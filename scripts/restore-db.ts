/**
 * Restores a backup made by `npm run db:backup` (docs/BACKUP.md): rows are upserted by primary
 * key into the database at DATABASE_URL, so a restore into an empty, migrated database rebuilds
 * it, and a restore into a live one overwrites only the rows in the file.
 *
 *   age -d -i key.txt iltod-backup-….ndjson.gz.age > backup.ndjson.gz
 *   npm run db:restore -- --file backup.ndjson.gz --dry-run         # parse + count only
 *   npm run db:restore -- --file backup.ndjson.gz --yes             # write
 *   npm run db:restore -- --file backup.ndjson.gz --table app_settings --yes
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { createGunzip } from "node:zlib";

import { closeDb, getDb, hasDatabase } from "@/db";
import { importLines } from "@/lib/backup";
import { errorDetail } from "@/lib/log-safe";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    table: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
  },
});

async function main() {
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  if (!values.file) {
    console.error("✗ --file <backup.ndjson[.gz]> is required (decrypt the .age file first, docs/BACKUP.md).");
    process.exitCode = 1;
    return;
  }
  const dryRun = values["dry-run"];
  if (!dryRun && !values.yes) {
    console.error("✗ This writes into the database at DATABASE_URL. Run with --dry-run first, then add --yes.");
    process.exitCode = 1;
    return;
  }
  const url = process.env.DATABASE_URL ?? "";
  const target = url.startsWith("pglite:") ? url : (() => { try { return new URL(url).host; } catch { return "(unparsed URL)"; } })();
  console.error(`${dryRun ? "Dry run against" : "Restoring into"} ${target}…`);
  const input = createReadStream(values.file);
  const stream = values.file.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  // A missing or corrupt file (bad gzip) emits "error" on the stream, which readline does not pass
  // on: the process died on an unhandled error event instead of a clear message (audit D-1).
  let streamError: unknown = null;
  for (const s of [input, stream]) s.on("error", (err) => { streamError ??= err; rl.close(); });
  async function* checkedLines(): AsyncGenerator<string> {
    for await (const line of rl) {
      if (streamError) throw streamError;
      yield line;
    }
    if (streamError) throw streamError;
  }
  const counts = await importLines(getDb(), checkedLines(), {
    dryRun,
    only: values.table ? values.table.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
  });
  console.error(`✓ ${dryRun ? "would restore" : "restored"}: ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(", ") || "nothing"}`);
}

main()
  .catch((err) => {
    console.error(`::error::restore failed: ${errorDetail(err)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
