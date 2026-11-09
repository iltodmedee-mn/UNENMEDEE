/**
 * Which tender winner cells name a company an active member declared, worked out once per sync
 * and stored in indicator_snapshots key COMPANY_MATCHES_KEY. getCompanyTenders (src/lib/queries.ts)
 * read every distinct winner (3 700 names, ~170 KB) to match them in JS, and on Vercel `use cache`
 * does not outlive a serverless instance, so each /officials/[id] and /tenders render read them
 * again: the database's largest reader by rows on Nov 9 2026 (40 755 of 75 278 rows in 26 minutes).
 * tenders:sync and officials:companies call storeCompanyMatches after they write; the page reads
 * one small row.
 */
import { and, eq, isNotNull } from "drizzle-orm";

import type { DB } from "@/db";
import { indicatorSnapshots, tenders } from "@/db/schema";
import { foundKeys, matchWinners, type OfficialCompaniesSnapshot } from "@/lib/officials/companies";
import { tenderAwarded } from "@/lib/procurement/tender-sql";

export const COMPANY_MATCHES_KEY = "tender_company_matches";

export interface CompanyMatchesSnapshot {
  builtAt: string;
  /** Company key (`orgKey`) → the winner cells, as filed, that name it. */
  matches: Record<string, string[]>;
}

/** Matches the declared companies against every awarded winner cell now in the table. */
export async function computeCompanyMatches(db: DB): Promise<Map<string, string[]>> {
  const [snap] = await db.select({ data: indicatorSnapshots.data }).from(indicatorSnapshots).where(eq(indicatorSnapshots.key, "officials_companies"));
  const keys = foundKeys((snap?.data ?? null) as OfficialCompaniesSnapshot | null);
  if (keys.size === 0) return new Map();
  const winners = await db.selectDistinct({ winner: tenders.winner }).from(tenders).where(and(tenderAwarded, isNotNull(tenders.winner)));
  return matchWinners(
    keys,
    winners.flatMap((w) => (w.winner ? [w.winner] : [])),
  );
}

/** Computes the matches and stores them; returns how many companies matched. */
export async function storeCompanyMatches(db: DB, now = new Date()): Promise<number> {
  const matched = await computeCompanyMatches(db);
  const data: CompanyMatchesSnapshot = { builtAt: now.toISOString(), matches: Object.fromEntries(matched) };
  const row = { key: COMPANY_MATCHES_KEY, data, asOf: now.toISOString().slice(0, 10), updatedAt: now };
  await db.insert(indicatorSnapshots).values(row).onConflictDoUpdate({ target: indicatorSnapshots.key, set: row });
  return matched.size;
}

/** The stored matches, or null before the first sync wrote them (the caller then computes them). */
export async function readCompanyMatches(db: DB): Promise<Map<string, string[]> | null> {
  const [row] = await db.select({ data: indicatorSnapshots.data }).from(indicatorSnapshots).where(eq(indicatorSnapshots.key, COMPANY_MATCHES_KEY));
  const data = row?.data as CompanyMatchesSnapshot | undefined;
  if (!data || typeof data.matches !== "object" || data.matches === null) return null;
  return new Map(Object.entries(data.matches).filter((e): e is [string, string[]] => Array.isArray(e[1]) && e[1].every((c) => typeof c === "string")));
}
