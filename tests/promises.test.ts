import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";

import { ALL_DIRECTIONS, ALL_GOALS, PROGRAMME } from "@/lib/promises";
import { directionId, directionSlug, docxParagraphs, isMeasurable, parseProgramme, programmeClock } from "@/lib/promises/programme";
import { readZipEntry } from "@/lib/promises/zip";

// The shape of the official annex (State Great Khural resolution No. 21 of 2024, annex 1).
const ANNEX = `Монгол Улсын Их Хурлын 2024 оны 21 дугаар тогтоолын 1 дүгээр хавсралт
МОНГОЛ УЛСЫН ЗАСГИЙН ГАЗРЫН 2024-2028
ОНЫ ҮЙЛ АЖИЛЛАГААНЫ ХӨТӨЛБӨР
Хамтарсан Засгийн газрыг байгуулсан.
Дараах 14 мега төслийг хэрэгжүүлэхээр төлөвлөлөө:
1.Тавантолгойн 450 МВт-ын дулааны цахилгаан станцыг барина.
Нэмэлт тайлбар мөр.
2.Үндэсний хиймэл дагуулыг хөөргөнө.
НЭГ.БҮСЧИЛСЭН ХӨГЖЛИЙН БОДЛОГО
Бүс нутагт амьдрахад таатай нөхцөлийг бий болгоно.
1.1.Улаанбаатар хот-“20 минутын хот” стандарт
1.1.1.Хот төлөвлөлт, засаглалын шинэчлэл
1.1.1.1.“20 минутын хот” бодлогын баримт бичгийг боловсруулна.
1.1.1.2.Ипотекийн зээлийн 50-иас багагүй хувийг гэр хорооллын өрхөд олгоно.
ХОЁР.ХҮНИЙ ХӨГЖЛИЙН БОДЛОГО
2.1.Чинээлэг монгол хүн
2.1.1.Гэр бүлийг дэмжих бодлого
Гэр бүл
2.1.1.1.Гэр бүлийн хөгжлийг дэмжинэ.
Хүүхэд
2.1.1.2.Хүүхдийн мөнгийг олгоно.
Энэ зорилтын хоёр дахь догол мөр нь урт бөгөөд цэгээр төгссөн өгүүлбэр байна.
---оОо---
3.1.Энэ мөрийг уншихгүй`;

describe("government programme parser", () => {
  const p = parseProgramme(ANNEX);
  it("splits policies, directions, sections and goals by the programme's own numbering", () => {
    assert.deepEqual(
      p.policies.map((x) => [x.n, x.title]),
      [
        [1, "Бүсчилсэн хөгжлийн бодлого"],
        [2, "Хүний хөгжлийн бодлого"],
      ],
    );
    assert.equal(p.policies[0].intro, "Бүс нутагт амьдрахад таатай нөхцөлийг бий болгоно.");
    const d = p.policies[0].directions[0];
    assert.equal(d.id, "1.1");
    assert.equal(d.sections[0].id, "1.1.1");
    assert.deepEqual(
      d.sections[0].goals.map((g) => g.id),
      ["1.1.1.1", "1.1.1.2"],
    );
  });
  it("keeps unnumbered headings as goal groups and follow-up paragraphs in the goal", () => {
    const goals = p.policies[1].directions[0].sections[0].goals;
    assert.deepEqual(
      goals.map((g) => g.group),
      ["Гэр бүл", "Хүүхэд"],
    );
    assert.match(goals[1].text, /^Хүүхдийн мөнгийг олгоно\. Энэ зорилтын хоёр дахь/);
  });
  it("reads the mega projects from the preamble and stops at the end mark", () => {
    assert.deepEqual(p.megaProjects, ["Тавантолгойн 450 МВт-ын дулааны цахилгаан станцыг барина. Нэмэлт тайлбар мөр.", "Үндэсний хиймэл дагуулыг хөөргөнө."]);
    assert.ok(p.preamble.includes("Дараах 14 мега төслийг хэрэгжүүлэхээр төлөвлөлөө:"));
    assert.ok(!JSON.stringify(p).includes("уншихгүй"));
  });
  it("marks goals whose text names a number with a unit", () => {
    assert.ok(isMeasurable("Хүрэн нүүрсний ордыг түшиглэсэн 300 МВт-ын станц барина."));
    assert.ok(isMeasurable("замын хөдөлгөөний эрчмийг 30 хувиар нэмэгдүүлнэ"));
    assert.ok(isMeasurable("20,000 айлыг орон сууцжуулна"));
    assert.ok(isMeasurable("Ипотекийн зээлийн 50-иас багагүй хувийг олгоно."));
    assert.ok(isMeasurable("770 га газарт"));
    assert.ok(!isMeasurable("“20 минутын хот” бодлогын баримт бичгийг боловсруулна."));
    assert.ok(!isMeasurable("1 удаа орон сууцны дулаалгын ажлыг хийнэ."));
    assert.ok(!isMeasurable("2025 оныг “Залуучуудын жил” болгон зарлана."));
  });
  it("maps direction ids to URL slugs and refuses anything else", () => {
    assert.equal(directionSlug("3.4"), "3-4");
    assert.equal(directionId("3-4"), "3.4");
    assert.equal(directionId("4-14"), "4.14");
    assert.equal(directionId("../x"), null);
    assert.equal(directionId("3.4"), null);
  });
});

describe("docx reading", () => {
  it("joins a paragraph's runs and decodes entities", () => {
    const xml = `<w:body><w:p><w:r><w:t>1.1.Улаан</w:t></w:r><w:r><w:t xml:space="preserve">баатар &amp; хот</w:t></w:r></w:p><w:p><w:r><w:t>2</w:t></w:r></w:p></w:body>`;
    assert.equal(docxParagraphs(xml), "1.1.Улаанбаатар & хот\n2");
  });
  it("reads a deflated entry from a ZIP archive", () => {
    const name = Buffer.from("word/document.xml");
    const body = Buffer.from("<w:p>Сайн уу</w:p>".repeat(20));
    const data = deflateRawSync(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const cdAt = local.length + name.length + data.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + name.length, 12);
    end.writeUInt32LE(cdAt, 16);
    const zip = Buffer.concat([local, name, data, central, name, end]);
    assert.equal(readZipEntry(zip, "word/document.xml")?.toString("utf8"), body.toString("utf8"));
    assert.equal(readZipEntry(zip, "missing.xml"), null);
    assert.equal(readZipEntry(Buffer.from("not a zip at all, just text padding here"), "word/document.xml"), null);
  });
});

describe("imported programme (src/lib/promises/programme-2024.json)", () => {
  it("has the official structure: 4 policies, 16 directions, 620 goals, 14 mega projects, unique ids", () => {
    assert.equal(PROGRAMME.policies.length, 4);
    assert.equal(ALL_DIRECTIONS.length, 16);
    assert.equal(ALL_GOALS.length, 620);
    assert.equal(PROGRAMME.megaProjects.length, 14);
    assert.equal(new Set(ALL_GOALS.map((g) => g.id)).size, ALL_GOALS.length);
    for (const { direction } of ALL_DIRECTIONS) for (const s of direction.sections) for (const g of s.goals) assert.ok(g.id.startsWith(`${s.id}.`), g.id);
    assert.match(PROGRAMME.sourceUrl, /^https:\/\/legalinfo\.mn\//);
  });
});

describe("programme clock", () => {
  it("counts the days from approval to the programme's end, as time passed and never as goals met", () => {
    assert.deepEqual(programmeClock("2024-08-27", "2024-08-27"), { totalDays: 1404, daysLeft: 1404, elapsedPct: 0 });
    assert.deepEqual(programmeClock("2026-11-06", "2024-08-27"), { totalDays: 1404, daysLeft: 603, elapsedPct: 57 });
    assert.deepEqual(programmeClock("2028-07-01", "2024-08-27"), { totalDays: 1404, daysLeft: 0, elapsedPct: 100 });
    assert.deepEqual(programmeClock("2030-01-01", "2024-08-27"), { totalDays: 1404, daysLeft: 0, elapsedPct: 100 });
    assert.equal(programmeClock("2024-01-01", "2024-08-27").elapsedPct, 0, "before approval nothing has passed");
  });
});
