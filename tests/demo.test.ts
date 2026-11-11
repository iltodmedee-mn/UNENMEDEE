import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { count, sql } from "drizzle-orm";

describe("npm run demo (PGlite + fixtures)", () => {
  // In-memory demo database: this file runs in its own process, so the env change stays here.
  process.env.DATABASE_URL = "pglite:memory";

  after(async () => {
    const { closeDb } = await import("@/db");
    await closeDb();
  });

  it("migrates and seeds real sample data offline, and only once", async () => {
    const { getDb, isDemoDatabase } = await import("@/db");
    const { migrateDemo } = await import("@/db/demo-migrate");
    const { seedDemo } = await import("@/db/demo-seed");
    const { articles, indicatorSnapshots, politicians } = await import("@/db/schema");
    assert.ok(isDemoDatabase());
    const db = getDb();
    assert.ok((await migrateDemo(db)) >= 12);
    assert.equal(await migrateDemo(db), 0, "migrations are recorded");
    const result = await seedDemo(db, "tests/fixtures", new Date("2026-10-22T05:00:00Z"));
    assert.ok(result && result.articles >= 8, `articles: ${result?.articles}`);
    assert.ok(result.politicians >= 1);
    const [{ n }] = await db.select({ n: count() }).from(indicatorSnapshots);
    assert.equal(n, 12, "8 data snapshots, the petitions page, the stored tender matches and the money map rows");
    const [m] = await db.select({ key: indicatorSnapshots.key }).from(indicatorSnapshots).where(sql`${indicatorSnapshots.key} = 'tender_company_matches'`);
    assert.ok(m, "the demo stores the matches the pages read (they never match live)");
    const [{ p }] = await db.select({ p: count() }).from(politicians);
    assert.equal(p, result.politicians);
    // The newest article is moved to "now", so the demo looks current.
    const [{ newest }] = (await db.execute(sql`select max(published_at)::text as newest from ${articles}`)).rows as { newest: string }[];
    assert.equal(new Date(newest).toISOString(), "2026-10-22T05:00:00.000Z");
    assert.equal(await seedDemo(db), null, "a second run is a no-op");
  });
});
