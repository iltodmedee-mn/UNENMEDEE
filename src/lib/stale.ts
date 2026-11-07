import { ubDateKey } from "@/lib/archive";

/** No new feed story for this long: the header and the ticker stop saying "live" and say how long instead. */
export const FEED_QUIET_HOURS = 6;

/** Whether data stored at `at` is older than `days` at `now`. Invalid dates count as stale. */
export function staleAfter(at: Date | string, days: number, now: Date = new Date()): boolean {
  const t = new Date(at).getTime();
  return !Number.isFinite(t) || now.getTime() - t > days * 86_400_000;
}

/** Whole hours since `at` (0 when in the future or unknown). */
export function hoursSince(at: Date | string | null | undefined, now: Date = new Date()): number {
  if (!at) return 0;
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 3_600_000)) : 0;
}

/** Whether the Ulaanbaatar day (UTC+8) at `ms` is a Saturday or Sunday: a quiet feed is then expected. */
export function isUbWeekend(ms: number): boolean {
  const day = new Date(`${ubDateKey(ms)}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}
