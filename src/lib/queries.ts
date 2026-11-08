import { and, count, desc, eq, gte, inArray, isNotNull, lt, lte, sql, type SQL } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { getDb, hasDatabase } from "@/db";
import { aiUsageLogs, appSettings, articles, assetDeclarations, clusters, digests, donations, feedSnapshots, indicatorSnapshots, openDatasets, politicians, pressItems, pressLinks, sources, tenders, documents, watchedPages, transparencyLedger, type AssetDeclaration, type OpenDataset, type Politician } from "@/db/schema";
import { shiftDate, ubDateKey, ubDayBounds } from "@/lib/archive";
import { activeBlacklist } from "@/lib/opendata-mn/highlights";
import { type BuyerSign, buyerSigns, type BuyerStats, isNonCompetitive, nationalShares, type NationalShares } from "@/lib/procurement/signs";
import { NO_AWARD_SQL } from "@/lib/procurement/tenders";
import { tenderAwarded, tenderFirstOfSame, tenderThisYear } from "@/lib/procurement/tender-sql";
import { DEFAULT_DONATION, type Donation, DONATION_KEY, parseDonation } from "@/lib/donation";
import type { DonationsSummary } from "@/lib/donations";
import { ABOUT_KEY, type About, DEFAULT_ABOUT, parseAbout } from "@/lib/about";
import { storedNeutrality, storedSpin } from "@/lib/ai/fact-spin";
import { declaredCompanies, foundKeys, matchWinners, type OfficialCompaniesSnapshot } from "@/lib/officials/companies";
import { sharedShortNames, suspectUnitYears } from "@/lib/officials/flags";
import { HIDDEN_YEARS_KEY, type HiddenYears, parseHiddenYears } from "@/lib/officials/hidden";
import type { SourceDiff, SourceStatus } from "@/lib/scraper/recheck";
import { isPressBlindspot } from "@/lib/press/outlets";
import { toPrefixQuery } from "@/lib/search";
import { feedKey, FIRST_PAGE, parseSnapshot, snapshotTag, toDate } from "@/lib/snapshots";
import { SOURCE_SEEDS } from "@/lib/sources";
import { LOG_KEEP_MONTHS, PRUNE_STATE_KEY } from "@/lib/retention";
import { ubMidnight } from "@/lib/ticker";
import { aiSummarized, dated, displayTitle, effectiveTopic, feedVisible, indexable, namesMnt, published, undated, visible } from "@/lib/story-rules";
import { findTopic, TOPICS } from "@/lib/topics";
import type { DatasetHighlight, DigestItem, ExtractedEntities, FactVsSpin, ReaderImpact, ScrapeMeta, SourceCategory } from "@/lib/types";

/**
 * Read model for the public site. Every function:
 *  - is cached with `use cache` + cacheLife + cacheTag (Next.js 16 Cache Components),
 *  - returns empty data when DATABASE_URL is missing or the DB is unreachable,
 *    so `next build` and contributors never need secrets (CLAUDE.md rule #6).
 */

export const FEED_FILTERS = ["all", "risk", "budget", "ministry", "local", ...TOPICS.map((t) => t.key)] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number];

export function parseFilter(value: string | string[] | undefined): FeedFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return (FEED_FILTERS as readonly string[]).includes(v ?? "") ? (v as FeedFilter) : "all";
}

export interface ArticleListItem {
  id: number;
  slug: string;
  /** The plain headline (`reader_title`) when Tier 1 wrote one, else the source's own. */
  title: string;
  /** The source's own headline when `title` is our plain one (shown under it as "Эх гарчиг"). */
  sourceTitle: string | null;
  /** "Танд хамаатай юу?" (null = the text names no one it changes things for). */
  impact: ReaderImpact | null;
  tldr: string;
  sourceName: string;
  sourceDomain: string;
  sourceCategory: SourceCategory;
  publishedAt: Date | null;
  riskScore: number;
  riskFlag: boolean;
  neutralityScore: number | null;
  amounts: string[];
  hasDeepAnalysis: boolean;
  clusterId: number | null;
  originalUrl: string;
  /** Articles in the same cross-source story (1 = only this one). */
  clusterSize: number;
  /** Topic the AI read from the text (null = filed by source domain). */
  topic: string | null;
  /** National significance 0-100 from Tier 1 (null = not scored). */
  importanceScore: number | null;
  /** The source page printed no date (`scrape_meta.date_unknown`): publishedAt is when we found it. */
  dateUnknown: boolean;
  /** No AI answered: `tldr` is the article's own first sentences (`summary_fallback`), not an AI summary. */
  summaryFallback: boolean;
  /** Press headlines that cover this story (src/lib/press/match.ts). */
  pressCount: number;
}

/**
 * A query that does not answer in time yields the empty state instead of hanging the render.
 * During `next build`, a hung `'use cache'` function fails the whole deploy; at runtime the
 * cached entry is simply refreshed on a later request.
 */
const QUERY_TIMEOUT_MS = Number(process.env.QUERY_TIMEOUT_MS ?? 10_000);

/** `next build` prerenders without a reachable database being a build failure: the empty state is right there. */
const BUILD_PHASE = process.env.NEXT_PHASE === "phase-production-build";

async function safe<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  if (!hasDatabase()) return fallback;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${QUERY_TIMEOUT_MS} ms`)), QUERY_TIMEOUT_MS);
    });
    return await Promise.race([fn(), timeout]);
  } catch (err) {
    console.error(`[queries] ${label} failed:`, err instanceof Error ? err.message : err);
    // At runtime the error propagates: a rejected 'use cache' call is not cached, so a database
    // blip costs one request, not an hour of "article not found" served from the cache.
    if (!BUILD_PHASE) throw err;
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How many different sources published this story's cluster, counted now: the stored
 * `clusters.article_count` counted articles (a second post from the same ministry made "3 эх
 * сурвалж") and was never lowered when a member was unpublished (clusters 1 and 3, Nov 2026).
 * The outer column is written out: Drizzle leaves columns unqualified in single-table selects, and
 * a bare "cluster_id" would bind to `m` inside the subquery.
 */
export const CLUSTER_SOURCES = sql<number | null>`(select count(distinct m.source_id)::int from ${articles} m where m.cluster_id = "articles"."cluster_id" and m.is_published)`;

const listColumns = {
  id: articles.id,
  slug: articles.slug,
  title: displayTitle,
  sourceTitle: articles.title,
  impact: articles.readerImpact,
  tldr: articles.tldrSummary,
  sourceName: sources.name,
  sourceDomain: sources.domain,
  sourceCategory: sources.category,
  publishedAt: articles.publishedAt,
  riskScore: articles.riskScore,
  riskFlag: articles.riskFlag,
  // A list row needs three small facts from the analysis, not the analysis (Nov 8 2026: these
  // three columns were ~1 KB of every ~2.2 KB list row, ~0.9 GB of Supabase egress in a month).
  // getArticleBySlug selects the full columns over these.
  factVsSpin: sql<Pick<FactVsSpin, "spin_detected" | "neutrality_score"> | null>`case when ${articles.factVsSpin} is null then null else jsonb_build_object('neutrality_score', ${articles.factVsSpin}->'neutrality_score', 'spin_detected', left(btrim(${articles.factVsSpin}->>'spin_detected'), 20)) end`,
  entities: sql<Pick<ExtractedEntities, "amounts_mnt"> | null>`jsonb_build_object('amounts_mnt', coalesce(${articles.extractedEntities}->'amounts_mnt', '[]'::jsonb))`,
  deep: sql<string | null>`case when coalesce(${articles.grokDeepAnalysis}, '') <> '' then 'y' end`,
  clusterId: articles.clusterId,
  originalUrl: articles.originalUrl,
  topic: articles.topic,
  importanceScore: articles.importanceScore,
  clusterSize: CLUSTER_SOURCES,
  dateUnknown: undated,
  summaryFallback: articles.summaryFallback,
  pressCount: sql<number>`(select count(*)::int from ${pressLinks} where ${pressLinks.articleId} = ${articles.id})`,
};

type ListRow = {
  id: number;
  slug: string;
  title: string;
  sourceTitle: string;
  impact: ReaderImpact | null;
  tldr: string | null;
  sourceName: string;
  sourceDomain: string;
  sourceCategory: SourceCategory;
  publishedAt: Date | null;
  riskScore: number;
  riskFlag: boolean;
  factVsSpin: Pick<FactVsSpin, "spin_detected" | "neutrality_score"> | null;
  entities: Pick<ExtractedEntities, "amounts_mnt"> | null;
  deep: string | null;
  clusterId: number | null;
  originalUrl: string;
  topic: string | null;
  importanceScore: number | null;
  clusterSize: number | null;
  dateUnknown: boolean;
  summaryFallback: boolean;
  pressCount: number | null;
};

function toListItem(r: ListRow): ArticleListItem {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    sourceTitle: r.title === r.sourceTitle ? null : r.sourceTitle,
    impact: r.impact ?? null,
    tldr: r.tldr ?? "",
    sourceName: r.sourceName,
    sourceDomain: r.sourceDomain,
    sourceCategory: r.sourceCategory,
    publishedAt: r.publishedAt,
    riskScore: r.riskScore,
    riskFlag: r.riskFlag,
    neutralityScore: storedNeutrality(r.factVsSpin),
    amounts: r.entities?.amounts_mnt ?? [],
    hasDeepAnalysis: Boolean(r.deep),
    clusterId: r.clusterId,
    originalUrl: r.originalUrl,
    topic: r.topic,
    importanceScore: r.importanceScore,
    clusterSize: Math.max(1, Number(r.clusterSize ?? 1)),
    dateUnknown: r.dateUnknown === true,
    summaryFallback: r.summaryFallback === true,
    pressCount: Number(r.pressCount ?? 0),
  };
}

const BUDGET_DOMAINS = ["tender.gov.mn", "shilendans.gov.mn", "mof.gov.mn", "audit.mn"];

function filterCondition(filter: FeedFilter): SQL | undefined {
  switch (filter) {
    case "risk":
      return eq(articles.riskFlag, true);
    case "budget":
      return sql`(${sources.domain} in (${sql.join(
        BUDGET_DOMAINS.map((d) => sql`${d}`),
        sql`, `,
      )}) or ${namesMnt})`;
    case "ministry":
      return eq(sources.category, "ministry");
    case "local":
      return eq(sources.category, "local");
    default: {
      const topic = findTopic(filter);
      return topic ? sql`${effectiveTopic} = ${topic.key}` : undefined;
    }
  }
}

/** The feed query itself, uncached: `getFeed` caches it, the snapshot writer runs it once per run. */
export async function loadFeed(filter: FeedFilter, limit = 30): Promise<ArticleListItem[]> {
  const rows = await getDb()
    .select(listColumns)
    .from(articles)
    .innerJoin(sources, eq(articles.sourceId, sources.id))
    .where(
      and(
        visible,
        filterCondition(filter),
        filter === "risk" || filter === "data" ? undefined : feedVisible,
        // The risk feed is score-first: without a window a months-old risk-95 story led it for good.
        filter === "risk" ? sql`${articles.publishedAt} >= now() - interval '30 days'` : undefined,
      ),
    )
    .orderBy(...(filter === "risk" ? [desc(articles.riskScore), desc(articles.publishedAt)] : [desc(articles.publishedAt), desc(articles.id)]))
    .limit(limit);
  return rows.map(toListItem);
}

export async function getFeed(filter: FeedFilter, limit = 30): Promise<ArticleListItem[]> {
  "use cache";
  cacheLife("news");
  cacheTag("articles", "feed");
  return safe("getFeed", [], () => loadFeed(filter, limit));
}

/** What a list page shows: its first stories, the site counters and the newest digest editions. */
export interface FeedPageData {
  stories: ArticleListItem[];
  stats: SiteStats;
  edition: DigestView | null;
  review: DigestView | null;
}

const reviveDigest = (d: DigestView | null | undefined): DigestView | null =>
  d ? { ...d, periodStart: toDate(d.periodStart) ?? new Date(0), periodEnd: toDate(d.periodEnd) ?? new Date(0) } : null;

/**
 * A list page's snapshot (docs/adr/0001-list-pages-read-snapshots.md): one row, cached for days;
 * the pipeline purges `snap-feed-<filter>` only when the snapshot changed. Null when there is none
 * yet (a new topic, the first deploy) or it was written by another version.
 */
async function readFeedSnapshot(filter: FeedFilter): Promise<FeedPageData | null> {
  "use cache";
  cacheLife("days");
  const key = feedKey(filter);
  cacheTag(snapshotTag(key));
  return safe("readFeedSnapshot", null, async () => {
    const [row] = await getDb().select({ data: feedSnapshots.data }).from(feedSnapshots).where(eq(feedSnapshots.key, key)).limit(1);
    const snap = parseSnapshot<FeedPageData>(row?.data);
    if (!snap || !Array.isArray(snap.data.stories)) return null;
    const d = snap.data;
    return {
      stories: d.stories.map((s) => ({ ...s, publishedAt: toDate(s.publishedAt) })),
      stats: d.stats,
      edition: reviveDigest(d.edition),
      review: reviveDigest(d.review),
    };
  });
}

/** The list page's content: its snapshot, or the live queries when there is no snapshot yet. */
export async function getFeedPage(filter: FeedFilter): Promise<FeedPageData> {
  // A failed read (the table not migrated yet on the first deploy, a database blip) is not a
  // broken page: the live queries draw it, and the rejected read is not cached.
  const snap = await readFeedSnapshot(filter).catch(() => null);
  if (snap) return snap;
  const [stories, stats, [edition], [review]] = await Promise.all([getFeed(filter, FIRST_PAGE), getSiteStats(), getDigests("12h", 1), getDigests("30d", 1)]);
  return { stories, stats, edition: edition ?? null, review: review ?? null };
}

/**
 * The newest stories of one feed (a topic key) for an article page's "Энэ сэдвийн сүүлийн мэдээ":
 * the article itself and its cluster left out, the same importance cut-off as the feed. Gives every
 * article page crawlable links to its neighbours (internal linking), not only to the nav.
 */
export async function getTopicNeighbours(filter: FeedFilter, excludeId: number, clusterId: number | null, limit = 5, settled = false): Promise<ArticleListItem[]> {
  "use cache";
  // On an old story's page a day-old "latest in this topic" list is fine (see SETTLED_AFTER_DAYS).
  if (settled) cacheLife("days");
  else cacheLife("hours");
  cacheTag("articles");
  return safe("getTopicNeighbours", [], async () => {
    const rows = await getDb()
      .select(listColumns)
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(
        and(
          visible,
          filterCondition(filter),
          feedVisible,
          sql`${articles.id} <> ${excludeId}`,
          clusterId === null ? undefined : sql`${articles.clusterId} is distinct from ${clusterId}`,
        ),
      )
      .orderBy(desc(articles.publishedAt), desc(articles.id))
      .limit(limit);
    return rows.map(toListItem);
  });
}

/**
 * A place's news (/place/<slug>): every published story from its official sites, newest first. No
 * importance cut-off: a district's own announcements are what its readers came for.
 */
export async function getPlaceFeed(domains: string[], limit = 40): Promise<ArticleListItem[]> {
  "use cache";
  cacheLife("news");
  cacheTag("articles", "feed");
  if (domains.length === 0) return [];
  return safe("getPlaceFeed", [], async () => {
    const rows = await getDb()
      .select(listColumns)
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(and(visible, inArray(sources.domain, domains)))
      .orderBy(desc(articles.publishedAt), desc(articles.id))
      .limit(limit);
    return rows.map(toListItem);
  });
}

export interface DayArchive {
  stories: ArticleListItem[];
  /** The nearest earlier / later Ulaanbaatar day that has stories (null = none). */
  prev: string | null;
  next: string | null;
}

/** Ulaanbaatar calendar day of published_at, "yyyy-mm-dd" (UTC+8, no DST). */
const UB_DAY = sql<string>`to_char((${articles.publishedAt} at time zone 'UTC') + interval '8 hours', 'YYYY-MM-DD')`;

/**
 * Every published story of one Ulaanbaatar day (/archive/<date>), oldest first, no importance
 * cut-off: the archive is the crawlable path to stories that left the feeds.
 */
export async function getDayArchive(date: string): Promise<DayArchive> {
  "use cache";
  // A day two or more days back only changes when an older story is found late: a day's cache is enough.
  if (date < ubDateKey(Date.now() - 2 * 86_400_000)) cacheLife("days");
  else cacheLife("hours");
  cacheTag("articles"); // not "feed": settled days are cached for days, a purge every run re-rendered them all
  return safe("getDayArchive", { stories: [], prev: null, next: null }, async () => {
    const db = getDb();
    const [start, end] = ubDayBounds(date).map((t) => new Date(t));
    const [rows, [before], [after]] = await Promise.all([
      db
        .select(listColumns)
        .from(articles)
        .innerJoin(sources, eq(articles.sourceId, sources.id))
        .where(and(visible, gte(articles.publishedAt, start), lt(articles.publishedAt, end)))
        .orderBy(articles.publishedAt, articles.id)
        .limit(400),
      db.select({ at: sql<Date | null>`max(${articles.publishedAt})`.mapWith(articles.publishedAt) }).from(articles).where(and(visible, lt(articles.publishedAt, start))),
      db.select({ at: sql<Date | null>`min(${articles.publishedAt})`.mapWith(articles.publishedAt) }).from(articles).where(and(visible, gte(articles.publishedAt, end))),
    ]);
    return {
      stories: rows.map(toListItem),
      prev: before?.at ? ubDateKey(new Date(before.at).getTime()) : null,
      next: after?.at ? ubDateKey(new Date(after.at).getTime()) : null,
    };
  });
}

export interface ArchiveDay {
  date: string;
  stories: number;
  /** Newest change on that day (sitemap lastModified). */
  lastModified: Date;
}

/** Days of the last `days` with published stories, newest first (/archive, sitemap, feed footers). */
export async function getArchiveDays(days = 60): Promise<ArchiveDay[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("articles", "feed");
  return safe("getArchiveDays", [], async () => {
    const rows = await getDb()
      .select({
        date: UB_DAY,
        stories: sql<number>`count(*)::int`,
        lastModified: sql<Date>`max(greatest(${articles.createdAt}, coalesce(${articles.editedAt}, ${articles.createdAt})))`.mapWith(articles.createdAt),
      })
      .from(articles)
      // From the Ulaanbaatar midnight `days` days back, so the oldest listed day is a whole day
      // (a rolling `now() - interval` cut it mid-day and its count disagreed with its archive page).
      .where(and(visible, isNotNull(articles.publishedAt), gte(articles.publishedAt, new Date(ubDayBounds(shiftDate(ubDateKey(Date.now()), -(days - 1)))[0]))))
      .groupBy(UB_DAY)
      .orderBy(desc(UB_DAY));
    return rows.map((r) => ({ date: r.date, stories: Number(r.stories), lastModified: r.lastModified }));
  });
}

export interface SourceHub {
  name: string;
  domain: string;
  category: SourceCategory;
  isActive: boolean;
}

/** One source's page (/source/<domain>): the source and its newest published stories. */
export async function getSourceHub(domain: string, limit = 40): Promise<{ source: SourceHub; stories: ArticleListItem[] } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("articles"); // not "feed": ~130 hubs re-rendered on every run (Vercel Hobby limit, Nov 8 2026)
  const seed = SOURCE_SEEDS.find((s) => s.domain === domain);
  const fallback = seed ? { source: { name: seed.name, domain: seed.domain, category: seed.category, isActive: true }, stories: [] } : null;
  return safe("getSourceHub", fallback, async () => {
    const db = getDb();
    const [source] = await db.select({ id: sources.id, name: sources.name, domain: sources.domain, category: sources.category, isActive: sources.isActive }).from(sources).where(eq(sources.domain, domain)).limit(1);
    if (!source) return null;
    const rows = await db
      .select(listColumns)
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(and(visible, eq(articles.sourceId, source.id)))
      .orderBy(desc(articles.publishedAt), desc(articles.id))
      .limit(limit);
    return { source: { name: source.name, domain: source.domain, category: source.category, isActive: source.isActive }, stories: rows.map(toListItem) };
  });
}

/** Sources with at least one published story, for the sitemap and prerendering. */
export async function getSourceHubDomains(): Promise<{ domain: string; lastModified: Date }[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("articles");
  return safe("getSourceHubDomains", [], () =>
    getDb()
      .select({ domain: sources.domain, lastModified: sql<Date>`max(${articles.createdAt})`.mapWith(articles.createdAt) })
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(visible)
      .groupBy(sources.domain)
      .orderBy(sources.domain),
  );
}

export interface ClusterListItem {
  id: number;
  title: string;
  synthesis: string | null;
  articleCount: number;
  maxRiskScore: number;
  updatedAt: Date;
  sources: string[];
}

export async function getClusters(limit = 30, sinceDays?: number): Promise<ClusterListItem[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("clusters");
  return safe("getClusters", [], async () => {
    const db = getDb();
    const since = sinceDays ? new Date(Date.now() - sinceDays * 86_400_000) : null;
    const rows = await db
      .select()
      .from(clusters)
      .where(and(gte(clusters.articleCount, 2), since ? gte(clusters.updatedAt, since) : undefined))
      .orderBy(desc(clusters.updatedAt))
      // Over-fetched: clusters with one source left (below) are dropped after the query.
      .limit(limit * 2);
    if (rows.length === 0) return [];
    const members = await db
      .select({ clusterId: articles.clusterId, name: sources.name })
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(and(visible, inArray(articles.clusterId, rows.map((r) => r.id))));
    // Published members only (as on the cluster page): a cluster whose stories were all withdrawn
    // is left out, one with a single source left loses its cross-source synthesis, and the count
    // is today's published members, not the stored count from when the cluster was made.
    return rows.flatMap((r) => {
      const mine = members.filter((m) => m.clusterId === r.id);
      const names = [...new Set(mine.map((m) => m.name))];
      // One source left (the other withdrawn) is not "reported by several sources": the header's
      // cluster count (getSiteStats, distinct sources >= 2) and this list agree.
      if (names.length < 2) return [];
      return [
        {
          id: r.id,
          title: r.title,
          synthesis: names.length < 2 ? null : r.synthesisSummary,
          articleCount: mine.length,
          maxRiskScore: r.maxRiskScore,
          updatedAt: r.updatedAt,
          sources: names,
        },
      ];
    }).slice(0, limit);
  });
}

export async function getCluster(id: number) {
  "use cache";
  cacheTag("clusters", `cluster-${id}`);
  const data = await safe("getCluster", null, async () => {
    const db = getDb();
    const [cluster] = await db.select().from(clusters).where(eq(clusters.id, id)).limit(1);
    if (!cluster) return null;
    const rows = await db
      .select(listColumns)
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(and(visible, eq(articles.clusterId, id)))
      .orderBy(desc(articles.publishedAt));
    // The title and synthesis were written from the members: with none still published the
    // cluster is gone, and with one left its cross-source synthesis is not shown either.
    if (rows.length === 0) return null;
    const sourceCount = new Set(rows.map((r) => r.sourceDomain)).size;
    return {
      cluster: { ...cluster, articleCount: rows.length, synthesisSummary: sourceCount < 2 ? null : cluster.synthesisSummary },
      sourceCount,
      articles: rows.map(toListItem),
    };
  });
  // Members join within 7 days of each other: once the newest is settled, the cluster is too.
  const newest = data?.articles.reduce<Date | null>((m, a) => (a.publishedAt && (!m || a.publishedAt > m) ? a.publishedAt : m), null);
  if (isSettled(newest, new Date())) cacheLife("days");
  else cacheLife("hours");
  return data;
}

export interface ArticleDetail extends ArticleListItem {
  originalUrl: string;
  contentHash: string;
  cleanContent: string;
  facts: string[];
  spinDetected: string;
  entities: ExtractedEntities;
  deepAnalysis: string | null;
  scrapeMeta: ScrapeMeta | null;
  createdAt: Date;
  editedAt: Date | null;
  contentPrunedAt: Date | null;
  summaryFallback: boolean;
  /** Re-check of the source page (src/lib/scraper/recheck.ts): null = not checked yet. */
  sourceStatus: SourceStatus | null;
  sourceChangedAt: Date | null;
  sourceDiff: SourceDiff | null;
  /** The model that actually wrote the summary / deep analysis (from ai_usage_logs); null = rule-based or unknown. */
  tier1Model: AIModelRef | null;
  tier2Model: AIModelRef | null;
  /** Older than SETTLED_AFTER_DAYS: nothing changes it any more but an edit, so it is cached for a day. */
  settled: boolean;
  /** The independent press's headlines on the same story, best match first. */
  press: PressCoverage[];
  /** Important, a day old, and none of the outlets we read had it (src/lib/press/outlets.ts); computed in the hourly cache. */
  pressBlindspot: boolean;
}

export interface PressCoverage {
  outlet: string;
  title: string;
  url: string;
  publishedAt: Date | null;
}

export interface AIModelRef {
  provider: string;
  model: string;
}

/** Latest successful call of these purposes for the article, as "provider|model". */
function modelUsed(purposes: string[]) {
  return sql<string | null>`(select ${aiUsageLogs.provider} || '|' || ${aiUsageLogs.model} from ${aiUsageLogs}
    where ${aiUsageLogs.articleId} = ${articles.id} and ${aiUsageLogs.success}
      and ${aiUsageLogs.purpose} in (${sql.join(purposes.map((p) => sql`${p}`), sql`, `)})
    order by ${aiUsageLogs.createdAt} desc limit 1)`;
}

/**
 * After this a story's page (and the neighbour list on it) is cached for a day instead of an hour.
 * The AI summary, the first cluster and the press links all arrive within hours; a later cluster
 * join or AI retry shows within a day. Was 8 days: ~1 200 recent pages re-rendering hourly on
 * crawler visits made 457 K ISR writes and 4 h 14 m of CPU in 30 days, and Vercel paused the
 * Hobby project on Nov 8 2026.
 */
const SETTLED_AFTER_DAYS = 2;

function isSettled(at: Date | null | undefined, now: Date): boolean {
  return !!at && now.getTime() - new Date(at).getTime() > SETTLED_AFTER_DAYS * 86_400_000;
}

function parseModelRef(v: string | null): AIModelRef | null {
  if (!v) return null;
  const [provider, ...rest] = v.split("|");
  return { provider, model: rest.join("|") };
}

export async function getArticleBySlug(slug: string): Promise<ArticleDetail | null> {
  "use cache";
  cacheTag("articles", `article-${slug}`);
  const article = await safe("getArticleBySlug", null, async (): Promise<ArticleDetail | null> => {
    const [r] = await getDb()
      .select({
        ...listColumns,
        factVsSpin: articles.factVsSpin,
        entities: articles.extractedEntities,
        deep: articles.grokDeepAnalysis,
        originalUrl: articles.originalUrl,
        contentHash: articles.contentHash,
        cleanContent: articles.cleanContent,
        scrapeMeta: articles.scrapeMeta,
        createdAt: articles.createdAt,
        editedAt: articles.editedAt,
        contentPrunedAt: articles.contentPrunedAt,
        summaryFallback: articles.summaryFallback,
        sourceStatus: articles.sourceStatus,
        sourceChangedAt: articles.sourceChangedAt,
        sourceDiff: articles.sourceDiff,
        tier1Model: modelUsed(["tier1", "admin_tier1"]),
        tier2Model: modelUsed(["tier2", "admin_tier2"]),
      })
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(and(visible, eq(articles.slug, slug)))
      .limit(1);
    if (!r) return null;
    const press = Number(r.pressCount ?? 0)
      ? await getDb()
          .select({ outlet: pressItems.outlet, title: pressItems.title, url: pressItems.url, publishedAt: pressItems.publishedAt })
          .from(pressLinks)
          .innerJoin(pressItems, eq(pressLinks.pressItemId, pressItems.id))
          .where(eq(pressLinks.articleId, r.id))
          .orderBy(desc(pressLinks.score))
          .limit(6)
      : [];
    const item = toListItem(r);
    // The clock is read inside this 'use cache' function, so the page stays static.
    const now = new Date();
    let pressBlindspot = isPressBlindspot(item, now);
    if (pressBlindspot && item.publishedAt) {
      // "Not found in the press" only holds if every feed was actually read while the story was fresh.
      const until = new Date(item.publishedAt.getTime() + 48 * 3_600_000);
      const [seen] = await getDb()
        .select({ outlets: sql<number>`count(distinct ${pressItems.outlet})::int` })
        .from(pressItems)
        .where(and(gte(pressItems.foundAt, item.publishedAt), lte(pressItems.foundAt, until)));
      pressBlindspot = isPressBlindspot(item, now, Number(seen?.outlets ?? 0));
    }
    return {
      ...item,
      press,
      pressBlindspot,
      originalUrl: r.originalUrl,
      contentHash: r.contentHash,
      cleanContent: r.cleanContent,
      facts: r.factVsSpin?.facts ?? [],
      spinDetected: storedSpin(r.factVsSpin),
      entities: r.entities ?? { people: [], orgs: [], amounts_mnt: [] },
      deepAnalysis: r.deep,
      scrapeMeta: r.scrapeMeta,
      createdAt: r.createdAt,
      editedAt: r.editedAt,
      contentPrunedAt: r.contentPrunedAt,
      summaryFallback: r.summaryFallback,
      sourceStatus: r.sourceStatus as SourceStatus | null,
      sourceChangedAt: r.sourceChangedAt,
      sourceDiff: r.sourceDiff,
      tier1Model: parseModelRef(r.tier1Model),
      tier2Model: parseModelRef(r.tier2Model),
      settled: isSettled(item.publishedAt ?? r.createdAt, now),
    };
  });
  if (article?.settled) cacheLife("days");
  else cacheLife("hours");
  return article;
}

/**
 * What a story's share image (article/[slug]/opengraph-image.tsx) draws. Cached for days on its
 * own: the PNG is the most expensive render on the site and used to follow the page's hourly life.
 * An edit purges it with the page (`article-<slug>`).
 */
export async function getArticleCard(slug: string) {
  "use cache";
  cacheLife("days");
  cacheTag("articles", `article-${slug}`);
  return safe("getArticleCard", null, async () => {
    const [r] = await getDb()
      .select({
        title: displayTitle,
        sourceName: sources.name,
        sourceDomain: sources.domain,
        sourceCategory: sources.category,
        topic: articles.topic,
        riskFlag: articles.riskFlag,
        riskScore: articles.riskScore,
        publishedAt: articles.publishedAt,
        dateUnknown: undated,
        amounts: sql<string[]>`coalesce(${articles.extractedEntities}->'amounts_mnt', '[]'::jsonb)`,
      })
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(and(visible, eq(articles.slug, slug)))
      .limit(1);
    return r ?? null;
  });
}

/** Slugs to prerender at build time (most recent). */
export async function getRecentSlugs(limit = 20): Promise<string[]> {
  return safe("getRecentSlugs", [], async () => {
    const rows = await getDb().select({ slug: articles.slug }).from(articles).where(visible).orderBy(desc(articles.publishedAt)).limit(limit);
    return rows.map((r) => r.slug);
  });
}

export interface SitemapArticle {
  slug: string;
  title: string;
  tldr: string;
  sourceName: string;
  sourceDomain: string;
  sourceCategory: SourceCategory;
  publishedAt: Date | null;
  /** The source page printed no date (`scrape_meta.date_unknown`): publishedAt is when we found it. */
  dateUnknown: boolean;
  lastModified: Date;
}

/** Newest public articles for sitemap.xml, the Google News sitemap and RSS (no body text). */
/**
 * sitemap.xml only needs the slug and a date: the full SitemapArticle row (title, summary,
 * source) for 45k articles made a cache entry of tens of MB and neared the query timeout.
 */
export async function getSitemapSlugs(limit = 45_000): Promise<{ slug: string; lastModified: Date }[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("articles");
  return safe("getSitemapSlugs", [], () =>
    getDb()
      .select({
        slug: articles.slug,
        lastModified: sql<Date>`greatest(${articles.createdAt}, coalesce(${articles.editedAt}, ${articles.createdAt}))`.mapWith(articles.createdAt),
      })
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(and(visible, indexable))
      .orderBy(desc(sql`coalesce(${articles.publishedAt}, ${articles.createdAt})`))
      .limit(limit),
  );
}

/** The newest public stories for RSS (thin pages included: feed readers get everything). */
export async function getSitemapArticles(limit = 1000): Promise<SitemapArticle[]> {
  "use cache";
  cacheLife("news");
  cacheTag("articles");
  return safe("getSitemapArticles", [], async () => {
    const rows = await getDb()
      .select({
        slug: articles.slug,
        title: displayTitle,
        tldr: articles.tldrSummary,
        sourceName: sources.name,
        sourceDomain: sources.domain,
        sourceCategory: sources.category,
        publishedAt: articles.publishedAt,
        dateUnknown: undated,
        lastModified: sql<Date>`greatest(${articles.createdAt}, coalesce(${articles.editedAt}, ${articles.createdAt}))`.mapWith(articles.createdAt),
      })
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(visible)
      .orderBy(desc(sql`coalesce(${articles.publishedAt}, ${articles.createdAt})`))
      .limit(limit);
    return rows.map((r) => ({ ...r, tldr: r.tldr ?? "" }));
  });
}

/**
 * The Google News sitemap: dated, indexable stories of the last two days (Google's limit), slug,
 * title and date only. It used to read the newest 1 000 rows with their summaries every 30 minutes
 * and keep ~100 of them in JavaScript (Nov 2026: ~0.3 GB of Supabase egress a month).
 */
export async function getNewsSitemapArticles(): Promise<{ slug: string; title: string; publishedAt: Date }[]> {
  "use cache";
  cacheLife("news");
  cacheTag("articles");
  return safe("getNewsSitemapArticles", [], async () => {
    const rows = await getDb()
      .select({ slug: articles.slug, title: displayTitle, publishedAt: articles.publishedAt })
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(and(visible, indexable, dated, gte(articles.publishedAt, sql`now() - interval '2 days'`)))
      .orderBy(desc(articles.publishedAt))
      .limit(1000);
    return rows.flatMap((r) => (r.publishedAt ? [{ slug: r.slug, title: r.title, publishedAt: r.publishedAt }] : []));
  });
}

/** Totals of the rows `db:prune` deleted, from its `prune_state` (0 when it never deleted anything). */
export function deletedTotals(value: string | undefined): { articles: number; analyzed: number } {
  if (!value) return { articles: 0, analyzed: 0 };
  try {
    const s = JSON.parse(value) as { articlesDeletedTotal?: unknown; analyzedDeletedTotal?: unknown };
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    return { articles: n(s.articlesDeletedTotal), analyzed: n(s.analyzedDeletedTotal) };
  } catch {
    return { articles: 0, analyzed: 0 };
  }
}

export interface SiteStats {
  activeSources: number;
  articles: number;
  analyzed: number;
  flagged: number;
  clusters: number;
  aiCostThisMonthUsd: number;
  /**
   * Newest feed story's created_at (ISO): "Шинэчилсэн: … өмнө". Only rows the feed shows (published,
   * importance >= FEED_MIN_IMPORTANCE): a minor item hidden from the feed (a district department
   * page, importance 10) made the masthead say "53 minutes ago" over a newest story 6 hours old.
   */
  lastArticleAt: string | null;
  /** Feed stories found since midnight Ulaanbaatar time (same rule as lastArticleAt). */
  todayArticles: number;
}

export async function getSiteStats(): Promise<SiteStats> {
  "use cache";
  cacheLife("hours");
  cacheTag("articles", "sources", "ai");
  const fallback: SiteStats = { activeSources: SOURCE_SEEDS.length, articles: 0, analyzed: 0, flagged: 0, clusters: 0, aiCostThisMonthUsd: 0, lastArticleAt: null, todayArticles: 0 };
  return safe("getSiteStats", fallback, loadSiteStats);
}

/** The site counters, uncached (`getSiteStats` caches them; the snapshot writer reads them once per run). */
export async function loadSiteStats(): Promise<SiteStats> {
  const db = getDb();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(ubMidnight(Date.now()));
  const [[src], [art], [clu], [cost], [recent], [pruned]] = await Promise.all([
    db.select({ n: count() }).from(sources).where(eq(sources.isActive, true)),
    db
      .select({
        total: count(),
        // "AI-аар шүүгдсэн" counts AI summaries only: the extractive fallback (first sentences,
        // labelled "AI ажиллаагүй") is not an AI analysis; it inflated the public number by 28 %.
        analyzed: sql<number>`count(*) filter (where ${aiSummarized})::int`,
        flagged: sql<number>`count(*) filter (where ${articles.riskFlag})::int`,
      })
      .from(articles),
    // Clusters that two or more sources still publish (the stored article_count goes stale).
    db
      .select({ n: count() })
      .from(
        db
          .select({ id: articles.clusterId })
          .from(articles)
          .where(and(isNotNull(articles.clusterId), published))
          .groupBy(articles.clusterId)
          .having(sql`count(distinct ${articles.sourceId}) >= 2`)
          .as("live_clusters"),
      ),
    db.select({ usd: sql<string>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)` }).from(aiUsageLogs).where(gte(aiUsageLogs.createdAt, monthStart)),
    db
      .select({
        last: sql<string | null>`max(${articles.createdAt})::text`,
        today: sql<number>`count(*) filter (where ${articles.createdAt} >= ${todayStart})::int`,
      })
      .from(articles)
      .where(and(published, feedVisible)),
    // Rows the retention job deleted were still read (and many analysed): the counters keep them.
    db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, PRUNE_STATE_KEY)).limit(1),
  ]);
  const deleted = deletedTotals(pruned?.value);
  return {
    activeSources: src.n,
    articles: art.total + deleted.articles,
    analyzed: art.analyzed + deleted.analyzed,
    flagged: art.flagged,
    clusters: clu.n,
    aiCostThisMonthUsd: Number(cost.usd),
    lastArticleAt: recent.last ? new Date(recent.last).toISOString() : null,
    todayArticles: recent.today,
  };
}

export interface SourceHealth {
  id: number;
  name: string;
  domain: string;
  category: SourceCategory;
  isActive: boolean;
  lastScrapedAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  articleCount: number;
  /** Published, summarized stories: what its /source/<domain> page lists (0 = empty, noindex). */
  visibleCount: number;
  /** Whole days since the last scrape attempt, computed with the cached query (null = never). */
  staleDays: number | null;
}

export async function getSources(): Promise<SourceHealth[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("sources");
  const fallback: SourceHealth[] = SOURCE_SEEDS.map((s, i) => ({
    id: i + 1,
    name: s.name,
    domain: s.domain,
    category: s.category,
    isActive: true,
    lastScrapedAt: null,
    lastError: null,
    consecutiveFailures: 0,
    articleCount: 0,
    visibleCount: 0,
    staleDays: null,
  }));
  return safe("getSources", fallback, async () => {
    const db = getDb();
    const counts = db
      .select({
        sourceId: articles.sourceId,
        n: count().as("n"),
        visible: sql<number>`count(*) filter (where ${visible})`.as("visible"),
      })
      .from(articles)
      .groupBy(articles.sourceId)
      .as("counts");
    const rows = await db
      .select({
        id: sources.id,
        name: sources.name,
        domain: sources.domain,
        category: sources.category,
        isActive: sources.isActive,
        lastScrapedAt: sources.lastScrapedAt,
        staleDays: sql<number | null>`floor(extract(epoch from now() - ${sources.lastScrapedAt}) / 86400)::int`,
        lastError: sources.lastError,
        consecutiveFailures: sources.consecutiveFailures,
        articleCount: sql<number>`coalesce(${counts.n}, 0)::int`,
        visibleCount: sql<number>`coalesce(${counts.visible}, 0)::int`,
      })
      .from(sources)
      .leftJoin(counts, eq(counts.sourceId, sources.id))
      .orderBy(sources.category, sources.name);
    return rows;
  });
}

export interface TransparencyData {
  /**
   * Spend per Ulaanbaatar day of every provider that cost money in the last 30 days (a billed
   * Gemini key, ElevenLabs, Requesty, DeepSeek, Grok…), from the logged USD, never from a fixed
   * list: a list of "the paid ones" said "no paid AI was used" while billed Gemini cost money.
   */
  dailySpend: { day: string; costs: Record<string, number> }[];
  /** The providers in `dailySpend`, largest 30-day spend first. */
  paidProviders: string[];
  byProvider: { provider: string; calls: number; promptTokens: number; completionTokens: number; costUsd: number }[];
  /** Income null = not entered for that month ("бүртгээгүй"). */
  ledger: { month: string; infraCostUsd: number; aiCostUsd: number; adRevenueUsd: number | null; donationsUsd: number | null; notes: string | null }[];
  totals: { costUsd: number; calls: number; tokens: number };
}

/**
 * The daily chart rows: every provider whose logged spend in the window is above zero, whatever
 * its name (pure, tested). Days with no paid spend are left out; a provider with $0 in total is
 * not a series.
 */
export function paidDailySpend(rows: { day: string; provider: string; usd: string | number | null }[]): Pick<TransparencyData, "dailySpend" | "paidProviders"> {
  const totals = new Map<string, number>();
  const days = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const usd = Number(r.usd ?? 0);
    if (!(usd > 0)) continue;
    totals.set(r.provider, (totals.get(r.provider) ?? 0) + usd);
    const d = days.get(r.day) ?? {};
    d[r.provider] = (d[r.provider] ?? 0) + usd;
    days.set(r.day, d);
  }
  let paidProviders = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  // The chart has four validated colours: a fifth provider would reuse the first and two providers
  // would read as one (Nov 2026 audit). Beyond four, the smallest are summed as "бусад".
  if (paidProviders.length > SPEND_SERIES) {
    const keep = new Set(paidProviders.slice(0, SPEND_SERIES - 1));
    for (const costs of days.values()) {
      for (const [p, usd] of Object.entries(costs)) {
        if (keep.has(p)) continue;
        costs[OTHER_PROVIDERS] = (costs[OTHER_PROVIDERS] ?? 0) + usd;
        delete costs[p];
      }
    }
    paidProviders = [...keep, OTHER_PROVIDERS];
  }
  const sorted = [...days.keys()].sort();
  // A day with no paid call is a bar of 0, not a missing day (10-26…10-29 vanished from the chart).
  const dailySpend: TransparencyData["dailySpend"] = [];
  if (sorted.length) {
    for (let t = Date.parse(`${sorted[0]}T00:00:00Z`); t <= Date.parse(`${sorted.at(-1)}T00:00:00Z`); t += 86_400_000) {
      const day = new Date(t).toISOString().slice(0, 10);
      dailySpend.push({ day, costs: days.get(day) ?? {} });
    }
  }
  return { dailySpend, paidProviders };
}

/** Colour slots of the daily spend chart (charts.tsx `SERIES`, src/styles/charts.css). */
const SPEND_SERIES = 4;
const OTHER_PROVIDERS = "бусад";

export async function getTransparency(): Promise<TransparencyData> {
  "use cache";
  cacheLife("hours");
  cacheTag("ai", "ledger");
  const empty: TransparencyData = { dailySpend: [], paidProviders: [], byProvider: [], ledger: [], totals: { costUsd: 0, calls: 0, tokens: 0 } };
  return safe("getTransparency", empty, async () => {
    const db = getDb();
    const since = new Date(Date.now() - 30 * 86_400_000);
    // Call logs are kept LOG_KEEP_MONTHS (db:prune); the per-provider table covers exactly that window.
    const logsSince = new Date();
    logsSince.setUTCMonth(logsSince.getUTCMonth() - LOG_KEEP_MONTHS);
    const day = sql<string>`to_char(${aiUsageLogs.createdAt} at time zone 'Asia/Ulaanbaatar', 'YYYY-MM-DD')`;
    const [daily, providers, ledger, [allTime]] = await Promise.all([
      db
        .select({ day, provider: aiUsageLogs.provider, usd: sql<string>`sum(${aiUsageLogs.estimatedCostUsd})` })
        .from(aiUsageLogs)
        .where(gte(aiUsageLogs.createdAt, since))
        .groupBy(day, aiUsageLogs.provider)
        .orderBy(day),
      db
        .select({
          provider: aiUsageLogs.provider,
          calls: count(),
          promptTokens: sql<number>`coalesce(sum(${aiUsageLogs.promptTokens}), 0)::bigint`,
          completionTokens: sql<number>`coalesce(sum(${aiUsageLogs.completionTokens}), 0)::bigint`,
          costUsd: sql<string>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)`,
        })
        .from(aiUsageLogs)
        .where(gte(aiUsageLogs.createdAt, logsSince))
        .groupBy(aiUsageLogs.provider),
      db.select().from(transparencyLedger).orderBy(desc(transparencyLedger.month)).limit(12),
      // The ledger keeps every month's AI total for good, also after its call logs are pruned.
      db.select({ usd: sql<string>`coalesce(sum(${transparencyLedger.aiCostUsd}), 0)` }).from(transparencyLedger),
    ]);
    const { dailySpend, paidProviders } = paidDailySpend(daily);
    const byProvider = providers.map((p) => ({
      provider: p.provider,
      calls: p.calls,
      promptTokens: Number(p.promptTokens),
      completionTokens: Number(p.completionTokens),
      costUsd: Number(p.costUsd),
    }));
    return {
      dailySpend,
      paidProviders,
      byProvider,
      ledger: ledger.map((l) => ({
        month: l.month,
        infraCostUsd: Number(l.infraCostUsd),
        aiCostUsd: Number(l.aiCostUsd),
        adRevenueUsd: l.adRevenueUsd === null ? null : Number(l.adRevenueUsd),
        donationsUsd: l.donationsUsd === null ? null : Number(l.donationsUsd),
        notes: l.notes,
      })),
      totals: {
        // All-time spend: the ledger, unless this month's ledger sync is behind the logs.
        costUsd: Math.max(Number(allTime?.usd ?? 0), byProvider.reduce((s, p) => s + p.costUsd, 0)),
        calls: byProvider.reduce((s, p) => s + p.calls, 0),
        tokens: byProvider.reduce((s, p) => s + p.promptTokens + p.completionTokens, 0),
      },
    };
  });
}

/** What a digest story shows when it is opened in place on /digest (from the article row). */
export interface DigestStory {
  tldr: string;
  summaryFallback: boolean;
  originalUrl: string;
  amounts: string[];
}

export interface DigestView {
  id: number;
  kind: string;
  periodStart: Date;
  periodEnd: Date;
  title: string;
  intro: string;
  /** Only items whose article is still published; `story` is attached only when asked (`withStories`) and it has a summary. */
  items: (DigestItem & { story?: DigestStory })[];
  candidateCount: number;
  generatedBy: string;
  costUsd: number;
}

/**
 * Latest AI digests, newest first. `kind` = "12h" editions or "30d" reviews. `withStories` attaches
 * each item's summary, amounts and source link (one extra query), so /digest can open a story in
 * place instead of sending the reader to another page and back.
 */
export async function getDigests(kind: "12h" | "30d", limit = 10, withStories = false): Promise<DigestView[]> {
  "use cache";
  cacheLife("news");
  cacheTag("digests");
  return safe("getDigests", [], () => loadDigests(kind, limit, withStories));
}

/** Digest editions, uncached (`getDigests` caches them; the snapshot writer reads the newest once per run). */
export async function loadDigests(kind: "12h" | "30d", limit = 10, withStories = false): Promise<DigestView[]> {
  const db = getDb();
  const rows = await db.select().from(digests).where(eq(digests.kind, kind)).orderBy(desc(digests.periodEnd)).limit(limit);
  const stories = new Map<number, DigestStory>();
  const live = new Set<number>();
  const ids = [...new Set(rows.flatMap((d) => d.items.map((it) => it.articleId)))];
  if (ids.length) {
    const found = await db
      .select({ id: articles.id, tldr: articles.tldrSummary, summaryFallback: articles.summaryFallback, originalUrl: articles.originalUrl, entities: articles.extractedEntities })
      .from(articles)
      .where(and(inArray(articles.id, ids), published));
    for (const a of found) {
      live.add(a.id);
      if (!withStories || !a.tldr) continue;
      stories.set(a.id, { tldr: a.tldr, summaryFallback: a.summaryFallback, originalUrl: a.originalUrl, amounts: a.entities?.amounts_mnt ?? [] });
    }
  }
  return rows.flatMap((d) => {
    const items = d.items.filter((it) => live.has(it.articleId));
    // An edition whose every story was withdrawn is gone too (it read "✓ уншиж дууслаа" over 0/0).
    if (items.length === 0) return [];
    return [{
    id: d.id,
    kind: d.kind,
    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
    title: d.title,
    intro: d.intro,
    // Withdrawn stories stay withdrawn: an article unpublished after the edition was written
    // (Nov 2026: 72 empty gov.mn image posts) left its line in /digest, linking to a 404 page.
    items: items.map((it) => {
      const story = stories.get(it.articleId);
      return story ? { ...it, story } : it;
    }),
    candidateCount: d.candidateCount,
    generatedBy: d.generatedBy,
    costUsd: Number(d.costUsd),
    }];
  });
}

/** One digest edition by id (the Instagram card, /ig-image). */
export async function getDigestById(id: number): Promise<Pick<DigestView, "id" | "kind" | "periodEnd" | "title" | "items"> | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("digests");
  return safe("getDigestById", null, async () => {
    const db = getDb();
    const [d] = await db
      .select({ id: digests.id, kind: digests.kind, periodEnd: digests.periodEnd, title: digests.title, items: digests.items })
      .from(digests)
      .where(eq(digests.id, id));
    if (!d) return null;
    // As in getDigests: a story unpublished after the edition was written is not on the card.
    const ids = d.items.map((it) => it.articleId);
    const live = ids.length ? new Set((await db.select({ id: articles.id }).from(articles).where(and(inArray(articles.id, ids), published))).map((a) => a.id)) : new Set<number>();
    return { ...d, items: d.items.filter((it) => live.has(it.articleId)) };
  });
}

/** opendata.mn catalogue with computed highlights (see scripts/sync-opendata-mn.ts). */
export async function getOpenDatasets(): Promise<OpenDataset[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("open-data");
  return safe("getOpenDatasets", [], async () => {
    const rows = await getDb().select().from(openDatasets).orderBy(openDatasets.category, openDatasets.title);
    // Re-checked on every cache refresh (hourly), not only on sync day: an ended ban drops out.
    return rows.map((r) => (r.highlight ? { ...r, highlight: activeBlacklist(r.highlight) } : r));
  });
}

/* ------------------------------------------------------------------ officials */

export interface PoliticianSummary {
  id: number;
  fullName: string;
  shortName: string;
  party: string | null;
  constituency: string | null;
  photoUrl: string | null;
  latestYear: number | null;
  latestIncome: number | null;
  latestAssets: number | null;
  /** The newest earlier year the latest one can be compared with (unit-suspect and hidden years skipped). */
  previousYear: number | null;
  previousAssets: number | null;
  /** True when a filing year was left out of the comparison (suspected unit error or editor-hidden). */
  comparisonLimited: boolean;
  /** The latest filing itself is the suspected unit error (thousand ₮ filed as ₮ or the reverse). */
  latestSuspect: boolean;
  /**
   * The figure the list ranks and scales by: the latest filing, or for a suspected unit error the
   * newest comparable earlier year. A 324 тэрбум filing the site itself calls a probable unit
   * error ranked its member first and shrank every other bar to a sliver.
   */
  rankAssets: number | null;
  rankYear: number | null;
}

/** Declaration years an editor took out of the comparison (see src/lib/officials/hidden.ts). */
async function loadHiddenYears(): Promise<HiddenYears> {
  const [row] = await getDb().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, HIDDEN_YEARS_KEY)).limit(1);
  return parseHiddenYears(row?.value);
}

/** Active members with their latest declared income and assets (from ХАСХОМ). */
export async function getPoliticians(): Promise<PoliticianSummary[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("officials");
  return safe("getPoliticians", [], async () => {
    const db = getDb();
    const people = await db.select().from(politicians).where(eq(politicians.isActive, true)).orderBy(politicians.fullName);
    if (people.length === 0) return [];
    const [decl, hidden] = await Promise.all([
      db
        .select({ politicianId: assetDeclarations.politicianId, year: assetDeclarations.year, incomeOwn: assetDeclarations.incomeOwn, totalAssets: assetDeclarations.totalAssets })
        .from(assetDeclarations)
        .where(inArray(assetDeclarations.politicianId, people.map((p) => p.id)))
        .orderBy(desc(assetDeclarations.year)),
      loadHiddenYears(),
    ]);
    return people.map((p) => {
      const hiddenYears = hidden[String(p.id)] ?? [];
      const mine = decl.filter((d) => d.politicianId === p.id && !hiddenYears.includes(d.year));
      const suspect = new Set(suspectUnitYears(mine));
      // The latest filing is shown as declared; the change is only computed between years that
      // are comparable (no suspected unit error on either side).
      const latest = mine[0];
      const latestSuspect = latest !== undefined && suspect.has(latest.year);
      // The newest earlier year that is not a suspected unit error: the change is computed against
      // it, and a suspect latest filing is ranked by it.
      const earlier = latest ? mine.slice(1).find((d) => d.totalAssets !== null && !suspect.has(d.year)) : undefined;
      const previous = latestSuspect ? undefined : earlier;
      const comparable = latestSuspect ? earlier : undefined;
      return {
        id: p.id,
        fullName: p.fullName,
        shortName: p.shortName,
        party: p.party,
        constituency: p.constituency,
        photoUrl: p.photoUrl,
        latestYear: latest?.year ?? null,
        latestIncome: latest?.incomeOwn ?? null,
        latestAssets: latest?.totalAssets ?? null,
        previousYear: previous?.year ?? null,
        previousAssets: previous?.totalAssets ?? null,
        comparisonLimited: suspect.size > 0 || hiddenYears.length > 0,
        latestSuspect,
        rankAssets: (latestSuspect ? comparable?.totalAssets : latest?.totalAssets) ?? null,
        rankYear: (latestSuspect ? comparable?.year : latest?.year) ?? null,
      };
    });
  });
}

export async function getPoliticianIds(): Promise<number[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("officials");
  return safe("getPoliticianIds", [], async () => {
    const rows = await getDb().select({ id: politicians.id }).from(politicians).where(eq(politicians.isActive, true));
    return rows.map((r) => r.id);
  });
}

/** Every member's short name, former ones included: links and mentions refuse a name two members ever shared. */
export async function getPoliticianNames(): Promise<{ id: number; shortName: string; isActive: boolean }[]> {
  "use cache";
  // The roster changes weekly (officials:sync) and it is on every article page: a day is enough.
  cacheLife("days");
  cacheTag("officials");
  return safe("getPoliticianNames", [], () => getDb().select({ id: politicians.id, shortName: politicians.shortName, isActive: politicians.isActive }).from(politicians));
}

export interface PoliticianDetail {
  politician: Politician;
  declarations: AssetDeclaration[];
  /** Years an editor left out of the comparison (shown as a note with the original filing's link). */
  hiddenYears: number[];
  mentions: { slug: string; title: string; publishedAt: Date | null; sourceName: string }[];
  /**
   * Another member, current or former, has the same short name: news that names it cannot be
   * attributed to this one (a former "Б.Бат" may still be in the news as a minister).
   */
  nameShared: boolean;
  /** Another ACTIVE member has the same short name: this term's attendance cannot be told apart either. */
  nameSharedNow: boolean;
}

export async function getPolitician(id: number): Promise<PoliticianDetail | null> {
  "use cache";
  // Declarations change once a year and the roster sync is daily: "hours" re-read every member's
  // page each hour a crawler came by (38 859 reads in 19 days, Nov 2026).
  cacheLife("days");
  cacheTag("officials", `politician-${id}`);
  return safe("getPolitician", null, async () => {
    const db = getDb();
    const [politician] = await db.select().from(politicians).where(eq(politicians.id, id)).limit(1);
    if (!politician) return null;
    const [allDeclarations, hidden, namesakes] = await Promise.all([
      db.select().from(assetDeclarations).where(eq(assetDeclarations.politicianId, id)).orderBy(assetDeclarations.year),
      loadHiddenYears(),
      db.select({ shortName: politicians.shortName, isActive: politicians.isActive }).from(politicians).where(eq(politicians.shortName, politician.shortName)),
    ]);
    const hiddenYears = hidden[String(id)] ?? [];
    const declarations = allDeclarations.filter((d) => !hiddenYears.includes(d.year));
    const nameShared = sharedShortNames(namesakes).size > 0;
    const nameSharedNow = sharedShortNames(namesakes.filter((n) => n.isActive)).size > 0;
    // News that names the person the way Mongolian text does ("Ж.Алдаржавхлан"); a short name two
    // members share cannot be attributed to either.
    const mentions = nameShared
      ? []
      : await db
          .select({ slug: articles.slug, title: displayTitle, publishedAt: articles.publishedAt, sourceName: sources.name })
          .from(articles)
          .innerJoin(sources, eq(articles.sourceId, sources.id))
          .where(and(visible, sql`jsonb_exists(coalesce(${articles.extractedEntities}->'people', '[]'::jsonb), ${politician.shortName})`))
          .orderBy(desc(articles.publishedAt))
          .limit(20);
    return { politician, declarations, hiddenYears, mentions, nameShared, nameSharedNow };
  });
}

/* ------------------------------------------------------------------ indicators */

/** A stored snapshot from an official data API (see scripts/sync-*.ts), or null. */
export async function getIndicator<T>(key: string): Promise<{ data: T; asOf: string | null; updatedAt: Date } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("indicators", `indicator-${key}`);
  return safe(`getIndicator(${key})`, null, async () => {
    const [row] = await getDb().select().from(indicatorSnapshots).where(eq(indicatorSnapshots.key, key)).limit(1);
    return row ? { data: row.data as T, asOf: row.asOf, updatedAt: row.updatedAt } : null;
  });
}

/**
 * The companies one member declared, out of the 57 KB `officials_companies` snapshot: only those
 * keys leave the database (every member's page used to read the whole snapshot).
 */
export async function getOfficialCompanies(keys: string[]): Promise<OfficialCompaniesSnapshot | null> {
  "use cache";
  cacheLife("days");
  cacheTag("indicators", "indicator-officials_companies");
  return safe("getOfficialCompanies", null, async () => {
    const wanted = JSON.stringify([...new Set(keys)].sort());
    const [row] = await getDb()
      .select({
        from: sql<string>`${indicatorSnapshots.data}->>'from'`,
        to: sql<string>`${indicatorSnapshots.data}->>'to'`,
        companies: sql<OfficialCompaniesSnapshot["companies"]>`coalesce((select jsonb_object_agg(k, ${indicatorSnapshots.data}->'companies'->k) from jsonb_array_elements_text(${wanted}::jsonb) k where ${indicatorSnapshots.data}->'companies' ? k), '{}'::jsonb)`,
      })
      .from(indicatorSnapshots)
      .where(eq(indicatorSnapshots.key, "officials_companies"))
      .limit(1);
    return row ? { from: row.from ?? "", to: row.to ?? "", companies: row.companies ?? {} } : null;
  });
}

/** "Дэмжих" bank account (app_settings "donation", edited in /admin). */
export async function getDonation(): Promise<Donation> {
  "use cache";
  cacheLife("days");
  cacheTag("settings");
  return safe("getDonation", DEFAULT_DONATION, async () => {
    const [row] = await getDb().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, DONATION_KEY)).limit(1);
    return row ? parseDonation(row.value) : DEFAULT_DONATION;
  });
}

/**
 * Received donations for /transparency (and the admin list): the newest `limit` rows plus the
 * all-time count and sum and this Ulaanbaatar month's sum. Tag "donations" (admin add/delete).
 */
export async function getDonations(limit = 100): Promise<DonationsSummary> {
  "use cache";
  cacheLife("hours");
  cacheTag("donations");
  const empty: DonationsSummary = { rows: [], count: 0, totalMnt: 0, monthMnt: 0 };
  return safe("getDonations", empty, async () => {
    const db = getDb();
    const month = `${ubDateKey(Date.now()).slice(0, 7)}-01`;
    const [rows, [sums]] = await Promise.all([
      db
        .select({ id: donations.id, receivedOn: donations.receivedOn, amountMnt: donations.amountMnt, donor: donations.donor, note: donations.note })
        .from(donations)
        .orderBy(desc(donations.receivedOn), desc(donations.id))
        .limit(limit),
      db
        .select({
          count: sql<number>`count(*)::int`,
          total: sql<string>`coalesce(sum(${donations.amountMnt}), 0)`,
          month: sql<string>`coalesce(sum(${donations.amountMnt}) filter (where ${donations.receivedOn} >= ${month}::date), 0)`,
        })
        .from(donations),
    ]);
    return { rows: rows.map((r) => ({ ...r, amountMnt: Number(r.amountMnt) })), count: sums.count, totalMnt: Number(sums.total), monthMnt: Number(sums.month) };
  });
}

/** "Бид хэн бэ" (/about), edited in /admin (app_settings "about"); defaults without a database. */
export async function getAbout(): Promise<About> {
  "use cache";
  cacheLife("days");
  cacheTag("settings");
  return safe("getAbout", DEFAULT_ABOUT, async () => {
    const [row] = await getDb().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, ABOUT_KEY)).limit(1);
    return row ? parseAbout(row.value) : DEFAULT_ABOUT;
  });
}

/** The editor-hidden declaration years as "id:year" pairs for the admin form (not cached: admin only). */
export async function getHiddenYearsText(): Promise<string> {
  if (!hasDatabase()) return "";
  const { hiddenYearsToText } = await import("@/lib/officials/hidden");
  return hiddenYearsToText(await loadHiddenYears());
}

/** Expression of the GIN index articles_search_idx (schema.ts): keep both identical. */
const SEARCH_DOC = sql`to_tsvector('simple', ${articles.title} || ' ' || coalesce(${articles.tldrSummary}, ''))`;

export interface SearchResults {
  articles: ArticleListItem[];
  politicians: { id: number; fullName: string; party: string | null; photoUrl: string | null }[];
}

/** /search: published articles (title + AI summary, prefix match) and MPs by name. */
export async function search(q: string): Promise<SearchResults> {
  "use cache";
  cacheLife("news");
  cacheTag("articles", "officials");
  const query = toPrefixQuery(q);
  const empty: SearchResults = { articles: [], politicians: [] };
  if (!query) return empty;
  return safe("search", empty, async () => {
    const db = getDb();
    const tsq = sql`to_tsquery('simple', ${query})`;
    const name = `%${q.trim().slice(0, 60).replace(/[%_\\]/g, "")}%`;
    const [rows, people] = await Promise.all([
      db
        .select(listColumns)
        .from(articles)
        .innerJoin(sources, eq(articles.sourceId, sources.id))
        .where(and(visible, sql`${SEARCH_DOC} @@ ${tsq}`))
        .orderBy(sql`ts_rank(${SEARCH_DOC}, ${tsq}) desc`, desc(articles.publishedAt))
        .limit(30),
      q.trim().length >= 2
        ? db
            .select({ id: politicians.id, fullName: politicians.fullName, party: politicians.party, photoUrl: politicians.photoUrl })
            .from(politicians)
            .where(and(eq(politicians.isActive, true), sql`(${politicians.fullName} ilike ${name} or ${politicians.shortName} ilike ${name})`))
            .limit(6)
        : Promise.resolve([]),
    ]);
    return { articles: rows.map(toListItem), politicians: people };
  });
}

export type AttendanceHighlight = Extract<DatasetHighlight, { kind: "attendance" }>;

/** Parliament attendance from opendata.mn (one dataset, every member's counts). */
export async function getAttendance(): Promise<{ highlight: AttendanceHighlight; pageUrl: string } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("open-data");
  return safe("getAttendance", null, async () => {
    const [row] = await getDb()
      .select({ highlight: openDatasets.highlight, pageUrl: openDatasets.pageUrl })
      .from(openDatasets)
      .where(sql`${openDatasets.highlight}->>'kind' = 'attendance'`)
      .limit(1);
    return row?.highlight?.kind === "attendance" ? { highlight: row.highlight, pageUrl: row.pageUrl } : null;
  });
}

/** /laws: newest legal acts registered on legalinfo.mn (laws, resolutions, orders) with their AI summaries. */
export async function getLegalActs(limit = 40): Promise<ArticleListItem[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("articles", "feed");
  return safe("getLegalActs", [], async () => {
    const rows = await getDb()
      .select(listColumns)
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(and(visible, eq(sources.domain, "legalinfo.mn")))
      .orderBy(desc(articles.publishedAt), desc(articles.id))
      .limit(limit);
    return rows.map(toListItem);
  });
}

export interface WeekNumbers {
  articles: number;
  risky: number;
  legalActs: number;
  sources: number;
  /** articles that name an amount in ₮ */
  withAmounts: number;
}

/** "📊 Энэ 7 хоногт" on /digest: plain counts over the last 7 days. */
export async function getWeekNumbers(): Promise<WeekNumbers | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("articles");
  return safe("getWeekNumbers", null, async () => {
    const since = sql`now() - interval '7 days'`;
    const [r] = await getDb()
      .select({
        articles: sql<number>`count(*)::int`,
        risky: sql<number>`count(*) filter (where ${articles.riskFlag})::int`,
        legalActs: sql<number>`count(*) filter (where ${sources.domain} = 'legalinfo.mn')::int`,
        sources: sql<number>`count(distinct ${articles.sourceId})::int`,
        withAmounts: sql<number>`count(*) filter (where ${namesMnt})::int`,
      })
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(and(visible, sql`${articles.publishedAt} > ${since}`));
    return r && r.articles > 0 ? r : null;
  });
}

export interface SourceChangeItem {
  slug: string;
  title: string;
  sourceName: string;
  status: "changed" | "gone";
  changedAt: Date;
  publishedAt: Date | null;
  /** Share of our sentences still on the page (changed only). */
  containment: number | null;
  edits: number;
}

/** Articles whose source page changed or disappeared after we stored them (/changes), newest first. */
export async function getSourceChanges(limit = 100): Promise<SourceChangeItem[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("articles");
  return safe("getSourceChanges", [], async () => {
    const rows = await getDb()
      .select({
        slug: articles.slug,
        title: articles.title,
        sourceName: sources.name,
        status: articles.sourceStatus,
        changedAt: articles.sourceChangedAt,
        publishedAt: articles.publishedAt,
        diff: articles.sourceDiff,
      })
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(and(visible, inArray(articles.sourceStatus, ["changed", "gone"]), isNotNull(articles.sourceChangedAt)))
      .orderBy(desc(articles.sourceChangedAt))
      .limit(limit);
    return rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      sourceName: r.sourceName,
      status: r.status as "changed" | "gone",
      changedAt: r.changedAt!,
      publishedAt: r.publishedAt,
      containment: r.diff?.containment ?? null,
      edits: (r.diff?.pairs.length ?? 0) + (r.diff?.removed.length ?? 0),
    }));
  });
}

export interface TenderItem {
  id: number;
  code: string;
  title: string;
  orgName: string;
  governor: string | null;
  budgetMnt: number | null;
  contractMnt: number | null;
  method: string | null;
  winner: string | null;
  /** Official result date as filed (yyyy-mm-dd), when readable. */
  resultDate: string | null;
  /** Amounts in an unclear unit: shown as filed, never as ₮. */
  unitSuspect: boolean;
}

export interface TendersOverview {
  /** Newest contracts first: new to our sync, else by the official date. */
  latest: TenderItem[];
  /** This year's largest contracts. */
  largest: TenderItem[];
  year: number;
  awardedCount: number;
  contractSum: number;
  orgCount: number;
  /** Lots whose winner cell says nobody won (no bidders, cancelled). */
  noAwardCount: number;
  /** Awards left out of the sum and the ranking because their unit is unclear. */
  unitSuspectCount: number;
  syncedAt: string | null;
}

const tenderColumns = {
  id: tenders.id,
  code: tenders.code,
  title: tenders.title,
  orgName: tenders.orgName,
  governor: tenders.governor,
  budgetMnt: tenders.budgetMnt,
  contractMnt: tenders.contractMnt,
  method: tenders.method,
  winner: tenders.winner,
  resultDate: tenders.resultDate,
  unitSuspect: tenders.unitSuspect,
};

/** /tenders: Шилэн данс form-1831 results (src/lib/procurement), facts only. */
export async function getTenders(limit = 60): Promise<TendersOverview | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("tenders");
  return safe("getTenders", null, async () => {
    const db = getDb();
    const thisYear = tenderThisYear;
    const firstOfSame = tenderFirstOfSame;
    const [latest, largest, [totals], [synced]] = await Promise.all([
      db
        .select(tenderColumns)
        .from(tenders)
        .where(and(tenderAwarded, firstOfSame))
        .orderBy(sql`coalesce(${tenders.awardedSeenAt}, ${tenders.resultDate}::timestamptz) desc nulls last`, desc(tenders.id))
        .limit(limit),
      db
        .select(tenderColumns)
        .from(tenders)
        .where(and(tenderAwarded, eq(tenders.unitSuspect, false), thisYear, firstOfSame))
        .orderBy(desc(tenders.contractMnt))
        .limit(15),
      db
        .select({
          year: sql<number>`extract(year from now() at time zone 'Asia/Ulaanbaatar')::int`,
          awarded: sql<number>`count(*) filter (where ${tenderAwarded} and ${firstOfSame})::int`,
          sum: sql<string>`coalesce(sum(${tenders.contractMnt}) filter (where ${tenderAwarded} and not ${tenders.unitSuspect} and ${firstOfSame}), 0)::text`,
          suspect: sql<number>`count(*) filter (where ${tenderAwarded} and ${tenders.unitSuspect} and ${firstOfSame})::int`,
          orgs: sql<number>`count(distinct ${tenders.orgName})::int`,
          // Only lots whose result says nobody won ("оролцогч ирээгүй", "-"): a named winner with no
          // amount yet is not "no winner" (it was 263 of the 501 on the card, Nov 2026 audit).
          noAward: sql<number>`count(*) filter (where ${tenders.winner} ~* ${NO_AWARD_SQL})::int`,
        })
        .from(tenders)
        .where(thisYear),
      db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "tenders_synced_at")),
    ]);
    if (latest.length === 0) return null;
    return {
      latest,
      largest,
      year: totals.year,
      awardedCount: totals.awarded,
      contractSum: Number(totals.sum),
      orgCount: totals.orgs,
      noAwardCount: totals.noAward,
      unitSuspectCount: totals.suspect,
      syncedAt: synced?.value ?? null,
    };
  });
}

export interface TenderSigns {
  buyers: BuyerSign[];
  national: NationalShares;
  /** This year's contracts signed above their approved budget, furthest above first. */
  overBudget: TenderItem[];
  overBudgetCount: number;
  year: number;
}

/**
 * /tenders "Анхаарах шинж" (src/lib/procurement/signs.ts): this year's clean awards only (a named
 * winner, an amount, no unclear unit, each contract once).
 */
export async function getTenderSigns(): Promise<TenderSigns | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("tenders");
  return safe("getTenderSigns", null, async () => {
    const db = getDb();
    const clean = and(tenderAwarded, eq(tenders.unitSuspect, false), isNotNull(tenders.winner), tenderThisYear, tenderFirstOfSame);
    const overBudget = sql`${tenders.budgetMnt} > 0 and ${tenders.contractMnt} > ${tenders.budgetMnt}`;
    const [byMethod, byWinner, over, [{ overCount, year }]] = await Promise.all([
      db
        .select({ orgName: tenders.orgName, method: tenders.method, n: sql<number>`count(*)::int` })
        .from(tenders)
        .where(clean)
        .groupBy(tenders.orgName, tenders.method),
      db
        .select({ orgName: tenders.orgName, winner: tenders.winner, n: sql<number>`count(*)::int` })
        .from(tenders)
        .where(clean)
        .groupBy(tenders.orgName, tenders.winner),
      db
        .select(tenderColumns)
        .from(tenders)
        .where(and(clean, overBudget))
        .orderBy(sql`(${tenders.contractMnt} - ${tenders.budgetMnt})::float / ${tenders.budgetMnt} desc`, desc(tenders.id))
        .limit(20),
      db
        .select({
          overCount: sql<number>`count(*) filter (where ${overBudget})::int`,
          year: sql<number>`extract(year from now() at time zone 'Asia/Ulaanbaatar')::int`,
        })
        .from(tenders)
        .where(clean),
    ]);
    if (byMethod.length === 0) return null;
    const stats = new Map<string, BuyerStats>();
    const statsOf = (orgName: string) => {
      let s = stats.get(orgName);
      if (!s) stats.set(orgName, (s = { orgName, lots: 0, topWinner: null, topWinnerLots: 0, nonCompetitiveLots: 0 }));
      return s;
    };
    let totalLots = 0;
    let nonCompetitiveLots = 0;
    for (const r of byMethod) {
      const s = statsOf(r.orgName);
      s.lots += r.n;
      totalLots += r.n;
      if (isNonCompetitive(r.method)) {
        s.nonCompetitiveLots += r.n;
        nonCompetitiveLots += r.n;
      }
    }
    for (const r of byWinner) {
      const s = statsOf(r.orgName);
      // Ties go to the name that sorts first, so a reload never swaps the supplier shown.
      if (r.winner && (r.n > s.topWinnerLots || (r.n === s.topWinnerLots && s.topWinner !== null && r.winner.localeCompare(s.topWinner, "mn") < 0))) {
        s.topWinner = r.winner;
        s.topWinnerLots = r.n;
      }
    }
    const all = [...stats.values()];
    return { buyers: buyerSigns(all), national: nationalShares(all, totalLots, nonCompetitiveLots), overBudget: over, overBudgetCount: overCount, year };
  });
}

/** Tender lots won by a company a member declared (src/lib/officials/companies.ts `matchWinners`). */
export interface CompanyTenders {
  /** The company as the member declared it. */
  name: string;
  /** Active members who declared shares in it, in their latest filing. */
  owners: { id: number; shortName: string }[];
  count: number;
  /** Clean amounts only (no unclear unit). */
  sum: number;
  items: TenderItem[];
}

/**
 * Declared companies that won a form-1831 tender, by company key. Only companies Шилэн данс knows
 * under exactly one register take part, a consortium cell counts for each member, and nothing is
 * read into a match: /tenders and the member's profile say so.
 */
export async function getCompanyTenders(): Promise<Record<string, CompanyTenders>> {
  "use cache";
  cacheLife("days");
  cacheTag("tenders");
  cacheTag("officials");
  return safe("getCompanyTenders", {}, async () => {
    const db = getDb();
    const [snap] = await db.select({ data: indicatorSnapshots.data }).from(indicatorSnapshots).where(eq(indicatorSnapshots.key, "officials_companies"));
    const keys = foundKeys((snap?.data ?? null) as OfficialCompaniesSnapshot | null);
    if (keys.size === 0) return {};
    const winners = await db.selectDistinct({ winner: tenders.winner }).from(tenders).where(and(tenderAwarded, isNotNull(tenders.winner)));
    const matched = matchWinners(
      keys,
      winners.flatMap((w) => (w.winner ? [w.winner] : [])),
    );
    if (matched.size === 0) return {};
    const cells = [...new Set([...matched.values()].flat())];
    const [rows, latest] = await Promise.all([
      db
        .select(tenderColumns)
        .from(tenders)
        .where(and(tenderAwarded, tenderFirstOfSame, inArray(tenders.winner, cells)))
        .orderBy(sql`${tenders.resultDate} desc nulls last`, desc(tenders.id)),
      db
        .selectDistinctOn([assetDeclarations.politicianId], { id: politicians.id, shortName: politicians.shortName, details: assetDeclarations.details })
        .from(assetDeclarations)
        .innerJoin(politicians, eq(politicians.id, assetDeclarations.politicianId))
        .where(eq(politicians.isActive, true))
        .orderBy(assetDeclarations.politicianId, desc(assetDeclarations.year)),
    ]);
    const owners = new Map<string, { name: string; owners: { id: number; shortName: string }[] }>();
    for (const m of latest)
      for (const o of declaredCompanies(m.details as Record<string, string> | null).stocks) {
        const e = owners.get(o.key) ?? { name: o.name, owners: [] };
        e.owners.push({ id: m.id, shortName: m.shortName });
        owners.set(o.key, e);
      }
    const out: Record<string, CompanyTenders> = {};
    for (const [key, cellList] of matched) {
      const lots = rows.filter((r) => r.winner !== null && cellList.includes(r.winner));
      if (lots.length === 0) continue;
      out[key] = {
        name: owners.get(key)?.name ?? lots[0].winner ?? key,
        owners: owners.get(key)?.owners ?? [],
        count: lots.length,
        sum: lots.reduce((s, r) => s + (r.unitSuspect ? 0 : (r.contractMnt ?? 0)), 0),
        items: lots.slice(0, 5),
      };
    }
    return out;
  });
}

export interface DocumentItem {
  id: number;
  url: string;
  title: string;
  kind: string;
  domain: string;
  pageTitle: string | null;
  pageUrl: string | null;
  fileType: string | null;
  meta: Record<string, string> | null;
  firstSeenAt: Date;
}

export interface WatchedPageItem {
  url: string;
  domain: string;
  title: string;
  kind: string;
  modified: string;
  fileCount: number;
}

export interface DocumentsOverview {
  audits: DocumentItem[];
  /** Files that appeared on a watched page after we first read it. */
  added: DocumentItem[];
  pages: WatchedPageItem[];
  checkedAt: string | null;
}

/** /documents: new audit.mn reports and files added to watched report/tender pages. */
export async function getDocuments(): Promise<DocumentsOverview | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("documents");
  return safe("getDocuments", null, async () => {
    const db = getDb();
    const cols = {
      id: documents.id,
      url: documents.url,
      title: documents.title,
      kind: documents.kind,
      domain: documents.domain,
      pageTitle: documents.pageTitle,
      pageUrl: documents.pageUrl,
      fileType: documents.fileType,
      meta: documents.meta,
      firstSeenAt: documents.firstSeenAt,
    };
    const [audits, added, pages, [checked]] = await Promise.all([
      db.select(cols).from(documents).where(eq(documents.domain, "audit.mn")).orderBy(desc(documents.firstSeenAt), desc(documents.id)).limit(20),
      db
        .select(cols)
        .from(documents)
        .where(and(eq(documents.baseline, false), sql`${documents.domain} <> 'audit.mn'`))
        .orderBy(desc(documents.firstSeenAt), desc(documents.id))
        .limit(50),
      db
        .select({ url: watchedPages.url, domain: watchedPages.domain, title: watchedPages.title, kind: watchedPages.kind, modified: watchedPages.modified, fileCount: watchedPages.fileCount })
        .from(watchedPages)
        .where(sql`${watchedPages.fileCount} > 0`)
        .orderBy(desc(watchedPages.modified))
        .limit(40),
      db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "documents_checked_at")),
    ]);
    if (audits.length === 0 && added.length === 0 && pages.length === 0) return null;
    return { audits, added, pages, checkedAt: checked?.value ?? null };
  });
}
