/**
 * Marks the site's list pages stale right after the pipeline or a maintenance task wrote
 * (src/lib/cache-purge.ts). `--all` also purges every article page (a repair of stored rows).
 * A failure only warns: the pages refresh on their own within the `news` cache life (30 min).
 */
import "dotenv/config";
import "@/lib/runtime-banner";

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import { closeDb, getDb, hasDatabase } from "@/db";
import { appSettings } from "@/db/schema";
import { NONCE_KEY, nonceValue, RUN_TAGS } from "@/lib/cache-purge";
import { errorLine } from "@/lib/log-safe";
import { PRODUCTION_URL } from "@/lib/site";

async function main() {
  const { values } = parseArgs({ options: { all: { type: "boolean", default: false } } });
  if (!hasDatabase()) return console.log("No DATABASE_URL: nothing to purge.");
  const nonce = randomBytes(32).toString("hex");
  const value = nonceValue(nonce, new Date());
  await getDb()
    .insert(appSettings)
    .values({ key: NONCE_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  const tags = values.all ? [...RUN_TAGS, "articles"] : RUN_TAGS;
  const res = await fetch(`${PRODUCTION_URL}/api/revalidate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce, tags }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    console.log(`::warning::cache purge answered ${res.status}: the pages refresh on their own within 30 minutes.`);
    return;
  }
  console.log(`✓ cache purged: ${tags.join(", ")}`);
}

main()
  .catch((err) => console.log(`::warning::cache purge failed: ${errorLine(err)} (the pages refresh on their own within 30 minutes)`))
  .finally(() => closeDb());
