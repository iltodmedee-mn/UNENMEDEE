/**
 * Dual-LLM "anti-brainwash" pipeline.
 *
 *   npm run ai:process                    # analyze unprocessed articles (default 40)
 *   npm run ai:process -- --limit 10
 *   npm run ai:process -- --limit 600 --budget 60   # stop starting new articles after 60 min
 *   npm run ai:process -- --id 123 --deep # re-analyze one article, force Grok
 *   npm run ai:process -- --sample        # no DB: analyze a built-in sample, print the result
 *
 * Tier 1 (free Groq / Gemini / Requesty / NVIDIA, then DeepSeek) for every article, newest first;
 * Tier 2 (Grok → Gemini Flash → …) when risk_score >= 65. opendata.gov.mn datasets are summarized by rules (0 tokens).
 * Paid providers stop at AI_MONTHLY_BUDGET_USD / AI_DAILY_BUDGET_USD and per-provider daily
 * call caps (see src/lib/ai/limits.ts). Every call's tokens and USD cost go to ai_usage_logs,
 * and this month's total is synced into transparency_ledger.
 * Articles no AI could process within FALLBACK_AFTER_HOURS (or whose output was unusable) get
 * their first sentences as the summary, so the site keeps showing news when every provider fails.
 */
import "dotenv/config";
import { parseArgs } from "node:util";

import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { articles } from "@/db/schema";
import { analyzeArticle, assignClusters, formatDeepAnalysis, processArticle } from "@/lib/ai/analyze";
import { CEREMONY_MAX, isCeremonial } from "@/lib/ai/ceremony";
import { CLUSTER_WINDOW_DAYS } from "@/lib/ai/clustering";
import { extractiveSummary, FALLBACK_AFTER_HOURS, FALLBACK_IMPORTANCE, RETRY_FALLBACK_DAYS, RETRY_FALLBACK_PER_RUN, shouldPark } from "@/lib/ai/fallback";
import { AIUnavailableError } from "@/lib/ai/router";
import { budgetConfig } from "@/lib/ai/limits";
import { consoleUsageLogger, dbBudgetGuard, dbUsageLogger, syncLedgerAiCost } from "@/lib/ai/usage-log";
import { oneLine } from "@/lib/log-safe";

const { values } = parseArgs({
  options: {
    limit: { type: "string", default: "40" },
    // Minutes; 0 = no time limit. Keeps GitHub Actions jobs inside their timeout.
    budget: { type: "string", default: "0" },
    // Parallel articles. Kept low so free tiers (Gemini ~10-15 requests/min) are not flooded.
    // Three free providers take turns (spreadFree): three articles at a time keeps each busy.
    batch: { type: "string", default: process.env.AI_CONCURRENCY || "3" },
    id: { type: "string" },
    deep: { type: "boolean", default: false },
    sample: { type: "boolean", default: false },
    // Cluster every unclustered article of the last 7 days again (after a clustering change).
    recluster: { type: "boolean", default: false },
  },
});

const SAMPLE = {
  title: "Улаанбаатар хотын замын засварт 48.5 тэрбум төгрөгийг шууд гэрээгээр олгохоор шийдвэрлэлээ",
  sourceName: "Жишээ эх сурвалж",
  sourceDomain: "example.gov.mn",
  url: "https://example.gov.mn/news/1",
  publishedAt: new Date(),
  text: `Нийслэлийн Засаг даргын захирамжаар 2026 онд хийгдэх авто замын засварын ажилд 48.5 тэрбум төгрөгийг
"Түргэн Зам" ХХК-тай шууд гэрээ байгуулах замаар олгохоор боллоо. Худалдан авах ажиллагааг тендер зарлахгүйгээр,
онцгой нөхцөл байдлын улмаас шууд гэрээгээр шийдвэрлэсэн гэж албаны хүмүүс тайлбарлав. Энэхүү түүхэн, урьд өмнө
байгаагүй бүтээн байгуулалт нь хотын иргэдийн амьдралыг эрс сайжруулах болно хэмээн Нийслэлийн Засаг дарга онцоллоо.
Засварын ажлын хамрах километр, нэгж өртгийн тооцоог одоогоор олон нийтэд ил болгоогүй байна.`,
};

async function runSample() {
  console.log("🧪 Sample analysis (no database). Usage is printed, not stored.\n");
  const out = await analyzeArticle(SAMPLE, { log: consoleUsageLogger, forceDeep: values.deep });
  console.log(`\nTier 1 via ${out.tier1Provider}:`);
  console.log(JSON.stringify(out.tier1, null, 2));
  if (out.tier2) {
    console.log(`\nTier 2 via ${out.tier2Provider}:\n`);
    console.log(formatDeepAnalysis(out.tier2));
  }
  console.log(`\nTotal cost: $${out.costUsd.toFixed(6)}`);
}

/**
 * Gives stale or unprocessable published articles an extractive summary (labelled "AI
 * ажиллаагүй" on the page). Unpublished rows (kept for dedupe) are never shown, so they get none:
 * 503 such rows once carried a fallback and were counted as "AI-аар шүүгдсэн".
 */
async function applyFallbacks(db: ReturnType<typeof getDb>) {
  const stale = await db
    .select({ id: articles.id, text: articles.cleanContent, title: articles.title })
    .from(articles)
    .where(
      and(
        isNull(articles.tldrSummary),
        eq(articles.isPublished, true),
        or(isNotNull(articles.aiError), lt(articles.createdAt, new Date(Date.now() - FALLBACK_AFTER_HOURS * 3_600_000))),
      ),
    )
    .limit(300);
  for (const a of stale) {
    const tldr = extractiveSummary(a.text) || a.title;
    await db.update(articles).set({ tldrSummary: tldr, summaryFallback: true, importanceScore: FALLBACK_IMPORTANCE }).where(eq(articles.id, a.id));
  }
  if (stale.length) console.log(`📝 ${stale.length} article(s) waited over ${FALLBACK_AFTER_HOURS} h or could not be analyzed: shown with their first sentences (no AI).`);
}

/**
 * Rows analysed before the ceremony cap (or edited headlines) keep a model score of 85 for "…
 * хүлээн авч уулзлаа". Cheap and idempotent: only last month's rows still above the cap are read.
 */
async function capCeremonialRows(db: ReturnType<typeof getDb>) {
  const rows = await db
    .select({ id: articles.id, title: articles.title })
    .from(articles)
    .where(and(sql`${articles.importanceScore} > ${CEREMONY_MAX}`, gte(articles.createdAt, new Date(Date.now() - 45 * 86_400_000))));
  const ids = rows.filter((r) => isCeremonial(r.title)).map((r) => r.id);
  if (ids.length) {
    await db.update(articles).set({ importanceScore: CEREMONY_MAX }).where(inArray(articles.id, ids));
    console.log(`🎀 ${ids.length} ceremonial headline(s) (meetings, visits, openings) capped at importance ${CEREMONY_MAX}.`);
  }
}

async function main() {
  if (values.sample) return runSample();
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set. Use --sample to test the AI providers without a database.");
    process.exitCode = 1;
    return;
  }
  const db = getDb();
  const log = dbUsageLogger(db);
  const budget = dbBudgetGuard(db);
  const cfg = budgetConfig();
  console.log(
    `💰 Limits: $${cfg.monthlyUsd}/month, $${cfg.dailyUsd}/day for paid AI; Grok ≤ ${cfg.dailyMaxCalls.grok} calls/day; Gemini ≤ ${cfg.dailyMaxCalls.gemini} calls/day.`,
  );

  if (values.id) {
    const id = Number(values.id);
    const res = await processArticle(db, id, { log, budget, forceDeep: values.deep, purpose: values.deep ? "admin" : "tier1" });
    if (res.tier2Error) console.log(`  (deep analysis skipped: ${res.tier2Error.slice(0, 200)})`);
    console.log(`✓ #${id} risk=${res.tier1.risk_score} flag=${res.tier1.risk_flag} deep=${Boolean(res.tier2)} cluster=${res.clusterId ?? "—"} $${res.costUsd.toFixed(6)}`);
    await syncLedgerAiCost(db);
    return;
  }

  if (values.recluster) {
    const rows = await db
      .select({ id: articles.id })
      .from(articles)
      .where(and(isNotNull(articles.tldrSummary), eq(articles.isPublished, true), isNull(articles.clusterId), gte(articles.createdAt, new Date(Date.now() - CLUSTER_WINDOW_DAYS * 86_400_000))))
      .orderBy(articles.createdAt);
    const assigned = await assignClusters(db, rows.map((r) => r.id), log, budget);
    console.log(`🔗 Reclustered ${rows.length} article(s): ${[...assigned.values()].filter((c) => c !== null).length} now in a cluster.`);
    return;
  }

  await applyFallbacks(db);
  await capCeremonialRows(db);
  const limit = Math.max(1, Number(values.limit));
  const batchSize = Math.max(1, Number(values.batch));
  const fresh = await db
    .select({ id: articles.id, title: articles.title })
    .from(articles)
    // Unpublished rows (archive pages, menus, timeless pages) are kept for dedupe only: no AI.
    .where(and(isNull(articles.tldrSummary), isNull(articles.aiError), eq(articles.isPublished, true)))
    // Newest news first: after a backfill, today's stories are analyzed before last month's.
    .orderBy(sql`${articles.publishedAt} desc nulls last`, desc(articles.id))
    .limit(limit);
  // Articles that got the extractive fallback during an outage get a real analysis once providers
  // are back: a few per run, newest first, for a few days. (A failed run stops before reaching them.)
  const retries =
    fresh.length < limit
      ? await db
          .select({ id: articles.id, title: articles.title })
          .from(articles)
          .where(and(eq(articles.summaryFallback, true), isNull(articles.aiError), eq(articles.isPublished, true), gte(articles.createdAt, new Date(Date.now() - RETRY_FALLBACK_DAYS * 86_400_000))))
          .orderBy(desc(articles.id))
          .limit(Math.min(RETRY_FALLBACK_PER_RUN, limit - fresh.length))
      : [];
  const pending = [...fresh, ...retries];
  if (retries.length) console.log(`🔁 ${retries.length} article(s) with a no-AI fallback summary retried.`);

  console.log(`🧠 ${pending.length} article(s) to analyze, in batches of ${batchSize}.`);
  let done = 0;
  let flagged = 0;
  let cost = 0;
  let consecutiveProviderFailures = 0;
  let budgetStop = false;
  const analyzed: number[] = [];

  const budgetMin = Math.max(0, Number(values.budget) || 0);
  const deadline = budgetMin ? Date.now() + budgetMin * 60_000 : Infinity;
  for (let i = 0; i < pending.length && !budgetStop; i += batchSize) {
    if (Date.now() > deadline) {
      console.log(`⏱  Time budget of ${budgetMin} min reached; ${pending.length - i} article(s) wait for the next run.`);
      break;
    }
    const batch = pending.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map((a) => processArticle(db, a.id, { log, budget, cluster: false })));
    for (const [j, r] of results.entries()) {
      const a = batch[j];
      if (r.status === "fulfilled") {
        done++;
        analyzed.push(a.id);
        consecutiveProviderFailures = 0;
        cost += r.value.costUsd;
        if (r.value.tier1.risk_flag) flagged++;
        const via = r.value.tier1Provider === "rule-based" ? " (0 токен)" : "";
        const deep = r.value.tier2 ? ` ⚡${r.value.tier2Provider?.split("/")[0]}` : r.value.tier2Error ? " (гүнзгий шинжилгээ алгассан)" : "";
        console.log(`  ✓ #${a.id} risk=${String(r.value.tier1.risk_score).padStart(3)}${via}${deep}  ${oneLine(a.title, 70)}`);
        continue;
      }
      const err = r.reason;
      if (err instanceof AIUnavailableError && err.budgetExhausted) {
        console.log(`⏸  AI limit reached (${err.attempts[0]?.split("limit: ")[1]?.replace(/\)$/, "") ?? "budget"}). Remaining articles wait for the next run.`);
        budgetStop = true;
        break;
      }
      if (err instanceof AIUnavailableError && err.attempts.length === 0) {
        console.error(`✗ ${err.message}`);
        process.exitCode = 1;
        budgetStop = true; // no provider configured: stop, but still cluster what was analysed
        break;
      }
      const message = err instanceof Error ? err.message : String(err);
      const details = err instanceof AIUnavailableError ? err.attempts.join(" | ") : message;
      const badOutput = err instanceof AIUnavailableError ? shouldPark(err.attempts) : false;
      if (badOutput) {
        // The model cannot handle this text: park it so we do not pay for it every run.
        await db.update(articles).set({ aiError: details.slice(0, 500) }).where(eq(articles.id, a.id));
      } else {
        consecutiveProviderFailures++;
      }
      console.log(`  ✗ #${a.id} ${details.slice(0, 160)}`);
    }
    if (consecutiveProviderFailures >= batchSize * 2) {
      console.error("✗ AI providers keep failing (network, auth or rate limit). Stopping this run; articles stay queued.");
      process.exitCode = 1;
      break;
    }
  }

  // One pool load for the whole run (assignClusters), not one per article.
  if (analyzed.length) {
    const assigned = await assignClusters(db, analyzed, log, budget);
    const joined = [...assigned.entries()].filter(([, c]) => c !== null);
    if (joined.length) console.log(`🔗 ${joined.length} article(s) joined a cross-source story: ${joined.map(([id, c]) => `#${id}→${c}`).join(", ")}`);
  }

  const monthTotal = await syncLedgerAiCost(db);
  console.log(`\n📊 Analyzed ${done}/${pending.length}; ${flagged} high-risk (deep analysis). Run cost $${cost.toFixed(6)}; month total $${monthTotal.toFixed(6)}.`);
}

main()
  .catch((err) => {
    if (err instanceof AIUnavailableError) {
      console.error(`✗ ${err.message}`);
      for (const a of err.attempts) console.error(`   - ${a}`);
    } else {
      console.error("✗ AI pipeline crashed:", err);
    }
    process.exitCode = 1;
  })
  .finally(closeDb);
