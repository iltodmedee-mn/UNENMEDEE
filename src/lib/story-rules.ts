import { and, eq, isNotNull, sql, type SQL } from "drizzle-orm";

import { articles, sources } from "@/db/schema";
import { FEED_MIN_IMPORTANCE, INDEXED_DOMAINS, isThinArticle, THIN_BELOW } from "@/lib/seo";
import { AI_TOPIC_KEYS, TOPICS, topicFor } from "@/lib/topics";
import type { ExtractedEntities, ScrapeMeta, SourceCategory } from "@/lib/types";

/**
 * What a story is: the one place that says which stored articles are "published", "AI-summarized",
 * "dated", what headline readers see, which topic a story belongs to, whether a search engine may
 * index it and whether it is in the feed. Queries, the posting scripts, push and the video job all
 * import these instead of writing their own copy (they had drifted: the push step posted undated
 * pages as news, Nov 2026).
 *
 * Every rule is a Drizzle SQL fragment (for `where` / `select`) and, where a row in memory needs
 * the same answer, a TypeScript twin next to it. `tests/story-rules.test.ts` runs both over the
 * same rows in PGlite and fails when they disagree. Server-only (drizzle schema); client code uses
 * `topicFor` (topics.ts) and `isThinArticle` (seo.ts), which the SQL here mirrors.
 *
 * Joined queries: `effectiveTopic`, `indexable` and `namesMnt` read `sources`, so the query must
 * join it.
 */

/** The fields of a stored story the TypeScript twins read. */
export interface StoryFacts {
  isPublished: boolean;
  tldrSummary: string | null;
  summaryFallback: boolean;
  scrapeMeta: ScrapeMeta | null;
  readerTitle: string | null;
  title: string;
  extractedEntities: ExtractedEntities | null;
  importanceScore: number | null;
  clusterId: number | null;
  topic: string | null;
  sourceDomain: string;
  sourceCategory: SourceCategory;
}

// ---------------------------------------------------------------- published / summarized / dated

/** Not withdrawn (`is_published`). */
export const published: SQL = eq(articles.isPublished, true);
export const isPublished = (s: Pick<StoryFacts, "isPublished">): boolean => s.isPublished === true;

/** What the public site shows: published and analysed (a summary exists, even the extractive fallback). */
export const visible: SQL = and(published, isNotNull(articles.tldrSummary))!;
export const isVisible = (s: Pick<StoryFacts, "isPublished" | "tldrSummary">): boolean => isPublished(s) && s.tldrSummary !== null;

/** Visible and written by a model: the no-AI fallback summary (first sentences) does not count. */
export const aiSummarized: SQL = and(visible, eq(articles.summaryFallback, false))!;
export const isAiSummarized = (s: Pick<StoryFacts, "isPublished" | "tldrSummary" | "summaryFallback">): boolean => isVisible(s) && s.summaryFallback === false;

/** The source page printed no date: `published_at` is only when we found it. As a boolean column. */
export const undated: SQL<boolean> = sql<boolean>`coalesce((${articles.scrapeMeta}->>'date_unknown')::boolean, false)`;
export const isUndated = (s: Pick<StoryFacts, "scrapeMeta">): boolean => s.scrapeMeta?.date_unknown === true;
/** The publication date is the source's own. */
export const dated: SQL = sql`${undated} = false`;

/**
 * Safe to put in front of readers as "new" (social posts, quiz questions, push, videos): visible,
 * AI-summarized and dated. A recency window on `published_at` is the caller's, because an undated
 * old page found today would pass it.
 */
export const postable: SQL = and(aiSummarized, dated)!;
export const isPostable = (s: StoryFacts): boolean => isAiSummarized(s) && !isUndated(s);

// ---------------------------------------------------------------- headline, amounts

/** The plain headline Tier 1 wrote, else the source's own (src/lib/ai/reader-view.ts). */
export const displayTitle: SQL<string> = sql<string>`coalesce(${articles.readerTitle}, ${articles.title})`;
export const displayTitleOf = (s: Pick<StoryFacts, "readerTitle" | "title">): string => s.readerTitle ?? s.title;

/** The story's extracted entities name at least one ₮ amount. */
export const namesMnt: SQL<boolean> = sql<boolean>`(jsonb_array_length(coalesce(${articles.extractedEntities}->'amounts_mnt', '[]'::jsonb)) > 0)`;
export const hasMntAmount = (s: Pick<StoryFacts, "extractedEntities">): boolean => (s.extractedEntities?.amounts_mnt?.length ?? 0) > 0;

// ---------------------------------------------------------------- topic

const DOMAIN_TOPIC = sql`case ${sources.domain} ${sql.join(
  TOPICS.flatMap((t) => t.domains.map((d) => sql`when ${d} then ${t.key}`)),
  sql` `,
)} else 'other' end`;

/**
 * SQL twin of `topicFor` (src/lib/topics.ts): local sites and opendata keep their domain topic,
 * otherwise the AI's `articles.topic` wins over the source domain.
 */
export const effectiveTopic: SQL<string> = sql<string>`case
  when ${sources.category} = 'local' then 'local'
  when ${DOMAIN_TOPIC} = 'data' then 'data'
  when ${articles.topic} in (${sql.join(AI_TOPIC_KEYS.map((k) => sql`${k}`), sql`, `)}) then ${articles.topic}
  else ${DOMAIN_TOPIC} end`;
export const effectiveTopicKey = (s: Pick<StoryFacts, "sourceDomain" | "sourceCategory" | "topic">): string => topicFor(s.sourceDomain, s.sourceCategory, s.topic).key;

// ---------------------------------------------------------------- feed and search engines

/**
 * Below FEED_MIN_IMPORTANCE a story (a training, a greeting, a dataset listing) stays off the home
 * page and topic pages. An unscored story (null) is shown.
 */
export const feedVisible: SQL = sql`coalesce(${articles.importanceScore}, 100) >= ${FEED_MIN_IMPORTANCE}`;
export const isFeedVisible = (s: Pick<StoryFacts, "importanceScore">): boolean => s.importanceScore === null || s.importanceScore >= FEED_MIN_IMPORTANCE;

/** SQL twin of `!isThinArticle(...)` (src/lib/seo.ts): offered to search engines and the sitemaps. */
export const indexable: SQL = sql`(coalesce(${articles.importanceScore}, 100) >= ${THIN_BELOW}
  or ${articles.clusterId} is not null
  or ${namesMnt}
  or ${sources.domain} in (${sql.join(INDEXED_DOMAINS.map((d) => sql`${d}`), sql`, `)}))`;
export const isIndexable = (s: Pick<StoryFacts, "importanceScore" | "clusterId" | "extractedEntities" | "sourceDomain">): boolean =>
  !isThinArticle({ importanceScore: s.importanceScore, clusterId: s.clusterId, amounts: s.extractedEntities?.amounts_mnt ?? [], sourceDomain: s.sourceDomain });
