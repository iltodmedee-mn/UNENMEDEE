import { getSiteStats } from "@/lib/queries";

/**
 * The header's live line ("N төрийн эх сурвалж хянаж байна", or a grey dot once the feed has been
 * quiet), read by the browser after load. Rendered into every page, the hourly site stats made each
 * of the ~3 000 article pages revalidate every hour on a crawler's visit (419 K ISR writes in Nov
 * 2026, Vercel Hobby allows 200 K); as one prerendered response it is a single hourly cache entry.
 */
export async function GET() {
  const stats = await getSiteStats();
  // The commit this deployment was built from: the pipeline's feed check compares it with `main`
  // (Nov 2026: production sat on a 2-day-old build and nobody knew, src/lib/feed-check.ts).
  return Response.json({ activeSources: stats.activeSources, lastArticleAt: stats.lastArticleAt, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null });
}
