import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";

import { contentHash, normalizeText } from "@/lib/text";

import { isFutureDate, parseDateValue } from "./dates";

export { parseDateValue };
import { chooseTitle } from "./titles";
import { safeDecode } from "./links";

export interface ExtractedArticle {
  title: string;
  text: string;
  excerpt: string;
  hash: string;
  publishedAt: Date | null;
}

/** Article bodies shorter than this are treated as navigation/listing pages. */
export const MIN_ARTICLE_CHARS = 200;

const silentConsole = new VirtualConsole();

/** Opening tag of a script, style, SVG or frame block. */
// The attribute run is bounded: unclosed "<script" openings each scanned to the end of the page.
const HEAVY_OPEN = /<(script|style|noscript|svg|iframe)\b[^>]{0,4000}>/gi;

/** One linear pass: each block runs to its own closing tag in any spelling ("</script >", "</SCRIPT foo>"). */
function stripHeavyOnce(html: string): string {
  const lower = html.toLowerCase();
  const unclosed = new Set<string>(); // no closing tag after this point: later openers of it stay
  let out = "";
  let last = 0;
  HEAVY_OPEN.lastIndex = 0;
  for (let m = HEAVY_OPEN.exec(html); m; m = HEAVY_OPEN.exec(html)) {
    const name = m[1].toLowerCase();
    // A self-closing "<svg .../>" has no body: scanning to the next "</svg>" ate article text.
    if (m[0].endsWith("/>") || unclosed.has(name)) continue;
    let close = lower.indexOf(`</${name}`, HEAVY_OPEN.lastIndex);
    while (close >= 0 && /[a-z0-9-]/.test(lower[close + 2 + name.length] ?? "")) close = lower.indexOf(`</${name}`, close + 1);
    if (close < 0) {
      unclosed.add(name);
      continue;
    }
    const end = lower.indexOf(">", close);
    const stop = end < 0 ? html.length : end + 1;
    out += html.slice(last, m.index);
    last = stop;
    HEAVY_OPEN.lastIndex = stop;
  }
  return out + html.slice(last);
}

/** Passes over the page at most: real pages need one or two. */
export const MAX_STRIP_PASSES = 3;

/**
 * Drops heavy blocks before JSDOM parses the page, only to save time and memory: this is not a
 * sanitizer (JSDOM runs no scripts, Readability drops them again and we keep plain text only).
 * Each pass is linear (an unclosed opener never rescans the page: 5,000 of them in 1 MB took
 * 1.4 s with a lazy regex); a block hidden inside another one goes on the next pass. Passes stop
 * at MAX_STRIP_PASSES: markup built to reveal one more block per pass would otherwise cost
 * pages × passes (quadratic), and whatever is left is only JSDOM's work.
 */
export function stripHeavyTags(html: string): string {
  let out = html;
  for (let pass = 0, prev = ""; pass < MAX_STRIP_PASSES && prev !== out; pass++) {
    prev = out;
    out = stripHeavyOnce(out);
  }
  return out;
}

/** Strip " – Site name" / " | Site name" suffixes from <title>. */
/**
 * A headline from an API or a feed (WordPress `title.rendered`, RSS, parliament.mn, legalinfo.mn):
 * already the headline, so only whitespace is normalised. cleanTitle's "Site | Headline" split is
 * for <title> only: on "Сайд Б.Бат - Хууль баталлаа" it kept half of a real headline.
 */
export function plainTitle(title: string): string {
  return normalizeText(title).replace(/\s+/g, " ").trim();
}

export function cleanTitle(title: string): string {
  const t = normalizeText(title).replace(/\s+/g, " ");
  const parts = t.split(/\s+[|–—-]\s+/);
  // "Headline | Site" or "Site | Headline": with two parts the headline is the longer one.
  if (parts.length === 2) {
    const longer = parts[0].length >= parts[1].length ? parts[0] : parts[1];
    return longer.length >= 15 ? longer.trim() : t;
  }
  if (parts.length > 1 && parts[0].length >= 15) return parts[0].trim();
  return t;
}

/** "11-р сар": the month number, never read as "1-р сар" (the lookbehind keeps "11" whole). */
// The day is a whole number too: the greedy gap used to take the first digit of "15" and read 5.
const MONTH_LABEL = /(20\d{2}).{0,6}(?<!\d)(1[0-2]|[1-9])-р сар.{0,6}?(?<!\d)(\d{1,2})(?!\d)/;

/** Dates this long before now are archive material, not a publication date read from body text. */
const STALE_TEXT_DATE_MS = 365 * 86_400_000;

/** A date (and optional Ulaanbaatar wall-clock time, UTC+8) or null when it is not plausible. */
function validDate(y: number, m: number, d: number, hour?: number, minute?: number): Date | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const timed = hour !== undefined && minute !== undefined && hour < 24 && minute < 60;
  const date = new Date(timed ? Date.UTC(y, m - 1, d, hour - 8, minute) : Date.UTC(y, m - 1, d));
  // Ignore dates in the future (typos, event dates).
  return isFutureDate(date) ? null : date;
}

/** Finds a "2026-10-21", "2026.10.21", "2026 оны 10 сарын 21", "2026 ... 10-р сар ... 21" or "10 сарын 21, 2026" date in text. */
export function dateFromText(text: string): Date | null {
  // The first VALID match of each pattern: an event date in the future ("2026-12-01-нд болох") or
  // an archive year before the real date used to end the search and leave the story undated.
  const first = (re: RegExp, pick: (m: RegExpMatchArray) => Date | null): Date | null => {
    for (const m of text.matchAll(re)) {
      const d = pick(m);
      if (d) return d;
    }
    return null;
  };
  return (
    first(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/g, (iso) =>
      validDate(+iso[1], +iso[2], +iso[3], iso[4] === undefined ? undefined : +iso[4], iso[5] === undefined ? undefined : +iso[5]),
    ) ??
    first(/(20\d{2})\s*оны\s*(\d{1,2})\s*(?:-р|дугаар|дүгээр)?\s*сарын\s*(\d{1,2})/g, (mn) => validDate(+mn[1], +mn[2], +mn[3])) ??
    first(new RegExp(MONTH_LABEL.source, "g"), (m) => validDate(+m[1], +m[2], +m[3])) ??
    // Month and day first, the year after a comma: "10 сарын 20, 2026" (iaac.mn).
    first(/(?<![\d.])(\d{1,2})\s*(?:-р|дугаар|дүгээр)?\s*сарын\s*(\d{1,2})(?:-?(?:ны|ний|нд))?\s*,\s*(20\d{2})(?!\d)/g, (md) => validDate(+md[3], +md[1], +md[2]))
  );
}

const DATE_CLASS = /date|time|ognoo|огноо|publish|post-on|posted|calendar|meta/i;

/** Text directly inside an element (not in its child elements). */
function ownText(el: Element): string {
  return [...el.childNodes]
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent ?? "")
    .join("")
    .trim();
}

/**
 * Dates printed in the page chrome around the headline (outside Readability's text): an element
 * whose class names a date, or the text right around the <h1>. Only elements that come before
 * the body's end inside the headline's container count, so "related news" lists are ignored.
 */
function dateNearHeadline(doc: Document, headline?: string): Date | null {
  const box = headlineBox(doc, headline);
  if (!box) return null;
  const all = [...box.querySelectorAll("*")];
  const h1 = all.find((el) => /^H[1-6]$/.test(el.tagName) && (el.textContent ?? "").trim().length > 0) ?? box;
  // The body starts at the first paragraph-like element after the headline with real text.
  const h1At = all.indexOf(h1);
  const bodyAt = all.findIndex((el, i) => i > h1At && /^(P|DIV|SECTION|ARTICLE)$/.test(el.tagName) && ownText(el).length > 150);
  const candidates = all.slice(0, bodyAt === -1 ? undefined : bodyAt).filter((el) => {
    const cls = `${el.getAttribute("class") ?? ""} ${el.id} ${el.querySelector("i")?.getAttribute("class") ?? ""}`;
    return DATE_CLASS.test(cls) && (el.textContent ?? "").trim().length <= 60;
  });
  for (const el of candidates) {
    const d = dateFromText(el.textContent ?? "");
    if (d) return d;
  }
  // Text around the headline: what precedes it inside the box and the first 300 characters after.
  const boxText = normalizeText(box.textContent ?? "");
  const at = boxText.indexOf(normalizeText(h1.textContent ?? ""));
  if (at >= 0) return dateFromText(boxText.slice(Math.max(0, at - 300), at + (h1.textContent ?? "").length + 300));
  return null;
}

/**
 * The element that holds the headline: the first <h1>, else the heading or title/header element
 * whose text starts with the headline (mlsp.gov.mn uses <h5 class="blog-post-title">,
 * uvurkhangai.gov.mn <div class="single_news_header">).
 */
function headlineElement(doc: Document, headline?: string): Element | null {
  const key = headline ? normalizeText(headline).replace(/\s+/g, " ").slice(0, 40) : "";
  return (
    [...doc.querySelectorAll("h1")].find((h) => (h.textContent ?? "").trim().length > 0) ??
    (key ? [...doc.querySelectorAll("h2, h3, h4, h5, h6, [class*=title], [class*=header]")].find((h) => normalizeText(h.textContent ?? "").replace(/\s+/g, " ").startsWith(key)) : undefined) ??
    null
  );
}

/** The box (up to three ancestors of the headline) the page chrome around the headline sits in. */
function headlineBox(doc: Document, headline?: string): Element | null {
  const h1 = headlineElement(doc, headline);
  if (!h1) return null;
  let box: Element = h1;
  for (let i = 0; i < 3 && box.parentElement && box.parentElement !== doc.body; i++) box = box.parentElement;
  return box;
}

/**
 * The article's <time>. Pages also carry <time> elements for "latest news" lists, so the ones in
 * the headline's box come first. judcouncil.mn prints the real date as the element's text while
 * its datetime attribute is a template placeholder ("2019-10-22"): when the text gives a date more
 * than a day away from the attribute, the text wins. A value more than a year older than the
 * newest one on the page is a stray stamp and is ignored.
 */
function timeElementDate(doc: Document, headline?: string): Date | null {
  const valueOf = (t: Element): Date | null => {
    const attr = parseDateValue(t.getAttribute("datetime"));
    const text = dateFromText(t.textContent ?? "");
    return text && (!attr || Math.abs(text.getTime() - attr.getTime()) > 86_400_000) ? text : attr;
  };
  const all = [...doc.querySelectorAll("time[datetime]")];
  const box = headlineBox(doc, headline);
  const inBox = box ? all.filter((t) => box.contains(t)) : [];
  const times = (inBox.length ? inBox : all).map(valueOf).filter((d): d is Date => d !== null);
  if (!times.length) return null;
  const newest = Math.max(...times.map((d) => d.getTime()));
  return times.find((d) => d.getTime() >= newest - STALE_TEXT_DATE_MS) ?? null;
}

const STAMP_ICON = /\b(?:fa|bi|icon|glyphicon|ti)-(?:clock|calendar|time)|\bfa-regular fa-(?:clock|calendar)/i;

/**
 * A timestamp printed next to a clock or calendar icon in the headline's own container, before or
 * after the body (uvurkhangai.gov.mn prints `<i class="fa fa-clock-o"></i> 2025-09-13 16:34:21`
 * under the text). The icon marks it as this article's stamp, so it is trusted even when old: an
 * old story then gets its real date and stays off the feed instead of showing as undated news.
 * Only the headline's parent counts, so the icons of a "related news" list beside it do not.
 */
function iconStampDate(doc: Document, headline?: string): Date | null {
  const container = headlineElement(doc, headline)?.parentElement;
  if (!container || container === doc.body) return null;
  for (const icon of container.querySelectorAll("i[class], span[class], svg[class]")) {
    if (!STAMP_ICON.test(icon.getAttribute("class") ?? "")) continue;
    const text = (icon.parentElement?.textContent ?? "").trim();
    // A stamp line with more after it (khural.mn: "Огноо: 2025-07-29 · Дугаар: 06/01 · Нээгдсэн: 218")
    // is read from the text right after the icon only, up to the next element.
    const own = text.length > 40 ? (icon.nextSibling?.nodeType === 3 ? (icon.nextSibling.textContent ?? "").trim() : "") : text;
    if (!own || own.length > 40) continue;
    const d = dateFromText(own);
    if (d) return d;
  }
  return null;
}

function jsonLdDate(doc: Document): Date | null {
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const d = parseDateValue((s.textContent ?? "").match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1]);
    if (d) return d;
  }
  return null;
}

/**
 * A date inside the page's own data blob: Next.js `__NEXT_DATA__`, Nuxt `__NUXT__` or any
 * `application/json` script (mofa.gov.mn prints no date in the markup but ships
 * `"createdDate":"2026-10-23T11:38:26"`). Only keys that name a publication date count, and the
 * first one in the main data object wins (related items come later in the blob).
 */
export function jsonBlobDate(html: string): Date | null {
  const blobs = [...html.matchAll(/<script[^>]*(?:id="__NEXT_DATA__"|type="application\/json"|>\s*window\.__NUXT__)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const blob of blobs) {
    const m = blob.match(/"(?:date|createdDate|created_at|createdAt|publishedAt|published_at|publishDate|pubDate|datePublished|news_date|post_date)"\s*:\s*"(20\d{2}-\d{2}-\d{2}[^"]{0,30})"/);
    const d = m ? parseDateValue(m[1]) : null;
    if (d) return d;
  }
  return null;
}

/** Finds a publication date in meta tags, JSON-LD, a data blob, <time>, the URL, the headline area or the text. */
export function extractPublishedDate(doc: Document, url: string, text: string, headline?: string, blobDate: Date | null = null): Date | null {
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[property="og:article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]',
  ];
  for (const sel of metaSelectors) {
    const d = parseDateValue(doc.querySelector(sel)?.getAttribute("content"));
    if (d) return d;
  }
  const ld = jsonLdDate(doc);
  if (ld) return ld;
  if (blobDate) return blobDate;
  const time = timeElementDate(doc, headline);
  if (time) return time;
  const fromUrl = safeDecode(url).match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})\//);
  if (fromUrl) {
    const d = validDate(+fromUrl[1], +fromUrl[2], +fromUrl[3]);
    if (d) return d;
  }
  const stamp = iconStampDate(doc, headline);
  if (stamp) return stamp;
  // A date printed in the page is only trusted when it is recent: an old one is a quoted
  // resolution date or an archive page (mrpam.gov.mn stored 2007 stories as that day's news).
  const printed = dateNearHeadline(doc, headline) ?? dateFromText(text.slice(0, 600));
  return printed && printed.getTime() < Date.now() - STALE_TEXT_DATE_MS ? null : printed;
}

/** Turns an HTML page into clean article text with Readability. Never stores HTML. */
export function extractArticle(html: string, url: string): ExtractedArticle | null {
  const blobDate = jsonBlobDate(html); // before the scripts are stripped
  const dom = new JSDOM(stripHeavyTags(html), { url, virtualConsole: silentConsole });
  const doc = dom.window.document;
  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
  // The site's name is every part of <title> after the first, except that "Site | Headline"
  // puts it first: with two parts, the shorter one is the site.
  const titleParts = doc.title.split(/\s*[|–—]\s*|\s+-\s+/).filter((p) => p.trim());
  const siteParts = titleParts.length === 2 ? [titleParts[0].length < titleParts[1].length ? titleParts[0] : titleParts[1]] : titleParts.slice(1);
  const h1 = [...doc.querySelectorAll("article h1, main h1, h1")].map((h) => h.textContent ?? "").find((t) => t.trim().length > 0);
  // Some CMSs fill og:site_name with the article's own headline: taken as the site's name, it made
  // the real headline look generic and the title fell back to the first sentence.
  const ogSite = doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content");
  const sameAsHeadline = (v: string | null | undefined) => Boolean(v) && [ogTitle, h1].some((t) => t && plainTitle(t) === plainTitle(v!));
  const siteNames = [sameAsHeadline(ogSite) ? null : ogSite, ...siteParts];
  const parsed = new Readability(doc.cloneNode(true) as Document, { charThreshold: 100 }).parse();

  const text = normalizeText(parsed?.textContent ?? "");
  if (text.length < MIN_ARTICLE_CHARS) {
    dom.window.close();
    return null;
  }
  const title = chooseTitle([parsed?.title, ogTitle, h1, cleanTitle(doc.title)], text, siteNames);
  const result: ExtractedArticle = {
    title,
    text,
    excerpt: normalizeText(parsed?.excerpt ?? "") || text.slice(0, 280),
    hash: contentHash(text),
    publishedAt: extractPublishedDate(doc, url, text, title, blobDate),
  };
  dom.window.close();
  return result;
}

/** Converts an HTML fragment (e.g. WordPress `content.rendered`) to normalized text. */
export function htmlFragmentToText(html: string): string {
  const dom = new JSDOM(`<body>${stripHeavyTags(html)}</body>`, { virtualConsole: silentConsole });
  const doc = dom.window.document;
  doc.querySelectorAll("p, br, li, h1, h2, h3, h4, tr, div").forEach((el) => el.append("\n"));
  const text = normalizeText(doc.body.textContent ?? "");
  dom.window.close();
  return text;
}
