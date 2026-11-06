/**
 * Plain headlines and "Танд хамаатай юу?" for stories analysed before Tier 1 wrote them.
 *
 *   npm run ai:reader                 # up to 64 stories of the last 30 days, 8 per AI call
 *   npm run ai:reader -- --limit 200 --days 60
 *
 * Only feed stories (importance ≥ FEED_MIN_IMPORTANCE or not scored), newest first; no-AI
 * fallback summaries, opendata listings and rows already tried READER_MAX_ATTEMPTS times are
 * skipped, so a pipeline run is a no-op once everything is done. Free tier-1 chain behind the
 * budget guard; every call is logged.
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { articles, sources } from "@/db/schema";
import { READER_BATCH, READER_MAX_ATTEMPTS, ReaderBatchSchema, readerMessages, readerViewFor, type ReaderItem } from "@/lib/ai/reader-batch";
import { AIUnavailableError, callAIWithFallback } from "@/lib/ai/router";
import { dbBudgetGuard, dbUsageLogger } from "@/lib/ai/usage-log";
import { FEED_MIN_IMPORTANCE } from "@/lib/seo";

const { values } = parseArgs({ options: { limit: { type: "string", default: "64" }, days: { type: "string", default: "30" } } });

async function main() {
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const db = getDb();
  const since = new Date(Date.now() - Math.max(1, Number(values.days) || 30) * 86_400_000);
  const rows = await db
    .select({ id: articles.id, title: articles.title, summary: articles.tldrSummary, facts: articles.factVsSpin })
    .from(articles)
    .innerJoin(sources, eq(articles.sourceId, sources.id))
    .where(
      and(
        isNull(articles.readerTitle),
        isNotNull(articles.tldrSummary),
        eq(articles.summaryFallback, false),
        eq(articles.isPublished, true),
        gte(articles.publishedAt, since),
        or(isNull(articles.importanceScore), gte(articles.importanceScore, FEED_MIN_IMPORTANCE)),
        sql`coalesce((${articles.scrapeMeta}->>'reader_attempts')::int, 0) < ${READER_MAX_ATTEMPTS}`,
        ne(sources.domain, "opendata.gov.mn"),
      ),
    )
    .orderBy(desc(articles.publishedAt))
    .limit(Math.max(1, Number(values.limit) || 64));
  console.log(`📰 ${rows.length} stories without a plain headline`);
  const log = dbUsageLogger(db);
  const budget = dbBudgetGuard(db);
  let titled = 0;
  let impacts = 0;
  for (let i = 0; i < rows.length; i += READER_BATCH) {
    const batch: ReaderItem[] = rows.slice(i, i + READER_BATCH).map((r) => ({ id: r.id, title: r.title, summary: r.summary ?? "", facts: r.facts?.facts ?? [] }));
    try {
      const res = await callAIWithFallback({ tier: "tier1", purpose: "reader", messages: readerMessages(batch), schema: ReaderBatchSchema, log, budget, maxTokens: 2_400, temperature: 0.2 });
      const missed: number[] = [];
      for (const item of batch) {
        const view = readerViewFor(item, res.data.items[String(item.id)]);
        if (!view.title) {
          missed.push(item.id);
          continue;
        }
        await db.update(articles).set({ readerTitle: view.title, readerImpact: view.impact }).where(eq(articles.id, item.id));
        titled++;
        if (view.impact) impacts++;
      }
      // The model answered but gave no usable headline (or the title already was plain): count it.
      if (missed.length) {
        await db
          .update(articles)
          .set({
            scrapeMeta: sql`jsonb_set(coalesce(${articles.scrapeMeta}, '{}'::jsonb), '{reader_attempts}', to_jsonb(coalesce((${articles.scrapeMeta}->>'reader_attempts')::int, 0) + 1))`,
          })
          .where(inArray(articles.id, missed));
      }
      console.log(`  ✓ ${batch.length} via ${res.provider}/${res.model} → ${batch.length - missed.length} headlines`);
    } catch (err) {
      console.error(`  ✗ batch ${i / READER_BATCH + 1}: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
      if (err instanceof AIUnavailableError) break;
    }
  }
  console.log(`📰 Done: ${titled} plain headlines, ${impacts} with "Танд хамаатай юу?".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
