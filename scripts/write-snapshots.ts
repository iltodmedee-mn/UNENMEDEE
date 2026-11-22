/**
 * After a pipeline run (or a digest, or a repair): writes every list page's snapshot and purges
 * the pages whose snapshot changed, plus "clusters" (docs/adr/0001-list-pages-read-snapshots.md,
 * src/lib/snapshot-writer.ts). A failure only warns: readers keep the previous snapshot.
 *
 *   npm run snapshots:write                  # write + purge the changed list pages
 *   npm run snapshots:write -- --also digests
 */
import "dotenv/config";
import "@/lib/runtime-banner";

import { parseArgs } from "node:util";

import { closeDb, hasDatabase } from "@/db";
import { errorLine } from "@/lib/log-safe";
import { requestPurge } from "@/lib/purge-request";
import { clustersChangedSince, forgetHashes, rememberClusters, writeSnapshots } from "@/lib/snapshot-writer";

async function main() {
  const { values } = parseArgs({ options: { also: { type: "string" } } });
  if (!hasDatabase()) return console.log("No DATABASE_URL: no snapshots to write.");
  const changed = await writeSnapshots();
  console.log(`🗂 snapshots written; ${changed.length} list page(s) changed${changed.length ? `: ${changed.join(", ")}` : ""}`);
  const also = values.also ? values.also.split(",").map((t) => t.trim()).filter(Boolean) : [];
  // A purge that failed (the site answered an error, or did not answer) is asked again by the next
  // run: without this the changed pages kept their old list for up to a day.
  // "clusters" only when a cluster changed: purged every run, it expired every clustered article
  // and cluster page 48 times a day (Nov 2026 audit P-1).
  const clusters = await clustersChangedSince();
  const tags = [...changed, ...(clusters.changed ? ["clusters"] : []), ...also];
  if (!tags.length) return console.log("🗂 nothing to purge.");
  const purged = await requestPurge(tags).catch((err: unknown) => {
    console.log(`::warning::cache purge failed: ${errorLine(err)}`);
    return false;
  });
  if (purged && clusters.changed) await rememberClusters(clusters.state);
  if (!purged && changed.length) console.log(`↻ ${await forgetHashes(changed)} list page(s) will be purged again by the next run.`);
}

main()
  .catch((err) => console.log(`::warning::snapshots not written: ${errorLine(err)} (readers keep the previous snapshot)`))
  .finally(() => closeDb());
