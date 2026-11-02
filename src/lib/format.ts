/** Mongolian formatting helpers (pure, usable on server and client). */

const MN_MONTHS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

/** "2026 оны 10-р сарын 20" */
export function formatDateMn(date: Date | string | null | undefined): string {
  if (!date) return "Огноо тодорхойгүй";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "Огноо тодорхойгүй";
  const ub = new Date(d.getTime() + 8 * 3_600_000); // Asia/Ulaanbaatar (UTC+8, no DST)
  return `${ub.getUTCFullYear()} оны ${MN_MONTHS[ub.getUTCMonth()]}-р сарын ${ub.getUTCDate()}`;
}

/** "5 минутын өмнө", "3 цагийн өмнө", "2 өдрийн өмнө" */
export function timeAgoMn(date: Date | string | null | undefined, now: number = Date.now()): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Math.max(0, now - d.getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Дөнгөж сая";
  if (min < 60) return `${min} минутын өмнө`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} цагийн өмнө`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} өдрийн өмнө`;
  return formatDateMn(d);
}

export function formatUsd(value: number, digits = 2): string {
  if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US").replace(/,/g, " ");
}

/** Splits a TL;DR (newline or sentence separated) into bullet sentences. */
/** A list marker the model put before a summary line ("- ", "• "): the page draws its own bullets. */
const BULLET = /^\s*[-–—•*·▪●]\s+/u;
export const stripBullet = (line: string): string => line.replace(BULLET, "").trim();

/**
 * Keys of the model's own JSON reply inside a summary: it mixed quote styles ('facts': [...]) and
 * the rest of the reply became tldr_summary (Nov 2026: #2366, #2369, #2431 showed
 * "…эхлүүлсэн.','facts': [...], 'impact': {...}}sain uu?{" on the article and in /digest).
 * The AI schema refuses such a reply now; rows stored before are cut here when shown.
 */
export const LEAKED_KEYS = /['"](?:facts|spin_detected|neutrality_score|entities|risk_score|risk_reason|importance_score|topic|reader_title|impact)['"]\s*:/;

/** The summary up to the first leaked JSON key, without the quote and comma that closed it. */
export function cutLeakedJson(text: string): string {
  const m = LEAKED_KEYS.exec(text);
  if (!m) return text;
  return text.slice(0, m.index).replace(/[\s'",{}[\]]+$/u, "").trim();
}

export function tldrSentences(tldr: string, max = 3): string[] {
  // Nov 2026: teasers read "- Шүүхийн ерөнхий зөвлөл…" because the model wrote its lines as a list.
  const byLine = cutLeakedJson(tldr).split(/\n+/).map(stripBullet).filter(Boolean);
  const parts = byLine.length >= 2 ? byLine : tldr.split(/(?<=[.!?])\s+(?=[А-ЯӨҮЁA-Z0-9"“«])/u).map((s) => s.trim()).filter(Boolean);
  return parts.slice(0, max);
}

export type RiskLevel = "low" | "medium" | "high";

export function riskLevel(score: number): RiskLevel {
  if (score >= 65) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  low: "Бага эрсдэл",
  medium: "Анхаарах",
  high: "Өндөр эрсдэл",
};

export const CATEGORY_LABEL: Record<string, string> = {
  portal: "Портал",
  ministry: "Яам",
  agency: "Агентлаг",
  local: "Орон нутаг",
};

/** "10-р сарын 20, 08:00 – 20:00" in Ulaanbaatar time (UTC+8, no DST). */
export function formatPeriodMn(start: Date | string, end: Date | string): string {
  const ub = (d: Date | string) => new Date(new Date(d).getTime() + 8 * 3_600_000);
  const day = (d: Date | string) => `${ub(d).getUTCMonth() + 1}-р сарын ${ub(d).getUTCDate()}`;
  const time = (d: Date | string) => `${String(ub(d).getUTCHours()).padStart(2, "0")}:${String(ub(d).getUTCMinutes()).padStart(2, "0")}`;
  return day(start) === day(end) ? `${day(start)}, ${time(start)} – ${time(end)}` : `${day(start)} ${time(start)} – ${day(end)} ${time(end)}`;
}

/** Large MNT amounts in words young readers know: 43.96 их наяд ₮, 2.1 тэрбум ₮. */
export function formatMntShort(value: number): string {
  const abs = Math.abs(value);
  // A real minus sign (U+2212): the hyphen in tabular figures is digit-wide and read as "- 1.03".
  const fmt = (n: number, unit: string) => `${value < 0 ? "−" : ""}${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 1 })} ${unit} ₮`;
  if (abs >= 1e12) return fmt(abs / 1e12, "их наяд");
  if (abs >= 1e9) return fmt(abs / 1e9, "тэрбум");
  if (abs >= 1e6) return fmt(abs / 1e6, "сая");
  return `${formatNumber(Math.round(value))} ₮`;
}

const AMOUNT_UNITS: Record<string, number> = { "их наяд": 1e12, тэрбум: 1e9, сая: 1e6, мянга: 1e3 };

/** Foreign-currency amounts are never compared with tögrög ones ("250 мянган ам.доллар"). */
const FOREIGN = /ам\.?\s*доллар|доллар|usd|\$|евро|eur|€|юань|cny|рубль|рубл/i;

/**
 * A number as written in Mongolian news: "4 500 000", "1,250.5", "12,5". With both separators the
 * last one is the decimal point; a single one is a thousands separator only when exactly three
 * digits follow it and no unit word does (with "тэрбум" etc. it is a decimal: "1,25 тэрбум").
 */
function parseAmountNumber(raw: string, hasUnit: boolean): number {
  const s = raw.replace(/\s/g, "").replace(/[.,]+$/, "");
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  if (commas && dots) {
    const decimal = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    return Number(s.replace(decimal === "," ? /\./g : /,/g, "").replace(",", "."));
  }
  const sep = commas ? "," : dots ? "." : "";
  if (!sep) return Number(s);
  if (commas + dots > 1) return Number(s.split(sep).join("")); // 1.250.000
  const tail = s.length - s.indexOf(sep) - 1;
  // A comma before exactly three digits groups thousands even before a unit word ("2,500 сая" =
  // 2.5 тэрбум, not 2.5 сая); "12,5 тэрбум" and "1.250 тэрбум" read as decimals.
  return Number(tail === 3 && (!hasUnit || sep === ",") ? s.replace(sep, "") : s.replace(sep, "."));
}

/** "12,5 тэрбум ₮" → 12 500 000 000 (best effort, null when unreadable or not in ₮). Mirrors amountToNumber in the scraper. */
export function amountValue(amount: string): number | null {
  if (FOREIGN.test(amount)) return null;
  const m = amount.match(/(\d[\d\s,.]*)\s*(их наяд|тэрбум|сая|мянга)?/i);
  if (!m) return null;
  const unitWord = m[2]?.toLowerCase();
  const n = parseAmountNumber(m[1], Boolean(unitWord));
  return Number.isFinite(n) ? n * (AMOUNT_UNITS[unitWord ?? ""] ?? 1) : null;
}

/**
 * The biggest of the extracted ₮ amounts (the chip on a story row), or undefined when none reads
 * as ₮: the first entry used to be the fallback, so "5 сая доллар" got the ₮ chip.
 */
export function largestAmount(amounts: string[]): string | undefined {
  let best: { text: string; value: number } | undefined;
  for (const text of amounts) {
    const value = amountValue(text);
    if (value !== null && (!best || value > best.value)) best = { text, value };
  }
  return best?.text;
}
