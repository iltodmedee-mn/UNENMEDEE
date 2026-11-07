import { and, eq, gte, inArray, sql } from "drizzle-orm";

import type { DB } from "@/db";
import { articles, seenUrls, sources } from "@/db/schema";
import { contentHash, slugify, truncate } from "@/lib/text";

import type { ArticleSink } from "./crawl";
import { isDayLevel, isFutureDate, MAX_AGE_DAYS, publishDecision } from "./dates";
import { isStaticPageUrl } from "./links";
import { firstSentenceTitle, isGenericTitle, looksEmptyBody, looksLikeNavigation, looksLikeUnitPage, unshoutTitle } from "./titles";
import type { ScrapedItem, SourceRef, SourceRunResult } from "./types";

/** Hard cap per article to protect the 500 MB Supabase free tier (~15 KB of text). */
export const MAX_STORED_CHARS = 15_000;

/** Sources whose items legitimately share titles (a dataset name per release). */
const REPEATING_TITLES = new Set(["opendata.gov.mn"]);

export interface SinkOptions {
  /** Dated items older than this many days are stored unpublished (a backfill passes its window). */
  maxAgeDays?: number;
}

/** Day-level dates this old and shared by this many rows of one source are a stray stamp, not a date. */
const SHARED_DATE_ROWS = 10;
const SHARED_DATE_MIN_DAYS = 30;

/** `seen_urls.content_hash` of a page that had no article text (never a real SHA-256). */
export const NO_TEXT_HASH = "no-text";

export function createDbSink(db: DB, options: SinkOptions = {}): ArticleSink {
  const maxAgeDays = Math.max(options.maxAgeDays ?? MAX_AGE_DAYS, MAX_AGE_DAYS);
  const claimed = new Set<string>();
  return {
    async filterNewUrls(urls) {
      if (urls.length === 0) return new Set();
      // seen_urls holds the URLs of rows the retention job deleted (src/lib/retention.ts).
      const [existing, deleted] = await Promise.all([
        db.select({ url: articles.originalUrl }).from(articles).where(inArray(articles.originalUrl, urls)),
        db.select({ url: seenUrls.originalUrl }).from(seenUrls).where(inArray(seenUrls.originalUrl, urls)),
      ]);
      const known = new Set([...existing, ...deleted].map((r) => r.url));
      return new Set(urls.filter((u) => !known.has(u)));
    },

    async markNoText(source, url) {
      // Photo and video posts (www.gov.mn, police.gov.mn) were fetched again every run, 8 s each,
      // and used up the per-source limit before the real stories behind them were reached.
      await db.insert(seenUrls).values({ originalUrl: url, contentHash: NO_TEXT_HASH, sourceId: source.id }).onConflictDoNothing();
    },

    async save(source: SourceRef, item: ScrapedItem) {
      // Hash the full cleaned text BEFORE any LLM call (CLAUDE.md rule #2).
      const hash = contentHash(item.text);
      // Claimed for this run before the database check: two URLs of one page saved by concurrent
      // requests both passed the check and were both stored (#1379/#1380, 0.45 s apart), and the
      // AI analysed the same text twice.
      if (claimed.has(hash)) return "duplicate";
      claimed.add(hash);
      const [dup, deletedDup] = await Promise.all([
        db.select({ id: articles.id }).from(articles).where(eq(articles.contentHash, hash)).limit(1),
        db.select({ url: seenUrls.originalUrl }).from(seenUrls).where(eq(seenUrls.contentHash, hash)).limit(1),
      ]);
      if (dup.length || deletedDup.length) return "duplicate";
      let title = item.title;
      let siteTitle = isGenericTitle(title, [source.name]);
      if (!siteTitle && !REPEATING_TITLES.has(source.domain)) {
        // The same title already used by this site this month: it is the site's title, not a headline.
        const seen = await db
          .select({ id: articles.id })
          .from(articles)
          .where(and(eq(articles.sourceId, source.id), inArray(articles.title, [title, unshoutTitle(title)]), gte(articles.createdAt, new Date(Date.now() - 30 * 86_400_000))))
          .limit(1);
        siteTitle = seen.length > 0;
      }
      // A site title over menu text is a homepage or a menu page: keep it (so it is not fetched
      // again) but never publish it.
      const menuPage = siteTitle && looksLikeNavigation(item.text);
      if (siteTitle && !menuPage) title = firstSentenceTitle(item.text);
      // A department's "about" page (district CMSs link them like news), a CMS static page or a post
      // whose body block is empty (gov.mn image-only posts): stored, never published.
      const notNews = menuPage || looksLikeUnitPage(title, item.text) || looksEmptyBody(item.text) || isStaticPageUrl(item.url);
      title = unshoutTitle(title);
      // Feeds and APIs (zasag RSS, parliament, WordPress date_gmt) are not checked by the extractor:
      // a date in the future is an event date or a typo, never the publication time.
      let publishedAt = item.publishedAt && !isFutureDate(item.publishedAt) ? item.publishedAt : null;
      // A day-level date from weeks ago that this source already gave 10+ articles is a stamp in
      // the page chrome (judcouncil.mn dated 39 stories "2019-10-22"): keep the story, drop the date.
      if (publishedAt && isDayLevel(publishedAt) && publishedAt.getTime() < Date.now() - SHARED_DATE_MIN_DAYS * 86_400_000) {
        const same = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(articles)
          .where(and(eq(articles.sourceId, source.id), eq(articles.publishedAt, publishedAt)));
        if ((same[0]?.n ?? 0) >= SHARED_DATE_ROWS) publishedAt = null;
      }
      const meta = { ...item.meta, ...(publishedAt ? {} : { date_unknown: true }) };
      const inserted = await db
        .insert(articles)
        .values({
          sourceId: source.id,
          title: title.slice(0, 500),
          slug: slugify(title, item.url),
          originalUrl: item.url,
          contentHash: hash,
          cleanContent: truncate(item.text, MAX_STORED_CHARS),
          scrapeMeta: Object.keys(meta).length ? meta : null,
          // Undated: the time we found it (feeds sort by date), flagged as unknown above. An undated
          // post whose text only mentions years before last year is an old page, not news.
          publishedAt: publishedAt ?? new Date(),
          isPublished: notNews ? false : (publishDecision(publishedAt, item.text, new Date(), maxAgeDays) ?? undefined),
          // tldr_summary stays null so `npm run ai:process` picks it up.
        })
        .onConflictDoNothing()
        .returning({ id: articles.id });
      return inserted.length ? "inserted" : "duplicate";
    },
  };
}

/** Writes per-source health after a run (drives exponential backoff for dead sites). */
export async function recordSourceResults(db: DB, results: SourceRunResult[]): Promise<void> {
  const now = new Date();
  for (const r of results) {
    if (!r.completed) continue; // not reached before the time budget: keep it first in line
    await db
      .update(sources)
      .set(
        r.error
          ? { lastScrapedAt: now, lastError: r.error.slice(0, 500), consecutiveFailures: sql`${sources.consecutiveFailures} + 1` }
          : { lastScrapedAt: now, lastError: null, consecutiveFailures: 0 },
      )
      .where(eq(sources.id, r.sourceId));
  }
}

/**
 * Hours a source waits after n consecutive failures: 2, 4, 8, 8… A dead site costs one failed
 * listing every 8 h; a live site that timed out from the runner (Oct 28 2026: mof.gov.mn,
 * mfa.gov.mn, customs.gov.mn, ulaanbaatar.mn all at once) is back the same day. The old cap of
 * 64 h kept whole ministries silent for three days after one bad network minute.
 */
export const MAX_BACKOFF_H = 8;
export function backoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(2 ** consecutiveFailures, MAX_BACKOFF_H) * 3_600_000;
}

/** Active sources that are due, least-recently scraped first. */
export async function loadDueSources(db: DB, domains?: string[]) {
  const rows = await db
    .select()
    .from(sources)
    .where(domains?.length ? and(eq(sources.isActive, true), inArray(sources.domain, domains)) : eq(sources.isActive, true))
    .orderBy(sql`${sources.lastScrapedAt} asc nulls first`);
  const now = Date.now();
  return rows.filter((s) => {
    if (domains?.length || s.consecutiveFailures === 0 || !s.lastScrapedAt) return true;
    return now - s.lastScrapedAt.getTime() >= backoffMs(s.consecutiveFailures);
  });
}
