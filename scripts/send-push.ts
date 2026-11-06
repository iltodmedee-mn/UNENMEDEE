/**
 * Push notifications for subscribers ("Мэдэгдэл авах").
 *
 *   npm run push:send -- --mode news     # important news analyzed in the last day (after ai:process)
 *   npm run push:send -- --mode digest   # the newest digest edition (after npm run digest)
 *   npm run push:send -- --mode news --dry-run
 *
 * News: importance >= 70 or a risk flag, published in the last 24 h, never notified before.
 * One notification per run: the top story, with "+N чухал мэдээ" for the rest.
 * News mode also sends "Миний гишүүн" alerts: one per subscriber whose followed MPs are named
 * (extracted_entities.people = politicians.short_name) in articles of the last 24 h.
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { appSettings, articles, digests, politicians, pushSubscriptions, sources } from "@/db/schema";
import { mentionAlerts } from "@/lib/officials/follow-alerts";
import { digestPayload, newsPayload, type PushPayload } from "@/lib/push/core";
import { sendToAll, sendToEndpoint } from "@/lib/push/server";
import { oneLine } from "@/lib/log-safe";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "news" },
    "dry-run": { type: "boolean", default: false },
  },
});

const IMPORTANCE_MIN = Number(process.env.PUSH_IMPORTANCE_MIN ?? 70);
const LAST_DIGEST_KEY = "push_last_digest_id";

async function newsPayloads(): Promise<{ payloads: PushPayload[]; ids: number[] }> {
  const db = getDb();
  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: sql<string>`coalesce(${articles.readerTitle}, ${articles.title})`,
      tldr: articles.tldrSummary,
      sourceName: sources.name,
      riskFlag: articles.riskFlag,
    })
    .from(articles)
    .innerJoin(sources, eq(articles.sourceId, sources.id))
    .where(
      and(
        eq(articles.isPublished, true),
        isNotNull(articles.tldrSummary),
        isNull(articles.notifiedAt),
        gte(articles.publishedAt, new Date(Date.now() - 24 * 3_600_000)),
        or(gte(articles.importanceScore, IMPORTANCE_MIN), eq(articles.riskFlag, true)),
      ),
    )
    .orderBy(sql`${articles.importanceScore} desc nulls last`, desc(articles.riskScore))
    .limit(50);
  const payload = newsPayload(rows);
  return { payloads: payload ? [payload] : [], ids: rows.map((r) => r.id) };
}

async function digestPayloads(): Promise<{ payloads: PushPayload[]; digestId: number | null; previous?: string | null }> {
  const db = getDb();
  const [latest] = await db
    .select()
    .from(digests)
    // 12 h: a push step that failed is retried by the next pipeline run, not lost.
    .where(gte(digests.createdAt, new Date(Date.now() - 12 * 3_600_000)))
    .orderBy(desc(digests.createdAt))
    .limit(1);
  if (!latest) return { payloads: [], digestId: null };
  const [last] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, LAST_DIGEST_KEY));
  if (last && Number(last.value) >= latest.id) return { payloads: [], digestId: null };
  return { payloads: [digestPayload(latest)], digestId: latest.id, previous: last?.value ?? null };
}

/**
 * Claims a digest for this run before anything is sent: only the run whose update moves
 * push_last_digest_id forward sends it, so two workflows finishing together never push twice.
 */
async function claimDigest(id: number): Promise<boolean> {
  const rows = await getDb()
    .insert(appSettings)
    .values({ key: LAST_DIGEST_KEY, value: String(id) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(id), updatedAt: new Date() }, setWhere: sql`${appSettings.value}::int < ${id}` })
    .returning({ value: appSettings.value });
  return rows.length > 0;
}

async function sendMentionAlerts(dryRun: boolean) {
  const db = getDb();
  const rows = await db
    .select({ id: articles.id, slug: articles.slug, title: articles.title, people: sql<string[]>`coalesce(${articles.extractedEntities}->'people', '[]'::jsonb)` })
    .from(articles)
    .where(and(eq(articles.isPublished, true), isNotNull(articles.tldrSummary), isNull(articles.mentionNotifiedAt), gte(articles.publishedAt, new Date(Date.now() - 24 * 3_600_000))))
    .orderBy(sql`${articles.importanceScore} desc nulls last`)
    .limit(200);
  if (!rows.length) return;
  const [pols, subs] = await Promise.all([
    // Every member, former ones included: a short name shared across terms is never attributed.
    db.select({ id: politicians.id, shortName: politicians.shortName, isActive: politicians.isActive }).from(politicians),
    db.select({ endpoint: pushSubscriptions.endpoint, follows: pushSubscriptions.followPoliticians }).from(pushSubscriptions).where(sql`cardinality(${pushSubscriptions.followPoliticians}) > 0`),
  ]);
  const alerts = mentionAlerts(rows, pols, subs);
  for (const a of alerts) console.log(`  → mention: ${oneLine(a.payload.title)} | ${oneLine(a.payload.body)}`);
  if (dryRun) return;
  let sent = 0;
  for (const a of alerts) if ((await sendToEndpoint(db, a.endpoint, a.payload)).ok) sent++;
  // Every alert failed (push service down): leave the rows for the next run (24 h window).
  if (alerts.length > 0 && sent === 0) return console.log(`👤 Миний гишүүн: 0/${alerts.length} alert(s) delivered; retried next run.`);
  await db.update(articles).set({ mentionNotifiedAt: new Date() }).where(inArray(articles.id, rows.map((r) => r.id)));
  console.log(`👤 Миний гишүүн: ${sent}/${alerts.length} alert(s) sent for ${rows.length} new article(s).`);
}

async function main() {
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const db = getDb();
  const mode = values.mode === "digest" ? "digest" : "news";
  if (mode === "news") await sendMentionAlerts(values["dry-run"]);
  const plan = mode === "digest" ? await digestPayloads() : await newsPayloads();
  if (plan.payloads.length === 0) {
    console.log(`🔕 Nothing new to notify (${mode}).`);
    return;
  }
  for (const p of plan.payloads) console.log(`  → ${oneLine(p.title)} | ${oneLine(p.body)} | ${p.url}`);
  if (values["dry-run"]) return;

  if ("digestId" in plan && plan.digestId !== null && !(await claimDigest(plan.digestId))) {
    console.log("🔕 Another run already sent this digest.");
    return;
  }
  const res = await sendToAll(db, plan.payloads);
  const allFailed = res.sent === 0 && res.failed > 0;
  // Mark as notified once something was delivered, or with zero subscribers (future subscribers
  // should not get a backlog). A run where every send failed leaves it for the next run.
  if ("ids" in plan && plan.ids.length && !allFailed) await db.update(articles).set({ notifiedAt: new Date() }).where(inArray(articles.id, plan.ids));
  if ("digestId" in plan && plan.digestId !== null && allFailed) {
    // Give the claim back so the next run (12 h window) tries again.
    await db
      .update(appSettings)
      .set({ value: plan.previous ?? "0", updatedAt: new Date() })
      .where(and(eq(appSettings.key, LAST_DIGEST_KEY), eq(appSettings.value, String(plan.digestId))));
  }
  console.log(`🔔 ${mode}: ${res.sent} notification(s) sent, ${res.failed} failed, ${res.removed} dead subscription(s) removed.`);
}

main()
  .catch((err) => {
    console.error("✗ Push failed:", err);
    process.exitCode = 1;
  })
  .finally(closeDb);
