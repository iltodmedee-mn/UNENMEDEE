/**
 * Writes form-1831 tender lots (src/lib/procurement/tenders.ts) to `tenders`, merging each with the
 * stored row of the same key. Used by scripts/sync-tenders.ts; tests/tender-store.test.ts runs it on
 * PGlite.
 */
import { sql } from "drizzle-orm";

import type { DB } from "@/db";
import { tenders } from "@/db/schema";
import { MIN_PLAIN_MNT, type Tender, UNIT_RATIO } from "@/lib/procurement/tenders";

const BATCH = 300;

const budget = sql`coalesce(excluded.budget_mnt, ${tenders.budgetMnt})`;
const contract = sql`coalesce(excluded.contract_mnt, ${tenders.contractMnt})`;

/**
 * unitSuspect() (tenders.ts) on the MERGED budget and contract: the incoming flag was computed
 * without the stored side, so a stored thousands-of-₮ budget next to a new ₮ contract read as a clean
 * 95 900 % over-budget award. The outer coalesce is the JS rule's "otherwise false": with one amount
 * missing SQL's `null < x` is null, the whole OR was null, and the not-null column refused every
 * batch that held such a lot (no tender stored from Nov 7 to Nov 9 2026).
 */
const mergedUnitSuspect = sql`coalesce(${budget} < ${MIN_PLAIN_MNT} or ${contract} < ${MIN_PLAIN_MNT} or greatest(${budget}, ${contract})::numeric / nullif(least(${budget}, ${contract}), 0) >= ${UNIT_RATIO}, false)`;

/**
 * Upserts the lots in batches and returns how many were written. A row keeps its first_seen_at;
 * awarded_seen_at is set the first time it carries a winner and a contract amount. On the very first
 * sync (`firstSync`, empty table) awards are dated by their official result date and undated ones stay
 * null, so the feed does not open with thousands of "new" contracts.
 */
export async function upsertTenders(db: DB, rows: Tender[], firstSync: boolean, now = new Date()): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((t) => {
      const seen = !firstSync ? now : t.resultDate ? new Date(`${t.resultDate}T12:00:00+08:00`) : null;
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
        firstSeenAt: seen ?? now,
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
          budgetMnt: budget,
          contractMnt: contract,
          method: sql`coalesce(excluded.method, ${tenders.method})`,
          // A later filing that says "-" keeps the stored winner of an awarded lot.
          winner: sql`case when ${tenders.awarded} and not excluded.awarded then ${tenders.winner} else coalesce(excluded.winner, ${tenders.winner}) end`,
          awarded: sql`${tenders.awarded} or excluded.awarded`,
          unitSuspect: mergedUnitSuspect,
          resultDate: sql`coalesce(excluded.result_date, ${tenders.resultDate})`,
          // Set once, when a stored lot first turns awarded; later syncs never move it.
          awardedSeenAt: sql`case when excluded.awarded and not ${tenders.awarded} then now() else ${tenders.awardedSeenAt} end`,
          updatedAt: sql`now()`,
        },
      });
    written += batch.length;
  }
  return written;
}
