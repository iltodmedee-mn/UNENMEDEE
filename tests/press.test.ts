import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseNewsMn, parseRssItems } from "@/lib/press/feeds";
import { matchPress, namesClash, type GovDoc, type PressDoc } from "@/lib/press/match";
import { isPressBlindspot, PRESS_TRACKING_FROM } from "@/lib/press/outlets";

const day = 86_400_000;
const t0 = new Date("2026-11-02T04:00:00Z");

describe("press feeds", () => {
  it("reads RSS titles, links and dates, never the description", () => {
    const xml = `<rss version="2.0"><channel><title>X</title>
      <item><title>Төрийн албан хаагчийн цалин нэмэгдэнэ</title><link>https://ikon.mn/n/abc</link>
        <description><![CDATA[<p>Урт текст</p>]]></description><pubDate>Wed, 28 Oct 2026 18:15:00 +0800</pubDate></item>
      <item><title>Богино</title><link>https://ikon.mn/n/b</link></item>
      <item><title>Линкгүй мэдээний гарчиг</title></item>
    </channel></rss>`;
    const items = parseRssItems(xml);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0], { url: "https://ikon.mn/n/abc", title: "Төрийн албан хаагчийн цалин нэмэгдэнэ", publishedAt: new Date("2026-10-28T10:15:00Z") });
  });

  it("builds news.mn links from ids and dates them by when we found them", () => {
    const found = new Date("2026-10-28T12:00:00Z");
    const items = parseNewsMn([{ id: 2895850, title: { rendered: "Хэрэг хэлэлцүүлэхээс &#8220;татгалзлаа&#8221;" } }, { id: "x", title: { rendered: "Буруу id-тай мэдээ" } }, { id: 5, title: {} }], found);
    assert.deepEqual(items, [{ url: "https://news.mn/r/2895850/", title: "Хэрэг хэлэлцүүлэхээс “татгалзлаа”", publishedAt: found }]);
    assert.deepEqual(parseNewsMn({ error: 1 }, found), []);
  });
});

describe("press matching", () => {
  // Real headlines from Oct 2026.
  const gov: GovDoc[] = [
    { id: 1, title: "Төрийн үйлчилгээний 52 мянган албан хаагчийн үндсэн цалинг нэмэгдүүллээ", summary: "Засгийн газар цалин нэмэх шийдвэр гаргалаа.", publishedAt: t0 },
    { id: 2, title: "УИХ-ын гишүүн О.Батнайрамдал “Нээлттэй парламент” танхимд ажиллалаа", summary: "Иргэдтэй уулзлаа.", publishedAt: t0 },
    { id: 3, title: "Өнгөрсөн хоногт: Нийт нутгаар цаг агаар тогтуун байлаа", summary: "Цаг агаар.", publishedAt: t0 },
    { id: 4, title: "Ган үйлдвэрлэлийн цогцолбор төслийн хөрөнгө оруулагчийг сонгон шалгаруулна", summary: "Төсөл.", publishedAt: t0 },
  ];
  const press: PressDoc[] = [
    { id: 10, title: "ТАНИЛЦ: Ирэх сарын 1-нээс нэмэгдэх төрийн үйлчилгээний албан хаагчийн цалингийн дүн", publishedAt: new Date(t0.getTime() + day) },
    { id: 11, title: "УИХ-ын гишүүн Ч.Лодойсамбуу “Нээлттэй парламент” танхимд ажиллалаа", publishedAt: t0 },
    { id: 12, title: "Өдөртөө бага зэрэг дулаарна", publishedAt: t0 },
    { id: 13, title: "Төрийн үйлчилгээний албан хаагчийн цалин нэмэгдэнэ", publishedAt: new Date(t0.getTime() + 9 * day) },
    { id: 14, title: "Дэлхийн аварга шалгаруулах тэмцээнд хүрэл медаль хүртлээ", publishedAt: t0 },
    { id: 15, title: "Монгол Улсын хөгжлийн банк шинэ зээл олголоо", publishedAt: t0 },
  ];
  const matches = matchPress(gov, press);
  const pairs = matches.map((m) => `${m.articleId}-${m.pressId}`);

  it("links the same event worded differently", () => {
    assert.ok(pairs.includes("1-10"), JSON.stringify(matches));
  });

  it("keeps different people's routine news apart", () => {
    assert.ok(!pairs.includes("2-11"));
    assert.ok(namesClash("УИХ-ын гишүүн О.Батнайрамдал …", "УИХ-ын гишүүн Ч.Лодойсамбуу …"));
    assert.ok(!namesClash("О.Батнайрамдал уулзлаа", "О.Батнайрамдал: шинэ хууль"));
    assert.ok(!namesClash("Засгийн газар шийдвэрлэлээ", "Ч.Лодойсамбуу ажиллалаа"));
  });

  it("ignores unrelated stories and press outside the time window", () => {
    assert.ok(!pairs.includes("3-12"));
    assert.ok(!pairs.includes("1-13"), "9 days later is outside the window");
    assert.ok(!matches.some((m) => m.pressId === 14 || m.pressId === 15));
  });
});

describe("press blindspot", () => {
  const base = { importanceScore: 80, publishedAt: new Date(PRESS_TRACKING_FROM.getTime() + day), pressCount: 0 };
  const later = new Date(base.publishedAt.getTime() + 2 * day);
  it("is an important story a day old that no outlet had", () => {
    assert.ok(isPressBlindspot(base, later));
  });
  it("never applies to minor, covered, fresh, undated or pre-tracking stories", () => {
    assert.ok(!isPressBlindspot({ ...base, importanceScore: 50 }, later));
    assert.ok(!isPressBlindspot({ ...base, importanceScore: null }, later));
    assert.ok(!isPressBlindspot({ ...base, pressCount: 1 }, later));
    assert.ok(!isPressBlindspot(base, new Date(base.publishedAt.getTime() + 3_600_000)));
    assert.ok(!isPressBlindspot({ ...base, dateUnknown: true }, later));
    assert.ok(!isPressBlindspot({ ...base, publishedAt: new Date(PRESS_TRACKING_FROM.getTime() - day) }, later));
  });
  it("never claims «not found» when a feed was not read while the story was fresh", () => {
    assert.ok(isPressBlindspot(base, later, 3));
    assert.ok(!isPressBlindspot(base, later, 2));
    assert.ok(!isPressBlindspot(base, later, 0));
  });
});

describe("press feed dates without a zone", () => {
  it("are Ulaanbaatar time, not UTC", () => {
    const rss = `<rss><channel><item><title>Нэг сайн гарчиг энд</title><link>https://ikon.mn/n/1</link><pubDate>2026-11-05 17:41:00</pubDate></item></channel></rss>`;
    assert.equal(parseRssItems(rss)[0].publishedAt?.toISOString(), "2026-11-05T09:41:00.000Z");
  });
});
