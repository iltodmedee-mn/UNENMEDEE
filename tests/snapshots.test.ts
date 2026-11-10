import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import type { DB } from "@/db";
import { contentHash, feedKey, parseSnapshot, SNAPSHOT_TAG, SNAPSHOT_VERSION, snapshotTag, toDate } from "@/lib/snapshots";

process.env.DATABASE_URL = "pglite:memory";

describe("snapshot helpers", () => {
  it("keys and tags", () => {
    assert.equal(feedKey("all"), "feed:all");
    assert.equal(snapshotTag(feedKey("all")), "snap-feed-all");
    assert.ok(SNAPSHOT_TAG.test(snapshotTag(feedKey("health"))));
  });
  it("the hash follows the content, not the key order of a fresh object", () => {
    assert.equal(contentHash({ a: 1 }), contentHash({ a: 1 }));
    assert.notEqual(contentHash({ a: 1 }), contentHash({ a: 2 }));
  });
  it("reads only its own version, and dates come back as Dates", () => {
    assert.equal(parseSnapshot(null), null);
    assert.equal(parseSnapshot({ v: SNAPSHOT_VERSION + 1, builtAt: "x", data: {} }), null);
    assert.deepEqual(parseSnapshot({ v: SNAPSHOT_VERSION, builtAt: "2026-11-08T00:00:00.000Z", data: { a: 1 } })?.data, { a: 1 });
    assert.equal(toDate("2026-11-08T00:00:00.000Z")?.toISOString(), "2026-11-08T00:00:00.000Z");
    assert.equal(toDate(null), null);
    assert.equal(toDate("not a date"), null);
  });
});

describe("writeSnapshots (PGlite, demo data)", () => {
  let db: DB;
  before(async () => {
    const { getDb } = await import("@/db");
    const { migrateDemo } = await import("@/db/demo-migrate");
    const { seedDemo } = await import("@/db/demo-seed");
    db = getDb();
    await migrateDemo(db);
    await seedDemo(db, "tests/fixtures", new Date());
  });
  after(async () => {
    const { closeDb } = await import("@/db");
    await closeDb();
  });

  it("writes every list, rebuilds only what changed, and a withdrawn story leaves the home snapshot", async () => {
    const { writeSnapshots } = await import("@/lib/snapshot-writer");
    const { FEED_FILTERS } = await import("@/lib/queries");
    const first = await writeSnapshots();
    assert.equal(first.length, FEED_FILTERS.length, "the first run creates every snapshot");
    assert.deepEqual(await writeSnapshots(), [], "nothing changed, nothing to rebuild");

    const home = async () => {
      const r = (await db.execute(sql`select data from feed_snapshots where key = 'feed:all'`)).rows[0] as { data: { data: { stories: { id: number }[] } } };
      return parseSnapshot<{ stories: { id: number }[] }>(r.data)!.data.stories;
    };
    const top = (await home())[0];
    assert.ok(top, "the demo home feed has stories");
    await db.execute(sql`update articles set is_published = false where id = ${top.id}`);
    const changed = await writeSnapshots();
    assert.ok(changed.includes("snap-feed-all"), `home rebuilt: ${changed.join(", ")}`);
    assert.ok(!(await home()).some((s) => s.id === top.id), "the withdrawn story is gone from the snapshot");
  });

  it("a failed purge is asked again: forgetting the hash makes the next run report the page as changed", async () => {
    const { forgetHashes, writeSnapshots } = await import("@/lib/snapshot-writer");
    assert.deepEqual(await writeSnapshots(), [], "settled");
    // The purge of the home page and one topic failed: the next run must purge exactly those again.
    assert.equal(await forgetHashes(["snap-feed-all", "snap-feed-budget", "clusters", "snap-feed-nope"]), 2);
    assert.deepEqual((await writeSnapshots()).sort(), ["snap-feed-all", "snap-feed-budget"]);
    assert.deepEqual(await writeSnapshots(), []);
    assert.equal(await forgetHashes([]), 0);
  });
});
