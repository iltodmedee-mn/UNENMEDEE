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
    // A duplicate of a stored article remembers its URL, so the next run does not fetch it again
    // (audit D-3). One caught only by this run's in-memory claim does not: that save may still fail.
    const seen = (await db.execute(sql`select original_url from seen_urls where original_url like 'https://judcouncil.mn/n/%' order by 1`)).rows.map((r) => (r as { original_url: string }).original_url);
    assert.deepEqual(seen, ["https://judcouncil.mn/n/3"]);
  });

  it("a save that fails gives its claim back, so the same text can be saved again in the run", async () => {
    const { createDbSink } = await import("@/lib/scraper/db-sink");
    const { articles } = await import("@/db/schema");
    let failOnce = true;
    const flaky = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "insert")
          return (table: unknown) => {
            if (table === articles && failOnce) {
              failOnce = false;
              throw new Error("connection reset");
            }
            return target.insert(table as typeof articles);
          };
        return Reflect.get(target, prop, receiver);
      },
    });
    const sink = createDbSink(flaky);
    const item = { title: "Шинэ тогтоол гарлаа", text: "Засгийн газрын ээлжит хуралдаанаар шинэ тогтоол баталлаа. ".repeat(10), publishedAt: new Date(), url: "https://judcouncil.mn/retry/1" };
    await assert.rejects(sink.save(district(), item));
    assert.equal(await sink.save(district(), item), "inserted");
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

  it("one notice posted again by the same source is not a new story (Арвайхээр land auction, Nov 2026)", async () => {
    const { createDbSink, REPOST_DAYS } = await import("@/lib/scraper/db-sink");
    const id = Number((await rows(sql`insert into sources (name, domain, url_pattern, category) values ('Засгийн газар', 'repost.gov.mn', 'https://repost.gov.mn', 'ministry') returning id`))[0].id);
    const src = { id, domain: "repost.gov.mn", name: "Засгийн газар", urlPattern: "https://repost.gov.mn" };
    const title = "2026 оны Газар зохион байгуулалтын төлөвлөгөөний дагуу ГАЗАР ЭЗЭМШҮҮЛЭХ ДУУДЛАГА ХУДАЛДААГ";
    // The real posts: the same text, only the parcel numbers differ (and one "танхимын" for "танхим").
    const body = (parcel: string, plan: string, hall = "танхим") =>
      `Аймгийн засаг даргын 2026 оны 11 дүгээр сарын 19-ний өдрийн А/676 дугаар захирамжийг үндэслэн 2026 оны 12 дугаар сарын 10-ний өдрийн 11:00-13:00 цагт танхимаар зохион байгуулагдана. Арвайхээр сумын 13-р баг, шинэ музейн зүүн талд ${parcel} нэгж талбар (${plan} төлөвлөлтийн нэгж талбар)-ын дугаар бүхий 5-8 давхар нийтийн орон сууцны зориулалттай газарт орон сууцны тохижилтийн талбайг нэмэх шаардлагаар 280м2 газарт ${hall} дуудлага худалдаа зарлаж байна. Бүртгэл: оролцогчид дэнчин, тэмдэгтийн хураамж төлж материалаа бүрдүүлнэ.`;
    const at = new Date(Date.now() - 3_600_000);
    const item = (n: string, text: string, extra: Partial<{ title: string; publishedAt: Date }> = {}) => ({ url: `https://repost.gov.mn/news/n/${n}`, title, text, publishedAt: at, ...extra });
    const sink = createDbSink(db);
    assert.equal(await sink.save(src, item("f393", body("6216000212", "5016017"))), "inserted");
    assert.equal(await sink.save(src, item("f391", body("6216000822", "5016018", "танхимын"))), "duplicate");
    assert.equal(await sink.save(src, item("f390", body("6216000259", "5016019"))), "duplicate");
    assert.equal((await sink.filterNewUrls(["https://repost.gov.mn/news/n/f391"])).size, 0, "remembered, not read again");
    // The same body under another title (judcouncil.mn: one text per candidate, the name only in the title) stays.
    assert.equal(await sink.save(src, item("f400", body("6216000300", "5016020"), { title: "Нэр дэвшигч Б.Болормаагийн танилцуулга" })), "inserted");
    // Same title, a different notice.
    assert.equal(await sink.save(src, item("f401", "Өвөрхангай аймгийн Засаг даргын захирамжаар Хархорин сумын бэлчээрийн даацын судалгааг хийж, малчдад танилцуулах уулзалт зохион байгуулна. ".repeat(3))), "inserted");
    // The listing's cut title for the same notice is the same post.
    assert.equal(await sink.save(src, item("f392", body("6216000823", "5016021"), { title: `${title.slice(0, 60)}…` })), "duplicate");
    // A future event date is stored as "found now", and the repost is matched on that date too (CodeRabbit on #341).
    const ahead = new Date(Date.now() + 10 * 86_400_000);
    // An undated text needs a current year to be published (isTimelessPage).
    const meeting = `${new Date().getFullYear()} оны ирэх сарын 10-нд болох их уулзалтын зар: бүртгэл, байршил, хөтөлбөр. `.repeat(4);
    assert.equal(await sink.save(src, item("f700", meeting, { title: "Их уулзалтын зар", publishedAt: ahead })), "inserted");
    assert.equal(await sink.save(src, item("f701", `${meeting}Утас 2.`, { title: "Их уулзалтын зар", publishedAt: ahead })), "duplicate");
    // Same notice posted again outside the window: a new round, a new story.
    assert.equal(await sink.save(src, item("f500", body("6216000999", "5016099"), { publishedAt: new Date(at.getTime() - (REPOST_DAYS + 1) * 86_400_000) })), "inserted");
  });

  it("sameTitle: equal, or cut short with an ellipsis", async () => {
    const { sameTitle } = await import("@/lib/scraper/db-sink");
    const whole = "ГЕГ: 2026 оны эхний 10 сард манай улс 3.71 мян.Тонн ямааны самнасан ноолуур, 88.9 сая.Тн чулуун нүүрс экспортолжээ";
    assert.equal(sameTitle(whole, "ГЕГ: 2026 оны эхний 10 сард манай улс 3.71 мян.Тонн ямааны самнасан ноолуур, 88.9 сая.Тн чулуун нүүрс…"), true);
    assert.equal(sameTitle(whole, whole), true);
    // A shorter title that is not marked as cut is another headline.
    assert.equal(sameTitle(whole, "ГЕГ: 2026 оны эхний 10 сард манай улс 3.71 мян.Тонн ямааны самнасан ноолуур"), false);
    // Two names behind one cut prefix stay apart.
    assert.equal(sameTitle("Иргэний хэргийг харьяалан шийдвэрлэх давж заалдах шатны шүүхийн шүүгчид нэр дэвшигч Б.Нармандах", "Иргэний хэргийг харьяалан шийдвэрлэх давж заалдах шатны шүүхийн шүүгчид нэр дэвшигч Б.Дэлгэрцэцэг"), false);
  });

  it("bodySimilarity ignores numbers and counts distinct words", async () => {
    const { bodySimilarity } = await import("@/lib/scraper/db-sink");
    assert.equal(bodySimilarity("Нэгж талбар 6216000212 дуудлага худалдаа", "Нэгж талбар 6216000259 дуудлага худалдаа"), 1);
    assert.equal(bodySimilarity("", "дуудлага худалдаа"), 0);
    assert.ok(bodySimilarity("Хархорин сумын бэлчээрийн судалгаа", "Арвайхээр сумын газрын дуудлага") < 0.3);
  });

  it("which domains repeat titles by nature", async () => {
    const { repeatsTitles } = await import("@/lib/scraper/db-sink");
    for (const d of ["legalinfo.mn", "opendata.gov.mn", "parliament.mn", "zasag.mn", "police.gov.mn", "mof.gov.mn"]) assert.equal(repeatsTitles(d), true, d);
    assert.equal(repeatsTitles("judcouncil.mn"), false);
  });
});
