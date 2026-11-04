import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Tier1Schema } from "@/lib/ai/schemas";
import { cutLeakedJson, LEAKED_KEYS, stripBullet, tldrSentences } from "@/lib/format";
import { looksEmptyBody } from "@/lib/scraper/titles";

import { TIER1_OK } from "./helpers/mock-llm";

// Nov 2026: three things reached the home page that should not have. Real production text.
describe("gov.mn posts with an empty body block", () => {
  // #2403: an image-only post; the extractor read only the page chrome (289 characters).
  const empty =
    "2026 ОНЫ АРАВДУГААР САРЫН ОНЦЛОХ АЖИЛмэдээ•2026-11-02 14:37•0• Н.ЭрдэнэболдЭдийн засагНийгэмНийгмийн хамгаалалНийтлэгч байгууллагаТөв аймгийн засаг даргын тамгын газарОнцлох мэдээнүүд Сэтгэгдэл (0) Та сэтгэгдэл бичихдээ хууль зүйн болон ёс суртахууныг баримтална уу. Мэдээлэл байхгүй байна";

  it("are not news", () => {
    assert.equal(looksEmptyBody(empty), true);
    assert.equal(looksEmptyBody(`${empty}.\n`), true);
  });

  it("a story with a body is news, even when the comment box says the same words", () => {
    const body = "Засгийн газрын хуралдаанаар 2027 оны төсвийн төслийг хэлэлцэж, УИХ-д өргөн мэдүүлэхээр шийдвэрлэлээ. ".repeat(10);
    assert.equal(looksEmptyBody(`${body}Сэтгэгдэл (0) Мэдээлэл байхгүй байна`), false);
    assert.equal(looksEmptyBody("Хилийн боомтууд 11 дүгээр сард ажиллах болон түр хаах цагийн хуваарь гарлаа. Иргэд, тээвэрлэгчид хуваарийг харгалзана уу."), false);
  });
});

describe("summary lines written as a list", () => {
  it("lose the model's '- ' / '• ' marker (the teaser read '- Шүүхийн ерөнхий зөвлөл…')", () => {
    assert.deepEqual(tldrSentences("- Шүүхийн ерөнхий зөвлөл сургалт эхлүүллээ.\n• 34 мэргэжилтэн хамрагдана."), ["Шүүхийн ерөнхий зөвлөл сургалт эхлүүллээ.", "34 мэргэжилтэн хамрагдана."]);
    assert.equal(stripBullet("— Засгийн газар шийдвэрлэлээ."), "Засгийн газар шийдвэрлэлээ.");
  });

  it("keep numbers and minus signs that start a sentence", () => {
    assert.equal(stripBullet("-5 хэм хүртэл хүйтэрнэ."), "-5 хэм хүртэл хүйтэрнэ.");
    assert.equal(stripBullet("34 шүүх мэргэжилтэн сургалтад хамрагдлаа."), "34 шүүх мэргэжилтэн сургалтад хамрагдлаа.");
  });

  it("are stored without the marker", () => {
    const ok = JSON.parse(TIER1_OK);
    const r = Tier1Schema.parse({ ...ok, tldr_summary: "- Нэгдүгээр өгүүлбэр энд байна.\n- Хоёрдугаар өгүүлбэр энд байна." });
    assert.equal(r.tldr_summary, "Нэгдүгээр өгүүлбэр энд байна.\nХоёрдугаар өгүүлбэр энд байна.");
  });
});

describe("a reply whose summary holds the rest of the JSON", () => {
  it("fails, so the repair retry runs instead of publishing it (#2403)", () => {
    const ok = JSON.parse(TIER1_OK);
    const leaked = "- Хуудас хоосон байна.\n- Шийдвэр, тоо дурдагдаагүй.','facts': ['Огноо: 2026-11-02'], 'spin_detected': 'Илрээгүй', 'importance_score': 0, 'topic': 'society'}society{";
    assert.equal(Tier1Schema.safeParse({ ...ok, tldr_summary: leaked }).success, false);
    assert.equal(Tier1Schema.safeParse(ok).success, true);
  });
});

describe("summaries stored with the model's JSON reply inside (Nov 2026: #2366, #2369, #2431)", () => {
  // Shortened from production row #2369.
  const leaked =
    "- Хамтарсан хорооны 10 дахь хуралдаан 2026 оны 10 дугаар сарын 30-нд Сөүл хотноо болсон.\n- БНСУ Монгол иргэдэд цахимаар шуурхай жуулчлалын виз олгох тогтолцоог эхлүүлсэн.','facts': ['Огноо: 2026 оны 10 дугаар сарын 30'],'spin_detected': 'Илэрхий пи-ар илрээгүй.','neutrality_score': 95,'impact': {'who': 'Монгол иргэд'}}sain uu?{";

  it("shows only the summary lines, never the keys or the junk after them", () => {
    assert.deepEqual(tldrSentences(leaked), [
      "Хамтарсан хорооны 10 дахь хуралдаан 2026 оны 10 дугаар сарын 30-нд Сөүл хотноо болсон.",
      "БНСУ Монгол иргэдэд цахимаар шуурхай жуулчлалын виз олгох тогтолцоог эхлүүлсэн.",
    ]);
    assert.doesNotMatch(cutLeakedJson(leaked), /facts|sain uu|[{}'"]$/);
  });

  it("leaves a normal summary with quotes alone", () => {
    const ok = 'Засгийн газар "Чөлөөлье" санаачилгыг эхлүүллээ.';
    assert.equal(cutLeakedJson(ok), ok);
    assert.equal(LEAKED_KEYS.test(ok), false);
  });
});

describe("a one-line summary with leaked JSON is cut (Nov 2026 audit)", () => {
  it("does not show the leak again", () => {
    assert.deepEqual(tldrSentences("Нэг өгүүлбэр.', 'facts': ['a']"), ["Нэг өгүүлбэр."]);
  });
});
