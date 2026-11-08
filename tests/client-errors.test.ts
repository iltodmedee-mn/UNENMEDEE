import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import type { DB } from "@/db";
import { CLIENT_ERROR_SCRIPT } from "@/lib/client-error-script";
import { CLIENT_ROW_CAP, clientRoute, parseClientError, recordClientError } from "@/lib/client-errors";

process.env.DATABASE_URL = "pglite:memory";

describe("client error reports", () => {
  it("keeps only the first path segment", () => {
    assert.equal(clientRoute("/"), "CLIENT /");
    assert.equal(clientRoute("/tax?salary=1"), "CLIENT /tax");
    assert.equal(clientRoute("/article/some-slug-123"), "CLIENT /article/*");
    assert.equal(clientRoute("/ЮУ/x"), null);
    assert.equal(clientRoute("https://evil.example/"), null);
    assert.equal(clientRoute(42), null);
  });
  it("refuses junk, cross-origin and oversized bodies", () => {
    assert.deepEqual(parseClientError('{"m":"TypeError: x is null","p":"/tax"}'), { route: "CLIENT /tax", message: "TypeError: x is null" });
    assert.equal(parseClientError('{"m":"Script error.","p":"/"}'), null);
    assert.equal(parseClientError('{"m":"","p":"/"}'), null);
    assert.equal(parseClientError("not json"), null);
    assert.equal(parseClientError(JSON.stringify({ m: "x".repeat(2_000), p: "/" })), null);
    assert.equal(parseClientError('{"m":"a\\nb","p":"/"}')?.message, "a b");
  });
  it("the inline script is small and valid JavaScript", () => {
    assert.ok(CLIENT_ERROR_SCRIPT.length < 600, `${CLIENT_ERROR_SCRIPT.length} bytes`);
    assert.doesNotThrow(() => new Function(CLIENT_ERROR_SCRIPT));
  });
});

describe("recordClientError (PGlite)", () => {
  let db: DB;
  before(async () => {
    const { getDb } = await import("@/db");
    const { migrateDemo } = await import("@/db/demo-migrate");
    db = getDb();
    await migrateDemo(db);
  });
  after(async () => {
    const { closeDb } = await import("@/db");
    await closeDb();
  });

  it("counts repeats and stops adding rows at the cap", async () => {
    await recordClientError(db, { route: "CLIENT /tax", message: "boom" });
    await recordClientError(db, { route: "CLIENT /tax", message: "boom" });
    const [row] = (await db.execute(sql`select count from site_errors where route = 'CLIENT /tax'`)).rows as { count: number }[];
    assert.equal(Number(row.count), 2);
    for (let i = 0; i < CLIENT_ROW_CAP + 5; i++) await recordClientError(db, { route: "CLIENT /x", message: `m${i}` });
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from site_errors where route like 'CLIENT %'`)).rows as { n: number }[];
    assert.equal(Number(n), CLIENT_ROW_CAP);
  });
});
