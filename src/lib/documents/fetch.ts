import { politeFetch } from "@/lib/scraper/http";

import { type AuditRow, documentLinks, parseAuditRegister, parseWpPages, type DocLink, type WpPage, wpUrl } from "./watch";

/**
 * Network half of the document watch (robots.txt and 8 s per host through politeFetch). The
 * caller reports a failure per source and goes on with the others. Files are never downloaded.
 */
export const AUDIT_REGISTER_URL = "https://audit.mn/audit";

export async function fetchAuditRegister(): Promise<AuditRow[]> {
  const res = await politeFetch(AUDIT_REGISTER_URL, { timeoutMs: 60_000 });
  if (!res.ok) throw new Error(`audit.mn returned HTTP ${res.status}`);
  const rows = parseAuditRegister(await res.text());
  if (rows.length === 0) throw new Error("audit.mn: no report rows parsed (page layout changed?)");
  return rows;
}

/** The site's 100 most recently modified pages whose title is watched. */
export async function fetchWatchedPages(site: { base: string; domain: string }): Promise<WpPage[]> {
  const res = await politeFetch(wpUrl(site.base, "wp/v2/pages", "orderby=modified&order=desc&per_page=100&_fields=id,title,modified,link"), {
    timeoutMs: 60_000,
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseWpPages(await res.json(), site.domain);
}

/** One page's body (the REST `content.rendered`) as file links. */
export async function fetchPageDocuments(site: { base: string }, page: WpPage): Promise<DocLink[]> {
  const res = await politeFetch(wpUrl(site.base, `wp/v2/pages/${page.id}`, "_fields=content"), { timeoutMs: 60_000, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { content?: { rendered?: unknown } };
  const html = typeof json?.content?.rendered === "string" ? json.content.rendered : "";
  return documentLinks(html, page.link);
}
