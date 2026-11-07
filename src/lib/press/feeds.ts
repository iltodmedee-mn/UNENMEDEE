import * as cheerio from "cheerio";

import { parseDateValue } from "@/lib/scraper/dates";
import { normalizeText } from "@/lib/text";

export { OUTLETS, type Outlet } from "./outlets";

export interface FeedItem {
  url: string;
  title: string;
  publishedAt: Date | null;
}

const strip = (html: string) => normalizeText(cheerio.load(`<div>${html}</div>`)("div").text()).replace(/\s+/g, " ").trim();

/** A feed date; one without a zone is Ulaanbaatar time (parseDateValue), not UTC. */
function validDate(s: string | undefined | null): Date | null {
  return parseDateValue(s);
}

/** RSS 2.0 (ikon.mn, sonin.mn): title, link and pubDate with its zone (the description is not read). */
export function parseRssItems(xml: string): FeedItem[] {
  const $ = cheerio.load(xml, { xml: true });
  const out: FeedItem[] = [];
  $("item").each((_, el) => {
    const node = $(el);
    const url = node.find("link").first().text().trim() || node.find("guid").first().text().trim();
    const title = strip(node.find("title").first().text());
    if (!/^https?:\/\//.test(url) || title.length < 8) return;
    out.push({ url, title, publishedAt: validDate(node.find("pubDate").first().text().trim()) });
  });
  return out;
}

/**
 * news.mn's WordPress API is customised: no `link` and no `date`, only the id and a relative time
 * ("2 цагийн өмнө"). Its article URLs are https://news.mn/r/<id>/; the time is when we found it
 * (the pipeline reads it every hour).
 */
export function parseNewsMn(json: unknown, foundAt: Date): FeedItem[] {
  if (!Array.isArray(json)) return [];
  const out: FeedItem[] = [];
  for (const x of json as { id?: unknown; title?: { rendered?: unknown } }[]) {
    const id = typeof x.id === "number" && Number.isInteger(x.id) && x.id > 0 ? x.id : null;
    const title = typeof x.title?.rendered === "string" ? strip(x.title.rendered) : "";
    if (!id || title.length < 8) continue;
    out.push({ url: `https://news.mn/r/${id}/`, title, publishedAt: foundAt });
  }
  return out;
}
