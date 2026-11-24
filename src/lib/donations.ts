/**
 * Received donations ("Хандив"), entered by hand in /admin and listed on /transparency. Only what
 * is published is stored: the donor's name as shown (full, initials or none), never the name as it
 * came from the bank when the donor is shown by initials or anonymously. Plain text, no HTML.
 */

export const NAME_MODES = ["initials", "full", "anonymous"] as const;
export type NameMode = (typeof NAME_MODES)[number];

export const NAME_MODE_LABEL: Record<NameMode, string> = {
  initials: "Товчилж (Б.Б.)",
  full: "Бүтэн нэрээр",
  anonymous: "Нэргүй",
};

export const ANONYMOUS_LABEL = "Нэрээ нууцалсан дэмжигч";
export const DONOR_MAX = 80;
export const NOTE_MAX = 140;
/** Larger than any plausible single transfer; a typo with three extra zeros is refused. */
export const AMOUNT_MAX = 1_000_000_000;

export interface DonationRow {
  id: number;
  /** Ulaanbaatar day the money arrived, "YYYY-MM-DD". */
  receivedOn: string;
  amountMnt: number;
  /** As published; null = anonymous. */
  donor: string | null;
  note: string | null;
}

export interface DonationsSummary {
  rows: DonationRow[];
  /** All-time count and sum (rows may be capped). */
  count: number;
  totalMnt: number;
  /** Ulaanbaatar calendar month of the newest data read. */
  monthMnt: number;
}

/** One line of text: no control characters, single spaces, at most `max` characters. */
export function cleanLine(raw: unknown, max: number): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const capital = (w: string) => w.charAt(0).toLocaleUpperCase("mn");

/**
 * "Б.Батболд" → "Б.Б.", "БАТБОЛД БААТАР" → "Б.Б.", "Номин" → "Н.": the first letter of the first two
 * name parts (split on spaces, dots and hyphens). Empty when there is no letter at all.
 */
export function initials(name: string): string {
  const parts = name.split(/[\s.\-–]+/).filter((p) => /\p{L}/u.test(p));
  return parts
    .slice(0, 2)
    .map((p) => `${capital(p.replace(/^[^\p{L}]+/u, ""))}.`)
    .join("");
}

/** What the public list shows for this donor; null = anonymous (also when no name was typed). */
export function publicDonor(name: string, mode: NameMode): string | null {
  const clean = cleanLine(name, DONOR_MAX);
  if (mode === "anonymous" || !clean) return null;
  if (mode === "full") return clean;
  return initials(clean) || null;
}

/**
 * "45000", "45 000", "45,000", "45.000₮" → 45000; a bank statement's "50,000.00" → 50000 (the
 * two-digit tail is cents and is dropped: it read 5 000 000 before, Nov 2026 audit B-3). Negatives
 * and other text → null.
 */
export function parseAmount(raw: unknown): number | null {
  const s = String(raw ?? "")
    .trim()
    .replace(/[.,]\d{1,2}\s*(₮|төг(рөг)?)?$/i, "$1")
    .replace(/[\s,.'₮]/g, "")
    .replace(/төг(рөг)?$/i, "");
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= AMOUNT_MAX ? n : null;
}

/** A real calendar day between 2024-01-01 and `today` (Ulaanbaatar "YYYY-MM-DD"). */
export function validDay(raw: unknown, today: string): string | null {
  const s = String(raw ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s >= "2024-01-01" && s <= today ? s : null;
}
