/**
 * Reports and tender documents that governments keep on pages, not in news posts (pure half,
 * unit-tested; the network half is fetch.ts). Two sources:
 *
 * - audit.mn's report register (`/audit`): one row per audit report; an id we have not seen is a
 *   new report. The first three rows are older pinned ones, so order never decides "new".
 * - WordPress ministry and aimag sites: every page carries a `modified` time in the REST API.
 *   Pages whose title names a report, a tender, procurement, transparency or an audit are read
 *   again when that time moves, and a file link we have not seen on the page (PDF, Word, Excel,
 *   a zip, an upload) is a new document. The first read of a page is a baseline: its files are
 *   stored but never announced as new.
 *
 * Only the link, its text and the page it sits on are stored: never the file.
 */
import * as cheerio from "cheerio";

import { unshoutTitle } from "@/lib/scraper/titles";

export type DocKind = "audit" | "tender" | "report";

/** WordPress sources (found Nov 2026 by their `api.w.org` link): domain and REST base. */
export const WP_SITES: { domain: string; base: string; name: string }[] = [
  { domain: "mimr.gov.mn", base: "https://www.mimr.gov.mn/wp-json/", name: "Аж үйлдвэр, эрдэс баялгийн яам" },
  { domain: "mod.gov.mn", base: "https://mod.gov.mn/index.php?rest_route=/", name: "Батлан хамгаалах яам" },
  { domain: "mddic.gov.mn", base: "https://mddic.gov.mn/mn/wp-json/", name: "Цахим хөгжил, инноваци, харилцаа холбооны яам" },
  { domain: "ndaatgal.mn", base: "https://www.ndaatgal.mn/wp-json/", name: "Нийгмийн даатгалын ерөнхий газар" },
  { domain: "pcsp.gov.mn", base: "https://pcsp.gov.mn/index.php?rest_route=/", name: "Төрийн өмчийн бодлого, зохицуулалтын газар" },
  { domain: "darkhan.gov.mn", base: "https://darkhan.gov.mn/wp-json/", name: "Дархан-Уул аймаг" },
  { domain: "arkhangai.gov.mn", base: "https://arkhangai.gov.mn/wp-json/", name: "Архангай аймаг" },
  { domain: "govisumber.gov.mn", base: "https://govisumber.gov.mn/index.php?rest_route=/", name: "Говьсүмбэр аймаг" },
  { domain: "bnd.ub.gov.mn", base: "https://bnd.ub.gov.mn/wp-json/", name: "Баянгол дүүрэг" },
  { domain: "ncoe.gov.mn", base: "https://ncoe.gov.mn/wp-json/", name: "Онцгой байдлын ерөнхий газар (ҮОБЦ)" },
];

/** A REST route on a base that is either `/wp-json/` or `index.php?rest_route=/`. */
export function wpUrl(base: string, route: string, query: string): string {
  const b = base.replace(/\/?$/, "/");
  return /[?&]rest_route=/.test(base) ? `${b}${route}&${query}` : `${b}${route}?${query}`;
}

/** Page titles worth watching. */
const WATCH_TITLE = /тендер|худалдан\s+авах|тайлан|ил\s+тод|аудит|санхүүгийн|төсөв|шилэн\s+данс/iu;

export function isWatchedTitle(title: string): boolean {
  return WATCH_TITLE.test(title);
}

export function docKind(title: string): DocKind {
  if (/тендер|худалдан\s+авах/iu.test(title)) return "tender";
  if (/аудит/iu.test(title)) return "audit";
  return "report";
}

/** "&#8211;" etc. in REST titles, and any markup. */
export function plainText(html: string): string {
  return cheerio.load(`<p>${html}</p>`)("p").text().replace(/\s+/g, " ").trim();
}

export interface WpPage {
  id: number;
  title: string;
  /** As the API gives it ("2026-08-13T16:46:13", site time). */
  modified: string;
  link: string;
}

/** `/wp/v2/pages?_fields=id,title,modified,link` → pages whose title is watched. */
export function parseWpPages(json: unknown, domain?: string): WpPage[] {
  if (!Array.isArray(json)) return [];
  const out: WpPage[] = [];
  for (const p of json as Record<string, unknown>[]) {
    const id = typeof p?.id === "number" ? p.id : null;
    const rendered = (p?.title as { rendered?: unknown } | undefined)?.rendered;
    const title = typeof rendered === "string" ? plainText(rendered) : "";
    const modified = typeof p?.modified === "string" ? p.modified : null;
    const link = typeof p?.link === "string" ? p.link : null;
    if (id === null || !title || !modified || !link || !isWatchedTitle(title)) continue;
    out.push({ id, title: title.slice(0, 300), modified, link: ownLink(link, id, domain) });
  }
  return out;
}

/** `link` is publisher data: only a link on the site itself is kept, else `?page_id=<id>` there. */
function ownLink(link: string, id: number, domain?: string): string {
  if (!domain) return link;
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\./, "");
    if ((u.protocol === "https:" || u.protocol === "http:") && (host === domain || host.endsWith(`.${domain}`))) return u.href;
  } catch {
    /* fall through */
  }
  return `https://${domain}/?page_id=${id}`;
}

const FILE_EXT = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|odt|ods)$/i;

/** Link texts that name an action, not the file. */
const GENERIC_LINK = /^(татах|татаж авах|download|үзэх|харах|дэлгэрэнгүй|энд дарна уу|энд дарж|файл|pdf|линк|холбоос|click here|here)[.!:]?$/iu;

export interface DocLink {
  url: string;
  title: string;
  fileType: string | null;
}

/**
 * File links in a page body: an extension we know, an upload path, or a Google Drive / Docs file.
 * Relative links resolve against the page; only http(s). The title is the link text, else the
 * file name.
 */
export function documentLinks(html: string, pageUrl: string, max = 300): DocLink[] {
  const $ = cheerio.load(html);
  const seen = new Map<string, DocLink>();
  $("a[href]").each((_, a) => {
    if (seen.size >= max) return false;
    let u: URL;
    try {
      u = new URL($(a).attr("href")!.trim(), pageUrl);
    } catch {
      return;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    u.hash = "";
    const path = u.pathname;
    const ext = path.match(FILE_EXT)?.[1]?.toLowerCase() ?? null;
    const isFile = ext !== null || /\/wp-content\/uploads\//i.test(path) || (/^(drive|docs)\.google\.com$/i.test(u.hostname) && /\/(file|document|spreadsheets)\/d\//.test(path));
    if (!isFile) return;
    const href = u.href;
    if (seen.has(href)) return;
    let name = $(a).text().replace(/\s+/g, " ").trim();
    // "ТАТАХ" / "Download" in a table: the row (or list item) says what the file is.
    if (name.length < 3 || GENERIC_LINK.test(name)) {
      const holder = $(a).closest("tr, li, p");
      // Table cells are read one by one (adjacent <td>s have no space between them: "3Гамшгаас").
      const cells = holder.is("tr") ? holder.children("td, th").toArray().map((c) => $(c).text()) : [holder.text()];
      const context = cells
        .join(" ")
        .replace(name, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\d{1,3}[.)]?\s+/, "");
      if (context.length >= 3 && context.length <= 300) name = context;
    }
    if (name.length < 3 || GENERIC_LINK.test(name)) {
      try {
        name = decodeURIComponent(path.split("/").pop() ?? "");
      } catch {
        name = path.split("/").pop() ?? "";
      }
    }
    seen.set(href, { url: href, title: unshoutTitle(name).slice(0, 300) || href.slice(0, 300), fileType: ext });
  });
  return [...seen.values()];
}

export interface AuditRow {
  id: string;
  title: string;
  office: string | null;
  auditType: string | null;
  url: string;
}

/** audit.mn `/audit` register rows: report id, title, the audit office and the audit type. */
export function parseAuditRegister(html: string): AuditRow[] {
  const $ = cheerio.load(html);
  const rows: AuditRow[] = [];
  $("table#example tbody tr").each((_, tr) => {
    const cells = $(tr).children("td");
    const link = $(tr).find("a[href*='report_detail/']").first();
    const id = link.attr("href")?.match(/report_detail\/(\d{1,9})/)?.[1];
    const title = link.text().replace(/\s+/g, " ").trim();
    if (!id || !title) return;
    const text = (i: number) => cells.eq(i).text().replace(/\s+/g, " ").trim() || null;
    rows.push({ id, title: unshoutTitle(title).slice(0, 400), office: text(4), auditType: text(6), url: `https://audit.mn/audit/report_detail/${id}` });
  });
  return rows;
}
