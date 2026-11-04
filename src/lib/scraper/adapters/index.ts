import type { ScrapedItem } from "../types";
import { fetchGovMn, GOVMN_ORGS } from "./govmn";
import { fetchLegalinfo } from "./legalinfo";
import { fetchNhrcm } from "./nhrcm";
import { fetchOpendata } from "./opendata";
import { fetchParliament } from "./parliament";
import { fetchPolice } from "./police";
import { fetchZasag } from "./zasag";

/**
 * Sources that expose a public JSON API (the same one their own website calls).
 * These skip HTML crawling entirely: faster, exact dates, and no rendering needed.
 * Every other source goes through the generic crawler in ../crawl.ts.
 */
export const API_ADAPTERS: Record<string, (limit: number) => Promise<ScrapedItem[]>> = {
  "opendata.gov.mn": fetchOpendata,
  "parliament.mn": fetchParliament,
  "zasag.mn": fetchZasag,
  "legalinfo.mn": fetchLegalinfo,
  "police.gov.mn": fetchPolice,
  "nhrcm.gov.mn": fetchNhrcm,
  // Bodies whose own site fails but which post on the www.gov.mn portal (govmn.ts).
  ...Object.fromEntries(Object.entries(GOVMN_ORGS).map(([domain, slug]) => [domain, (limit: number) => fetchGovMn(slug, limit)])),
};

/**
 * The host an API source's requests go to: every www.gov.mn portal source shares one, zasag.mn reads
 * mongolia.gov.mn's feed. run-scraper.ts runs one queue per host in parallel, so the portal's
 * 8 s-per-request queue (40 bodies, a backlog of 300+ stories on Nov 4 2026) can no longer use up
 * the API share before police.gov.mn, parliament.mn or legalinfo.mn are reached.
 */
export function apiHost(domain: string): string {
  if (GOVMN_ORGS[domain]) return "www.gov.mn";
  if (domain === "zasag.mn") return "mongolia.gov.mn";
  return domain;
}

/** API sources grouped by host, in the given (least-recently-scraped first) order. */
export function groupByApiHost<T extends { domain: string }>(list: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const s of list) {
    const host = apiHost(s.domain);
    groups.set(host, [...(groups.get(host) ?? []), s]);
  }
  return [...groups.values()];
}
