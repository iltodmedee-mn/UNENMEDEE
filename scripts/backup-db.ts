/**
 * Exports the database as NDJSON (src/lib/backup.ts) to stdout, for
 * `.github/workflows/backup.yml`, which streams it through gzip and age so the plain text never
 * touches the disk. Row counts go to stderr; no row content is ever logged.
 *
 *   npm run --silent db:backup > backup.ndjson     # locally, to a file you then encrypt
 *   npm run db:backup -- --mark                    # record a finished backup (backup_last_at)
 */
import "dotenv/config";
import { once } from "node:events";
import { parseArgs } from "node:util";

import { closeDb, getDb, hasDatabase } from "@/db";
import { exportTables, markBackup } from "@/lib/backup";
import { errorDetail } from "@/lib/log-safe";

const { values } = parseArgs({ options: { mark: { type: "boolean", default: false } } });

async function main() {
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const db = getDb();
  if (values.mark) {
    await markBackup(db);
    console.error("✓ backup_last_at recorded.");
    return;
  }
  const counts = await exportTables(db, async (line) => {
    if (!process.stdout.write(line)) await once(process.stdout, "drain");
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.error(`✓ ${total} rows: ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(", ")}`);
}

main()
  .catch((err) => {
    console.error(`::error::backup failed: ${errorDetail(err)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
