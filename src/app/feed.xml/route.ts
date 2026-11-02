import { cutLeakedJson } from "@/lib/format";
import { getSitemapArticles } from "@/lib/queries";
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME, SITE_URL, xmlEscape } from "@/lib/site";

/** RSS 2.0 of the newest analyzed stories (feed readers, Google Discover, aggregators). */
export async function GET() {
  const articles = await getSitemapArticles(50);
  const items = articles
    .map((a) => {
      const url = absoluteUrl(`/article/${a.slug}`);
      // An undated page is dated by when we found it: readers sort by it, but it is not a claim.
      const date = (a.publishedAt ?? a.lastModified).toUTCString();
      const title = a.dateUnknown ? `${a.title} (огноо тодорхойгүй)` : a.title;
      return `    <item>
      <title>${xmlEscape(title)}</title>
      <link>${xmlEscape(url)}</link>
      <guid isPermaLink="true">${xmlEscape(url)}</guid>
      <pubDate>${date}</pubDate>
      <source url="${xmlEscape(`https://${a.sourceDomain}`)}">${xmlEscape(a.sourceName)}</source>
      <description>${xmlEscape(cutLeakedJson(a.tldr).replace(/\s+/g, " ").trim())}</description>
    </item>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(SITE_NAME)} — шинэ мэдээ</title>
    <link>${xmlEscape(absoluteUrl("/"))}</link>
    <atom:link href="${xmlEscape(absoluteUrl("/feed.xml"))}" rel="self" type="application/rss+xml" />
    <description>${xmlEscape(SITE_DESCRIPTION)}</description>
    <language>mn</language>
    <copyright>${xmlEscape(`© ${SITE_NAME} · CC BY 4.0 (эх сурвалжаа ${SITE_URL} гэж дурдана уу). Анхны мэдээ тухайн байгууллагынх.`)}</copyright>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=600" } });
}
