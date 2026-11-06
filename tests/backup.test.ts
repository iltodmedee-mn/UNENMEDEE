import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import type { DB } from "@/db";
import * as schema from "@/db/schema";

// Source: the in-process demo database (this file runs in its own process). Target: a second,
// empty PGlite database, migrated the same way, as after "Supabase project lost".
process.env.DATABASE_URL = "pglite:memory";

let source: DB;
let target: DB;
let closeTarget: () => Promise<void>;
const lines: string[] = [];

type Row = Record<string, unknown>;
const rowsOf = async (db: DB, q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: Row[] }).rows;

describe("database backup and restore", () => {
  before(async () => {
    const { getDb } = await import("@/db");
    const { migrateDemo } = await import("@/db/demo-migrate");
    const { seedDemo } = await import("@/db/demo-seed");
    source = getDb();
    await migrateDemo(source);
    await seedDemo(source, "tests/fixtures", new Date("2026-10-22T05:00:00Z"));
    await source.insert(schema.appSettings).values({ key: "vapid_private_key", value: "test-only-not-a-real-key" });
    await source.insert(schema.pushSubscriptions).values({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "k", auth: "a" });

    const load = createRequire(`${process.cwd()}/`);
    const { PGlite } = load("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
    const { drizzle } = load("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
    const client = new PGlite();
    target = drizzle(client, { schema }) as unknown as DB;
    closeTarget = () => client.close();
    await migrateDemo(target);
  });

  after(async () => {
    const { closeDb } = await import("@/db");
    await closeDb();
    await closeTarget();
  });

  it("exports every table as NDJSON lines with counts only", async () => {
    const { exportTables, BACKUP_TABLES, tableName } = await import("@/lib/backup");
    const counts = await exportTables(source, (line) => {
      lines.push(line);
    });
    assert.deepEqual(Object.keys(counts), BACKUP_TABLES.map(tableName));
    assert.ok(counts.articles >= 8, `articles ${counts.articles}`);
    assert.equal(counts.push_subscriptions, 1);
    assert.equal(lines.length, Object.values(counts).reduce((a, b) => a + b, 0));
    for (const l of lines) assert.ok(l.endsWith("\n") && JSON.parse(l).t);
  });

  it("a dry run parses everything and writes nothing", async () => {
    const { importLines } = await import("@/lib/backup");
    const counts = await importLines(target, lines, { dryRun: true });
    assert.ok(counts.articles >= 8);
    const [r] = await rowsOf(target, sql`select count(*)::int as n from articles`);
    assert.equal(r.n, 0);
  });

  it("restores into an empty database with dates, numbers and JSON intact", async () => {
    const { importLines } = await import("@/lib/backup");
    const counts = await importLines(target, lines);
    for (const [table, n] of Object.entries(counts)) {
      const [r] = await rowsOf(target, sql`select count(*)::int as n from ${sql.identifier(table)}`);
      assert.equal(r.n, n, table);
    }
    const pick = sql`select id, slug, published_at, created_at, extracted_entities, tldr_summary from articles order by id limit 3`;
    assert.deepEqual(await rowsOf(target, pick), await rowsOf(source, pick));
    const decl = sql`select * from asset_declarations order by id`;
    assert.deepEqual(await rowsOf(target, decl), await rowsOf(source, decl), "bigint and numeric values");
    const snap = sql`select key, data, as_of, updated_at from indicator_snapshots order by key`;
    assert.deepEqual(await rowsOf(target, snap), await rowsOf(source, snap));
    const [vapid] = await rowsOf(target, sql`select value from app_settings where key = 'vapid_private_key'`);
    assert.equal(vapid.value, "test-only-not-a-real-key");
  });

  it("moves serial sequences past the restored ids and is safe to run twice", async () => {
    const { importLines } = await import("@/lib/backup");
    const [{ id }] = await target.insert(schema.sources).values({ name: "Шинэ", domain: "new.gov.mn", urlPattern: "https://new.gov.mn", category: "agency" }).returning({ id: schema.sources.id });
    const [{ max }] = await rowsOf(source, sql`select max(id)::int as max from sources`);
    assert.ok(id > Number(max), "a new row does not collide with a restored id");
    const again = await importLines(target, lines);
    assert.ok(again.articles >= 8);
    const [r] = await rowsOf(target, sql`select count(*)::int as n from articles`);
    assert.equal(r.n, again.articles, "upsert, no duplicates");
  });

  it("restores all or nothing: a bad line at the end leaves no rows behind", async () => {
    const { importLines } = await import("@/lib/backup");
    const before = (await rowsOf(target, sql`select count(*)::int as n from app_settings where key = 'restore-atomic-probe'`))[0].n;
    const probe = JSON.stringify({ t: "app_settings", r: { key: "restore-atomic-probe", value: "x", updatedAt: "2026-10-22T05:00:00.000Z" } });
    await assert.rejects(importLines(target, [probe, '{"t":"articles"}']), /not a backup line/);
    const after = (await rowsOf(target, sql`select count(*)::int as n from app_settings where key = 'restore-atomic-probe'`))[0].n;
    assert.equal(after, before);
  });

  it("a stray banner line on stdout does not void the restore (the backup pipes stdout into gzip)", async () => {
    const { importLines } = await import("@/lib/backup");
    const probe = JSON.stringify({ t: "app_settings", r: { key: "restore-banner-probe", value: "x", updatedAt: "2026-10-22T05:00:00.000Z" } });
    const counts = await importLines(target, ["▸ backup-db.ts · node v24.0.0 linux-x64 · commit abc1234 · db postgres (x)", probe]);
    assert.equal(counts.app_settings, 1);
    assert.equal((await rowsOf(target, sql`select count(*)::int as n from app_settings where key = 'restore-banner-probe'`))[0].n, 1);
  });

  it("restores only the tables asked for and refuses unknown ones", async () => {
    const { importLines } = await import("@/lib/backup");
    await target.update(schema.appSettings).set({ value: "changed" }).where(sql`key = 'vapid_private_key'`);
    const counts = await importLines(target, lines, { only: ["app_settings"] });
    assert.deepEqual(Object.keys(counts), ["app_settings"]);
    const [vapid] = await rowsOf(target, sql`select value from app_settings where key = 'vapid_private_key'`);
    assert.equal(vapid.value, "test-only-not-a-real-key");
    await assert.rejects(importLines(target, lines, { only: ["users"] }), /unknown table/);
    await assert.rejects(importLines(target, ['{"t":"pg_authid","r":{}}']), /unknown table/);
    await assert.rejects(importLines(target, ['{"t":"articles"}']), /not a backup line/);
  });

  it("records the finished backup for the watchdog", async () => {
    const { markBackup, BACKUP_LAST_KEY } = await import("@/lib/backup");
    await markBackup(source, new Date("2026-10-28T20:11:00Z"));
    const [r] = await rowsOf(source, sql`select value from app_settings where key = ${BACKUP_LAST_KEY}`);
    assert.equal(r.value, "2026-10-28T20:11:00.000Z");
  });
});
