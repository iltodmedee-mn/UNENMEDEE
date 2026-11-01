import * as cheerio from "cheerio";

import { htmlFragmentToText, MIN_ARTICLE_CHARS, plainTitle } from "../extractor";
import { politeFetch } from "../http";
import type { ScrapedItem } from "../types";

/**
 * legalinfo.mn (Unified Legal Information System): newly registered legal acts (laws, УИХ and
 * Government resolutions, ministerial orders, aimag decisions). The "Шинээр нэмэгдсэн акт" page
 * loads them from this AJAX endpoint (form POST, JSON {"Html": "..."}); each act's text is on its
 * server-rendered detail page. Readability picks the hidden login form there, so the text is
 * taken from `.maincontenter` directly. No robots.txt (404), the 8 s host delay still applies.
 */
export const LEGALINFO_LIST_URL = "https://legalinfo.mn/mn/ajaxLlist/";
const DAYS_BACK = 3;
const MAX_PAGES = 3;

export interface LegalAct {
  url: string;
  title: string;
  issuer: string | null;
  /** The day the act was added (Ulaanbaatar time). */
  addedAt: Date | null;
}

/** "2026-10-21 Лхагва" → midnight Ulaanbaatar time. */
function groupDate(label: string): Date | null {
  const m = label.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`) : null;
}

export function parseLegalinfoList(html: string): LegalAct[] {
  const $ = cheerio.load(html);
  const acts: LegalAct[] = [];
  let current: Date | null = null;
  $(".latest-law-grouping, a.act-name").each((_, el) => {
    const node = $(el);
    if (node.hasClass("latest-law-grouping")) {
      current = groupDate(node.text());
      return;
    }
    const href = node.attr("href") ?? "";
    if (!/lawId=\d+/.test(href)) return;
    const issuer = node.closest("[data-uk-grid]").find("span").not(".txt-number").last().text().trim();
    // The list is the site's markup: only legalinfo.mn's own detail pages are followed.
    const url = new URL(href, "https://legalinfo.mn");
    if (url.protocol !== "https:" || url.hostname !== "legalinfo.mn") return;
    acts.push({ url: url.toString(), title: plainTitle(node.text()), issuer: issuer || null, addedAt: current });
  });
  return acts;
}

export function legalinfoDetailText(html: string): string {
  const $ = cheerio.load(html);
  const main = $(".maincontenter").first();
  return main.length ? htmlFragmentToText(main.html() ?? "") : "";
}

function ubDate(d: Date): string {
  return new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

export async function fetchLegalinfo(limit: number): Promise<ScrapedItem[]> {
  const today = new Date();
  const acts: LegalAct[] = [];
  for (let page = 1; page <= MAX_PAGES && acts.length < limit; page++) {
    const body = new URLSearchParams({ b_date_start: ubDate(new Date(today.getTime() - DAYS_BACK * 86_400_000)), e_date_start: ubDate(today), page: String(page) });
    const res = await politeFetch(LEGALINFO_LIST_URL, {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded", "x-requested-with": "XMLHttpRequest", accept: "application/json" },
    });
    if (!res.ok) throw new Error(`legalinfo.mn list returned HTTP ${res.status}`);
    const json = (await res.json()) as { Html?: string };
    const found = parseLegalinfoList(json.Html ?? "");
    acts.push(...found);
    if (found.length < 20) break;
  }
  return acts.slice(0, limit).map((a) => ({
    url: a.url,
    title: a.title,
    text: "",
    publishedAt: a.addedAt,
    // Detail pages are fetched only for acts not stored yet (see runApiSource).
    loadText: async () => {
      const res = await politeFetch(a.url);
      if (!res.ok) return null;
      const text = legalinfoDetailText(await res.text());
      if (text.length < MIN_ARTICLE_CHARS) return null;
      return a.issuer ? `Батлагдсан байгууллага: ${a.issuer}\n\n${text}` : text;
    },
  }));
}
