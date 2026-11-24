import { eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { appSettings, clusters, feedSnapshots } from "@/db/schema";
import { errorLine } from "@/lib/log-safe";
import { FEED_FILTERS, type FeedPageData, loadDigests, loadFeed, loadSiteStats } from "@/lib/queries";
import { contentHash, feedKey, FIRST_PAGE, SNAPSHOT_VERSION, snapshotTag } from "@/lib/snapshots";

/**
 * Writes every list page's snapshot (docs/adr/0001-list-pages-read-snapshots.md) and returns the
 * cache tags of those whose content changed. The hash covers the stories and the digest editions,
 * not the site counters: those change every run and would rebuild all ~23 list pages each time.
 * Run by the pipeline after it writes (scripts/write-snapshots.ts) and by admin edits.
 */
export async function writeSnapshots(now = new Date()): Promise<string[]> {
  const db = getDb();
  const [stats, [edition], [review], previous] = await Promise.all([
    loadSiteStats(),
    loadDigests("12h", 1),
    loadDigests("30d", 1),
    db.select({ key: feedSnapshots.key, hash: feedSnapshots.hash }).from(feedSnapshots),
  ]);
  const before = new Map(previous.map((r) => [r.key, r.hash]));
  const changed: string[] = [];
  // One list that fails to load must not lose the tags already changed: their new hashes are
  // stored, so without a purge now they would keep the old list for a day (audit R-6).
  let failed = 0;
  for (const filter of FEED_FILTERS) {
    try {
      changed.push(...(await writeOne(filter)));
    } catch (err) {
      failed++;
      console.log(`::warning::snapshot ${filter} not written: ${errorLine(err)}`);
    }
  }
  if (failed) console.log(`::warning::${failed} of ${FEED_FILTERS.length} list snapshot(s) not written; readers keep the previous ones.`);
  return changed;

  async function writeOne(filter: (typeof FEED_FILTERS)[number]): Promise<string[]> {
    const stories = await loadFeed(filter, FIRST_PAGE);
    const data: FeedPageData = { stories, stats, edition: edition ?? null, review: review ?? null };
    const hash = contentHash({ stories, edition: data.edition, review: data.review });
    const key = feedKey(filter);
    const value = { v: SNAPSHOT_VERSION, builtAt: now.toISOString(), data };
    await db
      .insert(feedSnapshots)
      .values({ key, data: value, hash, builtAt: now })
      .onConflictDoUpdate({ target: feedSnapshots.key, set: { data: value, hash, builtAt: now } });
    return before.get(key) !== hash ? [snapshotTag(key)] : [];
  }
}

const CLUSTERS_SEEN_KEY = "clusters_purged_state";

/**
 * Whether any cluster was created, refreshed or deleted since the last purge of the "clusters" tag,
 * and the state to store once that purge went through. Every run used to purge "clusters"
 * whatever happened, which expired every clustered article page and every cluster page 48 times a
 * day for crawlers to render again (Nov 2026 audit P-1); most runs change no cluster at all.
 */
export async function clustersChangedSince(): Promise<{ changed: boolean; state: string }> {
  const db = getDb();
  const [[row], [seen]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int`, at: sql<string | null>`max(${clusters.updatedAt})::text` }).from(clusters),
    db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, CLUSTERS_SEEN_KEY)),
  ]);
  const state = `${row?.n ?? 0}|${row?.at ?? ""}`;
  return { changed: seen?.value !== state, state };
}

/** Stored after the "clusters" purge succeeded, so the next run purges only after a new change. */
export async function rememberClusters(state: string): Promise<void> {
  await getDb()
    .insert(appSettings)
    .values({ key: CLUSTERS_SEEN_KEY, value: state })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: state, updatedAt: new Date() } });
}

/**
 * Forgets the stored hash of the snapshots behind these cache tags, so the next run sees them as
 * changed and purges them again. Called when the purge after a write failed: the new hash was
 * already stored, the next run would find "nothing changed", and the page (cached for a day,
 * refreshed only by a purge) kept the old list, a withdrawn story included, until its content
 * changed again.
 */
export async function forgetHashes(tags: string[]): Promise<number> {
  const keys = FEED_FILTERS.map(feedKey).filter((key) => tags.includes(snapshotTag(key)));
  if (keys.length === 0) return 0;
  const rows = await getDb().update(feedSnapshots).set({ hash: "" }).where(inArray(feedSnapshots.key, keys)).returning({ key: feedSnapshots.key });
  return rows.length;
}
