import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readerViewFor } from "@/lib/ai/reader-batch";
import { cleanImpact, cleanReaderTitle, groundingSource, numbersGrounded, sourceDigits } from "@/lib/ai/reader-view";
import { Tier1Schema } from "@/lib/ai/schemas";

const TITLE = "Арваннэгдүгээр сарын 1-нээс хөгжлийн бэрхшээлтэй хүнд олгох нийгмийн халамжийн тэтгэврийн хэмжээг нэмэгдүүлэх тухай";
const TEXT = "Засгийн газрын тогтоолоор тэтгэврийн хэмжээ 600,000 төгрөг болно. Иргэд e-Mongolia-д 11-р сарын 15-ны дотор бүртгэлээ шинэчилнэ. 2026 онд 4 500 хүн хамрагдана.";
const digits = groundingSource(TITLE, TEXT, new Date("2026-10-20T03:00:00Z"));

describe("reader view grounding", () => {
  it("accepts numbers the source printed, with or without separators", () => {
    assert.ok(numbersGrounded("Тэтгэвэр ₮600,000 болно", digits));
    assert.ok(numbersGrounded("Тэтгэвэр 600000 төгрөг", digits));
    assert.ok(numbersGrounded("4500 хүн", digits));
    assert.ok(numbersGrounded("2026-10-20-нд", digits));
  });

  it("does not check month numbers written as words in the source", () => {
    assert.ok(numbersGrounded("11-р сарын 1-нээс", digits));
  });

  it("rejects a number the source never printed", () => {
    assert.ok(!numbersGrounded("Тэтгэвэр ₮650,000 болно", digits));
    assert.ok(!numbersGrounded("12 000 хүн", digits));
  });

  it("keeps a plain headline only when it is new, sane and grounded", () => {
    assert.equal(cleanReaderTitle("Хөгжлийн бэрхшээлтэй хүний тэтгэвэр 11-р сарын 1-нээс ₮600,000 болно.", TITLE, digits), "Хөгжлийн бэрхшээлтэй хүний тэтгэвэр 11-р сарын 1-нээс ₮600,000 болно");
    assert.equal(cleanReaderTitle("Тэтгэвэр ₮700,000 болно", TITLE, digits), null);
    assert.equal(cleanReaderTitle(TITLE, TITLE, digits), null);
    assert.equal(cleanReaderTitle("ТЭТГЭВЭР НЭМЭГДЛЭЭ ГЭНЭ ҮҮ", TITLE, digits), null);
    assert.equal(cleanReaderTitle("Богино", TITLE, digits), null);
    assert.equal(cleanReaderTitle("x".repeat(120), TITLE, digits), null);
    assert.equal(cleanReaderTitle(null, TITLE, digits), null);
  });

  it("keeps each impact field alone and drops placeholders", () => {
    const impact = cleanImpact(
      { who: "Хөгжлийн бэрхшээлтэй иргэд", change: "Сарын тэтгэвэр 600,000 төгрөг болно", when: "11-р сарын 1-нээс", action: "e-Mongolia-д 11-р сарын 15-ны дотор бүртгэлээ шинэчлэх" },
      digits,
    );
    assert.deepEqual(impact, {
      who: "Хөгжлийн бэрхшээлтэй иргэд",
      change: "Сарын тэтгэвэр 600,000 төгрөг болно",
      when: "11-р сарын 1-нээс",
      action: "e-Mongolia-д 11-р сарын 15-ны дотор бүртгэлээ шинэчлэх",
    });
    const partial = cleanImpact({ who: "null", change: "Тэтгэвэр 900,000 болно", when: "удахгүй", action: "Бүртгэлээ шинэчилнэ" }, digits);
    assert.deepEqual(partial, { who: null, change: null, when: null, action: "Бүртгэлээ шинэчилнэ" });
  });

  it("returns null when nothing says what changes for the reader", () => {
    assert.equal(cleanImpact({ who: "бүх иргэд", change: null, when: null, action: "тодорхойгүй" }, digits), null);
    assert.equal(cleanImpact("ямар нэг текст", digits), null);
  });

  it("matches whole numbers and amounts, not digits hidden inside other numbers", () => {
    const src = "Төсөв 15,000,000 төгрөг, нийт 1,500,000,000 төгрөг. 500 өрх 2026 онд хамрагдана.";
    // The old digit-substring check accepted these: "5" is inside "2026", "50" inside "500".
    assert.ok(!numbersGrounded("5 өрх хамрагдана", src));
    assert.ok(!numbersGrounded("50 өрх хамрагдана", src));
    assert.ok(numbersGrounded("500 өрх хамрагдана", src));
    assert.ok(numbersGrounded("15 сая төгрөг", src));
    assert.ok(numbersGrounded("1.5 тэрбум төгрөг", src));
    assert.ok(numbersGrounded("1,5 тэрбум төгрөг", src));
    assert.ok(!numbersGrounded("2 тэрбум төгрөг", src));
    assert.ok(numbersGrounded("15,000,000 төгрөг", "Төсөв 15 сая төгрөг"));
  });

  it("dates the source by the Ulaanbaatar day", () => {
    // 2026-10-19 17:30 UTC is 2026-10-20 01:30 in Ulaanbaatar.
    const src = groundingSource("Гарчиг", "Текст", new Date("2026-10-19T17:30:00Z"));
    assert.ok(numbersGrounded("20-нд", src));
    assert.ok(!numbersGrounded("19-нд", src));
  });

  it("parses the Tier-1 fields loosely and never fails the answer because of them", () => {
    const base = { tldr_summary: "Тэтгэврийн хэмжээ нэмэгдэнэ. Хөгжлийн бэрхшээлтэй иргэд хамрагдана.", facts: [], spin_detected: "", neutrality_score: 80, entities: {}, risk_score: 5, risk_reason: "" };
    const none = Tier1Schema.parse(base);
    assert.equal(none.reader_title, null);
    assert.equal(none.impact, null);
    const junk = Tier1Schema.parse({ ...base, reader_title: 42, impact: ["x"] });
    assert.equal(junk.reader_title, null);
    assert.equal(junk.impact, null);
  });

  it("backfills from the headline, summary and facts with the same checks", () => {
    const item = { id: 7, title: TITLE, summary: "Тэтгэвэр 600,000 төгрөг болно.", facts: ["11-р сарын 1-нээс"] };
    const ok = readerViewFor(item, { title: "Тэтгэвэр 11-р сарын 1-нээс ₮600,000 болно", who: "Хөгжлийн бэрхшээлтэй иргэд", change: "Тэтгэвэр нэмэгдэнэ", when: null, action: null });
    assert.equal(ok.title, "Тэтгэвэр 11-р сарын 1-нээс ₮600,000 болно");
    assert.equal(ok.impact?.who, "Хөгжлийн бэрхшээлтэй иргэд");
    assert.deepEqual(readerViewFor(item, { title: "Тэтгэвэр ₮1,000,000 болно" }), { title: null, impact: null });
    // Another story's answer under this id (the model shifted its list by one): dropped.
    const shifted = readerViewFor(item, { title: "Улаанбаатарын агаарын бохирдол буурлаа", who: "Нийслэлийн оршин суугчид", change: "Агаарын чанар сайжирна", when: null, action: null });
    assert.deepEqual(shifted, { title: null, impact: null });
    assert.equal(sourceDigits("600, 000 ба 4 500"), "600000 ба 4500");
  });
});
