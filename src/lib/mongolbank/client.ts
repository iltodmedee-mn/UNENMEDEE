import { z } from "zod";

import { politeFetch } from "@/lib/scraper/http";

/**
 * Bank of Mongolia (mongolbank.mn) homepage indicators, from the JSON endpoints its own site
 * calls: POST /mn/<name>/data?startDate&endDate with an empty JSON body. Numbers arrive as
 * strings with thousands separators. robots.txt: Allow /.
 */
const BASE = "https://www.mongolbank.mn/mn";

/** "3,597.30" → 3597.3; empty or invalid → null. */
export function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return String(v).trim() !== "" && Number.isFinite(n) ? n : null;
}

const Envelope = z.object({ success: z.boolean().optional(), data: z.array(z.record(z.string(), z.unknown())).catch([]) });
type Row = Record<string, unknown>;

export interface Point {
  label: string;
  value: number;
}

export interface MacroSnapshot {
  policyRate: { value: number; since: string; history: Point[] } | null;
  inflation: { month: string; ub: number | null; core: number | null; national: number | null; history: Point[] } | null;
  fx: { date: string; rates: { code: string; rate: number }[]; usdHistory: Point[] } | null;
  gold: { date: string; buy: number } | null;
  reserves: { month: string; value: number; yoy: number | null; history: Point[] } | null;
}

const FX_CODES = ["USD", "CNY", "EUR", "RUB", "KRW", "JPY", "GBP"];

export function buildSnapshot(raw: { policy: Row[]; inflation: Row[]; fx: Row[]; gold: Row[]; reserves: Row[] }): MacroSnapshot {
  const byKey = (rows: Row[], key: string) => [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  const policy = byKey(raw.policy, "EFFECTIVE_FROM").filter((r) => parseNumber(r.POLICY_RATE) !== null);
  const infl = byKey(raw.inflation, "STAT_DATE").filter((r) => parseNumber(r.STATE_YEARLY) !== null || parseNumber(r.UB_YEARLY) !== null);
  const fx = byKey(raw.fx, "RATE_DATE").filter((r) => parseNumber(r.USD) !== null);
  const gold = byKey(raw.gold, "RATE_DATE").filter((r) => parseNumber(r.GOLD_BUY) !== null);
  const res = byKey(raw.reserves, "STAT_DATE").filter((r) => parseNumber(r.GROSS_RESERVES) !== null);
  const lastP = policy.at(-1);
  const lastI = infl.at(-1);
  const lastF = fx.at(-1);
  const lastG = gold.at(-1);
  const lastR = res.at(-1);
  return {
    policyRate: lastP
      ? { value: parseNumber(lastP.POLICY_RATE)!, since: String(lastP.EFFECTIVE_FROM), history: policy.map((r) => ({ label: String(r.EFFECTIVE_FROM), value: parseNumber(r.POLICY_RATE)! })) }
      : null,
    inflation: lastI
      ? {
          month: String(lastI.STAT_DATE),
          ub: parseNumber(lastI.UB_YEARLY),
          core: parseNumber(lastI.CORE_YEARLY),
          national: parseNumber(lastI.STATE_YEARLY),
          history: infl.map((r) => ({ label: String(r.STAT_DATE), value: parseNumber(r.STATE_YEARLY) ?? parseNumber(r.UB_YEARLY)! })),
        }
      : null,
    fx: lastF
      ? {
          date: String(lastF.RATE_DATE),
          rates: FX_CODES.map((code) => ({ code, rate: parseNumber(lastF[code]) })).filter((r): r is { code: string; rate: number } => r.rate !== null),
          usdHistory: fx.map((r) => ({ label: String(r.RATE_DATE), value: parseNumber(r.USD)! })),
        }
      : null,
    gold: lastG ? { date: String(lastG.RATE_DATE), buy: parseNumber(lastG.GOLD_BUY)! } : null,
    reserves: lastR
      ? { month: String(lastR.STAT_DATE).slice(0, 7), value: parseNumber(lastR.GROSS_RESERVES)!, yoy: parseNumber(lastR.YOY), history: res.map((r) => ({ label: String(r.STAT_DATE).slice(0, 7), value: parseNumber(r.GROSS_RESERVES)! })) }
      : null,
  };
}

/**
 * One more try after a 5xx (politeFetch waits the host's 8 s first): Mongolbank answered a single
 * 502 on Nov 5 2026 and the whole snapshot stayed half a day old.
 */
export async function onceMoreOn5xx(request: () => Promise<Response>): Promise<Response> {
  const res = await request();
  if (res.status < 500) return res;
  await res.body?.cancel().catch(() => {});
  return request();
}

async function post(name: string, start: string, end: string): Promise<Row[]> {
  const res = await onceMoreOn5xx(() =>
    politeFetch(`${BASE}/${name}/data?startDate=${start}&endDate=${end}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: "{}",
    }),
  );
  if (!res.ok) throw new Error(`mongolbank ${name} returned HTTP ${res.status}`);
  return Envelope.parse(await res.json()).data;
}

/** Ulaanbaatar date as YYYY-MM-DD, `daysBack` days ago. */
function ubDay(daysBack: number): string {
  return new Date(Date.now() + 8 * 3_600_000 - daysBack * 86_400_000).toISOString().slice(0, 10);
}

export async function fetchMacroSnapshot(): Promise<MacroSnapshot> {
  const today = ubDay(0);
  const twoYears = ubDay(730);
  // Sequential on purpose: one host, politeFetch keeps 8 s between requests.
  const policy = await post("policy-interest-rate", ubDay(365 * 4), today);
  const inflation = await post("inflation", twoYears.slice(0, 7), today.slice(0, 7));
  const fx = await post("currency-rates", ubDay(180), today);
  const gold = await post("gold-and-silver-price", ubDay(30), today);
  const reserves = await post("international-reserves", twoYears, today);
  return buildSnapshot({ policy, inflation, fx, gold, reserves });
}
