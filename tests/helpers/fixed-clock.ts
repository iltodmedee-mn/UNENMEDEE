/**
 * Pins `Date` for a test file whose fixtures are real 2026 pages and prices. Without it the suite
 * read the real clock and broke on its own: the Gemini voice price changes on 2027-01-01, "this
 * year" dates are in the future every January–March, and the extractor drops printed dates a year
 * after the fixture's date (audit Nov 2026: 7 failures on 2027-01-05, 2 every day from mid-2027).
 * Only `Date` is mocked; timers stay real.
 */
import { mock } from "node:test";

export const FIXED_NOW = new Date("2026-11-01T04:00:00Z");

export function pinClock(now: Date = FIXED_NOW): void {
  mock.timers.enable({ apis: ["Date"], now });
}
