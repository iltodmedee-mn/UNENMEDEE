import * as cheerio from "cheerio";

import { cleanTitle, htmlFragmentToText, MIN_ARTICLE_CHARS, plainTitle } from "../extractor";
import { politeFetch } from "../http";
import type { ScrapedItem } from "../types";

/**
 * police.gov.mn (Цагдаагийн ерөнхий газар): the "Шинэ мэдээ" list is server-rendered cards with
 * a title but no date; the image path carries the upload day (/image/2026/10/21/…), used for
 * the --days window. The detail page has the exact time ("2026-10-21 12:19:00", Ulaanbaatar)
 * and the text in `.article-view-text`. The generic crawler found no links (the cards are
 * `a.articleList-item` blocks). No robots.txt (404); the 8 s host delay still applies.
 */
export const POLICE_LIST_URL = "https://police.gov.mn/a/?page=1&size=20";
const ORIGIN = "https://police.gov.mn";

export interface PoliceListItem {
  url: string;
  title: string;
  /** Upload day from the image path, midnight Ulaanbaatar time. */
  day: Date | null;
}

const ubTime = (date: string, time = "00:00:00") => new Date(`${date}T${time}+08:00`);

export function parsePoliceList(html: string): PoliceListItem[] {
  const $ = cheerio.load(html);
  const items: PoliceListItem[] = [];
  const seen = new Set<string>();
  $("a.articleList-item").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!/^\/a\/\d+$/.test(href)) return;
    const url = ORIGIN + href;
    const title = plainTitle($(el).find(".title").text());
    if (!title || seen.has(url)) return;
    seen.add(url);
    const d = ($(el).find("img").attr("src") ?? "").match(/\/image\/(\d{4})\/(\d{2})\/(\d{2})\//);
    items.push({ url, title, day: d ? ubTime(`${d[1]}-${d[2]}-${d[3]}`) : null });
  });
  return items;
}

export function parsePoliceArticle(html: string): { title: string; text: string; publishedAt: Date | null } {
  const $ = cheerio.load(html);
  const view = $(".article-view-main article").first();
  const date = view.find(".article-view-tools-default .date").first().text().trim().match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/);
  return {
    title: cleanTitle(view.find(".article-view-name").first().text() || ($('meta[property="og:title"]').attr("content") ?? "")),
    text: htmlFragmentToText(view.find(".article-view-text").first().html() ?? ""),
    publishedAt: date ? ubTime(date[1], date[2].length === 5 ? `${date[2]}:00` : date[2]) : null,
  };
}

export async function fetchPolice(limit: number): Promise<ScrapedItem[]> {
  const res = await politeFetch(POLICE_LIST_URL);
  if (!res.ok) throw new Error(`police.gov.mn list returned HTTP ${res.status}`);
  const list = parsePoliceList(await res.text());
  if (list.length === 0) throw new Error("police.gov.mn list had no articles (layout changed?)");
  return list.slice(0, limit).map((item) => ({
    url: item.url,
    title: item.title,
    text: "",
    publishedAt: item.day,
    // Detail pages are fetched only for articles not stored yet (see runApiSource).
    loadText: async () => {
      const page = await politeFetch(item.url);
      if (!page.ok) return null;
      const a = parsePoliceArticle(await page.text());
      if (a.text.length < MIN_ARTICLE_CHARS) return null;
      return { text: a.text, publishedAt: a.publishedAt ?? item.day };
    },
  }));
}
