/**
 * Syncs the opendata.mn catalogue and recomputes the highlight summaries for /data.
 *
 *   npm run data:sync              # all datasets (metadata) + highlights
 *   npm run data:sync -- --dry-run # no DB: print what would be stored
 *
 * Stores metadata and small summaries only, never raw rows (500 MB Supabase limit).
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { openDatasets } from "@/db/schema";
import { columnNames, datasetPageUrl, fetchMeta, fetchRows, fileApiUrl, listCategories, listDatasetIds, PORTAL } from "@/lib/opendata-mn/client";
import { HIGHLIGHTS } from "@/lib/opendata-mn/highlights";
import type { DatasetHighlight } from "@/lib/types";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });

async function main() {
  const dryRun = values["dry-run"];
  if (!dryRun && !hasDatabase()) {
    console.error("✗ DATABASE_URL is not set. Use --dry-run to test without a database.");
    process.exitCode = 1;
    return;
  }
  const ids = await listDatasetIds();
  const categories = await listCategories();
  console.log(`📦 opendata.mn: ${ids.length} dataset(s).`);
  let failed = 0;

  for (const id of ids) {
    try {
      const meta = await fetchMeta(id, categories);
      let highlight: DatasetHighlight | null = null;
      const summarize = HIGHLIGHTS[id];
      if (summarize) {
        const rows = await fetchRows(id);
        highlight = summarize(rows);
        console.log(`  ✓ #${id} ${meta.change_name.slice(0, 60)}: ${rows.length} rows → ${highlight?.kind ?? "no summary"} (${JSON.stringify(highlight ?? {}).length} B)`);
      } else {
        console.log(`  ✓ #${id} ${meta.change_name.slice(0, 60)}`);
      }
      const row = {
        portal: PORTAL,
        externalId: id,
        title: meta.change_name.trim(),
        category: meta.categoryTitle,
        description: meta.file_description?.trim() || null,
        dataSource: meta.data_source?.trim() || meta.OrganizationModel?.name?.trim() || null,
        fileType: meta.file_type ?? null,
        rowCount: meta.quality?.rows_count ?? 0,
        columns: columnNames(meta),
        license: meta.LicenseModel?.short_name || meta.LicenseModel?.name || null,
        updateFrequency: meta.file_update_frequency ?? null,
        pageUrl: datasetPageUrl(meta.category_id, id),
        apiUrl: fileApiUrl(id),
        sourceUpdatedAt: meta.updated_at ? new Date(meta.updated_at) : null,
      };
      if (dryRun) continue;
      await getDb()
        .insert(openDatasets)
        .values({ ...row, highlight })
        .onConflictDoUpdate({
          target: [openDatasets.portal, openDatasets.externalId],
          // Keep the previous summary if this run could not compute one.
          set: { ...row, highlight: highlight ?? sql`${openDatasets.highlight}`, syncedAt: sql`now()` },
        });
    } catch (err) {
      failed++;
      console.log(`  ✗ #${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\n📊 ${ids.length - failed}/${ids.length} dataset(s) synced${dryRun ? " (dry run)" : ""}.`);
  if (failed === ids.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("✗ opendata.mn sync failed:", err);
    process.exitCode = 1;
  })
  .finally(closeDb);
