import { z } from "zod";

/**
 * Companies a member of parliament names in their own ХАСХОМ declaration (shares they hold,
 * lenders), checked against Шилэн данс: did a state body pay a company of exactly that name, how
 * much, and which bodies paid most. Both are official public records; the page shows them side by
 * side with their links and draws no conclusion (a payment is not wrongdoing, and two companies
 * can share a name, which is why an ambiguous name is never linked).
 *
 * Private people named as lenders are never shown or looked up, only organisations.
 */

/** Words that make a declared name an organisation rather than a private person. */
// "сан" (fund) only as a word of its own: a private lender whose name ends in it ("Г.Отгонсан")
// read as an organisation, so a person was shown and looked up.
const ORG = /(^|[\s"«»“”(])(ХХК|ХК|ТӨХК|ТӨҮГ|ХЗХ|ББСБ|ААН|LLC|LTD|INC|JSC)([\s"«»“”).,]|$)|(?<!\p{L})банк|bank|(?<!\p{L})сан(?!\p{L})|хоршоо|групп|корпораци|компани|нөхөрлөл|fund/iu;
/** Organisations we list but do not look up: banks and funds lend to everyone, and every citizen holds Erdenes Tavantolgoi shares. */
const NOT_A_SUPPLIER = /(?<!\p{L})банк|bank|ббсб|хадгаламж|зээлийн хоршоо|(?<!\p{L})сан(?!\p{L})|fund|эрдэнэс\s*тавантолгой/iu;
const LEGAL_FORM = /(^|\s)(ХХК|ХК|ТӨХК|ТӨҮГ|ХЗХ|ББСБ|ААН|LLC|LTD|INC|JSC)(?=\s|$)/gi;

export const isOrgName = (name: string): boolean => ORG.test(name);

/** The name without legal form and quotes, spacing kept: what Шилэн данс is searched with. */
export function bareName(name: string): string {
  return name
    .replace(/["«»“”„'`]/g, " ")
    .replace(LEGAL_FORM, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Comparison key: "Бодит чадал ХХК", "Бодитчадал ХХК ХХК" and "«Бодитчадал»" are one company. */
export function orgKey(name: string): string {
  return bareName(name).toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");
}

export interface DeclaredOrg {
  name: string;
  key: string;
  /** False for banks, funds and Erdenes Tavantolgoi: listed, never looked up. */
  lookup: boolean;
}

export interface DeclaredCompanies {
  stocks: DeclaredOrg[];
  lenders: DeclaredOrg[];
  /** Names that look like private people: counted, never shown. */
  hiddenPeople: number;
}

function split(list: string | undefined): string[] {
  return (list ?? "")
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function orgs(list: string | undefined, hidden: { n: number }): DeclaredOrg[] {
  const out = new Map<string, DeclaredOrg>();
  for (const name of split(list)) {
    if (!isOrgName(name)) {
      hidden.n++;
      continue;
    }
    const key = orgKey(name);
    if (key.length < 2 || out.has(key)) continue;
    out.set(key, { name: name.replace(/(\s+(ХХК|ХК))\s+\2$/i, "$1"), key, lookup: !NOT_A_SUPPLIER.test(name) });
  }
  return [...out.values()];
}

/** The organisations in one declaration's details (`stocks`, `lenders`), each once. */
export function declaredCompanies(details: Record<string, string> | null | undefined): DeclaredCompanies {
  const hidden = { n: 0 };
  const stocks = orgs(details?.stocks, hidden);
  const lenders = orgs(details?.lenders, hidden);
  return { stocks, lenders, hiddenPeople: hidden.n };
}

// ---------------------------------------------------------------- Шилэн данс

export const SHILENDANS_API = "https://back.shilendans.gov.mn/proxy/gap-integration-service/integrationECopyCredits";
export const SHILENDANS_SITE = "https://shilendans.gov.mn/";
/** Payments are searched from here: the first full year of Шилэн данс data we rely on. */
export const PAYMENTS_FROM = "2017-01-01";

const Supplier = z.object({ name: z.string(), register: z.coerce.string().nullish(), count: z.coerce.number().nullish(), amount: z.coerce.number().nullish() });
const SupplierPage = z.object({ content: z.array(z.unknown()).catch([]), totalElements: z.coerce.number().catch(0) });
const Payer = z.object({ name: z.string(), transactionCount: z.coerce.number().nullish(), transactionAmount: z.coerce.number().nullish() });

export interface SupplierHit {
  name: string;
  register: string;
  amount: number;
  count: number;
}

export function parseSuppliers(json: unknown): SupplierHit[] {
  return SupplierPage.parse(json)
    .content.map((r) => Supplier.safeParse(r))
    .flatMap((r) => (r.success && r.data.register ? [{ name: r.data.name.trim(), register: r.data.register, amount: r.data.amount ?? 0, count: r.data.count ?? 0 }] : []));
}

export interface PayerRow {
  name: string;
  amount: number;
  count: number;
}

/** The state bodies that paid a supplier, largest first. */
export function parsePayers(json: unknown, max = 3): PayerRow[] {
  return SupplierPage.parse(json)
    .content.map((r) => Payer.safeParse(r))
    .flatMap((r) => (r.success ? [{ name: r.data.name.trim(), amount: r.data.transactionAmount ?? 0, count: r.data.transactionCount ?? 0 }] : []))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, max);
}

export type CompanyCheck =
  | { status: "found"; name: string; checkedAt: string; register: string; amount: number; count: number; payers: PayerRow[] }
  | { status: "ambiguous"; name: string; checkedAt: string; registers: number }
  | { status: "none"; name: string; checkedAt: string };

export interface OfficialCompaniesSnapshot {
  from: string;
  to: string;
  /** By `orgKey`. */
  companies: Record<string, CompanyCheck>;
}

/** Search strings for a declared name: as written, then without spaces ("Бодит чадал" → "Бодитчадал"). */
export function searchQueries(name: string): string[] {
  const bare = bareName(name);
  const glued = bare.replace(/\s+/g, "");
  return glued !== bare ? [bare, glued] : [bare];
}

/** The search results that are this company by name; more than one register means we cannot tell which. */
export function exactMatches(hits: SupplierHit[], key: string): SupplierHit[] {
  const byRegister = new Map<string, SupplierHit>();
  for (const h of hits) if (orgKey(h.name) === key && !byRegister.has(h.register)) byRegister.set(h.register, h);
  return [...byRegister.values()];
}

/** A stored check is reused for this long. */
export const RECHECK_DAYS = 30;

/** Which keys to look up this run: never checked first, then the oldest past RECHECK_DAYS. */
export function dueKeys(wanted: Map<string, string>, stored: Record<string, CompanyCheck>, now = new Date()): string[] {
  const cutoff = now.getTime() - RECHECK_DAYS * 86_400_000;
  const fresh = [...wanted.keys()].filter((k) => !stored[k]);
  const stale = [...wanted.keys()]
    .filter((k) => stored[k] && new Date(stored[k].checkedAt).getTime() < cutoff)
    .sort((a, b) => stored[a].checkedAt.localeCompare(stored[b].checkedAt));
  return [...fresh, ...stale];
}
