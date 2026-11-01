import * as cheerio from "cheerio";

import { htmlFragmentToText, MIN_ARTICLE_CHARS, plainTitle } from "../extractor";
import { politeFetch } from "../http";
import type { ScrapedItem } from "../types";

/**
 * zasag.mn (Government of Mongolia) is the same Laravel site as mongolia.gov.mn, but zasag.mn
 * serves a *.mongolia.gov.mn certificate and its /news route is a 404. The site's own RSS feed
 * carries the full article HTML and a +0800 publish time, so one request yields complete items.
 * Links in the feed point at zasag.mn; they are rewritten to the host that actually works.
 */
export const ZASAG_FEED_URL = "https://mongolia.gov.mn/feed";

/** "<p>..." inside CDATA may still carry entities (&quot;): decode via an HTML parse. */
function decode(s: string): string {
  return cheerio.load(`<p>${s}</p>`)("p").text().trim();
}

export function parseZasagFeed(xml: string): ScrapedItem[] {
  const $ = cheerio.load(xml, { xml: true });
  return $("item")
    .toArray()
    .map((el): ScrapedItem | null => {
      const item = $(el);
      const id = item.find("link").text().trim().match(/\/news\/view\/(\d+)/)?.[1];
      const text = htmlFragmentToText(item.find("description").text());
      if (!id || text.length < MIN_ARTICLE_CHARS) return null;
      const date = new Date(item.find("pubDate").text().trim());
      return {
        url: `https://mongolia.gov.mn/news/view/${id}`,
        title: plainTitle(decode(item.find("title").text())),
        text,
        publishedAt: Number.isNaN(date.getTime()) ? null : date,
      };
    })
    .filter((x): x is ScrapedItem => x !== null);
}

export async function fetchZasag(limit: number): Promise<ScrapedItem[]> {
  const res = await politeFetch(ZASAG_FEED_URL, { headers: { accept: "application/rss+xml, application/xml" } });
  if (!res.ok) throw new Error(`mongolia.gov.mn feed returned HTTP ${res.status}`);
  return parseZasagFeed(await res.text()).slice(0, limit);
}
