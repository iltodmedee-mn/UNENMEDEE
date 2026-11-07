/**
 * Pure date heuristics shared by the DB sink and the backfill script (no jsdom here).
 */

/**
 * Newest year the text mentions, up to next year in Ulaanbaatar, or null. A later year is a target
 * ("2030 он хүртэл", "Алсын хараа 2050"), not the page's time: counted, a 2019 programme page
 * looked current and reached the feed as today's news.
 */
export function newestYearMentioned(text: string, now = new Date()): number | null {
  const last = ubYear(now) + 1;
  let max: number | null = null;
  for (const m of text.matchAll(/(?<!\d)(20\d{2})(?!\d)/g)) {
    const y = +m[1];
    if (y <= last && (max === null || y > max)) max = y;
  }
  return max;
}

/** True when the text contains a full day-level date ("2021-05-05", "2021 оны 5 сарын 5"). */
function hasFullDate(text: string): boolean {
  return /20\d{2}[./-]\d{1,2}[./-]\d{1,2}|20\d{2}\s*оны\s*\d{1,2}\s*(?:-р|дугаар|дүгээр)?\s*сарын\s*\d{1,2}/.test(text);
}

/**
 * True for an undated page that is an old post picked up from a site's archive: its text gives a
 * full date and names no year after the one before last. A current story that only mentions a
 * past year in passing ("2011 онд") has no full date and is not judged.
 */
export function looksOld(text: string, now = new Date()): boolean {
  const year = newestYearMentioned(text, now);
  return year !== null && year < ubYear(now) - 1 && hasFullDate(text);
}

/** Dated items older than this are stored but never published or analysed on a regular run. */
export const MAX_AGE_DAYS = 60;

/**
 * Whether a scraped item goes out as news. A dated item is news only inside the retention window
 * (a crawler reaching an archive page must not surface 2009 resolutions as today's); an undated
 * one is news unless its text proves it old. `null` = the column's default (published).
 */
export function publishDecision(publishedAt: Date | null, text: string, now = new Date(), maxAgeDays = MAX_AGE_DAYS): boolean | null {
  if (publishedAt) return publishedAt.getTime() < now.getTime() - maxAgeDays * 86_400_000 ? false : null;
  return looksOld(text, now) || isTimelessPage(text, now) ? false : null;
}

/**
 * An undated text that is not news: it names no year at all (a department page, instructions, a
 * biography, "nine wonders of the aimag") or its newest year is before last year (a 2020–2024
 * programme). Government news nearly always carries a current date or year; pages like these only
 * reached the crawler through section links and were filling the home page as "today's" stories.
 */
export function isTimelessPage(text: string, now = new Date()): boolean {
  const year = newestYearMentioned(text, now);
  return year === null || year < ubYear(now) - 1;
}

/** A day-level date (no time part): what a stray or copied date stamp looks like. */
export function isDayLevel(d: Date): boolean {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
}

/** The calendar year in Ulaanbaatar (UTC+8): on 1 January 00:00–08:00 the UTC year is still last year's. */
export function ubYear(now: Date): number {
  return new Date(now.getTime() + 8 * 3_600_000).getUTCFullYear();
}

/**
 * A publication date that cannot be right yet: a timed one more than an hour ahead, or a day-level
 * one (stored as UTC midnight of the Ulaanbaatar day) after today in Ulaanbaatar. The old 24-hour
 * tolerance let "tomorrow" (an event date) through, and that story sat on top of the feed.
 */
export function isFutureDate(d: Date, now = new Date()): boolean {
  if (isDayLevel(d)) {
    const ubToday = new Date(now.getTime() + 8 * 3_600_000);
    return d.getTime() > Date.UTC(ubToday.getUTCFullYear(), ubToday.getUTCMonth(), ubToday.getUTCDate());
  }
  return d.getTime() > now.getTime() + 3_600_000;
}

/**
 * A machine-readable date (meta tag, JSON-LD, <time datetime>). A value without a zone
 * ("2026-10-23 17:41:12", "2026-10-23T17:41") is Ulaanbaatar wall-clock time (UTC+8): read as
 * UTC it would be 8 hours late and the feed would sort it under the next morning's news.
 */
export function parseDateValue(value: string | null | undefined): Date | null {
  if (!value) return null;
  let v = value.trim();
  const local = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/);
  if (local) v = `${local[1]}T${local[2]}+08:00`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 || isFutureDate(d)) return null;
  return d;
}
