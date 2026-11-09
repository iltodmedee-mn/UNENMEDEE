/**
 * Looks up in Шилэн данс the companies active members named in their latest ХАСХОМ declaration
 * (shares, lenders) and stores the result in indicator_snapshots key `officials_companies`
 * (src/lib/officials/companies.ts). One host at 8 s a request, so a run stops at --budget minutes
 * and the next run goes on: never-checked names first, then checks older than 30 days.
 *
 *   npm run officials:companies                          # 25-minute budget
 *   npm run officials:companies -- --budget 5 --dry-run
 *   npm run officials:companies -- --dry-run --names "Бодитчадал ХХК,Хүчит хөтлүүр ХХК"   # no database
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { desc, eq } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { assetDeclarations, indicatorSnapshots, politicians } from "@/db/schema";
import { errorDetail, oneLine } from "@/lib/log-safe";
import { type CompanyCheck, declaredCompanies, dueKeys, type OfficialCompaniesSnapshot, PAYMENTS_FROM } from "@/lib/officials/companies";
import { checkCompany } from "@/lib/officials/companies-sync";
import { storeCompanyMatches } from "@/lib/procurement/company-matches";

const SNAPSHOT_KEY = "officials_companies";

const { values } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false }, budget: { type: "string", default: "25" }, limit: { type: "string" }, names: { type: "string" } },
});

const ubToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

/** Every organisation to look up, by key, with the spelling to search for. */
async function wantedNames(): Promise<Map<string, string>> {
  const wanted = new Map<string, string>();
  const add = (details: Record<string, string> | null | undefined) => {
    const c = declaredCompanies(details);
    for (const o of [...c.stocks, ...c.lenders]) if (o.lookup && !wanted.has(o.key)) wanted.set(o.key, o.name);
  };
  if (values.names) {
    for (const name of values.names.split(",")) add({ stocks: name });
    return wanted;
  }
  const rows = await getDb()
    .selectDistinctOn([assetDeclarations.politicianId], { details: assetDeclarations.details })
    .from(assetDeclarations)
    .innerJoin(politicians, eq(politicians.id, assetDeclarations.politicianId))
    .where(eq(politicians.isActive, true))
    .orderBy(assetDeclarations.politicianId, desc(assetDeclarations.year));
  for (const r of rows) add(r.details);
  return wanted;
}

async function loadSnapshot(): Promise<OfficialCompaniesSnapshot | null> {
  if (!hasDatabase()) return null;
  const [row] = await getDb().select().from(indicatorSnapshots).where(eq(indicatorSnapshots.key, SNAPSHOT_KEY)).limit(1);
  return (row?.data as OfficialCompaniesSnapshot | undefined) ?? null;
}

async function save(snap: OfficialCompaniesSnapshot): Promise<void> {
  const row = { key: SNAPSHOT_KEY, data: snap, asOf: snap.to, updatedAt: new Date() };
  await getDb().insert(indicatorSnapshots).values(row).onConflictDoUpdate({ target: indicatorSnapshots.key, set: row });
}

async function main() {
  const dryRun = values["dry-run"];
  if (!hasDatabase() && !(dryRun && values.names)) {
    console.error("✗ DATABASE_URL is not set. Use --dry-run --names \"A ХХК,B ХХК\" to test without a database.");
    process.exitCode = 1;
    return;
  }
  const wanted = await wantedNames();
  const to = ubToday();
  const stored = (await loadSnapshot()) ?? { from: PAYMENTS_FROM, to, companies: {} };
  // Keep only companies still declared by an active member: a member who left takes theirs along.
  const companies: Record<string, CompanyCheck> = {};
  for (const k of wanted.keys()) if (stored.companies[k]) companies[k] = stored.companies[k];
  const snap: OfficialCompaniesSnapshot = { from: PAYMENTS_FROM, to, companies };

  const due = dueKeys(wanted, companies).slice(0, values.limit ? Math.max(1, Number(values.limit)) : undefined);
  const deadline = Date.now() + Math.max(1, Number(values.budget) || 25) * 60_000;
  console.log(`🏢 ${wanted.size} declared companies to look up, ${due.length} due (never checked or > 30 days).`);

  let done = 0;
  let failed = 0;
  for (const key of due) {
    if (Date.now() > deadline) {
      console.log(`⏱  Time budget reached; ${due.length - done - failed} left for the next run.`);
      break;
    }
    try {
      const c = await checkCompany(wanted.get(key)!, to);
      companies[key] = c;
      done++;
      const what = c.status === "found" ? `${c.register} · ${Math.round(c.amount).toLocaleString("en-US")} ₮ · ${c.count} гүйлгээ` : c.status === "ambiguous" ? `${c.registers} байгууллага ижил нэртэй` : "олдсонгүй";
      console.log(`  ${c.status === "found" ? "✓" : "·"} ${oneLine(wanted.get(key), 80)}: ${what}`);
      // Progress survives a timeout or a cancelled job.
      if (!dryRun && done % 20 === 0) await save(snap);
    } catch (err) {
      failed++;
      console.warn(`  ✗ ${oneLine(wanted.get(key), 80)}: ${oneLine(err instanceof Error ? err.message : err, 160)}`);
      if (failed >= 5 && done === 0) {
        console.error("::error::Шилэн данс answers no lookups; stopping (the stored results stay).");
        process.exitCode = 1;
        break;
      }
    }
  }
  const found = Object.values(companies).filter((c) => c.status === "found").length;
  console.log(`📊 ${done} checked this run, ${failed} failed; ${Object.keys(companies).length}/${wanted.size} on record, ${found} paid by a state body (${JSON.stringify(snap).length} B).`);
  if (!dryRun && hasDatabase()) {
    await save(snap);
    // The tender pages read which winners are these companies from one stored row (company-matches.ts).
    console.log(`🧾 ${await storeCompanyMatches(getDb())} declared companies among the tender winners.`);
  }
}

main()
  .catch((err) => {
    console.error(`::error::sync-official-companies: ${errorDetail(err)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
