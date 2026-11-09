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
  const written = await upsertTenders(db, rows, firstSync);
  await db
    .insert(appSettings)
    .values({ key: "tenders_synced_at", value: new Date().toISOString() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: new Date().toISOString() } });
  console.log(`✓ ${written} rows upserted${firstSync ? " (first sync: dated by the official result date)" : ""}${failed ? `, ${failed} call(s) failed` : ""}.`);
}

main()
  .catch((err) => {
    console.error(`::error::sync-tenders: ${errorDetail(err)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
