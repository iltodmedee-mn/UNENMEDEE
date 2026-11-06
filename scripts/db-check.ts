/**
 * Connects the way the site and the jobs do (node-postgres with the verified TLS of src/db/tls.ts)
 * and runs one query. The manual maintenance task `db-check` runs it with `db:migrate` (postgres.js)
 * after a TLS or connection change, before the change reaches every schedule.
 *
 *   npm run db:check
 */
import "dotenv/config";
import "@/lib/runtime-banner";

import { sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";

async function main() {
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL!).hostname;
    } catch {
      return "?";
    }
  })();
  const t = Date.now();
  const { rows } = await getDb().execute(sql`select version() as v, current_setting('ssl', true) as ssl`);
  const row = rows[0] as { v: string; ssl: string | null };
  console.log(`✓ node-postgres → ${host}: verified TLS, ${String(row.v).split(" ").slice(0, 2).join(" ")}, ${Date.now() - t} ms`);
}

main()
  .catch((err) => {
    const e = err as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    console.error(`✗ ${[e.code ?? e.cause?.code, e.message, e.cause?.message].filter(Boolean).join(" · ")}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
