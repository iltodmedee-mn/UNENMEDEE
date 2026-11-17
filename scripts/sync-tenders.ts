/**
 * Tender results from Шилэн данс (form 1831) → `tenders`, for /tenders.
 *
 *   npm run tenders:sync                    # the last 3 report months, both report groups
 *   npm run tenders:sync -- --months 10     # backfill
 *   npm run tenders:sync -- --dry-run       # no DB: print counts and the largest contracts
 *
 * A row keeps its first_seen_at; awarded_seen_at is set the first time it carries a winner and a
 * contract amount, so "new contracts" means new to us, whatever date the body typed. The very first
 * sync (empty table) dates awards by their official result date (undated ones stay null), so the
 * feed does not start with thousands of "new" rows. When every call fails the step is red and nothing
 * is written; the time of the last good sync goes to app_settings `tenders_synced_at`.
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { appSettings } from "@/db/schema";
import { formatMntShort } from "@/lib/format";
import { errorDetail, oneLine } from "@/lib/log-safe";
import { fetchTenders } from "@/lib/procurement/fetch";
import { storeMoneyMap } from "@/lib/money-map/build";
import { requestPurge } from "@/lib/purge-request";
import { errorLine } from "@/lib/log-safe";
import { storeCompanyMatches } from "@/lib/procurement/company-matches";
import { upsertTenders } from "@/lib/procurement/tender-store";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, months: { type: "string", default: "3" } } });

async function main() {
  const dry = values["dry-run"];
  if (!dry && !hasDatabase()) {
    console.error("✗ DATABASE_URL is not set. Use --dry-run to test without a database.");
    process.exitCode = 1;
    return;
  }
  const months = Math.min(Math.max(Number(values.months) || 3, 1), 24);
  const { tenders: rows, calls, failed } = await fetchTenders(new Date(), months);
  for (const c of calls) console.log(`  · ${oneLine(c, 120)}`);
  const awarded = rows.filter((t) => t.awarded);
  console.log(`🧾 ${rows.length} tender lots, ${awarded.length} with a winner and a contract amount.`);
  if (failed === calls.length) {
    console.log("::error::Every Шилэн данс call failed; nothing stored.");
    process.exitCode = 1;
    return;
  }
  if (dry) {
    for (const t of awarded.sort((a, b) => (b.contractMnt ?? 0) - (a.contractMnt ?? 0)).slice(0, 10)) {
      console.log(`  ${formatMntShort(t.contractMnt ?? 0).padStart(18)}  ${oneLine(t.orgName, 40)} → ${oneLine(t.winner, 40)} · ${oneLine(t.title, 60)}`);
    }
    return;
  }

  const db = getDb();
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from tenders`)).rows as { n: number }[];
  const firstSync = n === 0;
  const before = await tenderFingerprint(db);
  const written = await upsertTenders(db, rows, firstSync);
  // The company matches and the money map are rebuilt from every awarded lot: only when a lot was
  // added or changed (Nov 2026: the rebuild re-read ~11 000 rows twice a day for nothing, 9 % of
  // the database egress). A missing stored row is rebuilt anyway.
  const changed = before !== (await tenderFingerprint(db)) || !(await storedRowsPresent(db));
  let matched: number | string = "unchanged";
  if (changed) {
    // The members' companies among the winners, stored once for the pages (company-matches.ts).
    matched = await storeCompanyMatches(db);
    // The «Миний ₮» map: this year's lots by aimag and sum, one stored row (src/lib/money-map).
    const placed = await storeMoneyMap(db);
    console.log(`🗺 ${placed} lots on the money map.`);
    // The pages read these rows through an hour-long cache: purge them so a sync shows at once (Nov 11
    // 2026: /money stayed empty for an hour after the first map was stored).
    await requestPurge(["indicator-money_map", "indicator-money_map_items", "indicator-tender_company_matches"]).catch((err: unknown) => console.log(`::warning::cache purge failed: ${errorLine(err)}`));
  } else {
    console.log("🗺 No lot added or changed: the company matches and the money map stay as stored.");
  }
  await db
    .insert(appSettings)
    .values({ key: "tenders_synced_at", value: new Date().toISOString() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: new Date().toISOString() } });
  console.log(`✓ ${written} rows upserted${firstSync ? " (first sync: dated by the official result date)" : ""}${failed ? `, ${failed} call(s) failed` : ""}; ${matched} declared companies among the winners.`);
}

/** One row: a digest of every column the matches and the map read, so "nothing changed" is exact. */
async function tenderFingerprint(db: ReturnType<typeof getDb>): Promise<string> {
  const r = await db.execute(
    sql`select count(*)::text || ':' || coalesce(md5(string_agg(concat_ws('|', key, awarded, winner, contract_mnt, org_name, governor, title, result_date, unit_suspect), ',' order by key)), '') as f from tenders`,
  );
  return String((r.rows as { f: string }[])[0]?.f ?? "");
}

async function storedRowsPresent(db: ReturnType<typeof getDb>): Promise<boolean> {
  const r = await db.execute(sql`select count(*)::int as n from indicator_snapshots where key in ('money_map', 'money_map_items', 'tender_company_matches')`);
  return Number((r.rows as { n: number }[])[0]?.n ?? 0) === 3;
}

main()
  .catch((err) => {
    console.error(`::error::sync-tenders: ${errorDetail(err)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
