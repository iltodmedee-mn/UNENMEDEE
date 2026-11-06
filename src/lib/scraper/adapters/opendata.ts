import { z } from "zod";

import { normalizeText } from "@/lib/text";

import { htmlFragmentToText } from "../extractor";
import { politeFetch, readJsonLimited } from "../http";
import type { ScrapedItem } from "../types";

/**
 * opendata.gov.mn is a Nuxt single-page app: its HTML is an empty shell, so there is
 * nothing to scrape. The page itself loads datasets from a public JSON endpoint
 * (POST /api/v1/front/search). We call the same endpoint the browser calls. This is
 * the portal's own frontend API, not CKAN.
 */
export const OPENDATA_SEARCH_URL = "https://opendata.gov.mn/api/v1/front/search";

const Item = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullish(),
  org: z.object({ reg_num: z.string().nullish(), name: z.string().nullish() }).nullish(),
  data: z.object({ uuid: z.string().nullish(), name: z.string().nullish() }).nullish(),
  frequency: z.object({ name: z.string().nullish() }).nullish(),
  term: z.string().nullish(),
  files: z.array(z.object({ ext: z.string().nullish() })).nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});

const Response = z.object({
  result: z.object({ details: z.object({ items: z.array(Item), total_rows: z.number().optional() }) }),
});

export type OpendataItem = z.infer<typeof Item>;

/** "2026-10-19 23:02:01" (Ulaanbaatar time, UTC+8) → Date */
function parseUbTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value.replace(" ", "T")}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function opendataItemToScraped(item: OpendataItem): ScrapedItem {
  const formats = [...new Set((item.files ?? []).map((f) => f.ext?.toUpperCase()).filter(Boolean))].join(", ");
  const description = item.description ? htmlFragmentToText(item.description).slice(0, 2000) : "";
  const lines = [
    `Нээлттэй өгөгдлийн багц: ${item.name}`,
    item.org?.name ? `Эзэмшигч байгууллага: ${item.org.name}` : null,
    item.data?.name && item.data.name !== item.name ? `Өгөгдлийн ангилал: ${item.data.name}` : null,
    item.frequency?.name ? `Шинэчлэгдэх давтамж: ${item.frequency.name}` : null,
    item.term ? `Хамрах хугацаа: ${item.term}` : null,
    formats ? `Файлын формат: ${formats}` : null,
    item.updated_at ? `Сүүлд шинэчлэгдсэн: ${item.updated_at}` : null,
    description ? `\nТайлбар:\n${description}` : null,
  ].filter(Boolean);
  return {
    url: `https://opendata.gov.mn/dataview/${item.id}`,
    title: item.name,
    text: normalizeText(lines.join("\n")),
    publishedAt: parseUbTime(item.created_at ?? item.updated_at),
    meta: {
      dataset_org: item.org?.name ?? undefined,
      dataset_updated: item.updated_at ?? undefined,
    },
  };
}

export function parseOpendataResponse(json: unknown): OpendataItem[] {
  return Response.parse(json).result.details.items;
}

/** Newest datasets first. Each dataset becomes one item, deduplicated by URL downstream. */
export async function fetchOpendata(limit: number): Promise<ScrapedItem[]> {
  const res = await politeFetch(OPENDATA_SEARCH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ page: { page: 1, page_size: Math.min(limit, 50), sort: "created_at desc" } }),
  });
  if (!res.ok) throw new Error(`opendata.gov.mn API returned HTTP ${res.status}`);
  return parseOpendataResponse(await readJsonLimited(res)).map(opendataItemToScraped);
}
