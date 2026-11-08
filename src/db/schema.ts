import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import type { SourceDiff } from "@/lib/scraper/recheck";
import type { DatasetHighlight, DigestItem, ExtractedEntities, FactVsSpin, ReaderImpact, ScrapeMeta } from "@/lib/types";
import type { VideoMeta } from "@/lib/video/posts";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const sourceCategory = pgEnum("source_category", ["portal", "ministry", "agency", "local"]);
export const aiProvider = pgEnum("ai_provider", ["deepseek", "grok", "ollama", "gemini", "nvidia", "groq", "requesty", "mistral", "openrouter", "zai", "elevenlabs"]);

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  domain: varchar("domain", { length: 255 }).notNull().unique(),
  /** Listing path or full URL the adapter starts crawling from. */
  urlPattern: text("url_pattern").notNull(),
  category: sourceCategory("category").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
  /** Last scrape error message (null after a successful run). */
  lastError: text("last_error"),
  /** Consecutive failed runs. The scraper backs off exponentially on dead sites. */
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  /** "seed" or the hub URL where `discover-sources` found this domain. */
  discoveredFrom: text("discovered_from").notNull().default("seed"),
});

export const clusters = pgTable("clusters", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  synthesisSummary: text("synthesis_summary"),
  articleCount: integer("article_count").notNull().default(0),
  maxRiskScore: integer("max_risk_score").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const articles = pgTable(
  "articles",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    originalUrl: text("original_url").notNull().unique(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    cleanContent: text("clean_content").notNull(),
    /** Small structured hints from the scraper adapter (not raw HTML). */
    scrapeMeta: jsonb("scrape_meta").$type<ScrapeMeta>(),
    tldrSummary: text("tldr_summary"),
    /** The headline in plain words (Tier 1, numbers checked against the text); null = show `title`. */
    readerTitle: text("reader_title"),
    /** "Танд хамаатай юу?": who, what changes, from when, what to do (null fields = the text does not say). */
    readerImpact: jsonb("reader_impact").$type<ReaderImpact>(),
    factVsSpin: jsonb("fact_vs_spin").$type<FactVsSpin>(),
    extractedEntities: jsonb("extracted_entities").$type<ExtractedEntities>(),
    riskFlag: boolean("risk_flag").notNull().default(false),
    riskScore: integer("risk_score").notNull().default(0),
    /** 0-100: how much the news matters nationally (AI Tier 1). Null for articles analyzed before it existed. */
    importanceScore: integer("importance_score"),
    /** Topic key the AI read from the text (src/lib/topics.ts AI_TOPIC_KEYS); null = use the source domain. */
    topic: varchar("topic", { length: 32 }),
    /** When a push notification went out for this article (never notify twice). */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    /** Set once followers of the MPs named in this article were notified (or none followed them). */
    mentionNotifiedAt: timestamp("mention_notified_at", { withTimezone: true }),
    grokDeepAnalysis: text("grok_deep_analysis"),
    clusterId: integer("cluster_id").references(() => clusters.id, { onDelete: "set null" }),
    /** Set when the AI pipeline gave up on this article, so it is not retried forever. */
    aiError: text("ai_error"),
    isPublished: boolean("is_published").notNull().default(true),
    /** Set when an editor changed the text in /admin. The SHA-256 still proves the ORIGINAL scraped text. */
    editedAt: timestamp("edited_at", { withTimezone: true }),
    /** Set when the body was cut to an excerpt after RETENTION_DAYS (keeps the free 500 MB DB from filling). */
    contentPrunedAt: timestamp("content_pruned_at", { withTimezone: true }),
    /** The summary is the article's first sentences because no AI could process it (see src/lib/ai/fallback.ts). */
    summaryFallback: boolean("summary_fallback").notNull().default(false),
    /** Last time scripts/recheck-sources.ts fetched the source page again (src/lib/scraper/recheck.ts). */
    sourceCheckedAt: timestamp("source_checked_at", { withTimezone: true }),
    /** "ok" | "changed" (the page's text differs from our copy) | "gone" (404 or redirected away on 2+ checks). */
    sourceStatus: varchar("source_status", { length: 12 }),
    /** When the change or removal was first seen. */
    sourceChangedAt: timestamp("source_changed_at", { withTimezone: true }),
    sourceMissingCount: integer("source_missing_count").notNull().default(0),
    /** Sentences that changed or disappeared (only for "changed"; capped at MAX_DIFF). */
    sourceDiff: jsonb("source_diff").$type<SourceDiff>(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("articles_content_hash_idx").on(t.contentHash),
    index("articles_source_id_idx").on(t.sourceId),
    index("articles_cluster_id_idx").on(t.clusterId),
    index("articles_risk_idx").on(t.riskFlag, t.riskScore),
    index("articles_published_at_idx").on(t.publishedAt),
    index("articles_created_at_idx").on(t.createdAt),
    index("articles_source_status_idx").on(t.sourceStatus).where(sql`${t.sourceStatus} in ('changed', 'gone')`),
    // /search: must match the expression in searchArticles() exactly.
    index("articles_search_idx").using("gin", sql`to_tsvector('simple', ${t.title} || ' ' || coalesce(${t.tldrSummary}, ''))`),
  ],
);

export const aiUsageLogs = pgTable(
  "ai_usage_logs",
  {
    id: serial("id").primaryKey(),
    provider: aiProvider("provider").notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    /** What the call was for: tier1 | tier2 | cluster | admin. */
    purpose: varchar("purpose", { length: 32 }),
    articleId: integer("article_id").references(() => articles.id, { onDelete: "set null" }),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    success: boolean("success").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_usage_logs_created_at_idx").on(t.createdAt),
    index("ai_usage_logs_provider_idx").on(t.provider),
    // Covers the FK (Supabase advisor 0001): deleting an article must not scan all logs.
    index("ai_usage_logs_article_id_idx").on(t.articleId),
  ],
);

/**
 * AI-written news digests: "12h" editions (08:00 and 20:00 Ulaanbaatar time) and longer
 * catch-up reviews such as "30d". Items are denormalized so the page needs no joins.
 */
export const digests = pgTable(
  "digests",
  {
    id: serial("id").primaryKey(),
    kind: varchar("kind", { length: 16 }).notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    title: text("title").notNull(),
    intro: text("intro").notNull(),
    items: jsonb("items").$type<DigestItem[]>().notNull(),
    /** Candidate articles the editor model chose from. */
    candidateCount: integer("candidate_count").notNull().default(0),
    /** "provider/model", or "rule-based" when no AI was available. */
    generatedBy: varchar("generated_by", { length: 120 }).notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("digests_kind_period_end_idx").on(t.kind, t.periodEnd)],
);

/**
 * Catalogue of external open-data portals' datasets (opendata.mn) with small computed
 * highlights. Raw rows are never stored: only metadata and compact summaries (CLAUDE.md rule #3).
 */
export const openDatasets = pgTable(
  "open_datasets",
  {
    id: serial("id").primaryKey(),
    portal: varchar("portal", { length: 64 }).notNull(),
    externalId: integer("external_id").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    description: text("description"),
    /** Original publisher (e.g. Монголбанк), not the portal account that uploaded it. */
    dataSource: text("data_source"),
    fileType: varchar("file_type", { length: 16 }),
    rowCount: integer("row_count").notNull().default(0),
    columns: jsonb("columns").$type<string[]>().notNull(),
    license: varchar("license", { length: 64 }),
    updateFrequency: varchar("update_frequency", { length: 64 }),
    pageUrl: text("page_url").notNull(),
    apiUrl: text("api_url").notNull(),
    highlight: jsonb("highlight").$type<DatasetHighlight>(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("open_datasets_portal_external_id_idx").on(t.portal, t.externalId)],
);

/** Browser push subscriptions (Web Push). Only the endpoint and its keys: no personal data. */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  failures: integer("failures").notNull().default(0),
  /** politicians.id the reader follows ("Миний гишүүн"): alerts when they appear in news. */
  followPoliticians: integer("follow_politicians").array().notNull().default(sql`'{}'::integer[]`),
});

/**
 * Server-side settings shared by Vercel and GitHub Actions (both already hold DATABASE_URL),
 * e.g. the VAPID key pair for Web Push. RLS on, never exposed through the REST API.
 */
export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transparencyLedger = pgTable("transparency_ledger", {
  id: serial("id").primaryKey(),
  /** e.g. "2026-10" */
  month: varchar("month", { length: 7 }).notNull().unique(),
  infraCostUsd: numeric("infra_cost_usd", { precision: 10, scale: 2 }).notNull().default("0"),
  aiCostUsd: numeric("ai_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  /** null = not entered for that month ("бүртгээгүй"), never shown as $0 income. */
  adRevenueUsd: numeric("ad_revenue_usd", { precision: 10, scale: 2 }),
  donationsUsd: numeric("donations_usd", { precision: 10, scale: 2 }),
  notes: text("notes"),
});

/**
 * Received donations, typed in /admin and listed on /transparency (`src/lib/donations.ts`). `donor`
 * is the name as published (initials, full or null = anonymous); the bank's own name is not kept.
 */
export const donations = pgTable(
  "donations",
  {
    id: serial("id").primaryKey(),
    receivedOn: date("received_on").notNull(),
    amountMnt: bigint("amount_mnt", { mode: "number" }).notNull(),
    donor: varchar("donor", { length: 80 }),
    note: varchar("note", { length: 140 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("donations_received_on_idx").on(t.receivedOn)],
);

/**
 * Members of parliament (and later other officials), synced from parliament.mn's public API.
 * Rows are never deleted: after an election, members who left get is_active = false.
 */
export const politicians = pgTable(
  "politicians",
  {
    id: serial("id").primaryKey(),
    parliamentMemberId: integer("parliament_member_id").notNull().unique(),
    /** aid_user_num in IAAC's ХАСХОМ declaration system (xacxom.iaac.mn), from the member's hom_url. */
    xacxomId: varchar("xacxom_id", { length: 32 }),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    /** "Ж.Алдаржавхлан": how news text names the person (matches extracted_entities.people). */
    shortName: varchar("short_name", { length: 120 }).notNull(),
    party: varchar("party", { length: 120 }),
    constituency: varchar("constituency", { length: 160 }),
    votes: integer("votes"),
    electionSystem: varchar("election_system", { length: 32 }),
    termStart: date("term_start"),
    termEnd: date("term_end"),
    isActive: boolean("is_active").notNull().default(true),
    photoUrl: text("photo_url"),
    profileUrl: text("profile_url").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("politicians_short_name_idx").on(t.shortName)],
);

/**
 * Yearly asset and income declarations (ХАСХОМ, published under the Anti-Corruption Law 14.3).
 * Amounts in ₮ (the source reports thousands; converted on sync).
 */
export const assetDeclarations = pgTable(
  "asset_declarations",
  {
    id: serial("id").primaryKey(),
    politicianId: integer("politician_id")
      .notNull()
      .references(() => politicians.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    /** Position held when declaring (e.g. "Дүүргийн Засаг дарга" before becoming an MP). */
    positionName: varchar("position_name", { length: 200 }),
    incomeOwn: bigint("income_own", { mode: "number" }),
    incomeFamily: bigint("income_family", { mode: "number" }),
    buildingsValue: bigint("buildings_value", { mode: "number" }),
    transportValue: bigint("transport_value", { mode: "number" }),
    landValue: bigint("land_value", { mode: "number" }),
    savings: bigint("savings", { mode: "number" }),
    receivables: bigint("receivables", { mode: "number" }),
    otherAssets: bigint("other_assets", { mode: "number" }),
    loans: bigint("loans", { mode: "number" }),
    gifts: bigint("gifts", { mode: "number" }),
    totalAssets: bigint("total_assets", { mode: "number" }),
    /** Short text fields as declared (vehicles, land, lenders); never raw pages. */
    details: jsonb("details").$type<Record<string, string>>(),
    sourceUrl: text("source_url").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("asset_declarations_politician_year_idx").on(t.politicianId, t.year)],
);

/** Small computed snapshots from official data APIs (Mongolbank, NSO budget, Шилэн данс), one row per key. */
export const indicatorSnapshots = pgTable("indicator_snapshots", {
  key: varchar("key", { length: 64 }).primaryKey(),
  data: jsonb("data").notNull(),
  asOf: varchar("as_of", { length: 32 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Tender results filed to Шилэн данс (form 1831, src/lib/procurement): one row per organisation +
 * tender code + item. `first_seen_at` is when our sync first saw the row, `awarded_seen_at` when
 * it first carried a winner and a contract amount (the "new contract" feed); the official
 * `result_date` is shown when the organisation typed a readable one.
 */
export const tenders = pgTable(
  "tenders",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 200 }).notNull().unique(),
    code: varchar("code", { length: 40 }).notNull(),
    title: text("title").notNull(),
    orgName: text("org_name").notNull(),
    orgRegister: varchar("org_register", { length: 20 }),
    governor: text("governor"),
    budgetMnt: bigint("budget_mnt", { mode: "number" }),
    contractMnt: bigint("contract_mnt", { mode: "number" }),
    method: text("method"),
    winner: text("winner"),
    awarded: boolean("awarded").notNull().default(false),
    /** Amounts in an unclear unit (thousands typed as ₮): shown as filed, never summed or ranked. */
    unitSuspect: boolean("unit_suspect").notNull().default(false),
    resultDate: date("result_date", { mode: "string" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    awardedSeenAt: timestamp("awarded_seen_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tenders_awarded_seen_idx").on(t.awardedSeenAt), index("tenders_result_date_idx").on(t.resultDate)],
);

export type TenderRow = typeof tenders.$inferSelect;

/**
 * Reports and tender documents kept on pages (src/lib/documents): audit.mn reports and the file
 * links on watched WordPress report/tender pages. Only the link, its text and its page are stored,
 * never the file. `baseline` rows were already there when we first read their page: kept so they
 * are never announced, listed only as "already on the page".
 */
export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    url: varchar("url", { length: 1000 }).notNull().unique(),
    title: text("title").notNull(),
    /** "audit" | "tender" | "report" */
    kind: varchar("kind", { length: 16 }).notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    pageTitle: text("page_title"),
    pageUrl: text("page_url"),
    fileType: varchar("file_type", { length: 8 }),
    /** audit.mn: the audit office and the audit type. */
    meta: jsonb("meta").$type<Record<string, string>>(),
    baseline: boolean("baseline").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("documents_first_seen_idx").on(t.firstSeenAt)],
);

/** The watched pages and the `modified` time we last read them at (src/lib/documents). */
export const watchedPages = pgTable("watched_pages", {
  url: varchar("url", { length: 1000 }).primaryKey(),
  domain: varchar("domain", { length: 255 }).notNull(),
  title: text("title").notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  /** As the site reports it; a different value means the page was edited. */
  modified: varchar("modified", { length: 40 }).notNull(),
  fileCount: integer("file_count").notNull().default(0),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DocumentRow = typeof documents.$inferSelect;

export const sourcesRelations = relations(sources, ({ many }) => ({
  articles: many(articles),
}));

export const articlesRelations = relations(articles, ({ one }) => ({
  source: one(sources, { fields: [articles.sourceId], references: [sources.id] }),
  cluster: one(clusters, { fields: [articles.clusterId], references: [clusters.id] }),
}));

export const clustersRelations = relations(clusters, ({ many }) => ({
  articles: many(articles),
}));

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type Cluster = typeof clusters.$inferSelect;
export type AIUsageLog = typeof aiUsageLogs.$inferSelect;
export type Digest = typeof digests.$inferSelect;
export type OpenDataset = typeof openDatasets.$inferSelect;
export type Politician = typeof politicians.$inferSelect;
export type AssetDeclaration = typeof assetDeclarations.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
/**
 * Generated videos (src/lib/video, scripts/make-video.ts): one per good and NSO data month
 * (`prices:<good>:<month>`) or per story (`money:<articleId>`). The
 * MP4 lives here only until the platforms have fetched it from /reel (make-video clears files
 * older than `VIDEO_KEEP_DAYS`); the row stays so the same video is never made twice. Not in the
 * backup.
 */
export const videos = pgTable("videos", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 80 }).notNull().unique(),
  meta: jsonb("meta").$type<VideoMeta>().notNull(),
  mp4: bytea("mp4"),
  bytes: integer("bytes"),
  durationS: real("duration_s"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LedgerRow = typeof transparencyLedger.$inferSelect;

/**
 * What was published to social media (Facebook page), one row per platform + item, so a run that
 * retries never posts the same story twice. The row is reserved before the API call and removed
 * if the call fails; post_id is the platform's id of the published post.
 */
export const socialPosts = pgTable(
  "social_posts",
  {
    id: serial("id").primaryKey(),
    platform: varchar("platform", { length: 16 }).notNull(),
    /** "digest" (digests.id) or "article" (articles.id). */
    kind: varchar("kind", { length: 16 }).notNull(),
    refId: integer("ref_id").notNull(),
    postId: varchar("post_id", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("social_posts_platform_kind_ref_idx").on(t.platform, t.kind, t.refId)],
);

/**
 * URLs and content hashes of articles the retention job deleted (`src/lib/retention.ts`), so the
 * scraper still treats them as already seen and never fetches or stores them again. ~100 bytes a
 * row instead of a ~5 KB article row with its indexes; rows older than `SEEN_URL_KEEP_DAYS` go too.
 */
export const seenUrls = pgTable(
  "seen_urls",
  {
    originalUrl: text("original_url").primaryKey(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    sourceId: integer("source_id"),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("seen_urls_content_hash_idx").on(t.contentHash), index("seen_urls_seen_at_idx").on(t.seenAt)],
);

/**
 * Headlines of independent newsrooms (src/lib/press/feeds.ts OUTLETS), to show which government
 * stories the press also wrote about. Title + link only: no text, no images. Rows older than
 * PRESS_KEEP_DAYS are deleted by `npm run press:sync`.
 */
export const pressItems = pgTable(
  "press_items",
  {
    id: serial("id").primaryKey(),
    outlet: varchar("outlet", { length: 64 }).notNull(),
    title: text("title").notNull(),
    url: text("url").notNull().unique(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("press_items_found_at_idx").on(t.foundAt)],
);

/** A press headline that covers a government story (src/lib/press/match.ts, TF-IDF cosine ≥ PRESS_MATCH_MIN). */
export const pressLinks = pgTable(
  "press_links",
  {
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    pressItemId: integer("press_item_id")
      .notNull()
      .references(() => pressItems.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.pressItemId] }), index("press_links_press_item_idx").on(t.pressItemId)],
);

/**
 * Server errors the public site hit (src/instrumentation.ts), one row per route and first message
 * line, counted, so the watchdog can say a page is failing without a paid error tracker. Holds no
 * request headers, body, query string or user data; pruned after 30 days.
 */
export const siteErrors = pgTable(
  "site_errors",
  {
    key: varchar("key", { length: 64 }).primaryKey(),
    route: varchar("route", { length: 300 }).notNull(),
    message: varchar("message", { length: 300 }).notNull(),
    digest: varchar("digest", { length: 40 }),
    count: integer("count").notNull().default(1),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("site_errors_last_seen_idx").on(t.lastSeen)],
);

/**
 * The finished content of one list page (home feed, a topic) as of the last pipeline run
 * (docs/adr/0001-list-pages-read-snapshots.md). `hash` covers only what makes the page different
 * (its stories and digest editions), so a run that changes nothing rebuilds nothing.
 */
export const feedSnapshots = pgTable("feed_snapshots", {
  key: varchar("key", { length: 64 }).primaryKey(),
  data: jsonb("data").notNull(),
  hash: varchar("hash", { length: 64 }).notNull(),
  builtAt: timestamp("built_at", { withTimezone: true }).notNull().defaultNow(),
});
