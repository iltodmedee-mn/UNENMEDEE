/**
 * The watchdog's database collectors (scripts/health-check.ts only orchestrates them). Each one
 * fills the snapshot `healthProblems` (health.ts) decides on, and asks the module that owns the
 * rule instead of restating it in SQL:
 *   - "published", "AI-summarized", "dated"           → story-rules.ts
 *   - what a `social_posts.post_id` means             → social/post-ledger.ts
 *   - the budget guard's day and provider set         → ai/usage-log.ts (`dailySpendUsd`)
 *   - what a failing source is                        → scraper/db-sink.ts (`sourceHealth`)
 * Only facts nobody else owns (table sizes, push counts, digest authors) are read here.
 * Pure of the clock: `now` is injected (tests/health-collect.test.ts, PGlite).
 */
import { and, desc, eq, gt, gte, isNull, sql, type SQL } from "drizzle-orm";

import type { DB } from "@/db";
import { appSettings, articles, digests, pressItems, pushSubscriptions, siteErrors, sources, videos } from "@/db/schema";
import { dailySpendUsd } from "@/lib/ai/usage-log";
import { type CoreSnapshot, type IntegritySnapshot, SOCIAL_PLATFORMS, type SocialPlatform, type SocialSnapshot } from "@/lib/health";
import { OUTLETS } from "@/lib/press/outlets";
import { MAX_AGE_DAYS } from "@/lib/scraper/dates";
import { sourceHealth } from "@/lib/scraper/db-sink";
import { EXTRACTION_KEY, parseExtractionReport } from "@/lib/scraper/recheck";
import { lastRealPost, unknownSince } from "@/lib/social/post-ledger";
import { aiSummarized, dated, published, undated } from "@/lib/story-rules";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The share of the daily paid cap (`AI_DAILY_BUDGET_USD`) from which a day counts as "at the cap". */
export const CAP_DAY_FRACTION = 0.9;

type At = Date | string | null;

/** Hours between a database timestamp (a Date, or the string a driver may return) and `now`; null when there is none. */
export function hoursSince(at: At | undefined, now: Date): number | null {
  if (!at) return null;
  return (now.getTime() - new Date(at).getTime()) / HOUR_MS;
}

const maxAt = (col: unknown) => sql<At>`max(${col})`;

async function newestArticle(db: DB, where: SQL | undefined, col: "createdAt" | "sourceCheckedAt" = "createdAt"): Promise<At> {
  const [r] = await db.select({ at: maxAt(articles[col]) }).from(articles).where(where);
  return r?.at ?? null;
}

async function countArticles(db: DB, where: SQL | undefined): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(articles).where(where);
  return r?.n ?? 0;
}

export async function collectCore(db: DB, now: Date, dailyUsd: number): Promise<CoreSnapshot> {
  const since24h = new Date(now.getTime() - DAY_MS);
  const [lastArticle, lastAi, lastRecheck, [lastDigest], [lastPush], aiBacklog, published24h, fallback24h, health, [push], recent, size, spend] = await Promise.all([
    // Published rows only: archive/menu pages stored unpublished must not make a dead feed look alive.
    newestArticle(db, published),
    newestArticle(db, aiSummarized),
    newestArticle(db, undefined, "sourceCheckedAt"),
    db.select({ at: maxAt(digests.createdAt) }).from(digests),
    db.select({ at: maxAt(pushSubscriptions.lastSuccessAt) }).from(pushSubscriptions),
    countArticles(db, and(published, isNull(articles.tldrSummary))),
    countArticles(db, and(published, gte(articles.createdAt, since24h))),
    countArticles(db, and(published, eq(articles.summaryFallback, true), gte(articles.createdAt, since24h))),
    sourceHealth(db),
    db.select({ subs: sql<number>`count(*)::int`, failing: sql<number>`(count(*) filter (where ${pushSubscriptions.failures} >= 3))::int` }).from(pushSubscriptions),
    db.select({ by: digests.generatedBy }).from(digests).where(eq(digests.kind, "12h")).orderBy(desc(digests.createdAt)).limit(4),
    db.execute(sql`select pg_database_size(current_database()) / 1048576.0 as mb`),
    dailySpendUsd(db, 7, now),
  ]);
  return {
    hoursSinceArticle: hoursSince(lastArticle, now),
    hoursSinceAi: hoursSince(lastAi, now),
    hoursSinceDigest: hoursSince(lastDigest?.at, now),
    aiBacklog,
    activeSources: health.active,
    failingSources: health.failing,
    pushSubs: push?.subs ?? 0,
    pushFailing: push?.failing ?? 0,
    hoursSincePushSuccess: hoursSince(lastPush?.at, now),
    dbMb: Number((size as unknown as { rows: { mb: unknown }[] }).rows[0]?.mb ?? 0),
    published24h,
    fallback24h,
    recentDigests: recent.map((r) => r.by),
    paidCapDays: spend.filter((usd) => usd >= dailyUsd * CAP_DAY_FRACTION).length,
    hoursSinceRecheck: hoursSince(lastRecheck, now),
  };
}

/** Data the public site must never show wrong (health.ts IntegritySnapshot). */
/** Published undated stories one source may add in 24 h before the watchdog names it. */
export const UNDATED_BURST = 3;

/** SQL twin of `isLatinText` (script.ts) for the plain A–Z letters: more Latin than Cyrillic, 12+ of them. */
const latinMostly = (col: SQL) => sql`(length(regexp_replace(coalesce(${col}, ''), '[^A-Za-z]', '', 'g')) >= 12
  and length(regexp_replace(coalesce(${col}, ''), '[^A-Za-z]', '', 'g')) > length(regexp_replace(coalesce(${col}, ''), '[^А-Яа-яЁёӨөҮү]', '', 'g')))`;

export async function collectIntegrity(db: DB, now: Date): Promise<IntegritySnapshot> {
  const since30d = new Date(now.getTime() - 30 * DAY_MS);
  const since14d = new Date(now.getTime() - 14 * DAY_MS);
  const oldestFresh = new Date(now.getTime() - MAX_AGE_DAYS * DAY_MS);
  // like, not a regex: in a template literal "\[" loses its backslash and became a class.
  const brokenText = sql`(${articles.tldrSummary} like '%undefined%' or ${articles.tldrSummary} like '%[object Object]%'
    or ${articles.tldrSummary} like '%''facts'':%' or ${articles.tldrSummary} like '%"facts":%'
    or ${articles.factVsSpin}::text like '%[object Object]%'
    or ${articles.factVsSpin}->>'spin_detected' in ('undefined', 'null')
    or ${latinMostly(sql`${articles.tldrSummary}`)} or ${latinMostly(sql`${articles.readerTitle}`)})`;
  const since24h = new Date(now.getTime() - DAY_MS);
  const [broken, wide, dups, silent, burst] = await Promise.all([
    countArticles(db, and(published, gte(articles.createdAt, since30d), brokenText)),
    db.execute(sql`select count(*)::int as n from (select cluster_id from articles where cluster_id is not null and ${published}
      group by cluster_id having max(published_at) - min(published_at) > interval '7 days') c`),
    db.execute(sql`select count(*)::int as n from (select content_hash from articles group by content_hash having count(*) > 1) d`),
    // Only rows the publish rule would show: dated and inside MAX_AGE_DAYS. Sites whose link harvest
    // finds only old archive pages or undated static pages store them unpublished on purpose;
    // counting those named 19 healthy sources (Nov 2026).
    db
      .select({ domain: sources.domain })
      .from(sources)
      .innerJoin(articles, eq(articles.sourceId, sources.id))
      .where(and(eq(sources.isActive, true), gte(articles.createdAt, since14d), gt(articles.publishedAt, oldestFresh), dated))
      .groupBy(sources.domain)
      .having(sql`count(*) >= 10 and count(*) filter (where ${articles.isPublished}) = 0`)
      .orderBy(sources.domain),
    // Several undated stories from one site in a day are almost always an old archive read as new
    // (Nov 7 2026: 14 khural.mn resolutions from 2025 led the feed as "found today").
    db
      .select({ domain: sources.domain })
      .from(sources)
      .innerJoin(articles, eq(articles.sourceId, sources.id))
      .where(and(published, undated, gte(articles.createdAt, since24h)))
      .groupBy(sources.domain)
      .having(sql`count(*) >= ${UNDATED_BURST}`)
      .orderBy(sources.domain),
  ]);
  const n = (r: unknown) => Number((r as { rows: { n: unknown }[] }).rows[0]?.n ?? 0);
  // Server errors readers hit in the last 24 h (src/instrumentation.ts → site_errors).
  const errors = await db
    .select({ route: siteErrors.route, message: siteErrors.message, count: siteErrors.count })
    .from(siteErrors)
    .where(gte(siteErrors.lastSeen, since24h))
    .orderBy(desc(siteErrors.count))
    .limit(5);
  // The pipeline fallback's last GitHub answer (pg_net keeps responses for a few hours): a 4xx means
  // the token or the URL is wrong and the fallback silently does nothing (Nov 7 2026: 403 for a day).
  const dispatch = await db
    .execute(sql`select status_code from net._http_response where created > ${since24h} order by created desc limit 1`)
    .then((r) => Number((r as unknown as { rows: { status_code: unknown }[] }).rows[0]?.status_code ?? 0) || null)
    .catch(() => null);
  // The weekly extraction check (scripts/recheck-sources.ts); a report older than 15 days is stale.
  const [extractionRow] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, EXTRACTION_KEY));
  const extraction = parseExtractionReport(extractionRow?.value);
  const extractionFresh = extraction && now.getTime() - Date.parse(extraction.at) < 15 * DAY_MS;
  return {
    brokenAiText: broken,
    widespreadClusters: n(wide),
    duplicateHashes: n(dups),
    silentSources: silent.map((x) => x.domain),
    undatedBursts: burst.map((x) => x.domain),
    siteErrors: errors,
    fallbackDispatchStatus: dispatch,
    unreadableSources: extractionFresh ? extraction.broken.map((b) => `${b.domain} (${b.empty}/${b.read})`) : [],
  };
}

/** Per platform: hours since a post really went out, and posts of unknown outcome in the last 7 days. */
export async function collectSocial(db: DB, now: Date): Promise<Partial<Record<SocialPlatform, SocialSnapshot>>> {
  const unknown = await unknownSince(db, 7, now);
  const out: Partial<Record<SocialPlatform, SocialSnapshot>> = {};
  for (const p of SOCIAL_PLATFORMS) out[p] = { hoursSinceOk: hoursSince(await lastRealPost(db, p), now), unknown7d: unknown[p] ?? 0 };
  return out;
}

/** The newest video made, per platform the newest video really posted, and per press outlet the newest headline. */
export async function collectVideosAndPress(db: DB, now: Date) {
  const [lastVideo] = await db.select({ at: maxAt(videos.createdAt) }).from(videos);
  const hoursSincePost: Partial<Record<SocialPlatform, number | null>> = {};
  for (const p of SOCIAL_PLATFORMS) {
    const at = await lastRealPost(db, p, "video");
    if (at) hoursSincePost[p] = hoursSince(at, now);
  }
  const press: Record<string, number | null> = Object.fromEntries(OUTLETS.map((o) => [o.domain, null]));
  const found = await db.select({ outlet: pressItems.outlet, at: maxAt(pressItems.foundAt) }).from(pressItems).groupBy(pressItems.outlet);
  for (const r of found) if (r.outlet in press) press[r.outlet] = hoursSince(r.at, now);
  return { videos: { hoursSinceVideo: hoursSince(lastVideo?.at, now), hoursSincePost }, press };
}
