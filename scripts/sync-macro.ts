/**
 * Bank of Mongolia indicators for the home strip and /data: policy rate, inflation, official
 * exchange rates, gold price, international reserves. Five requests, one host (8 s apart).
 *
 *   npm run macro:sync               # store the snapshot in indicator_snapshots ("mongolbank")
 *   npm run macro:sync -- --dry-run  # print it
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { closeDb, getDb, hasDatabase } from "@/db";
import { indicatorSnapshots } from "@/db/schema";
import { fetchMacroSnapshot } from "@/lib/mongolbank/client";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });

async function main() {
  const dryRun = values["dry-run"];
  if (!dryRun && !hasDatabase()) {
    console.error("✗ DATABASE_URL is not set. Use --dry-run to test without a database.");
    process.exitCode = 1;
    return;
  }
  const snap = await fetchMacroSnapshot();
  const asOf = snap.fx?.date ?? snap.gold?.date ?? null;
  console.log(
    `🏦 Mongolbank: policy ${snap.policyRate?.value ?? "—"}% (${snap.policyRate?.since ?? "—"}), inflation ${snap.inflation?.national ?? "—"}% (${snap.inflation?.month ?? "—"}), USD ${snap.fx?.rates.find((r) => r.code === "USD")?.rate ?? "—"}, gold ${snap.gold?.buy ?? "—"}, reserves ${snap.reserves?.value ?? "—"}M$ (${snap.reserves?.month ?? "—"})`,
  );
  if (!snap.policyRate && !snap.inflation && !snap.fx) throw new Error("Mongolbank returned no data; keeping the previous snapshot.");
  if (dryRun) return;
  const row = { key: "mongolbank", data: snap, asOf, updatedAt: new Date() };
  await getDb().insert(indicatorSnapshots).values(row).onConflictDoUpdate({ target: indicatorSnapshots.key, set: row });
  console.log(`🏦 Stored (${JSON.stringify(snap).length} B).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
