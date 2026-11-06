/**
 * Records that a pipeline run has started (`app_settings` key `pipeline_started_at`).
 *
 * The Supabase fallback (supabase/pipeline-fallback.sql) reads it: GitHub drops scheduled runs of
 * public repositories under load, so when no run has started for an hour, a pg_cron job in the
 * database asks GitHub to start one. A run that is going keeps it quiet. The watchdog reads it too.
 *
 *   npm run pipeline:mark
 */
import "dotenv/config";
import "@/lib/runtime-banner";

import { closeDb, getDb, hasDatabase, schema } from "@/db";

export const PIPELINE_STARTED_KEY = "pipeline_started_at";

async function main() {
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const now = new Date();
  const value = now.toISOString();
  await getDb()
    .insert(schema.appSettings)
    .values({ key: PIPELINE_STARTED_KEY, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: now } });
  console.log(`✓ Pipeline start recorded (${value}).`);
}

main()
  .catch((err) => {
    // Never stops the run: the fallback only dispatches an extra run at worst.
    console.error(`::warning::could not record the pipeline start: ${err instanceof Error ? err.message : err}`);
  })
  .finally(() => closeDb());
