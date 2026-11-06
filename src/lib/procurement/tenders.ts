/**
 * Procurement results from Шилэн данс (pure half, unit-tested; the network half is fetch.ts).
 *
 * tender.gov.mn sits behind a Cloudflare challenge and is never worked around. Every budget body
 * also files its tender results to Шилэн данс as form 1831 ("тендерийн ерөнхий мэдээлэл"), and
 * the portal's open-data call returns them: one row per tender (or lot) with its code, item,
 * approved budget, contract amount, method, winner and result date. A monthly filing repeats the
 * year so far, so rows are merged by organisation + tender code + item.
 *
 * The rows are typed by hand in each organisation: dates come as "2026-04-15", "2026.04",
 * "2026/05/025" or a year off ("2029.01.29"), methods as "НТШ" or the full name, a winner cell may
 * read "оролцогч ирээгүй". Nothing is guessed: an unreadable date is null, a winner cell that says
 * nobody won is kept as the official text but never counted as an award.
 */
import { z } from "zod";

/** Form 1831 columns: A code, B item, C budget, D contract amount, E method, G winner, J result date. */
export const TENDER_FORM = { reportFormId: 1831, columns: [5960, 5962, 5964, 5966, 5968, 5972, 5978] } as const;
/** 6 = budget governors (ministries, aimags), 117 = budget organisations (schools, hospitals, sums…). */
export const TENDER_GROUPS = [6, 117] as const;
export const SHILENDANS_URL = "https://shilendans.gov.mn/";

export interface Tender {
  /** registerNo | code | item: one tender lot of one organisation. */
  key: string;
  code: string;
  title: string;
  orgName: string;
  orgRegister: string | null;
  /** The body the organisation reports to ("Боловсрол, шинжлэх ухааны сайд", "Ховд"). */
  governor: string | null;
  budgetMnt: number | null;
  contractMnt: number | null;
  method: string | null;
  /** The winner cell as filed ("НБИК ХХК"), or null when empty. */
  winner: string | null;
  /** True only when a named winner and a contract amount were filed. */
  awarded: boolean;
  /**
   * The amounts' unit is unclear: some bodies type thousands of ₮ into the ₮ column (Орхон: a
   * 4.17 тэрбум contract against a "4 343 956" budget, "337 230" for a 337 сая contract). An amount
   * under 1 сая or a budget and contract 20× apart is shown as filed with "нэгж тодорхойгүй" and
   * never summed or ranked. Nothing is rescaled.
   */
  unitSuspect: boolean;
  /** yyyy-mm-dd, only when the cell is a real date inside the report year (or the one before). */
  resultDate: string | null;
}

const text = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, " ").trim() || null));

const Row = z.object({ A: text, B: text, C: text, D: text, E: text, G: text, J: text, name: text, registerNo: text, refTypeName: text });

/** "ССАЖЗЯ/20260101060", "ХЭАХСЦ2/20260202001": letters/digits, a slash, the year and a number. */
const CODE = /^[\p{L}\d-]{1,24}\/\d{8,14}$/u;

/**
 * Winner cells that say no contract was signed, or that hold a status instead of a name: Nov 2026
 * rows read "Зарлагдаагүй", "Тендер зарлагдаагүй байна", "Зарласан байгаа", "эхлээгүй", "Хамгийн
 * сайн үнэлэгдсэн", "Эрх бүхий оролцогч болохыг нотлох баримт бичгүүд", "оролцогч ороогүй" or "0",
 * and the warning signs nearly named one of them as a buyer's main supplier.
 */
export const NO_AWARD =
  /ирээгүй|ирүүлээгүй|ороогүй|хүчингүй|цуцал|зарлаагүй|зарлагдаагүй|^зарласан|эхлээгүй|байхгүй|шалгараагүй|үнэлээгүй|үнэлэгдсэн|баримт бич|дахин зарла|хүлээж авч байгаа|боломжгүй|^[-–—.\s\d]*$/iu;
/** The same test for Postgres (`~*`), used by the /tenders "no winner" count. */
export const NO_AWARD_SQL =
  "ирээгүй|ирүүлээгүй|ороогүй|хүчингүй|цуцал|зарлаагүй|зарлагдаагүй|^зарласан|эхлээгүй|байхгүй|шалгараагүй|үнэлээгүй|үнэлэгдсэн|баримт бич|дахин зарла|хүлээж авч байгаа|боломжгүй|^[-–—.[:space:][:digit:]]*$";

/** True when a winner cell names nobody ("-", "оролцогч ирээгүй"…). */
export const namesNoWinner = (winner: string | null): boolean => winner !== null && NO_AWARD.test(winner);

/** Method abbreviations as the bodies type them; anything else keeps its own wording. */
const METHODS: [RegExp, string][] = [
  [/^нтша?$|нээлттэй/iu, "Нээлттэй тендер"],
  [/^ха$|харьцуулалт/iu, "Харьцуулалтын арга"],
  [/^шха$|шууд/iu, "Шууд гэрээ"],
  [/ерөнхий гэрээ/iu, "Ерөнхий гэрээ"],
  [/зөвлөх/iu, "Зөвлөх үйлчилгээ"],
];

export function methodLabel(raw: string | null): string | null {
  if (!raw) return null;
  for (const [re, label] of METHODS) if (re.test(raw)) return label;
  return raw.length > 60 ? `${raw.slice(0, 59)}…` : raw;
}

/** Whole tögrög from "1068516025" or "355543123.27"; anything that is not a plain number is null. */
export function amount(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.replace(/[\s,]/g, "");
  if (!/^\d{1,15}(\.\d{1,4})?$/.test(s)) return null;
  const n = Math.round(Number(s));
  return n > 0 ? n : null;
}

/**
 * "2026-04-15", "2026.05.13", "2026/05/025" → yyyy-mm-dd; "2026.04" (no day), impossible dates and
 * years outside [year - 1, year] are null. `today` (yyyy-mm-dd) drops dates in the future.
 */
export function resultDate(raw: string | null, year: number, today: string): string | null {
  const m = raw?.match(/^(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,3})\D{0,3}$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < year - 1 || y > year || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1) return null;
  const iso = date.toISOString().slice(0, 10);
  return iso > today ? null : iso;
}

/** Below this a form-1831 amount is almost always thousands of ₮ typed into the ₮ column. */
export const MIN_PLAIN_MNT = 1_000_000;
/** A budget and a contract this far apart: one of them was typed in another unit. */
export const UNIT_RATIO = 20;

export function unitSuspect(budget: number | null, contract: number | null): boolean {
  if ((budget !== null && budget < MIN_PLAIN_MNT) || (contract !== null && contract < MIN_PLAIN_MNT)) return true;
  if (budget !== null && contract !== null) return Math.max(budget, contract) / Math.min(budget, contract) >= UNIT_RATIO;
  return false;
}

function cut(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Rows of one or more form-1831 answers → tenders, one per organisation + code + item. A later
 * row of the same lot fills what an earlier one left empty (the filing grows over the year).
 */
export function parseTenders(answers: unknown[], year: number, today: string): Tender[] {
  const byKey = new Map<string, Tender>();
  for (const json of answers) {
    if (!Array.isArray(json)) continue;
    for (const raw of json) {
      const r = Row.safeParse(raw);
      if (!r.success) continue;
      const { A, B, C, D, E, G, J, name, registerNo, refTypeName } = r.data;
      if (!A || !CODE.test(A) || !B || !name) continue;
      const title = cut(B, 300);
      const key = cut(`${registerNo ?? name}|${A}|${title.toLowerCase().slice(0, 80)}`, 200);
      const winner = G ? cut(G, 200) : null;
      const contractMnt = amount(D);
      const t: Tender = {
        key,
        code: A,
        title,
        orgName: cut(name, 200),
        orgRegister: registerNo,
        governor: refTypeName,
        budgetMnt: amount(C),
        contractMnt,
        method: methodLabel(E),
        winner,
        awarded: !!winner && !NO_AWARD.test(winner) && contractMnt !== null,
        unitSuspect: false,
        resultDate: resultDate(J, year, today),
      };
      t.unitSuspect = unitSuspect(t.budgetMnt, t.contractMnt);
      const prev = byKey.get(key);
      byKey.set(key, prev ? mergeLot(prev, t) : t);
    }
  }
  return [...byKey.values()];
}

/** A later row of the same lot fills what an earlier one left empty. */
function mergeLot(prev: Tender, t: Tender): Tender {
  return {
    ...prev,
    budgetMnt: prev.budgetMnt ?? t.budgetMnt,
    contractMnt: t.contractMnt ?? prev.contractMnt,
    method: prev.method ?? t.method,
    // A later "-" never replaces a named winner (43 lots read "Шалгарсан: -", Nov 2026 audit).
    winner: t.winner && !(namesNoWinner(t.winner) && prev.winner && !namesNoWinner(prev.winner)) ? t.winner : (prev.winner ?? t.winner),
    awarded: t.awarded || prev.awarded,
    resultDate: t.resultDate ?? prev.resultDate,
    unitSuspect: unitSuspect(prev.budgetMnt ?? t.budgetMnt, t.contractMnt ?? prev.contractMnt),
  };
}

/**
 * One row per key across several report years: a lot carried over into the next year is in both
 * years' filings, and two rows with one key in one upsert batch make Postgres refuse the whole
 * batch ("ON CONFLICT DO UPDATE command cannot affect row a second time", Nov 2026 audit).
 */
export function mergeByKey(lots: Tender[]): Tender[] {
  const byKey = new Map<string, Tender>();
  for (const t of lots) {
    const prev = byKey.get(t.key);
    byKey.set(t.key, prev ? mergeLot(prev, t) : t);
  }
  return [...byKey.values()];
}

/** The request body for one report group and month. */
export function tenderQuery(group: number, year: number, month: number) {
  return { ...TENDER_FORM, columns: [...TENDER_FORM.columns], years: [year], months: [month], reportGroupIds: [group], tez: [], ttz: [], orgs: [] };
}
