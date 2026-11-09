import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import type { DB } from "@/db";
import { COMPANY_MATCHES_KEY, readCompanyMatches, storeCompanyMatches } from "@/lib/procurement/company-matches";
import { upsertTenders } from "@/lib/procurement/tender-store";
import { type Tender, unitSuspect } from "@/lib/procurement/tenders";

process.env.DATABASE_URL = "pglite:memory";

let db: DB;
const T0 = new Date("2026-11-09T06:00:00Z");

function lot(over: Partial<Tender>): Tender {
  const t: Tender = {
    key: "6001234|ХУД/2026/01|1",
    code: "ХУД/2026/01",
    title: "Сургуулийн засвар",
    orgName: "Орхон аймгийн Боловсролын газар",
    orgRegister: "6001234",
    governor: "Орхон",
    budgetMnt: null,
    contractMnt: null,
    method: null,
    winner: null,
    awarded: false,
    unitSuspect: false,
    resultDate: null,
    ...over,
  };
  return { ...t, unitSuspect: unitSuspect(t.budgetMnt, t.contractMnt) };
}

async function stored(key: string) {
  const r = (await db.execute(sql`select budget_mnt, contract_mnt, unit_suspect, awarded from tenders where key = ${key}`)) as unknown as {
    rows: { budget_mnt: string | null; contract_mnt: string | null; unit_suspect: boolean; awarded: boolean }[];
  };
  return r.rows[0];
}

describe("upsertTenders (PGlite)", () => {
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
    await db.execute(sql`delete from tenders`);
  });

  // Nov 7-9 2026: every sync failed with 23502 on unit_suspect, so no tender was stored.
  it("re-syncing a lot with one amount missing stores unit_suspect false, not null", async () => {
    await upsertTenders(db, [lot({ budgetMnt: 50_000_000 })], false, T0);
    await upsertTenders(db, [lot({ budgetMnt: 50_000_000 })], false, T0);
    assert.equal((await stored(lot({}).key)).unit_suspect, false);

    const k2 = "6001234|ХУД/2026/02|1";
    await upsertTenders(db, [lot({ key: k2, contractMnt: 48_000_000 })], false, T0);
    await upsertTenders(db, [lot({ key: k2, contractMnt: 48_000_000 })], false, T0);
    assert.equal((await stored(k2)).unit_suspect, false);
  });

  it("re-syncing a lot with neither amount stores false", async () => {
    await upsertTenders(db, [lot({})], false, T0);
    await upsertTenders(db, [lot({})], false, T0);
    assert.equal((await stored(lot({}).key)).unit_suspect, false);
  });

  it("flags from the merged amounts: a stored thousands-of-₮ budget next to a new ₮ contract", async () => {
    await upsertTenders(db, [lot({ budgetMnt: 4_343_956 })], false, T0);
    // The new filing has only the contract: on its own it looks clean.
    const update = lot({ contractMnt: 4_170_000_000, winner: "НБИК ХХК", awarded: true });
    assert.equal(update.unitSuspect, false);
    await upsertTenders(db, [update], false, T0);
    const row = await stored(update.key);
    assert.equal(row.unit_suspect, true);
    assert.equal(row.awarded, true);
  });

  it("a clean merged pair stays unflagged, an amount under 1 сая is flagged", async () => {
    await upsertTenders(db, [lot({ budgetMnt: 50_000_000 })], false, T0);
    await upsertTenders(db, [lot({ contractMnt: 48_000_000, winner: "НБИК ХХК", awarded: true })], false, T0);
    assert.equal((await stored(lot({}).key)).unit_suspect, false);

    const k3 = "6001234|ХУД/2026/03|1";
    await upsertTenders(db, [lot({ key: k3, budgetMnt: 50_000_000 })], false, T0);
    await upsertTenders(db, [lot({ key: k3, contractMnt: 337_230 })], false, T0);
    assert.equal((await stored(k3)).unit_suspect, true);
  });

  // Nov 9 2026: every /officials/[id] and /tenders render read all 3 700 winner names to match them.
  it("stores which winner cells name a declared company, and reads them back", async () => {
    assert.equal(await readCompanyMatches(db), null);
    const companies = {
      from: "2025-01-01",
      to: "2026-11-09",
      companies: {
        бодитчадал: { status: "found", name: "Бодит чадал ХХК", checkedAt: "2026-11-01", register: "5000001", amount: 1, count: 1, payers: [] },
        хоёрнэр: { status: "ambiguous", name: "Хоёр нэр ХХК", checkedAt: "2026-11-01", registers: 2 },
      },
    };
    await db.execute(sql`insert into indicator_snapshots (key, data, as_of, updated_at) values ('officials_companies', ${JSON.stringify(companies)}::jsonb, '2026-11-09', now()) on conflict (key) do update set data = excluded.data`);
    await upsertTenders(
      db,
      [
        lot({ key: "a|ХУД/2026/01|1", contractMnt: 48_000_000, winner: "Бодит чадал ХХК", awarded: true }),
        lot({ key: "a|ХУД/2026/02|1", contractMnt: 30_000_000, winner: "Чоногол трейд, Бодит чадал", awarded: true }),
        lot({ key: "a|ХУД/2026/03|1", contractMnt: 30_000_000, winner: "Хоёр нэр ХХК", awarded: true }),
        lot({ key: "a|ХУД/2026/04|1", contractMnt: 30_000_000, winner: "Өөр компани ХХК", awarded: true }),
      ],
      false,
      T0,
    );
    assert.equal(await storeCompanyMatches(db, T0), 1);
    const read = await readCompanyMatches(db);
    assert.deepEqual([...(read?.matches ?? new Map<string, string[]>()).entries()].map(([k, v]) => [k, [...v].sort()]), [["бодитчадал", ["Бодит чадал ХХК", "Чоногол трейд, Бодит чадал"].sort()]]);
    // No member in this database declared it: the owners map is stored, and empty.
    assert.deepEqual([...(read?.owners ?? new Map([["x", null]])).keys()], []);
    // A stored value of the wrong shape reads as "not built yet", never as a crash.
    await db.execute(sql`update indicator_snapshots set data = '{"matches": "x"}'::jsonb where key = ${COMPANY_MATCHES_KEY}`);
    assert.equal(await readCompanyMatches(db), null);
    await db.execute(sql`delete from indicator_snapshots where key in ('officials_companies', ${COMPANY_MATCHES_KEY})`);
  });
});
