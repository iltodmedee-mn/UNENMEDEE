import { htmlFragmentToText, MIN_ARTICLE_CHARS, plainTitle } from "../extractor";
import { politeFetch } from "../http";
import type { ScrapedItem } from "../types";

/**
 * nhrcm.gov.mn (Хүний эрхийн үндэсний комисс) is an Angular app whose story links are hash routes
 * (`#/page/42/post/view/7149`), so the crawler, which drops fragments, found no article even after
 * rendering (Nov 2026). The page itself reads `POST /back/api/content/list` (menu 7 = "Мэдээ,
 * мэдээлэл"), which returns each story's full HTML (`info`) and day (`created_at`, midnight), so one
 * request gives complete items. No robots.txt (404); the 8 s host delay applies.
 */
export const NHRCM_LIST_URL = "https://nhrcm.gov.mn/back/api/content/list";
const NEWS_MENU = 7;

export function parseNhrcmList(json: unknown): ScrapedItem[] {
  const list = (json as { list?: unknown })?.list;
  if (!Array.isArray(list)) throw new Error("nhrcm.gov.mn list: no list array (API changed?)");
  const out: ScrapedItem[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    const id = String(raw.id ?? "");
    const menu = String(raw.menuid ?? "");
    if (!/^\d{1,9}$/.test(id) || !/^\d{1,6}$/.test(menu)) continue;
    const text = htmlFragmentToText(typeof raw.info === "string" ? raw.info : "");
    const title = plainTitle(typeof raw.title === "string" ? raw.title : "");
    if (!title || text.length < MIN_ARTICLE_CHARS) continue;
    const day = typeof raw.created_at === "string" ? raw.created_at.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] : undefined;
    out.push({
      url: `https://nhrcm.gov.mn/#/page/${menu}/post/view/${id}`,
      title,
      text,
      // A day only (the API prints midnight): Ulaanbaatar midnight, like police.gov.mn's list days.
      publishedAt: day ? new Date(`${day}T00:00:00+08:00`) : null,
    });
  }
  return out;
}

export async function fetchNhrcm(limit: number): Promise<ScrapedItem[]> {
  const res = await politeFetch(NHRCM_LIST_URL, {
    method: "POST",
    body: JSON.stringify({ lang: "mn", menuid: NEWS_MENU, page: 1, size: Math.min(Math.max(limit, 1), 30) }),
    headers: { "content-type": "application/json", accept: "application/json" },
  });
  if (!res.ok) throw new Error(`nhrcm.gov.mn list returned HTTP ${res.status}`);
  return parseNhrcmList(await res.json());
}
