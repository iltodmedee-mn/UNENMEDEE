import { getDb, hasDatabase } from "@/db";
import { emptyCounts } from "@/lib/reaction-kinds";
import { addReaction, COUNTS_CACHE_S, parseArticleId, parseReaction, reactionCounts } from "@/lib/reactions";
import { clientIp, failureLimiter } from "@/lib/rate-limit";

/**
 * A story's counts for everyone. The CDN keeps the answer COUNTS_CACHE_S seconds (and serves the old
 * one while it refreshes), so the database is read at most once a minute per story read.
 */
export async function GET(request: Request) {
  const id = parseArticleId(new URL(request.url).searchParams.get("id"));
  if (!id) return Response.json({ error: "bad request" }, { status: 400 });
  if (!hasDatabase()) return Response.json(emptyCounts());
  try {
    const counts = await reactionCounts(getDb(), id);
    return Response.json(counts, { headers: { "cache-control": `public, max-age=0, s-maxage=${COUNTS_CACHE_S}, stale-while-revalidate=600` } });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

/**
 * One reader tap under a story (src/lib/reactions.ts): counts it and answers the story's counts.
 * 30 taps an hour per IP (per server instance), on top of the browser remembering its own taps.
 */
const perIp = failureLimiter(30, 3_600_000);

export async function POST(request: Request) {
  if (!hasDatabase()) return Response.json({ error: "unavailable" }, { status: 503 });
  const ip = clientIp(request.headers);
  if (perIp.blocked(ip)) return Response.json({ error: "too many" }, { status: 429 });
  perIp.fail(ip);
  const tap = parseReaction(await request.text());
  if (!tap) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    const counts = await addReaction(getDb(), tap.articleId, tap.kind);
    return Response.json(counts, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    // A story that does not exist (foreign key 23503) is the caller's mistake; anything else is ours.
    const code = (err as { cause?: { code?: string }; code?: string } | null)?.cause?.code ?? (err as { code?: string } | null)?.code;
    return Response.json({ error: "not counted" }, { status: code === "23503" ? 404 : 503, headers: { "cache-control": "no-store" } });
  }
}
