/**
 * Which tender winner cells name a company an active member declared, worked out once per sync
 * and stored in indicator_snapshots key COMPANY_MATCHES_KEY. getCompanyTenders (src/lib/queries.ts)
 * read every distinct winner (3 700 names, ~170 KB) to match them in JS, and on Vercel `use cache`
 * does not outlive a serverless instance, so each /officials/[id] and /tenders render read them
 * again: the database's largest reader by rows on Nov 9 2026 (40 755 of 75 278 rows in 26 minutes).
 * tenders:sync and officials:companies call storeCompanyMatches after they write; the page reads
 * one small row.
 */
import { and, desc, eq, isNotNull } from "drizzle-orm";

import type { DB } from "@/db";
import { assetDeclarations, indicatorSnapshots, politicians, tenders } from "@/db/schema";
import { declaredCompanies, foundKeys, matchWinners, type OfficialCompaniesSnapshot } from "@/lib/officials/companies";
import { tenderAwarded } from "@/lib/procurement/tender-sql";

export const COMPANY_MATCHES_KEY = "tender_company_matches";

export interface CompanyOwners {
  /** The company as a member declared it. */
  name: string;
  /** Active members who declared shares in it, in their latest filing. */
  owners: { id: number; shortName: string }[];
}

export interface CompanyMatchesSnapshot {
  builtAt: string;
  /** Company key (`orgKey`) → the winner cells, as filed, that name it. */
  matches: Record<string, string[]>;
  /** Company key → who declared it (only the matched keys). Each read of the latest filings moved ~1.2 KB a member. */
  owners?: Record<string, CompanyOwners>;
}

/** Who declared each company key, from every active member's latest ХАСХОМ filing. */
export async function computeCompanyOwners(db: DB): Promise<Map<string, CompanyOwners>> {
  const latest = await db
    .selectDistinctOn([assetDeclarations.politicianId], { id: politicians.id, shortName: politicians.shortName, details: assetDeclarations.details })
    .from(assetDeclarations)
    .innerJoin(politicians, eq(politicians.id, assetDeclarations.politicianId))
    .where(eq(politicians.isActive, true))
    .orderBy(assetDeclarations.politicianId, desc(assetDeclarations.year));
  const owners = new Map<string, CompanyOwners>();
  for (const m of latest)
    for (const o of declaredCompanies(m.details as Record<string, string> | null).stocks) {
      const e = owners.get(o.key) ?? { name: o.name, owners: [] };
      e.owners.push({ id: m.id, shortName: m.shortName });
      owners.set(o.key, e);
    }
  return owners;
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
  const all = matched.size > 0 ? await computeCompanyOwners(db) : new Map<string, CompanyOwners>();
  const owners = Object.fromEntries([...matched.keys()].flatMap((k) => (all.has(k) ? [[k, all.get(k)!] as const] : [])));
  const data: CompanyMatchesSnapshot = { builtAt: now.toISOString(), matches: Object.fromEntries(matched), owners };
  const row = { key: COMPANY_MATCHES_KEY, data, asOf: now.toISOString().slice(0, 10), updatedAt: now };
  await db.insert(indicatorSnapshots).values(row).onConflictDoUpdate({ target: indicatorSnapshots.key, set: row });
  return matched.size;
}

/**
 * The stored matches and their owners, or null before the first sync wrote them (the caller then
 * computes them). Owners are null in a row written before they were stored.
 */
export async function readCompanyMatches(db: DB): Promise<{ matches: Map<string, string[]>; owners: Map<string, CompanyOwners> | null } | null> {
  const [row] = await db.select({ data: indicatorSnapshots.data }).from(indicatorSnapshots).where(eq(indicatorSnapshots.key, COMPANY_MATCHES_KEY));
  const data = row?.data as CompanyMatchesSnapshot | undefined;
  if (!data || typeof data.matches !== "object" || data.matches === null) return null;
  const matches = new Map(Object.entries(data.matches).filter((e): e is [string, string[]] => Array.isArray(e[1]) && e[1].every((c) => typeof c === "string")));
  const ownerOk = (o: unknown): o is CompanyOwners =>
    !!o && typeof (o as CompanyOwners).name === "string" && Array.isArray((o as CompanyOwners).owners) && (o as CompanyOwners).owners.every((x) => typeof x?.id === "number" && typeof x?.shortName === "string");
  const owners = data.owners && typeof data.owners === "object" ? new Map(Object.entries(data.owners).filter((e): e is [string, CompanyOwners] => ownerOk(e[1]))) : null;
  return { matches, owners };
}
