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
