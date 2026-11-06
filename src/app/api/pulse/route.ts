import { getSiteStats } from "@/lib/queries";

/**
 * The header's live line ("N төрийн эх сурвалж хянаж байна", or a grey dot once the feed has been
 * quiet), read by the browser after load. Rendered into every page, the hourly site stats made each
 * of the ~3 000 article pages revalidate every hour on a crawler's visit (419 K ISR writes in Nov
 * 2026, Vercel Hobby allows 200 K); as one prerendered response it is a single hourly cache entry.
 */
export async function GET() {
  const stats = await getSiteStats();
  return Response.json({ activeSources: stats.activeSources, lastArticleAt: stats.lastArticleAt });
}
