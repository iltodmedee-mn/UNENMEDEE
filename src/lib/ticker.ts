/**
 * Pure helpers for the home page's rotating status line (status-ticker.tsx). No React here, so
 * the maths is unit-tested and shared with the server query that counts today's news.
 */

const HOUR = 3_600_000;

/**
 * The pipeline's four crons (autonomous-news-pipeline.yml): ":17 and :32" on even UTC hours,
 * ":02 and :47" on odd ones, an attempt every 15–45 minutes off the congested minute 0. The
 * ticker used to know only :17 / :47 and said "1 ц 27 мин" when the next attempt was 12 minutes off.
 */
export const PIPELINE_MINUTES_EVEN = [17, 32] as const;
export const PIPELINE_MINUTES_ODD = [2, 47] as const;

/** The next scheduled pipeline attempt. GitHub may still skip one under load: the earliest time. */
export function nextRunAt(now: number): number {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const hour = new Date(start.getTime() + i * HOUR);
    const minutes = hour.getUTCHours() % 2 === 0 ? PIPELINE_MINUTES_EVEN : PIPELINE_MINUTES_ODD;
    for (const m of minutes) {
      const t = hour.getTime() + m * 60_000;
      if (t > now) return t;
    }
  }
  return start.getTime() + 3 * HOUR;
}

/** "1 ц 35 мин", "40 мин" until the next pipeline run. */
export function nextRunLabel(now: number): string {
  const min = Math.max(1, Math.ceil((nextRunAt(now) - now) / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} ц ${m} мин` : `${m} мин`;
}

/** Midnight in Ulaanbaatar (UTC+8, no DST) at or before `now`, as a UTC timestamp. */
export function ubMidnight(now: number): number {
  const ub = new Date(now + 8 * HOUR);
  return Date.UTC(ub.getUTCFullYear(), ub.getUTCMonth(), ub.getUTCDate()) - 8 * HOUR;
}
