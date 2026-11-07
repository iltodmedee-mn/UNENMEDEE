import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import type { DB } from "@/db";
import { advanceMarker, claimLease, putOnce, releaseLease, rewindMarker } from "@/lib/claims";

process.env.DATABASE_URL = "pglite:memory";

let db: DB;
const stored = async (key: string) => {
  const r = (await db.execute(sql`select value from app_settings where key = ${key}`)) as unknown as { rows: { value: string }[] };
  return r.rows[0]?.value ?? null;
};
const T0 = new Date("2026-11-07T12:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const LEASE = 20 * 60_000;

describe("claims over app_settings (PGlite)", () => {
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
  beforeEach(async () => {
    await db.execute(sql`delete from app_settings where key like 'claims_test%'`);
  });

  it("two concurrent claims for one scope: exactly one wins", async () => {
    const o = { scope: "slot-A", now: T0, leaseMs: LEASE };
    const r = await Promise.all([claimLease(db, "claims_test_l", o), claimLease(db, "claims_test_l", o)]);
    assert.equal(r.filter((t) => t !== null).length, 1);
  });

  it("the same scope is held until the lease expires, then taken over; a new scope always wins", async () => {
    const first = await claimLease(db, "claims_test_l", { scope: "slot-A", now: T0, leaseMs: LEASE });
    assert.ok(first);
    assert.equal(await claimLease(db, "claims_test_l", { scope: "slot-A", now: min(5), leaseMs: LEASE }), null);
    const takeover = await claimLease(db, "claims_test_l", { scope: "slot-A", now: min(20), leaseMs: LEASE });
    assert.ok(takeover);
    assert.notEqual(takeover, first);
    assert.ok(await claimLease(db, "claims_test_l", { scope: "slot-B", now: min(21), leaseMs: LEASE }), "another slot");
  });

  it("a plain old value of the same scope (no claim time) counts as expired", async () => {
    await db.execute(sql`insert into app_settings (key, value) values ('claims_test_l', 'slot-A')`);
    assert.ok(await claimLease(db, "claims_test_l", { scope: "slot-A", now: T0, leaseMs: LEASE }));
  });

  it("releaseLease with a stale token does nothing; with the live token it frees the scope", async () => {
    const first = await claimLease(db, "claims_test_l", { scope: "slot-A", now: T0, leaseMs: LEASE });
    const second = await claimLease(db, "claims_test_l", { scope: "slot-A", now: min(25), leaseMs: LEASE });
    assert.ok(first && second);
    await releaseLease(db, "claims_test_l", first);
    assert.equal(await stored("claims_test_l"), second, "the takeover stays");
    await releaseLease(db, "claims_test_l", second);
    assert.equal(await stored("claims_test_l"), null);
    assert.ok(await claimLease(db, "claims_test_l", { scope: "slot-A", now: min(26), leaseMs: LEASE }));
  });

  it("advanceMarker never moves back; concurrent advances to one value: one true", async () => {
    const r = await Promise.all([advanceMarker(db, "claims_test_m", 5), advanceMarker(db, "claims_test_m", 5)]);
    assert.equal(r.filter(Boolean).length, 1);
    assert.equal(await advanceMarker(db, "claims_test_m", 5), false);
    assert.equal(await advanceMarker(db, "claims_test_m", 3), false);
    assert.equal(await stored("claims_test_m"), "5");
    assert.equal(await advanceMarker(db, "claims_test_m", 9), true);
  });

  it("rewindMarker only while the marker is still ours", async () => {
    await advanceMarker(db, "claims_test_m", 5);
    await advanceMarker(db, "claims_test_m", 7);
    assert.equal(await rewindMarker(db, "claims_test_m", 5, 4), false, "someone moved on");
    assert.equal(await stored("claims_test_m"), "7");
    assert.equal(await rewindMarker(db, "claims_test_m", 7, 5), true);
    assert.equal(await stored("claims_test_m"), "5");
    assert.equal(await advanceMarker(db, "claims_test_m", 7), true, "the next run can claim again");
  });

  it("putOnce keeps a young value (make is not called) and replaces an old one", async () => {
    const H = 3_600_000;
    let calls = 0;
    const make = (v: string) => () => (calls++, v);
    const a = await putOnce(db, "claims_test_q", make("one"), { keepIfYoungerThanMs: 72 * H, now: T0 });
    assert.deepEqual(a, { value: "one", written: true });
    const b = await putOnce(db, "claims_test_q", make("two"), { keepIfYoungerThanMs: 72 * H, now: new Date(T0.getTime() + 71 * H) });
    assert.deepEqual(b, { value: "one", written: false });
    assert.equal(calls, 1);
    const c = await putOnce(db, "claims_test_q", make("three"), { keepIfYoungerThanMs: 72 * H, now: new Date(T0.getTime() + 73 * H) });
    assert.deepEqual(c, { value: "three", written: true });
    const d = await putOnce(db, "claims_test_q", () => null, { keepIfYoungerThanMs: 72 * H, now: new Date(T0.getTime() + 200 * H) });
    assert.deepEqual(d, { value: "three", written: false }, "nothing to store keeps the old value");
  });
});
