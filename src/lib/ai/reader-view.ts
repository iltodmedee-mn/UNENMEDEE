import { ubDateKey } from "@/lib/archive";
import { isLatinText } from "@/lib/script";
import type { ReaderImpact } from "@/lib/types";

/**
 * The reader's view of a story (Oct 2026 mission audit): government headlines stay in the
 * government's words ("… Бүгд Найрамдах Солонгос Улсын Ерөнхийлөгч Ли Жэ Мёнтэй албан ёсны
 * хэлэлцээ хийлээ", 64 of 586 over 120 characters), and nothing told a reader whether a story
 * touches them. Young readers skip news that "has nothing to do with me" (Reuters Institute 2025);
 * Axios-style "why it matters" lines answer that.
 *
 * Tier 1 now writes a plain headline and four "Танд хамаатай юу?" fields. A model may invent a
 * number, so every number it writes must already be in the source (title, text, date), and every
 * field the text does not support stays null: nothing is shown rather than a guess.
 */

export const READER_TITLE_MAX = 100;
const READER_TITLE_MIN = 12;
const LIMITS: Record<keyof ReaderImpact, number> = { who: 70, change: 220, when: 50, action: 220 };

/** Placeholders models write instead of null. */
const EMPTY = /^(null|none|n\/a|үгүй|байхгүй|тодорхойгүй|мэдээлэлгүй|дурдаагүй|текстэд\s+(байхгүй|дурдаагүй|тодорхойгүй)|-|—|–)\.?$/i;

const NUMBER = /\d(?:[\d\s,.'\u00a0\u202f]*\d)?/g;
const SCALES: [RegExp, number][] = [
  [/^\s*их\s+наяд/i, 1e12],
  [/^\s*наяд/i, 1e12],
  [/^\s*тэрбум/i, 1e9],
  [/^\s*сая/i, 1e6],
  [/^\s*мянга/i, 1e3],
];

interface NumberToken {
  /** Digits only, leading zeros dropped: "600,000" → "600000", "06" → "6", "40.4" → "404". */
  digits: string;
  /** The value with its scale word: "1.5 тэрбум" → 1.5e9, "600,000" → 600000. */
  value: number;
  /** The number as written, without its scale word: "1.5 тэрбум" → 1.5, "600,000" → 600000. */
  base: number;
  /** Followed by a scale word (мянга, сая, тэрбум, их наяд). */
  scaled: boolean;
}

/** "1,250.5" → 1250.5, "600,000" → 600000, "2,5" → 2.5, "4 500" → 4500. */
function parseNumber(raw: string): number {
  const s = raw.replace(/[\s'\u00a0\u202f]/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  if (last < 0) return Number(s);
  return Number(`${s.slice(0, last).replace(/[.,]/g, "")}.${s.slice(last + 1)}`);
}

/** Every number in `text`; a month number ("11-р сар", "11 сарын") only when `months` is set. */
function numberTokens(text: string, months: boolean): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
    if (!months && /^\s*-?\s*(р|дүгээр|дугаар|дүгээр)?\s*сар/i.test(after) && Number(m[0]) <= 12) continue;
    const scale = SCALES.find(([re]) => re.test(after))?.[1];
    const base = parseNumber(m[0]);
    out.push({ digits: m[0].replace(/\D/g, "").replace(/^0+(?=\d)/, ""), value: base * (scale ?? 1), base, scaled: scale !== undefined });
  }
  return out;
}

/** The source's digits with thousand separators removed, so "600,000" and "600000" match. */
export function sourceDigits(source: string): string {
  return source.replace(/(?<=\d)[\s,.'\u00a0\u202f]{1,2}(?=\d)/g, "");
}

/**
 * Every number in `text` is a number the source prints: the same whole number ("5" is not found
 * inside "2026", "50" not inside "500", as the old digit-substring check allowed), or, written
 * with a scale word on either side, within 5 % of an amount in the source ("15 сая" for
 * "15,000,000 төгрөг", "1.5 тэрбум" for "1,500,000,000", "15,000,000" for "15 сая"). `source` null = no check (the zod schema's shape pass).
 */
export function numbersGrounded(text: string, source: string | null): boolean {
  if (source === null) return true;
  const own = numberTokens(source, true);
  // Compared by value, not by digits: "1.5" and "15" share the digits "15" (Nov 2026 audit: a
  // "15 хувь" headline passed for a source saying "1.5 хувь").
  const bases = new Set(own.map((t) => t.base));
  // A number with its own scale word is compared by value only: "15 тэрбум" is not grounded by a
  // source that says "15 сая" (the bare-number match let a 1000× amount through, Nov 2026).
  return numberTokens(text, false).every(
    (n) => (!n.scaled && bases.has(n.base)) || own.some((t) => (n.scaled || t.scaled) && t.value >= 1000 && Math.abs(n.value - t.value) <= 0.05 * t.value),
  );
}

function clean(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .replace(/\s+/g, " ")
    .replace(/^["'«“„\s]+|["'»”\s]+$/g, "")
    .trim();
  if (!s || EMPTY.test(s) || s.length > max || isLatinText(s)) return null;
  // "хөгжлийн бэрхшээлтэй иргэд" → "Хөгжлийн …"; a Latin start ("e-Mongolia") stays as written.
  return /^[а-яёөү]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The plain headline, or null: too short or long, all capitals, the same as the original, or a
 * number the source never printed (`digits` null = shape checks only, as in the zod schema).
 */
export function cleanReaderTitle(raw: unknown, original: string, digits: string | null): string | null {
  const t = clean(raw, READER_TITLE_MAX)?.replace(/\.$/, "");
  if (!t || t.length < READER_TITLE_MIN) return null;
  if (t === t.toUpperCase() && /\p{L}{4}/u.test(t)) return null;
  if (norm(t) === norm(original)) return null;
  if (!numbersGrounded(t, digits)) return null;
  return t;
}

/** "Танд хамаатай юу?" fields, each checked alone; null when the text supports none of them. */
export function cleanImpact(raw: unknown, digits: string | null): ReaderImpact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const field = (k: keyof ReaderImpact) => {
    const v = clean(r[k], LIMITS[k]);
    return v && numbersGrounded(v, digits) ? v : null;
  };
  const impact: ReaderImpact = { who: field("who"), change: field("change"), when: field("when"), action: field("action") };
  // "Хэзээнээс" must name a time: a date, a month, a year or a relative day.
  if (impact.when && !/\d|сар|өнөөдр|маргааш|ирэх|энэ\s+(жил|долоо|сар)|он(ы|д)?(?!\p{L})/iu.test(impact.when)) impact.when = null;
  // "Хэнд" alone ("бүх иргэд") says nothing: keep it only with what changes or what to do.
  if (!impact.change && !impact.action) return null;
  return impact;
}

/**
 * The source a Tier-1 answer is checked against: headline, text and the publication date as an
 * Ulaanbaatar day (a story published at 01:00 Ulaanbaatar time is the previous day in UTC).
 */
export function groundingSource(title: string, text: string, publishedAt: Date | null): string {
  return `${title}\n${text}\n${publishedAt ? ubDateKey(publishedAt.getTime()) : ""}`;
}
