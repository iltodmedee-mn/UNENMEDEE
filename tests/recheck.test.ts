import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareTexts, decide, splitSentences } from "@/lib/scraper/recheck";

const STORED = [
  "Засгийн газрын хуралдаанаар орон нутгийн авто замын санд 761,1 сая төгрөг төвлөрүүлэхээр шийдвэрлэлээ.",
  "Энэ хөрөнгөөр аймгуудын төвийг холбосон 12 замыг засварлана.",
  "Ажлыг 2026 оны 11 дүгээр сарын 30-ны дотор дуусгахыг сайд үүрэг болголоо.",
  "Тендерийн урилгыг ирэх долоо хоногт нийтэлнэ гэж яамнаас мэдээллээ.",
].join("\n");

const prev = { status: null, missingCount: 0, checkedAt: null };

describe("source recheck", () => {
  it("drops dates, counters and short lines from sentences", () => {
    assert.deepEqual(splitSentences("2026-10-21 10:30\n1,204 уншсан\nНүүр\n" + STORED).length, 4);
  });

  it("is ok when the page only added widgets around our text", () => {
    const fresh = `Холбоотой мэдээ: Өөр нэг мэдээний гарчиг энд байна.\n${STORED}\n3,512 уншсан\nСүүлийн мэдээнүүд: Бусад гарчиг байрлана.`;
    const d = decide(prev, STORED, { kind: "text", text: fresh });
    assert.equal(d.status, "ok");
  });

  it("flags a changed number with a before/after pair", () => {
    const fresh = STORED.replace("761,1 сая", "561,1 сая");
    const c = compareTexts(STORED, fresh);
    assert.equal(c.numbersChanged, true);
    assert.equal(c.pairs.length, 1);
    const d = decide(prev, STORED, { kind: "text", text: fresh });
    assert.equal(d.status, "changed");
    assert.match(d.diff!.pairs[0].after, /561,1/);
  });

  it("flags removed paragraphs", () => {
    const fresh = STORED.split("\n").slice(0, 2).join("\n") + "\nШинэ өгүүлбэр нэмэгдсэн бөгөөд энэ нь урт байна.";
    const d = decide(prev, STORED, { kind: "text", text: fresh });
    assert.equal(d.status, "changed");
    assert.equal(d.diff!.removed.length + d.diff!.pairs.length, 2);
  });

  it("skips failed extraction and fetch errors", () => {
    assert.equal(decide(prev, STORED, { kind: "text", text: "Нүүр хуудас" }).status, null);
    assert.equal(decide(prev, STORED, { kind: "error" }).status, null);
  });

  it("skips copies too short to judge and ignores attachment labels", () => {
    const stored = "Эрдэс баялгийн мэргэжлийн зөвлөлийн хуралдаан боллоо.\n2026 10 05 ЭБМЗ-ийн дүрэм төсөлDownload";
    const fresh = "Эрдэс баялгийн мэргэжлийн зөвлөлийн хуралдаан боллоо.\nЭБМЗ-ийн дүрмийн төсөл (PDF)\n" + "Цэс ".repeat(80);
    assert.equal(decide(prev, stored, { kind: "text", text: fresh }).status, null);
    assert.deepEqual(splitSentences("Үндэсний_хиймэл_дагуул_ерөнхий_санал_авах_RFIТатах\nGeneral_RFI_National_Communication_Satellite_Project ENGТатах"), []);
  });

  it("compares a glued title+date+counter+body blob in pieces", () => {
    const body = STORED.replace(/\n/g, " ");
    const stored = `АЛБА ХААГЧИД ФЕСТИВАЛЬД ХАМРАГДЛАА 2026-10-19 33 ${body}`;
    const fresh = `Алба хаагчид фестивальд хамрагдлаа\n2026-10-19\n412 уншсан\n${STORED}\nХолбоотой мэдээ: Өөр нэг мэдээний гарчиг энд байна.`;
    assert.equal(decide(prev, stored, { kind: "text", text: fresh }).status, "ok");
    // The same glued blob a week later, with a higher view count after the date.
    assert.equal(decide(prev, stored, { kind: "text", text: stored.replace("2026-10-19 33", "2026-10-19 69") }).status, "ok");
  });

  it("calls a page gone only after two misses days apart", () => {
    const now = new Date("2026-10-24T00:00:00Z");
    const first = decide(prev, STORED, { kind: "missing" }, now);
    assert.deepEqual(first, { status: null, missingCount: 1 });
    const sameDay = decide({ status: null, missingCount: 1, checkedAt: now }, STORED, { kind: "missing" }, new Date("2026-10-24T05:00:00Z"));
    assert.deepEqual(sameDay, { status: null, missingCount: 1 });
    const week = decide({ status: null, missingCount: 1, checkedAt: now }, STORED, { kind: "missing" }, new Date("2026-10-31T00:00:00Z"));
    assert.deepEqual(week, { status: "gone", missingCount: 2 });
  });
});

describe("source recheck: our own lines", () => {
  it("ignores the issuer line legalinfo.ts adds, so a short act is not 'changed'", () => {
    const body = "Нэгдүгээр заалт энд байна. Хоёрдугаар заалт энд байна. Гуравдугаар заалт энд байна.";
    const c = compareTexts(`Батлагдсан байгууллага: Засгийн газар\n\n${body}`, body);
    assert.equal(c.containment, 1);
    assert.equal(c.compared, 3);
  });

  it("ignores page furniture the Nov 2026 re-check read as edits (real production rows)", () => {
    // bayan-olgii.khural.mn: only the site poll's vote count moved.
    const poll = (n: number) => `${STORED}\nТА KHURAL.MN –Д ЯМАР ЧИГЛЭЛИЙН МЭДЭЭ ОРУУЛАХ ХЭРЭГТЭЙ ГЭЖ ҮЗЭЖ БАЙНА ВЭ?санал өгсөн: ${n}`;
    assert.equal(decide(prev, poll(11279), { kind: "text", text: poll(11283) }).status, "ok");
    // nema.gov.mn: a footer e-mail line and the agency's name in capitals are not article text.
    const footer = `${STORED}\nalternate_emailinfo@nema.gov.mn\nОНЦГОЙ БАЙДЛЫН ЕРӨНХИЙ ГАЗАР ЗАСГИЙН ГАЗРЫН ТОХИРУУЛАГЧ`;
    assert.equal(decide(prev, footer, { kind: "text", text: STORED }).status, "ok");
    // judcouncil.mn: the same text with a space after a full stop.
    const glued = `${STORED}\nШалгалтын дэлгэрэнгүй хуваарьтай танилцана уу.Шүүгчийн сонгон шалгаруулалтын журам.`;
    const spaced = `${STORED}\nШалгалтын дэлгэрэнгүй хуваарьтай танилцана уу. Шүүгчийн сонгон шалгаруулалтын журам.`;
    assert.equal(decide(prev, glued, { kind: "text", text: spaced }).status, "ok");
  });

  it("calls a re-read that matches almost none of our text unreadable, not changed", () => {
    // mongolbank.mn #2248: 0 of 12 sentences found: the getter read another block.
    const other = Array.from({ length: 6 }, (_, i) => `Огт өөр мэдээллийн жагсаалтын ${i + 1}-р мөр энд бичигдсэн байна.`).join("\n");
    assert.equal(decide(prev, STORED, { kind: "text", text: other }).status, null);
  });
});

describe("source recheck: related-news sidebar", () => {
  // nema.gov.mn #2218 (Nov 2026): stored with the site's "Шинэ мэдээ" list; the page re-read
  // without its headline and with the list moved on matched 0.71 and read as "changed".
  const body = [
    "Онцгой байдлын ерөнхий газрын даргын 2026 оны А/398 дугаар тушаалын дагуу ОБЕГ, нийслэлийн хүрээний Онцгой байдлын байгууллагын алба хаагчдыг 2026 оны 10 дугаар сарын 26-ны өдрөөс хүйтний улирлын хувцсанд шилжүүллээ.",
    "Хүйтний улирлын хувцсанд шилжсэнтэй холбогдуулан Монгол Улсын Ерөнхийлөгчийн 2024 оны 141 дүгээр зарлигаар баталсан “Цэргийн дүрэмт хувцас, цол, ялгах тэмдгийн загвар”, Зэвсэгт хүчний Жанжин штабын даргын 2024 оны А/777 дугаар тушаалаар баталсан “Цэргийн дүрэмт хувцас өмсөх дүрэм”-ийн хэрэгжилтийг хангах хүрээнд хувцасны болон жагсаалын нэгдсэн үзлэг, цэргийн тангараг давтах ажиллагааг зохион байгууллаа.",
    "Орон нутгийн Онцгой байдлын байгууллагын алба хаагчдыг 2026 оны 11 дүгээр сарын 02-ны өдөрт багтаан бүс нутгийн онцлогт тохируулан хүйтний улирлын хувцсанд бүсийн даргын тушаалаар шилжүүүлэх юм.",
  ];
  const stored = [
    "Алба хаагчид хүйтний улирлын хувцсанд шилжлээ",
    "calendar_today2026-10-30",
    ...body,
    "Бусад мэдээлэл",
    "calendar_today2026/10/30",
    "Шинэ мэдээ",
    "Эрсдэлээ шалгая, аюулгүй байдлаа хангая",
    "Өнөөдөр буюу аравдугаар сарын 29. Энэ өдөр таны амьдарч байгаа орчин, ажиллаж байгаа газар, айл, өрхийнхөө болоод өөрийн эрсдэлийг тооцож, үүсэж болзошгүй аюулаас урьдчилан сэргийлэх өдөр.",
  ].join("\n\n");

  it("compares only the text before a related-news heading", () => {
    const sentences = splitSentences(stored);
    assert.ok(!sentences.some((s) => s.includes("Эрсдэлээ шалгая")));
    const c = compareTexts(stored, body.join("\n\n"));
    assert.ok(c.containment >= 0.8, `containment ${c.containment}`);
    assert.equal(decide({ status: "changed", missingCount: 0, checkedAt: null }, stored, { kind: "text", text: body.join("\n\n") }).status, "ok");
  });

  it("keeps a real edit before the heading", () => {
    const edited = body.map((b) => b.replace("26-ны", "29-ний").replace("02-ны", "09-ний")).join("\n\n");
    assert.equal(decide({ status: "ok", missingCount: 0, checkedAt: null }, stored, { kind: "text", text: edited }).status, "changed");
  });

  it("never cuts at a heading on the first line", () => {
    assert.ok(splitSentences("Шинэ мэдээ\n\n" + body[0]).length > 0);
  });
});
