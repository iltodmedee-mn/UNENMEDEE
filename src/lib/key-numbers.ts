import { amountValue } from "@/lib/format";
import { formatShare, PER_PERSON_MIN, POPULATION } from "@/lib/per-person";

/** One row of the article's "Гол тоо" panel. */
export interface KeyNumber {
  /** The digits as extracted ("186.2"), or the whole text when it does not parse. */
  number: string;
  /** The unit words after the digits ("тэрбум ₮"), empty when unparsed. */
  unit: string;
  value: number | null;
  /** "≈ 54 400₮" per resident for amounts of 1 тэрбум and more. */
  share: string | null;
  /** The first extracted fact sentence that names this number. */
  context: string | null;
}

const NUMBER = /^(\d[\d\s,.]*)(.*)$/u;

/** Thousands groups: "4 500 000", "1,907,944", "1.250" (spaces include NBSP and narrow NBSP). */
const GROUPED = /^\d{1,3}(?:[   ,.]\d{3})+(?:[.,]\d+)?$/;

/**
 * The values a written number can mean, as canonical strings ("4500000", "51.4"). "1,250.5" and
 * "1 250,5" are 1250.5; a lone "1.250" may be 1.25 or 1250, so both are returned; a date such as
 * "2026.10.27" is no amount and returns nothing.
 */
export function numberValues(raw: string): Set<string> {
  const s = raw.trim();
  const out = new Set<string>();
  const canon = (v: string) => {
    const n = Number(v);
    if (Number.isFinite(n)) out.add(String(n));
  };
  if (/^\d+$/.test(s)) canon(s);
  else if (/^\d+[.,]\d+$/.test(s)) {
    canon(s.replace(",", "."));
    // One separator before exactly three digits can also be a thousands separator.
    if (/^\d{1,3}[.,]\d{3}$/.test(s)) canon(s.replace(/[.,]/, ""));
  } else if (GROUPED.test(s)) {
    const decimal = /[.,]\d{1,2}$|[.,]\d{4,}$/.exec(s);
    const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    const hasBoth = s.includes(".") && s.includes(",");
    if (hasBoth || decimal) {
      // The last mark is the decimal point, every other separator groups thousands.
      canon(`${s.slice(0, lastSep).replace(/[   ,.]/g, "")}.${s.slice(lastSep + 1)}`);
    } else canon(s.replace(/[   ,.]/g, ""));
  }
  return out;
}

/** Every number written in a sentence, as values (see `numberValues`); dates and times never match. */
function sentenceValues(text: string): Set<string> {
  const out = new Set<string>();
  const plain = text
    .replace(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/g, " ") // 2026-09-08, 2026.10.27
    .replace(/\d{1,2}:\d{2}/g, " "); // 14:16
  for (const m of plain.matchAll(/(?<![\d.,])\d[\d.,   ]*\d|(?<![\d.,])\d/g)) {
    const token = m[0];
    // A run with spaces that is not a thousands group is several numbers ("10 15").
    const parts = /[   ]/.test(token) && !GROUPED.test(token) ? token.split(/[   ]+/) : [token];
    for (const p of parts) for (const v of numberValues(p.replace(/[.,]$/, ""))) out.add(v);
  }
  return out;
}

/** Values of the numbers in `text` written right before a scale word starting with `stem` ("тэрб"). */
function scaledValues(text: string, stem: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\d.,])(\d[\d.,\u00a0\u202f ]*\d|\d)\s*(их наяд|наяд|тэрбум|сая|мянга)/gi)) {
    if (m[2].toLowerCase().startsWith(stem) || (stem === "наяд" && /наяд/i.test(m[2]))) out.push(...numberValues(m[1].replace(/[.,]$/, "")));
  }
  return out;
}

/**
 * The fact sentence that names this number as a whole number (a substring test matched "5" inside
 * "2025" and "15", "1.5" inside "11.5", and "2 их наяд" to a sitting's start time), preferring one
 * that also names the amount's scale word.
 */
export function contextFor(number: string, unit: string, facts: string[]): string | null {
  const wanted = numberValues(number);
  if (wanted.size === 0) return null;
  const matches = facts.filter((f) => [...sentenceValues(f)].some((v) => wanted.has(v)));
  const scale = unit.split(/\s+/).find((w) => /^(наяд|тэрбум|сая|мянга)/i.test(w));
  // The scale word must follow this very number ("5 тэрбум"), not just appear somewhere in the
  // sentence: "2025 онд 5 сургууль барихад 12 тэрбум…" is not about "5 тэрбум" (Nov 2026 audit).
  const stem = scale?.toLowerCase().slice(0, 4);
  const named = stem ? matches.find((f) => scaledValues(f, stem).some((v) => wanted.has(v))) : undefined;
  // "5", "12", "20" are common in dates, counts and article numbers: a sentence must also name the
  // scale word ("тэрбум") to be about this amount. A specific number ("186.2", "4 500 000") need not.
  // Judged on the value ("3.0" is 3, as common as "3").
  const specific = [...wanted].some((v) => v.replace(/\D/g, "").length >= 3 || v.includes("."));
  return named ?? (specific || !scale ? (matches[0] ?? null) : null);
}

function cut(s: string, max = 160): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const space = head.lastIndexOf(" ");
  return `${(space > 80 ? head.slice(0, space) : head).replace(/[\s,;:–—-]+$/, "")}…`;
}

/**
 * The article's ₮ amounts as display rows: largest first, one row per value, at most `max`.
 * Rule-based (the amounts come from the AI's entity list and the regex merge), no new claims:
 * the per-person line is plain division by the population and the context is a fact sentence
 * that contains the same digits.
 */
export function keyNumbers(amounts: string[], facts: string[], max = 5): KeyNumber[] {
  const rows: KeyNumber[] = [];
  const seen = new Set<string>();
  for (const raw of amounts) {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const value = amountValue(text);
    const m = value !== null ? text.match(NUMBER) : null;
    const number = m ? m[1].replace(/[\s,.]+$/, "") : text;
    const unit = m?.[2]?.trim() ?? "";
    const key = value !== null ? String(value) : number.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const context = value !== null ? contextFor(number, unit, facts) : null;
    rows.push({
      number,
      unit,
      value,
      share: value !== null && value >= PER_PERSON_MIN ? formatShare(value / POPULATION.count) : null,
      context: context ? cut(context) : null,
    });
  }
  rows.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return rows.slice(0, max);
}
