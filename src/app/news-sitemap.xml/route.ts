import { getNewsSitemapArticles } from "@/lib/queries";
import { absoluteUrl, SITE_NAME, xmlEscape } from "@/lib/site";

/**
 * Google News sitemap: only articles published in the last two days (Google's limit), and only
 * those whose page printed a real publication date.
 */
export async function GET() {
  const items = (await getNewsSitemapArticles())
    .map(
      (a) => `  <url>
    <loc>${xmlEscape(absoluteUrl(`/article/${a.slug}`))}</loc>
    <news:news>
      <news:publication><news:name>${xmlEscape(SITE_NAME)}</news:name><news:language>mn</news:language></news:publication>
      <news:publication_date>${a.publishedAt.toISOString()}</news:publication_date>
      <news:title>${xmlEscape(a.title)}</news:title>
    </news:news>
  </url>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${items}
</urlset>
`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=600" } });
}
