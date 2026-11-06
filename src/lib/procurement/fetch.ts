import { politeFetch, readJsonLimited } from "@/lib/scraper/http";

import { mergeByKey, parseTenders, type Tender, TENDER_GROUPS, tenderQuery } from "./tenders";

/**
 * Network half of the tender sync: Шилэн данс's open-data call (the portal's own front end sends
 * the same request; robots.txt allows everything). One request per report group and month; the
 * budget-organisation group answers ~4 MB in ~20 s, so the timeout is generous and the 8 s
 * per-host delay of politeFetch applies between calls.
 */
export const OPEN_DATA_URL = "https://back.shilendans.gov.mn/proxy/gap-report-service/reportFormDatas/openData1";

/** The last `count` report months up to this one, newest first, crossing a year boundary. */
export function recentMonths(now: Date, count: number): { year: number; month: number }[] {
  const ub = new Date(now.getTime() + 8 * 3_600_000);
  const out: { year: number; month: number }[] = [];
  let [year, month] = [ub.getUTCFullYear(), ub.getUTCMonth() + 1];
  for (let i = 0; i < count; i++) {
    out.push({ year, month });
    month--;
    if (month === 0) [year, month] = [year - 1, 12];
  }
  return out;
}

export interface TenderFetchResult {
  tenders: Tender[];
  /** "6/2026-10: 425" per call; failed calls say why. */
  calls: string[];
  failed: number;
}

export async function fetchTenders(now = new Date(), months = 3): Promise<TenderFetchResult> {
  const today = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  const calls: string[] = [];
  const byYear = new Map<number, unknown[]>();
  let failed = 0;
  // Oldest month first: mergeLot lets the later-processed row win, and within one year that must be
  // the NEWER filing (a corrected contract or winner used to lose to the older month's row).
  for (const { year, month } of [...recentMonths(now, months)].reverse()) {
    for (const group of TENDER_GROUPS) {
      const label = `${group}/${year}-${String(month).padStart(2, "0")}`;
      try {
        const res = await politeFetch(OPEN_DATA_URL, {
          method: "POST",
          timeoutMs: 180_000,
          headers: { "content-type": "application/json", accept: "application/json", address: "warn" },
          body: JSON.stringify(tenderQuery(group, year, month)),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await readJsonLimited(res, 40 * 1024 * 1024);
        byYear.set(year, [...(byYear.get(year) ?? []), json]);
        calls.push(`${label}: ${Array.isArray(json) ? json.length : 0} rows`);
      } catch (err) {
        failed++;
        calls.push(`${label}: failed (${err instanceof Error ? err.message.slice(0, 80) : "error"})`);
      }
    }
  }
  // Older year first, so the newer filing fills what the older one left empty.
  const tenders = mergeByKey([...byYear].sort(([a], [b]) => a - b).flatMap(([year, answers]) => parseTenders(answers, year, today)));
  return { tenders, calls, failed };
}
