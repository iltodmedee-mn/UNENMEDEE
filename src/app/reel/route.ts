import { and, eq, isNotNull } from "drizzle-orm";

import { getDb, hasDatabase } from "@/db";
import { videos } from "@/db/schema";
import { canonicalImageQuery } from "@/lib/site";

/**
 * GET /reel?v=<video id>: a generated video's MP4 (scripts/make-video.ts), for Instagram and
 * Threads, which fetch a video from a public URL, and Facebook's Reels upload. The file exists
 * only for a few days after it is made (`VIDEO_KEEP_DAYS`); afterwards this is 404. Only ids are
 * accepted, one canonical query, so a junk parameter cannot bypass the CDN.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const canonical = canonicalImageQuery(url, ["v"]);
  if (canonical) return Response.redirect(new URL(canonical, url), 308);
  const v = url.searchParams.get("v") ?? "";
  if (!/^\d{1,9}$/.test(v) || !hasDatabase()) return new Response("Not found", { status: 404 });
  // One URL per video: "v=0001" was another CDN key, so each spelling read the 3 MB file again.
  if (String(Number(v)) !== v) return Response.redirect(new URL(`/reel?v=${Number(v)}`, url), 308);
  const [row] = await getDb()
    .select({ mp4: videos.mp4 })
    .from(videos)
    .where(and(eq(videos.id, Number(v)), isNotNull(videos.mp4)))
    .limit(1);
  if (!row?.mp4) return new Response("Not found", { status: 404 });
  const body = new Uint8Array(row.mp4);
  return new Response(body, {
    headers: {
      "content-type": "video/mp4",
      "content-length": String(body.byteLength),
      "accept-ranges": "none",
      // A video id never changes its file; the CDN keeps it while the platforms fetch it.
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}
