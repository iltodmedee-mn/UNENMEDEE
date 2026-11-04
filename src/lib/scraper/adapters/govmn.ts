import { htmlFragmentToText, MIN_ARTICLE_CHARS, plainTitle } from "../extractor";
import { politeFetch } from "../http";
import type { ScrapedItem } from "../types";

/**
 * www.gov.mn (Цахим үйлчилгээний нэгдсэн портал, "E-Mongolia") hosts a news page for every
 * government organisation: `/news?organizationSlug=<slug>`, each story at `/news/n/<code>`.
 * Many bodies post there while their own sites are down, geo-blocked or JavaScript shells
 * (Nov 2026: mof.gov.mn and customs.gov.mn time out from outside Mongolia, mojha.gov.mn and
 * bulgan.gov.mn answer 404, culture.gov.mn shows a maintenance page, tov.gov.mn is a 2021 shell),
 * yet Сангийн яам, Гааль, ХЗДХЯ, the ministries and the aimag governors' offices post on gov.mn
 * the same day. The portal's own pages read the list from `/api/routes/news` (JSON: title, code,
 * time, summary); the text is in the story page's React Server Components payload (a `news`
 * object whose `content` is HTML, a long one stored as a separate text row). No robots.txt
 * (404); the 8 s per-host delay applies to every request, and all of them go to one host.
 */
const ORIGIN = "https://www.gov.mn";

/** Our source domain → its organisation slug on gov.mn (checked Nov 4 2026, each had fresh news). */
export const GOVMN_ORGS: Record<string, string> = {
  "mof.gov.mn": "mof",
  "customs.gov.mn": "customs",
  "mojha.gov.mn": "mojha",
  "meds.gov.mn": "moe",
  "mfa.gov.mn": "mfa",
  "bpo.gov.mn": "bpo",
  "culture.gov.mn": "culture",
  "pcsp.gov.mn": "pcsp",
  "sme.gov.mn": "sme",
  "cd.gov.mn": "cd",
  "bayan-olgii.gov.mn": "bayanulgiigover",
  "bulgan.gov.mn": "bulgangovern",
  "tov.gov.mn": "tuvgovern",
  "omnogovi.gov.mn": "umnugovigovern",
  "khovsgol.gov.mn": "khuvsgulgov",
  "dornogovi.gov.mn": "dornogovizdtg",
  "selenge.gov.mn": "selengegovern",
  "uvs.gov.mn": "uvsgovern",
  "bayankhongor.gov.mn": "bayankhongorgov",
  "sukhbaatar.gov.mn": "sukhbaatargover",
  "govisumber.gov.mn": "govisumbergover",
  "bgd.mn": "bgdzdtg",
};

/** gov.mn prints times without a zone: Ulaanbaatar (+08:00). */
function ubTime(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const d = new Date(`${s.slice(0, 19).padEnd(19, ":00")}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface GovMnListItem {
  url: string;
  title: string;
  publishedAt: Date | null;
  summary: string;
}

export function parseGovMnList(json: unknown): GovMnListItem[] {
  const items = (json as { items?: unknown })?.items;
  if (!Array.isArray(items)) throw new Error("gov.mn news list: no items array (API changed?)");
  const out: GovMnListItem[] = [];
  for (const raw of items as Record<string, unknown>[]) {
    const code = typeof raw.slug === "string" ? raw.slug : "";
    if (!/^n\/[a-z0-9]{1,12}$/.test(code)) continue;
    const title = plainTitle(typeof raw.title === "string" ? raw.title : "");
    if (!title) continue;
    out.push({ url: `${ORIGIN}/news/${code}`, title, publishedAt: ubTime(raw.createdAt), summary: typeof raw.summary === "string" ? raw.summary.trim() : "" });
  }
  return out;
}

/** The page's React Server Components stream: the string pieces of every `self.__next_f.push([1,"…"])`. */
export function rscStream(html: string): string {
  const parts: string[] = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  for (const m of html.matchAll(re)) {
    try {
      parts.push(JSON.parse(m[1]) as string);
    } catch {
      // A piece that is not valid JSON is skipped; the rest of the stream still parses.
    }
  }
  return parts.join("");
}

/** The JSON object that starts at `start` (a `{`), read with string awareness. Null if unbalanced. */
function objectAt(s: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/** A text row `<id>:T<hex byte length>,<text>` referenced as "$<id>". */
function textRow(stream: string, id: string): string | null {
  const marker = `${id}:T`;
  let at = stream.indexOf(`\n${marker}`);
  at = at >= 0 ? at + 1 : stream.startsWith(marker) ? 0 : -1;
  if (at < 0) return null;
  const head = stream.slice(at + marker.length).match(/^([0-9a-f]+),/);
  if (!head) return null;
  const from = at + marker.length + head[0].length;
  // The length counts UTF-8 bytes, not characters.
  return Buffer.from(stream.slice(from, from + Number.parseInt(head[1], 16)), "utf8").subarray(0, Number.parseInt(head[1], 16)).toString("utf8");
}

export function parseGovMnArticle(html: string): { title: string; text: string; publishedAt: Date | null } | null {
  const stream = rscStream(html);
  const at = stream.indexOf('"news":{"id":');
  if (at < 0) return null;
  const raw = objectAt(stream, at + '"news":'.length);
  if (!raw) return null;
  let news: { title?: unknown; content?: unknown; createAt?: unknown };
  try {
    news = JSON.parse(raw) as typeof news;
  } catch {
    return null;
  }
  let content = typeof news.content === "string" ? news.content : "";
  const ref = content.match(/^\$([0-9a-f]+)$/);
  if (ref) content = textRow(stream, ref[1]) ?? "";
  return {
    title: plainTitle(typeof news.title === "string" ? news.title : ""),
    text: htmlFragmentToText(content),
    publishedAt: ubTime(news.createAt),
  };
}

export function govMnListUrl(slug: string, pageSize: number): string {
  const q = new URLSearchParams({ page: "0", pageSize: String(pageSize), language: "MN", organizationSlug: slug });
  return `${ORIGIN}/api/routes/news?${q}`;
}

export async function fetchGovMn(slug: string, limit: number): Promise<ScrapedItem[]> {
  const res = await politeFetch(govMnListUrl(slug, Math.min(Math.max(limit, 1), 20)));
  if (!res.ok) throw new Error(`gov.mn news list (${slug}) returned HTTP ${res.status}`);
  const list = parseGovMnList(await res.json());
  return list.map((item) => ({
    url: item.url,
    title: item.title,
    text: "",
    publishedAt: item.publishedAt,
    // The story page is read only for URLs not stored yet (runApiSource).
    loadText: async () => {
      const page = await politeFetch(item.url);
      if (!page.ok) return null;
      const a = parseGovMnArticle(await page.text());
      // Photo and video posts carry no text ("<p><br></p>"): skipped, like police.gov.mn's.
      if (!a || a.text.length < MIN_ARTICLE_CHARS) return null;
      return { text: a.text, publishedAt: a.publishedAt ?? item.publishedAt };
    },
  }));
}
