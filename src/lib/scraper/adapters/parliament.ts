import { z } from "zod";

import { htmlFragmentToText, MIN_ARTICLE_CHARS, plainTitle } from "../extractor";
import { politeFetch, readJsonLimited } from "../http";
import type { ScrapedItem } from "../types";

/**
 * parliament.mn (State Great Khural) is a single-page app backed by a public JSON API.
 * The list endpoint already returns the full article body, so one request yields
 * many complete articles with exact publish times.
 */
export const PARLIAMENT_NEWS_URL = "https://parliament.mn/api/news/articles/";

const Article = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string(),
  category_name: z.string().nullish(),
  short_description: z.string().nullish(),
  content: z.string().nullish(),
  status: z.string().nullish(),
  related_members_detail: z.array(z.object({ full_name: z.string().nullish() })).nullish(),
  published_at: z.string().nullish(),
});

const Page = z.object({ results: z.array(Article) });

export type ParliamentArticle = z.infer<typeof Article>;

export function parliamentArticleToScraped(a: ParliamentArticle): ScrapedItem | null {
  if (a.status && a.status !== "PUBLISHED") return null;
  const body = htmlFragmentToText(a.content ?? a.short_description ?? "");
  const members = (a.related_members_detail ?? []).map((m) => m.full_name).filter(Boolean);
  const header = [a.category_name ? `Ангилал: ${a.category_name}` : null, members.length ? `Холбогдох гишүүд: ${members.join(", ")}` : null]
    .filter(Boolean)
    .join("\n");
  const text = header ? `${header}\n\n${body}` : body;
  if (body.length < MIN_ARTICLE_CHARS) return null;
  const date = a.published_at ? new Date(a.published_at) : null;
  return {
    url: `https://parliament.mn/parliament-news/detail/${encodeURIComponent(a.slug)}`,
    title: plainTitle(a.title),
    text,
    publishedAt: date && !Number.isNaN(date.getTime()) ? date : null,
  };
}

export function parseParliamentPage(json: unknown): ParliamentArticle[] {
  return Page.parse(json).results;
}

export async function fetchParliament(limit: number): Promise<ScrapedItem[]> {
  const res = await politeFetch(`${PARLIAMENT_NEWS_URL}?page=1&page_size=${Math.min(limit, 50)}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`parliament.mn API returned HTTP ${res.status}`);
  return parseParliamentPage(await readJsonLimited(res))
    .map(parliamentArticleToScraped)
    .filter((x): x is ScrapedItem => x !== null);
}
