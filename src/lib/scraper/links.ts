import * as cheerio from "cheerio";

export interface LinkCandidate {
  url: string;
  text: string;
  score: number;
}

const FILE_EXT = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|jpe?g|png|gif|webp|svg|mp4|mp3|avi|mov|apk|exe)(\?|$)/i;
// "/p/23", "/home", "page.aspx": static pages (departments, structure, instructions), not news.
// "/posts" is a listing, but "/posts/<id>" is an article (mecc.gov.mn), so only the bare path counts.
const NON_ARTICLE =
  /\/(c|p|tag|tags|category|categories|author|page|pages|search|login|signin|register|feed|rss|wp-admin|wp-content|wp-json|wp-login|cart|contact|about|sitemap|lang|language|static|download|files?|uploads?|gallery|video|photos?|home|instructions?)(\/|$|\?)|\/posts\/?($|\?)|[?&](lang|s|replytocom)=|page\.aspx/i;
/**
 * A CMS static page ("/page/<slug>", "/pages/<id>", "/p/<id>": mrpam.gov.mn's investor guides and
 * reports). Link scoring already skips them, but a section hop or a sitemap can still hand one to
 * the sink, which stores it unpublished.
 */
export function isStaticPageUrl(url: string): boolean {
  try {
    return /^\/(page|pages|p)\/[^/]+\/?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** "?p=123", "?id=45", "mn.php?page=40&news=1633": the article id lives in the query string. */
const QUERY_ID = /[?&](id|p|news|post|item|news_id|post_id|nid|aid)=\d+/i;

/** Path patterns used by Mongolian government CMSs for single articles. */
const ARTICLE_PATTERNS: [RegExp, number][] = [
  [/\/20\d{2}\/\d{1,2}\/\d{1,2}\/[^/]+/, 5], // WordPress dated permalinks
  [/\/(news|medee|мэдээ|post|posts|article|articles|content\/detail|detail|view|read|n|p|c\/news)\/[^/?#]*\d[^/?#]*/i, 4],
  [/\/(news|medee|post|posts|article|articles|blog|announcement|zarlal|tender|shiidver|tushaal|niitlel)\/[^/?#]{8,}/i, 3],
  [QUERY_ID, 3],
  [/\/\d{3,}(\.(html?|php|aspx?))?(\/|$|\?)/, 3],
  [/\/[^/]*-[^/]*-[^/]*-[^/]+\/?$/, 2], // long hyphenated slugs
];

/** Page chrome whose links are almost never articles. */
const CHROME_SELECTOR = [
  "nav",
  "header",
  "footer",
  '[role="navigation"]',
  // Whole class tokens only: wrappers like "has-menu" must not swallow the page.
  '[class~="menu" i]',
  '[class~="navbar" i]',
  '[class~="footer" i]',
  '[class~="breadcrumb" i]',
  '[class~="sub-menu" i]',
  '[id="menu" i]',
  '[id="footer" i]',
  'ul[class*="menu" i]',
  'li[class*="menu-item" i]',
].join(", ");

/**
 * Same organization if hosts match ignoring "www." (and allowing subdomains of the source). A
 * parent domain is not the same site: gov.mn links on a ministry page are the portal's news.
 */
export function sameSite(host: string, sourceDomain: string): boolean {
  const h = host.replace(/^www\./, "").toLowerCase();
  const d = sourceDomain.replace(/^www\./, "").toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

export function scoreLink(url: URL, text: string): number {
  const path = decodeURIComponent(url.pathname + url.search);
  if (FILE_EXT.test(path) || NON_ARTICLE.test(path)) return 0;
  const queryId = QUERY_ID.test(url.search);
  // "?page=3" is pagination, unless the id is in the query too ("mn.php?page=40&news=1633").
  if (/[?&]page=/i.test(url.search) && !queryId) return 0;
  if (!queryId && (url.pathname === "/" || url.pathname.length < 4)) return 0;
  let score = 0;
  for (const [re, w] of ARTICLE_PATTERNS) if (re.test(path)) score = Math.max(score, w);
  const len = text.trim().length;
  if (len >= 25) score += 2;
  else if (len >= 12) score += 1;
  else if (len < 4) score -= 1;
  // Cyrillic anchor text is a strong signal of a Mongolian headline.
  if (/[Ѐ-ӿ]{4,}/.test(text)) score += 1;
  return score;
}

/**
 * Harvests likely article links from a listing or home page.
 * Returns unique same-site URLs sorted by score (best first).
 */
export function harvestArticleLinks(html: string, pageUrl: string, sourceDomain: string, max = 40): LinkCandidate[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const best = new Map<string, LinkCandidate>();

  // Any element with an href: some Next.js sites render <Link passHref> around a <div>.
  $("[href]").each((_, el) => {
    if (/^(link|base|script)$/i.test(el.tagName)) return;
    const href = $(el).attr("href")?.trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || !sameSite(url.hostname, sourceDomain)) return;
    url.hash = "";
    const text = $(el).text().replace(/\s+/g, " ").trim() || $(el).attr("title") || "";
    let score = scoreLink(url, text);
    // Menus, headers and footers link to static pages ("About", "Structure"), not news.
    if ($(el).closest(CHROME_SELECTOR).length) score -= 5;
    if (score < 3) return;
    const key = url.toString();
    const prev = best.get(key);
    if (!prev || score > prev.score || text.length > prev.text.length) {
      best.set(key, { url: key, text: text.length > (prev?.text.length ?? 0) ? text : (prev?.text ?? text), score: Math.max(score, prev?.score ?? 0) });
    }
  });

  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, max);
}

/** Finds an RSS/Atom feed advertised by the page. */
export function findFeedUrl(html: string, pageUrl: string): string | null {
  const $ = cheerio.load(html);
  const href = $('link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]')
    .first()
    .attr("href");
  if (!href) return null;
  try {
    const url = new URL(href, pageUrl);
    // WordPress comment feeds are not news.
    return /comments\/feed/.test(url.pathname) ? null : url.toString();
  } catch {
    return null;
  }
}

export function isWordPress(html: string): boolean {
  return /\/wp-content\/|\/wp-includes\/|wp-json/i.test(html);
}

/** Parses RSS 2.0 or Atom into item links. */
export function parseFeed(xml: string): { url: string; title: string; publishedAt: Date | null }[] {
  const $ = cheerio.load(xml, { xml: true });
  const items: { url: string; title: string; publishedAt: Date | null }[] = [];
  $("item, entry").each((_, el) => {
    const node = $(el);
    // Direct children only: a descendant search per item made nested items quadratic.
    const link = node.children("link").first();
    const url = link.attr("href") || link.text().trim();
    const title = node.children("title").first().text().trim();
    const dateText = node.children("pubDate, published, updated, dc\\:date").first().text().trim();
    const date = dateText ? new Date(dateText) : null;
    if (url) items.push({ url, title, publishedAt: date && !Number.isNaN(date.getTime()) ? date : null });
  });
  return items;
}

const SECTION_TEXT = /мэдээ|мэдээлэл|шинэ мэдээ|news|сонин|үйл явдал/i;
const SECTION_PATH = /^\/(home|news|medee|mn|j|n|d\/news|newses|c\/(medee|news)[^/]*|t\/\d+)\/?$/i;

/**
 * Where a splash page points for its news: links whose text or path says "news" (govi-altai's
 * "/" only links to "/home"; dornod's to "/j"; mrt's to "/t/211"). Same site only, at most `max`.
 */
export function harvestSectionLinks(html: string, pageUrl: string, sourceDomain: string, max = 3): string[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const found = new Map<string, number>();
  $("[href]").each((_, el) => {
    if (/^(link|base|script)$/i.test(el.tagName)) return;
    const href = $(el).attr("href")?.trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || !sameSite(url.hostname, sourceDomain) || FILE_EXT.test(url.pathname)) return;
    url.hash = "";
    if (url.toString() === base.toString()) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const path = decodeURIComponent(url.pathname);
    const score = (SECTION_PATH.test(path) ? 2 : 0) + (SECTION_TEXT.test(text) && text.length <= 40 ? 2 : 0) + (/^\/(home|news)\/?$/i.test(path) ? 1 : 0);
    if (score >= 2) found.set(url.toString(), Math.max(score, found.get(url.toString()) ?? 0));
  });
  return [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([u]) => u);
}

/**
 * The WordPress REST base the page advertises (`<link rel="https://api.w.org/">`), which is
 * `/index.php?rest_route=/` on sites without pretty permalinks (mod.gov.mn, pcsp.gov.mn), where
 * `/wp-json/` answers 404.
 */
export function wordPressApiBase(html: string, pageUrl: string): string {
  const m = html.match(/<link[^>]+rel=["']https:\/\/api\.w\.org\/["'][^>]*href=["']([^"']+)["']/i) ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']https:\/\/api\.w\.org\/["']/i);
  const origin = new URL(pageUrl).origin;
  if (!m) return `${origin}/wp-json/`;
  try {
    const u = new URL(m[1].replace(/&amp;/g, "&"), pageUrl);
    return u.toString();
  } catch {
    return `${origin}/wp-json/`;
  }
}

/**
 * The WordPress post id of an article page: the `?p=` shortlink, else the `postid-N` body class.
 * The re-check reads the post through the REST API with it, as the crawler stored it.
 */
export function wordPressPostId(html: string): number | null {
  const short = html.match(/<link[^>]{0,200}rel=["']shortlink["'][^>]{0,300}>/i)?.[0] ?? html.match(/<link[^>]{0,300}href=["'][^"']{0,200}["'][^>]{0,100}rel=["']shortlink["'][^>]{0,100}>/i)?.[0];
  const id = short?.match(/[?&](?:amp;)?p=(\d{1,10})/)?.[1] ?? html.match(/\bpostid-(\d{1,10})\b/)?.[1];
  return id ? Number(id) : null;
}

/** "…/wp-json/" + "wp/v2/posts?…" or "…/index.php?rest_route=/" + "wp/v2/posts&…". */
export function wordPressPostsUrl(apiBase: string, query: string): string {
  if (/[?&]rest_route=/.test(apiBase)) return `${apiBase.replace(/\/?$/, "/")}wp/v2/posts&${query}`;
  return `${apiBase.replace(/\/?$/, "/")}wp/v2/posts?${query}`;
}

/**
 * The URL of a WordPress REST post. Some installs omit `link` (bnd.ub.gov.mn) and some advertise a
 * relative one ("index.php/?p=11597", conscourt.gov.mn, a site URL set without its host): both are
 * resolved against the site's origin, where "?p=<id>" always works.
 */
export function wordPressPostUrl(post: { id?: number; link?: string }, origin: string): string | undefined {
  if (post.link) {
    try {
      const url = new URL(post.link, `${origin}/`);
      // The post's own site only: `link` is publisher data, and a stored URL is fetched again later.
      if ((url.protocol === "https:" || url.protocol === "http:") && sameSite(url.hostname, new URL(origin).hostname)) return url.toString();
    } catch {
      /* fall through to the id form */
    }
  }
  return post.id ? `${origin}/?p=${post.id}` : undefined;
}
