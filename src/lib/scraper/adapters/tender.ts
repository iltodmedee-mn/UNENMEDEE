import type { ScrapeMeta } from "@/lib/types";

/**
 * Procurement field extraction for tender.gov.mn pages and for any article that
 * mentions procurement (ministries often publish tender results as news).
 *
 * NOTE: tender.gov.mn sits behind a Cloudflare browser challenge, so plain HTTP
 * requests from datacenter IPs get 403. The generic crawler still tries it and
 * records the failure; these extractors also run on every other source's text.
 */

// Starts only where a number starts (lookbehind): tried from inside a long digit run, the
// unanchored pattern backtracked quadratically on text with no currency word after it. "төг" is
// the abbreviation only as a whole word ("төг." or "төг"), not the start of "төгсөгч", "төгс".
const AMOUNT =
  /(?<![\d.,])(\d{1,3}(?:[ ,. ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(их наяд|тэрбум|сая|мянга(?:н)?)?\s*(?:төгрөг|₮|төг(?:\.|(?!\p{L})))/giu;

/** Finds MNT amounts and returns them as human-readable strings ("4.5 тэрбум ₮"). */
export function extractMntAmounts(text: string, max = 10): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(AMOUNT)) {
    const num = m[1].replace(/ /g, " ");
    const unit = m[2] ? ` ${m[2].toLowerCase()}` : "";
    // Skip tiny bare numbers ("5 төгрөг") that are almost always noise.
    const digits = num.replace(/[^\d]/g, "");
    if (!unit && digits.length < 6) continue;
    found.add(`${num}${unit} ₮`);
    if (found.size >= max) break;
  }
  return [...found];
}

/** Converts an extracted amount string to a number of MNT (best effort). */
export function amountToNumber(amount: string): number | null {
  const m = amount.match(/([\d ,.]+)\s*(их наяд|тэрбум|сая|мянга)?/i);
  if (!m) return null;
  let raw = m[1].trim();
  const multiplier = { "их наяд": 1e12, тэрбум: 1e9, сая: 1e6, мянга: 1e3 }[m[2]?.toLowerCase() ?? ""] ?? 1;
  if (multiplier > 1) {
    // "2,500 сая" is 2 500 million (comma + 3 digits = thousands); "12,5 тэрбум" is 12.5.
    raw = raw.replace(/\s/g, "").replace(/,(?=\d{3}(?!\d))/g, "").replace(",", ".");
  } else {
    raw = raw.replace(/[ ,.](?=\d{3}\b)/g, "").replace(",", ".");
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n * multiplier : null;
}

const BUDGET_LABEL = /Төсөвт\s+өртөг\s*[:：-]?\s*([^\n]{3,80})/i;
const PROCURING = /(?:Захиалагч|Худалдан\s+авах\s+байгууллага|Захиалагч\s+байгууллага)\s*[:：-]\s*([^\n]{3,120})/i;
/**
 * e.g. "ЗТЯ/202601234", "БХБЯ/202503012", "UB-2026/045".
 * Lookarounds instead of \b: JavaScript's \b only understands ASCII letters, not Cyrillic.
 */
const TENDER_CODE = /(?<![\p{L}\d])([А-ЯӨҮA-Z]{2,10}\s?\/\s?20\d{2}\d{2,8}|[A-Z]{2,6}-20\d{2}\/\d{2,5})(?![\p{L}\d])/u;

export function extractTenderMeta(text: string): ScrapeMeta {
  const meta: ScrapeMeta = {};
  const budget = text.match(BUDGET_LABEL);
  if (budget) meta.budget_mnt = extractMntAmounts(budget[1])[0] ?? budget[1].trim();
  const entity = text.match(PROCURING);
  if (entity) meta.procuring_entity = entity[1].trim().replace(/[.;,]$/, "");
  const code = text.match(TENDER_CODE);
  if (code) meta.tender_code = code[1].replace(/\s/g, "");
  return meta;
}

export function hasTenderSignals(text: string): boolean {
  return /тендер|худалдан\s+авах|Төсөвт\s+өртөг|гэрээ\s+байгуул/i.test(text);
}
