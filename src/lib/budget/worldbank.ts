import { z } from "zod";

import { politeFetch } from "@/lib/scraper/http";

/** World Bank WDI: tax revenue, % of GDP, Mongolia (comparison series for /budget). */
export const WB_TAX_URL = "https://api.worldbank.org/v2/country/MNG/indicator/GC.TAX.TOTL.GD.ZS?format=json&per_page=100&date=1990:2030";

const Response = z.tuple([z.object({ lastupdated: z.string().nullish() }).passthrough(), z.array(z.object({ date: z.string(), value: z.number().nullable() })).nullable()]);

export interface TaxShareSnapshot {
  lastUpdated: string | null;
  series: { label: string; value: number }[];
}

export function parseWorldBank(json: unknown): TaxShareSnapshot {
  const [meta, rows] = Response.parse(json);
  return {
    lastUpdated: meta.lastupdated ?? null,
    series: (rows ?? [])
      .filter((r): r is { date: string; value: number } => r.value !== null)
      .map((r) => ({ label: r.date, value: Math.round(r.value * 10) / 10 }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export async function fetchTaxShare(): Promise<TaxShareSnapshot> {
  const res = await politeFetch(WB_TAX_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`World Bank API returned HTTP ${res.status}`);
  const snap = parseWorldBank(await res.json());
  // An empty series would replace a good snapshot with an empty chart: keep the old one.
  if (snap.series.length === 0) throw new Error("World Bank API: no values in the answer");
  return snap;
}
