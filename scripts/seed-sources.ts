/**
 * Upserts the monitored government sources into the `sources` table.
 * Usage: npm run db:seed
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { sql } from "drizzle-orm";

import { closeDb, getDb } from "@/db";
import { sources } from "@/db/schema";
import { SOURCE_SEEDS } from "@/lib/sources";

async function main() {
  const db = getDb();
  const rows = await db
    .insert(sources)
    .values(SOURCE_SEEDS.map((s) => ({ ...s, isActive: true })))
    .onConflictDoUpdate({
      target: sources.domain,
      set: {
        name: sql`excluded.name`,
        urlPattern: sql`excluded.url_pattern`,
        category: sql`excluded.category`,
      },
    })
    .returning({ id: sources.id, domain: sources.domain });

  console.log(`✓ Upserted ${rows.length} sources:`);
  for (const r of rows) console.log(`  #${r.id} ${r.domain}`);
}

main()
  .catch((err) => {
    console.error("✗ Seeding failed:", err);
    process.exitCode = 1;
  })
  .finally(closeDb);
