import { inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { feedSnapshots } from "@/db/schema";
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
  for (const filter of FEED_FILTERS) {
    const stories = await loadFeed(filter, FIRST_PAGE);
    const data: FeedPageData = { stories, stats, edition: edition ?? null, review: review ?? null };
    const hash = contentHash({ stories, edition: data.edition, review: data.review });
    const key = feedKey(filter);
    const value = { v: SNAPSHOT_VERSION, builtAt: now.toISOString(), data };
    await db
      .insert(feedSnapshots)
      .values({ key, data: value, hash, builtAt: now })
      .onConflictDoUpdate({ target: feedSnapshots.key, set: { data: value, hash, builtAt: now } });
    if (before.get(key) !== hash) changed.push(snapshotTag(key));
  }
  return changed;
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
