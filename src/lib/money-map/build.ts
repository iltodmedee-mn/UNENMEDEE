/**
 * The «Миний ₮» map's data: this year's awarded form-1831 tenders placed on aimags and, where the
 * buyer's name says so, on a sum or district (regions.ts). Worked out at each tenders sync and stored
 * as one `indicator_snapshots` row (MONEY_MAP_KEY), so the page reads one small row (the Supabase
 * egress lesson of Nov 2026). Amounts flagged as a likely unit error are left out of the sums.
 */
import { and, desc, eq, gte } from "drizzle-orm";

import type { DB } from "@/db";
import { indicatorSnapshots, tenders } from "@/db/schema";
import { tenderAwarded, tenderFirstOfSame } from "@/lib/procurement/tender-sql";

import { type Aimag, aimagOf, centreOf, placeIn } from "./regions";

export const MONEY_MAP_KEY = "money_map";
/** Lots listed per map point. */
export const POINT_ITEMS = 5;

export interface MoneyItem {
  title: string;
  org: string;
  winner: string | null;
  mnt: number;
  date: string | null;
}
export interface MoneyPoint {
  name: string;
  aimag: Aimag;
  lon: number;
  lat: number;
  /** "centre" when only the aimag is known */
  kind: "centre" | "district" | "sum";
  mnt: number;
  count: number;
  items: MoneyItem[];
}
export interface MoneyMap {
  year: number;
  builtAt: string;
  aimags: { aimag: Aimag; mnt: number; count: number }[];
  points: MoneyPoint[];
  /** ministries' and agencies' lots with no place in their text */
  national: { mnt: number; count: number };
}

interface Lot {
  title: string;
  orgName: string;
  governor: string | null;
  winner: string | null;
  contractMnt: number | null;
  resultDate: string | null;
}

/** Pure: lots → map. Biggest amounts first everywhere. */
export function buildMoneyMap(lots: Lot[], year: number, now: Date): MoneyMap {
  const aimags = new Map<Aimag, { mnt: number; count: number }>();
  const points = new Map<string, MoneyPoint>();
  const national = { mnt: 0, count: 0 };
  for (const l of lots) {
    const mnt = l.contractMnt ?? 0;
    if (mnt <= 0) continue;
    const aimag = aimagOf({ governor: l.governor, orgName: l.orgName });
    if (!aimag) {
      national.mnt += mnt;
      national.count++;
      continue;
    }
    const a = aimags.get(aimag) ?? { mnt: 0, count: 0 };
    aimags.set(aimag, { mnt: a.mnt + mnt, count: a.count + 1 });
    const place = placeIn(`${l.orgName} ${l.title}`, aimag) ?? centreOf(aimag);
    const key = `${aimag}|${place.name}`;
    const p = points.get(key) ?? { ...place, mnt: 0, count: 0, items: [] };
    p.mnt += mnt;
    p.count++;
    p.items.push({ title: l.title.slice(0, 160), org: l.orgName.slice(0, 120), winner: l.winner?.slice(0, 120) ?? null, mnt, date: l.resultDate });
    points.set(key, p);
  }
  for (const p of points.values()) p.items = p.items.sort((x, y) => y.mnt - x.mnt).slice(0, POINT_ITEMS);
  return {
    year,
    builtAt: now.toISOString(),
    aimags: [...aimags].map(([aimag, v]) => ({ aimag, ...v })).sort((x, y) => y.mnt - x.mnt),
    points: [...points.values()].sort((x, y) => y.mnt - x.mnt),
    national,
  };
}

/** Computes this Ulaanbaatar year's map and stores it; returns how many lots were placed on it. */
export async function storeMoneyMap(db: DB, now = new Date()): Promise<number> {
  const year = new Date(now.getTime() + 8 * 3_600_000).getUTCFullYear();
  const lots = await db
    .select({ title: tenders.title, orgName: tenders.orgName, governor: tenders.governor, winner: tenders.winner, contractMnt: tenders.contractMnt, resultDate: tenders.resultDate })
    .from(tenders)
    .where(and(tenderAwarded, tenderFirstOfSame, eq(tenders.unitSuspect, false), gte(tenders.resultDate, `${year}-01-01`)))
    .orderBy(desc(tenders.contractMnt));
  const data = buildMoneyMap(lots as Lot[], year, now);
  const row = { key: MONEY_MAP_KEY, data, asOf: now.toISOString().slice(0, 10), updatedAt: now };
  await db.insert(indicatorSnapshots).values(row).onConflictDoUpdate({ target: indicatorSnapshots.key, set: row });
  return data.aimags.reduce((s, a) => s + a.count, 0);
}

