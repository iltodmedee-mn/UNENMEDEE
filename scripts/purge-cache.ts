/**
 * Marks cached pages stale right after a maintenance task wrote (src/lib/cache-purge.ts).
 * `--all` also purges every article page (a repair of stored rows); `--tags a,b` purges just those.
 * A failure only warns: the pages refresh on their own within their cache life.
 */
import "dotenv/config";
import "@/lib/runtime-banner";

import { parseArgs } from "node:util";

import { closeDb, hasDatabase } from "@/db";
import { RUN_TAGS } from "@/lib/cache-purge";
import { errorLine } from "@/lib/log-safe";
import { requestPurge } from "@/lib/purge-request";

async function main() {
  const { values } = parseArgs({ options: { all: { type: "boolean", default: false }, tags: { type: "string" } } });
  if (!hasDatabase()) return console.log("No DATABASE_URL: nothing to purge.");
  const tags = values.tags ? values.tags.split(",").map((t) => t.trim()).filter(Boolean) : values.all ? [...RUN_TAGS, "articles"] : RUN_TAGS;
  await requestPurge(tags);
}

main()
  .catch((err) => console.log(`::warning::cache purge failed: ${errorLine(err)} (the pages refresh on their own)`))
  .finally(() => closeDb());
