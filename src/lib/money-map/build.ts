/**
 * The «Миний ₮» map's data: this year's awarded form-1831 tenders placed on aimags and, where the
 * buyer's name says so, on a sum or district (regions.ts), each with what it buys (categories.ts).
 * Worked out at each tenders sync and stored as two `indicator_snapshots` rows, so the page reads one
 * small row (the Supabase egress lesson of Nov 2026):
 *   MONEY_MAP_KEY        aimags and points with totals (~20 KB): the page and the map
 *   MONEY_ITEMS_KEY      each point's biggest lots: fetched once by the map from a CDN-cached route
 * Amounts flagged as a likely unit error are left out of the sums.
 */
import { and, desc, eq, gte } from "drizzle-orm";

import type { DB } from "@/db";
import { indicatorSnapshots, tenders } from "@/db/schema";
import { tenderAwarded, tenderFirstOfSame } from "@/lib/procurement/tender-sql";

import { type Category, categoryOf } from "./categories";
import { type Aimag, aimagOf, centreOf, placeIn } from "./regions";

export const MONEY_MAP_KEY = "money_map";
export const MONEY_ITEMS_KEY = "money_map_items";
/** Lots kept per map point. */
export const POINT_ITEMS = 5;

/** One lot, short keys (this is the bulk of the items row): title, buyer, winner, ₮, result date, category. */
export interface MoneyItem {
  t: string;
  o: string;
  w: string | null;
  m: number;
  d: string | null;
  c: Category;
}
export interface MoneyPoint {
  /** `${aimag}|${name}`, the items row's key */
  id: string;
  name: string;
  aimag: Aimag;
  lon: number;
  lat: number;
  /** "centre" when only the aimag is known */
  kind: "centre" | "district" | "sum";
  mnt: number;
  count: number;
  /** what most of the money bought */
  cat: Category;
}
export interface MoneyAimag {
  aimag: Aimag;
  lon: number;
  lat: number;
  mnt: number;
  count: number;
  cat: Category;
}
export interface MoneyMap {
  year: number;
  builtAt: string;
  aimags: MoneyAimag[];
  points: MoneyPoint[];
  /** ministries' and agencies' lots with no place in their text */
  national: { mnt: number; count: number };
}
export type MoneyItems = Record<string, MoneyItem[]>;

interface Lot {
  title: string;
  orgName: string;
  governor: string | null;
  winner: string | null;
  contractMnt: number | null;
  resultDate: string | null;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The category with the most money in a tally. */
function top(tally: Map<Category, number>): Category {
  let best: Category = "other";
  let max = -1;
  for (const [c, m] of tally) if (m > max) [best, max] = [c, m];
  return best;
}

/** Pure: lots → map and items. Biggest amounts first everywhere. */
export function buildMoneyMap(lots: Lot[], year: number, now: Date): { map: MoneyMap; items: MoneyItems } {
  const aimags = new Map<Aimag, { mnt: number; count: number; cats: Map<Category, number> }>();
  const points = new Map<string, { p: Omit<MoneyPoint, "cat">; cats: Map<Category, number>; items: MoneyItem[] }>();
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
    const cat = categoryOf(l.title);
    const a = aimags.get(aimag) ?? { mnt: 0, count: 0, cats: new Map<Category, number>() };
    a.mnt += mnt;
    a.count++;
    a.cats.set(cat, (a.cats.get(cat) ?? 0) + mnt);
    aimags.set(aimag, a);
    const place = placeIn(`${l.orgName} ${l.title}`, aimag) ?? centreOf(aimag);
    const id = `${aimag}|${place.name}`;
    const e = points.get(id) ?? { p: { id, name: place.name, aimag, lon: place.lon, lat: place.lat, kind: place.kind, mnt: 0, count: 0 }, cats: new Map<Category, number>(), items: [] as MoneyItem[] };
    e.p.mnt += mnt;
    e.p.count++;
    e.cats.set(cat, (e.cats.get(cat) ?? 0) + mnt);
    e.items.push({ t: cut(l.title, 110), o: cut(l.orgName, 60), w: l.winner ? cut(l.winner, 48) : null, m: mnt, d: l.resultDate, c: cat });
    points.set(id, e);
  }
  const items: MoneyItems = {};
  for (const [id, e] of points) items[id] = e.items.sort((x, y) => y.m - x.m).slice(0, POINT_ITEMS);
  return {
    map: {
      year,
      builtAt: now.toISOString(),
      aimags: [...aimags]
        .map(([aimag, v]) => {
          const c = centreOf(aimag);
          return { aimag, lon: c.lon, lat: c.lat, mnt: v.mnt, count: v.count, cat: top(v.cats) };
        })
        .sort((x, y) => y.mnt - x.mnt),
      points: [...points.values()].map((e) => ({ ...e.p, cat: top(e.cats) })).sort((x, y) => y.mnt - x.mnt),
      national,
    },
    items,
  };
}

/** Computes this Ulaanbaatar year's map and stores both rows; returns how many lots were placed on it. */
export async function storeMoneyMap(db: DB, now = new Date()): Promise<number> {
  const year = new Date(now.getTime() + 8 * 3_600_000).getUTCFullYear();
  const lots = await db
    .select({ title: tenders.title, orgName: tenders.orgName, governor: tenders.governor, winner: tenders.winner, contractMnt: tenders.contractMnt, resultDate: tenders.resultDate })
    .from(tenders)
    .where(and(tenderAwarded, tenderFirstOfSame, eq(tenders.unitSuspect, false), gte(tenders.resultDate, `${year}-01-01`)))
    .orderBy(desc(tenders.contractMnt));
  const { map, items } = buildMoneyMap(lots as Lot[], year, now);
  const asOf = now.toISOString().slice(0, 10);
  for (const [key, data] of [
    [MONEY_MAP_KEY, map],
    [MONEY_ITEMS_KEY, items],
  ] as const) {
    const row = { key, data, asOf, updatedAt: now };
    await db.insert(indicatorSnapshots).values(row).onConflictDoUpdate({ target: indicatorSnapshots.key, set: row });
  }
  return map.aimags.reduce((s, a) => s + a.count, 0);
}
