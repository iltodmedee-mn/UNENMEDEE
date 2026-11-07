import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";

import type { DB } from "@/db";
import { articles, sources } from "@/db/schema";
import { displayTitle, postable } from "@/lib/story-rules";

/** The most stories one push run looks at (it sends one notification for the top one + a count). */
export const PUSH_CANDIDATES = 50;

/**
 * Stories a news push may announce: `postable` (published, AI-summarized, dated: an old page found
 * today with no printed date must not go out as "new"), not notified before, published in the last
 * 24 h, and important (importance >= `importanceMin`) or risk-flagged. Most important first.
 */
export async function selectPushCandidates(db: DB, importanceMin: number, now: Date = new Date()) {
  return db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: displayTitle,
      tldr: articles.tldrSummary,
      sourceName: sources.name,
      riskFlag: articles.riskFlag,
    })
    .from(articles)
    .innerJoin(sources, eq(articles.sourceId, sources.id))
    .where(
      and(
        postable,
        isNull(articles.notifiedAt),
        gte(articles.publishedAt, new Date(now.getTime() - 24 * 3_600_000)),
        or(gte(articles.importanceScore, importanceMin), eq(articles.riskFlag, true)),
      ),
    )
    .orderBy(sql`${articles.importanceScore} desc nulls last`, desc(articles.riskScore))
    .limit(PUSH_CANDIDATES);
}
