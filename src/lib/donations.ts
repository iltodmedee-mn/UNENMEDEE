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
/**
 * Above this a donation is accepted only under the donor's full name (Nov 2026, the owner's rule):
 * a large anonymous gift could come from a politician, a party or a tender bidder, and the site
 * promises no hidden ties. Smaller gifts may stay anonymous.
 */
export const ANON_MAX_MNT = 500_000;

/** Whether this amount may be recorded under this name mode (see `ANON_MAX_MNT`). */
export function nameModeAllowed(amountMnt: number, mode: NameMode): boolean {
  return amountMnt <= ANON_MAX_MNT || mode === "full";
}

/** What a hidden part of a note reads as. */
export const MASK = "•••";

/**
 * A bank memo with what must not be published taken out: links and web addresses, e-mail
 * addresses, account numbers (MN + digits) and any run of 7+ digits (phone numbers, accounts,
 * register numbers), spaces or dashes between the digits included. The owner still reads the note
 * before it is shown (`note_public`); this keeps a slip from reaching the page.
 */
export function maskNote(note: string): string {
  return note
    .replace(/\b(?:https?:\/\/|www\.)\S+/giu, MASK)
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu, MASK)
    .replace(/\b[\p{L}\p{N}-]+\.(?:mn|com|net|org|io|me|info|biz|ru|cn)\b\S*/giu, MASK)
    .replace(/\bMN\s?\d[\d\s-]{5,}\d/giu, MASK)
    .replace(/\d(?:[\s-]?\d){6,}/gu, MASK);
}

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
  /** Whether the owner has cleared the note for the public page. */
  notePublic: boolean;
}

/** One day of the current month: donations under a name and anonymous ones. */
export interface DonationDay {
  day: number;
  named: number;
  anonymous: number;
}

/** A finished month's totals ("2026-10"). */
export interface DonationMonth {
  month: string;
  count: number;
  totalMnt: number;
}

export interface DonationsSummary {
  rows: DonationRow[];
  /** All-time count and sum (rows may be capped). */
  count: number;
  totalMnt: number;
  /** Ulaanbaatar calendar month of the newest data read. */
  monthMnt: number;
  monthCount: number;
  /** "2026-11": the month `days` belongs to. */
  month: string;
  /** Days of `month` that had donations. */
  days: DonationDay[];
  /** The two months before `month`, newest first (only months with donations). */
  months: DonationMonth[];
  /** The first donation ever received (the "№1" mark); null when there is none. */
  firstId: number | null;
}

/** Days in a "YYYY-MM" month. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
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
