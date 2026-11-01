/**
 * Keeps the free 500 MB database from ever filling up (`npm run db:prune`, daily in news-digest).
 * Measured Oct 2026: +1.25 MB a day, 55 % of it unpublished rows kept only so the scraper does
 * not fetch the same pages again, and nothing was ever deleted. At 500 MB Supabase turns the
 * database read-only and the whole pipeline stops, so the job tightens itself as the database grows:
 *
 *   size       article bodies cut after   unpublished rows deleted after   old minor stories
 *   < 350 MB   RETENTION_DAYS (180)       90 days                          kept
 *   ≥ 350 MB   ≤ 90 days                  30 days                          kept
 *   ≥ 420 MB   ≤ 45 days                  30 days                          deleted (see below)
 *
 * A deleted row leaves its URL and SHA-256 in `seen_urls`, so the scraper still skips it.
 * "Old minor stories" (the owner's choice, Oct 2026) = published more than 2 years ago, in no
 * cluster, importance below 40 (already noindex), not a legal act, not edited, not in any digest.
 * Important stories, legal acts, clustered stories and digests are never deleted.
 * Every step works in batches of `BATCH` rows, so no statement runs into the query timeout.
 */
import { sql } from "drizzle-orm";

import type { DB } from "@/db";

export const DEFAULT_RETENTION_DAYS = 180;
export const EXCERPT_CHARS = 600;
export const UNPUBLISHED_KEEP_DAYS = 90;
export const SEEN_URL_KEEP_DAYS = 400;
/** AI call logs are kept this long; the monthly ledger keeps each month's total for good. */
export const LOG_KEEP_MONTHS = 13;
export const OLD_STORY_DAYS = 730;
export const OLD_STORY_MAX_IMPORTANCE = 40;
export const BATCH = 500;

export interface RetentionPlan {
  bodyDays: number;
  unpublishedDays: number;
  deleteOldStories: boolean;
}

export function retentionPlan(dbMb: number, configuredDays = DEFAULT_RETENTION_DAYS): RetentionPlan {
  const bodyDays = Math.max(30, Number.isFinite(configuredDays) ? configuredDays : DEFAULT_RETENTION_DAYS);
  if (dbMb >= 420) return { bodyDays: Math.min(bodyDays, 45), unpublishedDays: 30, deleteOldStories: true };
  if (dbMb >= 350) return { bodyDays: Math.min(bodyDays, 90), unpublishedDays: 30, deleteOldStories: false };
  return { bodyDays, unpublishedDays: UNPUBLISHED_KEEP_DAYS, deleteOldStories: false };
}

type Rows = { rows: Record<string, unknown>[] };
const run = async (db: DB, q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as Rows).rows;
const countOf = async (db: DB, q: ReturnType<typeof sql>) => Number((await run(db, q))[0]?.n ?? 0);

/** Runs `step` (one batch, returns rows touched) until a batch touches fewer than BATCH rows. */
async function batched(step: () => Promise<number>): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await step();
    total += n;
    if (n < BATCH) return total;
  }
}

export async function databaseMb(db: DB): Promise<number> {
  return countOf(db, sql`select pg_database_size(current_database()) / 1048576.0 as n`);
}

const bodyWhere = (days: number) =>
  sql`content_pruned_at is null and coalesce(published_at, created_at) < now() - make_interval(days => ${days}) and length(clean_content) > ${EXCERPT_CHARS}`;

/** Cuts article bodies older than `days` to an excerpt (title, summary, facts, link and hash stay). */
export async function pruneBodies(db: DB, days: number, dryRun = false): Promise<number> {
  if (dryRun) return countOf(db, sql`select count(*)::int as n from articles where ${bodyWhere(days)}`);
  return batched(async () => {
    const rows = await run(
      db,
      sql`update articles set clean_content = left(clean_content, ${EXCERPT_CHARS}), content_pruned_at = now()
        where id in (select id from articles where ${bodyWhere(days)} limit ${BATCH}) returning id`,
    );
    return rows.length;
  });
}

// A clustered or admin-edited row is kept: a cluster page lists its members, and an edit is a person's work.
const unpublishedWhere = (days: number) => sql`not is_published and edited_at is null and cluster_id is null and created_at < now() - make_interval(days => ${days})`;

const oldStoryWhere = sql`is_published and edited_at is null and cluster_id is null
  and coalesce(published_at, created_at) < now() - make_interval(days => ${OLD_STORY_DAYS})
  and coalesce(importance_score, 0) < ${OLD_STORY_MAX_IMPORTANCE}
  and source_id not in (select id from sources where domain = 'legalinfo.mn')
  and id not in (select (item->>'articleId')::int from digests, jsonb_array_elements(items) as item where item ? 'articleId')`;

export interface Deleted {
  rows: number;
  /** Of those, rows that had an AI summary (the public "analysed" counter keeps counting them). */
  analyzed: number;
}

/** Deletes matching articles in batches, recording each URL and hash in seen_urls first (one statement). */
async function deleteRemembering(db: DB, where: ReturnType<typeof sql>, dryRun: boolean): Promise<Deleted> {
  if (dryRun) {
    const [r] = await run(db, sql`select count(*)::int as n, count(tldr_summary)::int as a from articles where ${where}`);
    return { rows: Number(r?.n ?? 0), analyzed: Number(r?.a ?? 0) };
  }
  let analyzed = 0;
  const rows = await batched(async () => {
    const deleted = await run(
      db,
      sql`with doomed as (select id, original_url, content_hash, source_id from articles where ${where} order by id limit ${BATCH}),
        remembered as (insert into seen_urls (original_url, content_hash, source_id) select original_url, content_hash, source_id from doomed on conflict (original_url) do nothing)
        delete from articles where id in (select id from doomed) returning tldr_summary is not null as analyzed`,
    );
    analyzed += deleted.filter((r) => r.analyzed === true).length;
    return deleted.length;
  });
  return { rows, analyzed };
}

/** Unpublished rows (menus, old pages, backfill) only exist so the scraper skips them: seen_urls does that for ~2 % of the space. */
export function deleteUnpublished(db: DB, days: number, dryRun = false): Promise<Deleted> {
  return deleteRemembering(db, unpublishedWhere(days), dryRun);
}

/** Last tier, past 420 MB only: minor stories over two years old (see the file comment). */
export function deleteOldStories(db: DB, dryRun = false): Promise<Deleted> {
  return deleteRemembering(db, oldStoryWhere, dryRun);
}

export async function pruneSeenUrls(db: DB, dryRun = false): Promise<number> {
  const where = sql`seen_at < now() - make_interval(days => ${SEEN_URL_KEEP_DAYS})`;
  if (dryRun) return countOf(db, sql`select count(*)::int as n from seen_urls where ${where}`);
  return batched(async () => (await run(db, sql`delete from seen_urls where original_url in (select original_url from seen_urls where ${where} limit ${BATCH}) returning 1`)).length);
}

/**
 * AI call logs older than LOG_KEEP_MONTHS. The successful summary/analysis call of an existing
 * article stays: the article page names the model that wrote it from that row.
 */
export async function deleteOldUsageLogs(db: DB, dryRun = false): Promise<number> {
  const where = sql`created_at < now() - make_interval(months => ${LOG_KEEP_MONTHS})
    and not (success and article_id is not null and purpose in ('tier1', 'tier2', 'admin_tier1', 'admin_tier2'))`;
  if (dryRun) return countOf(db, sql`select count(*)::int as n from ai_usage_logs where ${where}`);
  return batched(async () => (await run(db, sql`delete from ai_usage_logs where id in (select id from ai_usage_logs where ${where} limit ${BATCH}) returning 1`)).length);
}

export interface PruneState {
  ranAt: string;
  dbMbBefore: number;
  dbMbAfter: number;
  plan: RetentionPlan;
  bodiesCut: number;
  unpublishedDeleted: number;
  oldStoriesDeleted: number;
  seenUrlsPruned: number;
  logsDeleted: number;
  /** Articles deleted by this job since it started, and how many of them had an AI summary: the public counters add them back. */
  articlesDeletedTotal: number;
  analyzedDeletedTotal: number;
}

export const PRUNE_STATE_KEY = "prune_state";

export async function readPruneState(db: DB): Promise<PruneState | null> {
  const [row] = await run(db, sql`select value from app_settings where key = ${PRUNE_STATE_KEY}`);
  if (!row) return null;
  try {
    return JSON.parse(String(row.value)) as PruneState;
  } catch {
    return null;
  }
}

/** One full run; with `dryRun` nothing changes and the counts say what would go. */
export async function runRetention(db: DB, opts: { configuredDays?: number; dryRun?: boolean } = {}): Promise<PruneState> {
  const dryRun = opts.dryRun ?? false;
  const dbMbBefore = await databaseMb(db);
  const plan = retentionPlan(dbMbBefore, opts.configuredDays);
  const bodiesCut = await pruneBodies(db, plan.bodyDays, dryRun);
  const unpublished = await deleteUnpublished(db, plan.unpublishedDays, dryRun);
  const oldStories = plan.deleteOldStories ? await deleteOldStories(db, dryRun) : { rows: 0, analyzed: 0 };
  const seenUrlsPruned = await pruneSeenUrls(db, dryRun);
  const logsDeleted = await deleteOldUsageLogs(db, dryRun);
  const previous = await readPruneState(db);
  const state: PruneState = {
    ranAt: new Date().toISOString(),
    dbMbBefore: Math.round(dbMbBefore * 10) / 10,
    dbMbAfter: Math.round((await databaseMb(db)) * 10) / 10,
    plan,
    bodiesCut,
    unpublishedDeleted: unpublished.rows,
    oldStoriesDeleted: oldStories.rows,
    seenUrlsPruned,
    logsDeleted,
    articlesDeletedTotal: (previous?.articlesDeletedTotal ?? 0) + (dryRun ? 0 : unpublished.rows + oldStories.rows),
    analyzedDeletedTotal: (previous?.analyzedDeletedTotal ?? 0) + (dryRun ? 0 : unpublished.analyzed + oldStories.analyzed),
  };
  if (!dryRun) {
    const value = JSON.stringify(state);
    await db.execute(sql`insert into app_settings (key, value, updated_at) values (${PRUNE_STATE_KEY}, ${value}, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()`);
  }
  return state;
}
