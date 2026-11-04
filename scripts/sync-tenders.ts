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
import { parseArgs } from "node:util";

import { sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { appSettings, tenders } from "@/db/schema";
import { formatMntShort } from "@/lib/format";
import { oneLine } from "@/lib/log-safe";
import { fetchTenders } from "@/lib/procurement/fetch";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, months: { type: "string", default: "3" } } });

const BATCH = 300;

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
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((t) => {
      // First sync: an award counts as "seen" on its official date; an undated one stays null
      // (listed by date only), so the feed does not open with thousands of "new" contracts.
      const seen = !firstSync ? new Date() : t.resultDate ? new Date(`${t.resultDate}T12:00:00+08:00`) : null;
      return {
        key: t.key,
        code: t.code,
        title: t.title,
        orgName: t.orgName,
        orgRegister: t.orgRegister,
        governor: t.governor,
        budgetMnt: t.budgetMnt,
        contractMnt: t.contractMnt,
        method: t.method,
        winner: t.winner,
        awarded: t.awarded,
        unitSuspect: t.unitSuspect,
        resultDate: t.resultDate,
        firstSeenAt: seen ?? new Date(),
        awardedSeenAt: t.awarded ? seen : null,
      };
    });
    await db
      .insert(tenders)
      .values(batch)
      .onConflictDoUpdate({
        target: tenders.key,
        set: {
          title: sql`excluded.title`,
          orgName: sql`excluded.org_name`,
          governor: sql`excluded.governor`,
          budgetMnt: sql`coalesce(excluded.budget_mnt, ${tenders.budgetMnt})`,
          contractMnt: sql`coalesce(excluded.contract_mnt, ${tenders.contractMnt})`,
          method: sql`coalesce(excluded.method, ${tenders.method})`,
          // A later filing that says "-" keeps the stored winner of an awarded lot.
          winner: sql`case when ${tenders.awarded} and not excluded.awarded then ${tenders.winner} else coalesce(excluded.winner, ${tenders.winner}) end`,
          awarded: sql`${tenders.awarded} or excluded.awarded`,
          unitSuspect: sql`excluded.unit_suspect`,
          resultDate: sql`coalesce(excluded.result_date, ${tenders.resultDate})`,
          // Set once, when a stored lot first turns awarded; later syncs never move it.
          awardedSeenAt: sql`case when excluded.awarded and not ${tenders.awarded} then now() else ${tenders.awardedSeenAt} end`,
          updatedAt: sql`now()`,
        },
      });
    written += batch.length;
  }
  await db
    .insert(appSettings)
    .values({ key: "tenders_synced_at", value: new Date().toISOString() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: new Date().toISOString() } });
  console.log(`✓ ${written} rows upserted${firstSync ? " (first sync: dated by the official result date)" : ""}${failed ? `, ${failed} call(s) failed` : ""}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
