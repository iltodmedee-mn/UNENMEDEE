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
