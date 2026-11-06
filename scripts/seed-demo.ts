/**
 * Fills the demo database with sample data from tests/fixtures (see src/db/demo-seed.ts).
 * Refuses to run against anything but a `pglite:` URL, so it can never touch the real database.
 *
 *   npm run demo        # does this for you, then starts the site
 */
import "dotenv/config";
import "@/lib/runtime-banner";

import { closeDb, getDb, isPgliteUrl } from "@/db";
import { migrateDemo } from "@/db/demo-migrate";
import { seedDemo } from "@/db/demo-seed";

async function main() {
  if (!isPgliteUrl(process.env.DATABASE_URL)) {
    console.error("✗ The demo seed only runs on the demo database (DATABASE_URL=pglite:…). Use `npm run demo`.");
    process.exitCode = 1;
    return;
  }
  const db = getDb();
  const applied = await migrateDemo(db);
  if (applied) console.log(`🗄  ${applied} migration(s) applied.`);
  const result = await seedDemo(db);
  if (!result) console.log("✓ Demo data already loaded (delete .demo-db/ to start fresh).");
  else console.log(`✓ Demo data: ${result.articles} articles, ${result.politicians} MPs, ${result.snapshots} data snapshots, digest: ${result.digest}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
