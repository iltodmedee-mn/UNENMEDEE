import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import type { DB } from "@/db";
import { articles, seenUrls, sources } from "@/db/schema";
import { contentHash, slugify, truncate } from "@/lib/text";

import { API_ADAPTERS } from "./adapters";
import type { ArticleSink } from "./crawl";
import { isDayLevel, isFutureDate, MAX_AGE_DAYS, publishDecision } from "./dates";
import { isStaticPageUrl } from "./links";
import { firstSentenceTitle, isGenericTitle, looksEmptyBody, looksLikeNavigation, looksLikeUnitPage, unshoutTitle } from "./titles";
import type { ScrapedItem, SourceRef, SourceRunResult } from "./types";

/** Hard cap per article to protect the 500 MB Supabase free tier (~15 KB of text). */
export const MAX_STORED_CHARS = 15_000;

/**
 * Sources whose items legitimately share titles (a dataset name per release). API and feed items
 * (legalinfo.mn acts, parliament, zasag, police, the gov.mn portal) carry a real headline, never a
 * `<title>`: a repeated "ЖУРАМ БАТЛАХ ТУХАЙ" is a second act, not the site's name.
 */
export function repeatsTitles(domain: string): boolean {
  return domain === "opendata.gov.mn" || Object.hasOwn(API_ADAPTERS, domain);
}

/** A source that lists one dataset again under a new id, and how long a same-named item counts as that dataset. */
export const RELISTING_DOMAIN = "opendata.gov.mn";
export const RELIST_DAYS = 7;

/**
 * A source posting one notice several times (Nov 25 2026: gov.mn carried one Арвайхээр land auction
 * as four posts that differed only in the parcel number; a teachers' contest went up four times,
 * a theatre notice twice). A post with the same title as one this source published within
 * `REPOST_DAYS`, whose words match it by `REPOST_SIMILARITY` with numbers ignored, is the same
 * notice. The title must match: judcouncil.mn's candidate notices share one body and differ only by
 * the name in the title, and each is its own story. Measured on the last 3 weeks: every such pair
 * scored 0.98–1.0; the closest real different stories on one site scored 0.88.
 */
export const REPOST_DAYS = 3;
export const REPOST_SIMILARITY = 0.9;

/** Characters of the title the database compares; the rest is checked by `sameTitle`. */
const TITLE_PREFIX = 40;

/**
 * Two titles of one post: equal, or one is the other cut short with "…" (gov.mn's listing cuts
 * long titles: the theatre and customs notices of Nov 2026 came once whole and once cut).
 */
export function sameTitle(a: string, b: string): boolean {
  const cut = (t: string) => t.trim().replace(/(…|\.\.\.)$/u, "").trim();
  const x = cut(a);
  const y = cut(b);
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const wasCut = /(…|\.\.\.)\s*$/u.test(x.length <= y.length ? a : b);
  return wasCut && short.length >= TITLE_PREFIX && long.startsWith(short);
}

/** Distinct words longer than two letters, lower-cased, every number read as "#". */
export function bodyWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/\d+/g, "#")
      .split(/[^\p{L}\p{N}#]+/u)
      .filter((w) => w.length > 2),
  );
}

/** Jaccard similarity of two bodies' word sets (0 when either is empty). */
export function bodySimilarity(a: string, b: string): number {
  const x = bodyWords(a);
  const y = bodyWords(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

export interface SinkOptions {
  /** Dated items older than this many days are stored unpublished (a backfill passes its window; it also marks a backfill). */
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
  // A backfill reads many genuine posts of one past day: the stray-stamp rule would date the 11th as "found now".
  const backfill = options.maxAgeDays !== undefined;
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
      // A duplicate of a stored article remembers its own URL: it was fetched again every run, 8 s a time (audit D-3).
      const remember = () => db.insert(seenUrls).values({ originalUrl: item.url, contentHash: hash, sourceId: source.id }).onConflictDoNothing();
      // An in-memory claim is not a stored article yet (its save may still fail): nothing is remembered for it.
      if (claimed.has(hash)) return "duplicate";
      claimed.add(hash);
      // A save that throws gives its claim back, so the same text can be tried again this run
      // (CodeRabbit on #337): a failed claim used to read as "duplicate" until the run ended.
      try {
        const [dup, deletedDup] = await Promise.all([
          db.select({ id: articles.id }).from(articles).where(eq(articles.contentHash, hash)).limit(1),
          db.select({ url: seenUrls.originalUrl }).from(seenUrls).where(eq(seenUrls.contentHash, hash)).limit(1),
        ]);
        if (dup.length || deletedDup.length) {
          await remember();
          return "duplicate";
        }
        // opendata.gov.mn lists the same registry datasets again every day under a new id, with only
        // the "last updated" line changed (6 datasets × 6 days in Oct-Nov 2026): one story a week.
        if (source.domain === RELISTING_DOMAIN) {
          const relisted = await db
            .select({ id: articles.id })
            .from(articles)
            .where(and(eq(articles.sourceId, source.id), eq(articles.title, unshoutTitle(item.title).slice(0, 500)), gte(articles.createdAt, new Date(Date.now() - RELIST_DAYS * 86_400_000))))
            .limit(1);
          if (relisted.length) {
            await db.insert(seenUrls).values({ originalUrl: item.url, contentHash: hash, sourceId: source.id }).onConflictDoNothing();
            return "duplicate";
          }
        }
        // The same notice posted again by this source (see REPOST_DAYS): only rows with this exact
        // title (or that title cut with "…") are read, so the check costs a few KB at most. opendata.gov.mn has its own weekly rule above.
        if (source.domain !== RELISTING_DOMAIN) {
          // The date the row will be stored with: a future date is an event date, stored as "found now".
          const at = (item.publishedAt && !isFutureDate(item.publishedAt) ? item.publishedAt : new Date()).getTime();
          const span = REPOST_DAYS * 86_400_000;
          const newTitle = unshoutTitle(item.title).slice(0, 500);
          const candidates = await db
            .select({ title: articles.title, text: articles.cleanContent })
            .from(articles)
            .where(
              and(
                eq(articles.sourceId, source.id),
                sql`left(${articles.title}, ${TITLE_PREFIX}) = ${newTitle.slice(0, TITLE_PREFIX)}`,
                eq(articles.isPublished, true),
                gte(articles.publishedAt, new Date(at - span)),
                lte(articles.publishedAt, new Date(at + span)),
              ),
            )
            // The exact title first: more than 10 rows sharing the 40-character prefix must not push it out.
            .orderBy(sql`${articles.title} = ${newTitle} desc`, desc(articles.publishedAt))
            .limit(10);
          // Compared as stored: the row keeps at most MAX_STORED_CHARS of its text.
          const body = truncate(item.text, MAX_STORED_CHARS);
          if (candidates.some((r) => r.text && sameTitle(r.title, newTitle) && bodySimilarity(r.text, body) >= REPOST_SIMILARITY)) {
            await remember();
            return "duplicate";
          }
        }
        let title = item.title;
        let siteTitle = isGenericTitle(title, [source.name]);
        if (!siteTitle && !repeatsTitles(source.domain)) {
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
        if (!backfill && publishedAt && isDayLevel(publishedAt) && publishedAt.getTime() < Date.now() - SHARED_DATE_MIN_DAYS * 86_400_000) {
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
      } catch (err) {
        claimed.delete(hash);
        throw err;
      }
    },
  };
}

/**
 * Writes the verdict of each source's run (source-run.ts): failing sources count a failure (and
 * back off), ok ones reset it, and a source that keeps its place in line is left untouched.
 */
export async function recordSourceResults(db: DB, results: Pick<SourceRunResult, "sourceId" | "verdict">[]): Promise<void> {
  const now = new Date();
  for (const { sourceId, verdict } of results) {
    if (verdict.kind === "keepsPlace") continue;
    await db
      .update(sources)
      .set(
        verdict.kind === "failing"
          ? { lastScrapedAt: now, lastError: verdict.reason.slice(0, 500), consecutiveFailures: sql`${sources.consecutiveFailures} + 1` }
          : { lastScrapedAt: now, lastError: null, consecutiveFailures: 0 },
      )
      .where(eq(sources.id, sourceId));
  }
}

/**
 * How many active sources there are and how many of them are failing: the verdict
 * `recordSourceResults` wrote (a failing run raises `consecutive_failures`, an ok one resets it).
 * For the watchdog.
 */
export async function sourceHealth(db: DB): Promise<{ active: number; failing: number }> {
  const [r] = await db
    .select({ active: sql<number>`count(*)::int`, failing: sql<number>`(count(*) filter (where ${sources.consecutiveFailures} > 0))::int` })
    .from(sources)
    .where(eq(sources.isActive, true));
  return { active: r?.active ?? 0, failing: r?.failing ?? 0 };
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
