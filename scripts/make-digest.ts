/**
 * AI news digest ("Онцлох тойм").
 *
 *   npm run digest                     # 12-hour edition (skipped if one was made < 6 h ago)
 *   npm run digest -- --kind 30d       # catch-up review of the last 30 days
 *   npm run digest -- --force          # make a new edition anyway
 *   npm run digest -- --due            # only inside the morning/evening window (scheduled runs)
 *
 * Uses the same free-first provider chain and budget guard as ai:process; falls back to a
 * rule-based ranking when no AI provider is available, so an edition always appears.
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { desc, eq } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { digests } from "@/db/schema";
import { createDigest, type DigestKind, isDigestDue } from "@/lib/ai/digest";
import { dbBudgetGuard, dbUsageLogger, syncLedgerAiCost } from "@/lib/ai/usage-log";
import { oneLine } from "@/lib/log-safe";

const { values } = parseArgs({
  options: {
    kind: { type: "string", default: "12h" },
    force: { type: "boolean", default: false },
    due: { type: "boolean", default: false },
  },
});

async function main() {
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const kind = values.kind === "30d" ? "30d" : ("12h" satisfies DigestKind);
  const db = getDb();
  if (values.due && kind === "12h" && !values.force) {
    const [last] = await db.select({ createdAt: digests.createdAt }).from(digests).where(eq(digests.kind, "12h")).orderBy(desc(digests.createdAt)).limit(1);
    if (!isDigestDue(new Date(), last?.createdAt ?? null)) {
      console.log(`⏭  No 12h digest: not inside a morning/evening window, or the last edition (${last?.createdAt.toISOString() ?? "none"}) is recent.`);
      return;
    }
  }
  const res = await createDigest(db, { kind, force: values.force, log: dbUsageLogger(db), budget: dbBudgetGuard(db) });
  if (res.status !== "created" || !res.digest) {
    console.log(`⏭  No ${kind} digest: ${res.reason}`);
    return;
  }
  const d = res.digest;
  // Model-written text (open to a steered reply) on one line each, so it cannot start a workflow command.
  console.log(`📰 ${oneLine(d.title)}  (${d.items.length}/${d.candidateCount} stories, ${d.generatedBy}, $${Number(d.costUsd).toFixed(6)})`);
  console.log(`   ${oneLine(d.intro, 500)}`);
  for (const [i, it] of d.items.entries()) console.log(`   ${String(i + 1).padStart(2)}. ${oneLine(it.headline)}  [#${it.articleId} ${oneLine(it.sourceName, 80)}]`);
  await syncLedgerAiCost(db);
}

main()
  .catch((err) => {
    console.error("✗ Digest failed:", err);
    process.exitCode = 1;
  })
  .finally(closeDb);
