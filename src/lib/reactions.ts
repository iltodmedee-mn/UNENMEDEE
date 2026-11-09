/**
 * Readers' one-tap reactions under a story: «Тустай», «Эргэлзээтэй», «Залруулга байна». No account
 * and nothing about the reader is stored, only a count per story and kind (`article_reactions`).
 *
 * Load (Nov 2026, Supabase egress over the free quota): the article page stays static. Everyone sees
 * the counts through GET /api/react?id=, which the CDN caches for COUNTS_CACHE_S, so the database
 * reads one story's 3 rows at most once a minute however many read it; a tap answers fresh counts.
 * A browser remembers its own taps (localStorage), the route limits taps per IP.
 */
import { eq, sql } from "drizzle-orm";

import type { DB } from "@/db";
import { articleReactions } from "@/db/schema";

import { REACTION_KINDS, type ReactionCounts, type ReactionKind } from "@/lib/reaction-kinds";

export { COUNTS_CACHE_S, REACTION_KINDS, REACTION_LABELS, type ReactionCounts, type ReactionKind } from "@/lib/reaction-kinds";


/** `?id=` of the counts request: a positive article id, or null. */
export function parseArticleId(v: string | null): number | null {
  if (!v || !/^\d{1,9}$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

const isKind = (v: unknown): v is ReactionKind => typeof v === "string" && (REACTION_KINDS as readonly string[]).includes(v);

/** The body of a tap: `{"id": <article id>, "kind": "useful" | "doubt" | "correction"}`, or null. */
export function parseReaction(body: string): { articleId: number; kind: ReactionKind } | null {
  if (body.length > 200) return null;
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const { id, kind } = v as { id?: unknown; kind?: unknown };
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || !isKind(kind)) return null;
  return { articleId: id, kind };
}

/** Counts one tap and returns the story's counts. Throws when the story does not exist (foreign key). */
export async function addReaction(db: DB, articleId: number, kind: ReactionKind, now = new Date()): Promise<ReactionCounts> {
  await db
    .insert(articleReactions)
    .values({ articleId, kind, count: 1, updatedAt: now })
    .onConflictDoUpdate({ target: [articleReactions.articleId, articleReactions.kind], set: { count: sql`${articleReactions.count} + 1`, updatedAt: now } });
  return reactionCounts(db, articleId);
}

export async function reactionCounts(db: DB, articleId: number): Promise<ReactionCounts> {
  const rows = await db.select({ kind: articleReactions.kind, count: articleReactions.count }).from(articleReactions).where(eq(articleReactions.articleId, articleId));
  const out: ReactionCounts = { useful: 0, doubt: 0, correction: 0 };
  for (const r of rows) if (isKind(r.kind)) out[r.kind] = r.count;
  return out;
}
