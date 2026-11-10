import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import type { DB } from "@/db";

import { pinClock } from "./helpers/fixed-clock";

// In-memory database: this file runs in its own process, so the env change stays here.
process.env.DATABASE_URL = "pglite:memory";

let db: DB;
let legalId: number;
let districtId: number;

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: Row[] }).rows;

const legal = () => ({ id: legalId, domain: "legalinfo.mn", name: "Эрх зүйн мэдээлэл", urlPattern: "https://legalinfo.mn" });
const district = () => ({ id: districtId, domain: "judcouncil.mn", name: "Шүүхийн ерөнхий зөвлөл", urlPattern: "https://judcouncil.mn" });

describe("db-sink storage rules (PGlite)", () => {
  before(async () => {
    pinClock();
    const { getDb } = await import("@/db");
    const { migrateDemo } = await import("@/db/demo-migrate");
    db = getDb();
    await migrateDemo(db);
    legalId = Number((await rows(sql`insert into sources (name, domain, url_pattern, category) values ('Эрх зүйн мэдээлэл', 'legalinfo.mn', 'https://legalinfo.mn', 'ministry') returning id`))[0].id);
    districtId = Number((await rows(sql`insert into sources (name, domain, url_pattern, category) values ('Шүүхийн ерөнхий зөвлөл', 'judcouncil.mn', 'https://judcouncil.mn', 'ministry') returning id`))[0].id);
  });

  after(async () => {
    const { closeDb } = await import("@/db");
    await closeDb();
  });

  it("skips a second URL with the same text (content hash)", async () => {
    const { createDbSink } = await import("@/lib/scraper/db-sink");
    const sink = createDbSink(db);
    const text = "Засгийн газрын ээлжит хуралдаанаар төсвийн тодотгол хэлэлцлээ. ".repeat(10);
    const base = { title: "Төсвийн тодотгол хэлэлцлээ", text, publishedAt: new Date() };
    assert.equal(await sink.save(district(), { ...base, url: "https://judcouncil.mn/n/1" }), "inserted");
    assert.equal(await sink.save(district(), { ...base, url: "https://judcouncil.mn/n/2" }), "duplicate");
    // A new sink (a new run) finds it in the database, not only in its in-memory claim.
    assert.equal(await createDbSink(db).save(district(), { ...base, url: "https://judcouncil.mn/n/3" }), "duplicate");
  });

  it("a legalinfo.mn act keeps its own title when another act used it this month (the real list)", async () => {
    const { createDbSink } = await import("@/lib/scraper/db-sink");
    const { parseLegalinfoList } = await import("@/lib/scraper/adapters/legalinfo");
    const html = (JSON.parse(readFileSync("tests/fixtures/legalinfo-list.json", "utf8")) as { Html: string }).Html;
    const acts = parseLegalinfoList(html);
    const byTitle = new Map<string, typeof acts>();
    for (const a of acts) byTitle.set(a.title, [...(byTitle.get(a.title) ?? []), a]);
    const pair = [...byTitle.values()].find((list) => list.length >= 2);
    assert.ok(pair, "the fixture holds two acts with one title");
    const sink = createDbSink(db);
    const stored: string[] = [];
    for (const [i, act] of pair.entries()) {
      const text = `Батлагдсан байгууллага: ${act.issuer ?? "Яам"}\n\nДугаар ${i + 1}. ${act.title} гэж шийдвэрлэв. `.repeat(8);
      // The fixture lists both under one lawId; a later act reusing the title has its own URL.
      const url = `${act.url}&act=${i}`;
      assert.equal(await sink.save(legal(), { url, title: act.title, text, publishedAt: act.addedAt }), "inserted");
      stored.push(url);
    }
    const out = await rows(sql`select title from articles where original_url in (${sql.join(stored.map((u) => sql`${u}`), sql`, `)})`);
    assert.equal(out.length, stored.length);
    for (const r of out) {
      assert.ok(!String(r.title).startsWith("Батлагдсан байгууллага"), `title: ${r.title}`);
      assert.equal(String(r.title).toLowerCase().includes("тухай"), true, `the act's own title is kept: ${r.title}`);
    }
  });

  it("a crawled page whose title another page of the site used is still the site's title", async () => {
    const { createDbSink } = await import("@/lib/scraper/db-sink");
    const sink = createDbSink(db);
    const mk = (n: number, body: string) => ({ url: `https://judcouncil.mn/s/${n}`, title: "Шүүхийн мэдээ шинэ зарлал", text: `${body} `.repeat(20), publishedAt: new Date() });
    assert.equal(await sink.save(district(), mk(1, "Эхний мэдээний бие энд бичигдсэн байна.")), "inserted");
    assert.equal(await sink.save(district(), mk(2, "Хоёр дахь мэдээний өөр агуулга энд байна.")), "inserted");
    const [r] = await rows(sql`select title from articles where original_url = 'https://judcouncil.mn/s/2'`);
    assert.match(String(r.title), /^Хоёр дахь мэдээний/);
  });

  it("markNoText remembers a page without text, and filterNewUrls skips it", async () => {
    const { createDbSink, NO_TEXT_HASH } = await import("@/lib/scraper/db-sink");
    const sink = createDbSink(db);
    const url = "https://judcouncil.mn/photo/9";
    assert.deepEqual([...(await sink.filterNewUrls([url]))], [url]);
    await sink.markNoText?.(district(), url);
    await sink.markNoText?.(district(), url); // twice is fine
    const [r] = await rows(sql`select content_hash from seen_urls where original_url = ${url}`);
    assert.equal(r.content_hash, NO_TEXT_HASH);
    assert.equal((await sink.filterNewUrls([url])).size, 0);
  });

  it("the shared-date (stray stamp) rule applies to a normal run but not to a --days backfill", async () => {
    const { createDbSink } = await import("@/lib/scraper/db-sink");
    const day = new Date("2026-08-20T00:00:00Z"); // day-level, more than 30 days before the pinned clock
    await rows(sql`insert into sources (name, domain, url_pattern, category) values ('Стамп', 'stamp.gov.mn', 'https://stamp.gov.mn', 'ministry')`);
    const stampId = Number((await rows(sql`select id from sources where domain = 'stamp.gov.mn'`))[0].id);
    const stamp = { id: stampId, domain: "stamp.gov.mn", name: "Стамп", urlPattern: "https://stamp.gov.mn" };
    const item = (n: number) => ({ url: `https://stamp.gov.mn/n/${n}`, title: `Мэдээ дугаар ${n} шинэ тогтоол гарлаа`, text: `Тогтоолын ${n}-р хэсэг 2026 оны хуралд хэлэлцэгдэв. `.repeat(12), publishedAt: day });
    // Ten rows already carry that day.
    for (let n = 0; n < 10; n++) {
      await rows(sql`insert into articles (source_id, title, slug, original_url, content_hash, clean_content, published_at) values (${stampId}, ${`Өмнөх ${n}`}, ${`omnoh-${n}`}, ${`https://stamp.gov.mn/old/${n}`}, ${`h${n}`.padEnd(64, "0")}, 'x', ${day})`);
    }
    assert.equal(await createDbSink(db).save(stamp, item(100)), "inserted");
    const [normal] = await rows(sql`select scrape_meta->>'date_unknown' as unknown from articles where original_url = 'https://stamp.gov.mn/n/100'`);
    assert.equal(normal.unknown, "true", "a normal run treats the shared date as a stray stamp");

    assert.equal(await createDbSink(db, { maxAgeDays: 90 }).save(stamp, item(101)), "inserted");
    const [backfill] = await rows(sql`select scrape_meta->>'date_unknown' as unknown, published_at::text as at from articles where original_url = 'https://stamp.gov.mn/n/101'`);
    assert.equal(backfill.unknown, null, "a backfill keeps the real day");
    assert.match(String(backfill.at), /^2026-08-20/);
  });

  it("opendata.gov.mn: a dataset listed again under a new id within a week is not a new story", async () => {
    const { createDbSink, RELIST_DAYS } = await import("@/lib/scraper/db-sink");
    const id = Number((await rows(sql`insert into sources (name, domain, url_pattern, category) values ('Нээлттэй өгөгдөл', 'opendata.gov.mn', 'https://opendata.gov.mn', 'ministry') returning id`))[0].id);
    const src = { id, domain: "opendata.gov.mn", name: "Нээлттэй өгөгдөл", urlPattern: "https://opendata.gov.mn" };
    const item = (n: number, day: string) => ({ url: `https://opendata.gov.mn/dataview/${n}`, title: "Иргэний улсын бүртгэлийн нээлттэй өгөгдөл", text: `Нээлттэй өгөгдлийн багц: Иргэний улсын бүртгэл. Сүүлд шинэчлэгдсэн: ${day}. `.repeat(6), publishedAt: new Date() });
    const sink = createDbSink(db);
    assert.equal(await sink.save(src, item(8489, "2026-10-27")), "inserted");
    // The real case: the next day's listing, a new id and a new "last updated" line.
    assert.equal(await sink.save(src, item(8495, "2026-10-28")), "duplicate");
    assert.equal((await sink.filterNewUrls(["https://opendata.gov.mn/dataview/8495"])).size, 0, "remembered, not read again");
    // Another dataset is its own story, and the same one again after the window.
    assert.equal(await sink.save(src, { ...item(8496, "2026-10-28"), title: "Нэрийн болон хаягийн сан", text: "Нээлттэй өгөгдлийн багц: Нэрийн болон хаягийн сан. ".repeat(8) }), "inserted");
    await db.execute(sql`update articles set created_at = now() - make_interval(days => ${RELIST_DAYS + 1}) where source_id = ${id}`);
    assert.equal(await sink.save(src, item(8530, "2026-11-04")), "inserted");
  });

  it("which domains repeat titles by nature", async () => {
    const { repeatsTitles } = await import("@/lib/scraper/db-sink");
    for (const d of ["legalinfo.mn", "opendata.gov.mn", "parliament.mn", "zasag.mn", "police.gov.mn", "mof.gov.mn"]) assert.equal(repeatsTitles(d), true, d);
    assert.equal(repeatsTitles("judcouncil.mn"), false);
  });
});
