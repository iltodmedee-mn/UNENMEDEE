import { politeFetch } from "@/lib/scraper/http";

import { type CompanyCheck, exactMatches, orgKey, parsePayers, parseSuppliers, PAYMENTS_FROM, searchQueries, SHILENDANS_API, type SupplierHit } from "./companies";

/** Network half of companies.ts (scripts only: pages import the pure half). */

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

async function getJson(path: string): Promise<unknown> {
  const res = await politeFetch(`${SHILENDANS_API}/${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`shilendans ${path.split("?")[0]} returned HTTP ${res.status}`);
  return res.json();
}

/** Pages read per search at most; a name with more hits is left unchecked (its stored result stays). */
export const MAX_SEARCH_PAGES = 6;
const MAX_PAYER_PAGES = 20;

/**
 * Every page of a Шилэн данс list (Spring `last` / `totalPages`). Only the first 50 hits were read:
 * "exactly one register" was then decided on part of the list, so a second company with the same
 * name further down could leave another company's state payments on an MP's declared one, and
 * "no record" could be said of a company on page 2. A list longer than `maxPages` throws, so the
 * caller keeps the previous result instead of storing a guess.
 */
export async function allPages(path: (page: number) => string, maxPages: number, get: (p: string) => Promise<unknown> = getJson): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let page = 0; page < maxPages; page++) {
    const json = (await get(path(page))) as { content?: unknown; last?: unknown; totalPages?: unknown };
    const content = Array.isArray(json?.content) ? json.content : [];
    out.push(...content);
    const total = Number(json?.totalPages);
    if (json?.last === true || content.length === 0 || (Number.isFinite(total) && page + 1 >= total)) return out;
  }
  throw new Error(`more than ${maxPages} pages of results: not checked`);
}

/** Looks one declared company up in Шилэн данс (every page of hits, at the 8 s host pace). */
export async function checkCompany(name: string, to: string, now = new Date(), get: (p: string) => Promise<unknown> = getJson): Promise<CompanyCheck> {
  const key = orgKey(name);
  const checkedAt = now.toISOString();
  let matches: SupplierHit[] = [];
  for (const q of searchQueries(name)) {
    const rows = await allPages((page) => `getBeltgenNiiluulegch?${qs({ page: String(page), size: "50", startDate: PAYMENTS_FROM, endDate: to, supplierType: "", ezaType: "", registerNo: "", orgName: q })}`, MAX_SEARCH_PAGES, get);
    matches = exactMatches(parseSuppliers({ content: rows }), key);
    if (matches.length) break;
  }
  if (matches.length === 0) return { status: "none", name, checkedAt };
  if (matches.length > 1) return { status: "ambiguous", name, checkedAt, registers: matches.length };
  const [m] = matches;
  // The largest payers of the whole list, not of its first 25 rows.
  const rows = await allPages((page) => `getSupplierOne?${qs({ page: String(page), size: "25", startDate: PAYMENTS_FROM, endDate: to, registerNo: m.register })}`, MAX_PAYER_PAGES, get);
  const payers = parsePayers({ content: rows });
  return { status: "found", name: m.name, checkedAt, register: m.register, amount: m.amount, count: m.count, payers };
}
