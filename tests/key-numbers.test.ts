import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contextFor, keyNumbers, numberValues } from "@/lib/key-numbers";

describe("keyNumbers", () => {
  it("splits digits from units, sorts by value and shares amounts of 1 тэрбум and more", () => {
    const rows = keyNumbers(["94 тэрбум ₮", "186.2 тэрбум төгрөг", "450 сая ₮"], ["Эрчим хүчний салбарт 186.2 тэрбум төгрөгийн төсөв баталлаа.", "Засварт 94 тэрбум."]);
    assert.deepEqual(
      rows.map((r) => [r.number, r.unit, r.share !== null, r.context]),
      [
        ["186.2", "тэрбум төгрөг", true, "Эрчим хүчний салбарт 186.2 тэрбум төгрөгийн төсөв баталлаа."],
        ["94", "тэрбум ₮", true, "Засварт 94 тэрбум."],
        ["450", "сая ₮", false, null],
      ],
    );
    assert.equal(rows[0].share, "≈ 54 400₮");
  });
  it("keeps one row per value and unparsed text as it is", () => {
    const rows = keyNumbers(["12 тэрбум ₮", "12 тэрбум төгрөг", "хэдэн сая ₮"], []);
    assert.deepEqual(
      rows.map((r) => [r.number, r.unit, r.value]),
      [
        ["12", "тэрбум ₮", 12e9],
        ["хэдэн сая ₮", "", null],
      ],
    );
  });
  it("finds the context when the fact uses the other decimal mark and cuts long sentences", () => {
    const long = `Хураамж 12,5 тэрбум төгрөг ${"байна ".repeat(40)}`.trim();
    const [row] = keyNumbers(["12.5 тэрбум ₮"], [long]);
    assert.ok(row.context?.endsWith("…"));
    assert.ok(row.context!.length <= 161);
  });
  it("never pairs an amount with a sentence about another number (production cases, Nov 2026)", () => {
    const ctx = (amount: string, facts: string[]) => keyNumbers([amount], facts)[0].context;
    assert.equal(ctx("90 тэрбум төгрөг", ["Эрчим хүчний системийн нийт суурилагдсан хүчин чадал: 1905 МВт"]), null);
    assert.equal(ctx("2 их наяд ₮", ["Хуралдаан 2026.10.27-ны 14:16 цагт эхэлсэн"]), null);
    assert.equal(ctx("20 гаруй тэрбум ₮", ["2026-09-08 огноо"]), null);
    assert.equal(ctx("7.9 тэрбум төгрөг", ["Нийт 1,907,944 га талбай өртсөн (ойн 11,278 га, хээрийн 1,896,666 га)"]), null);
    assert.equal(ctx("1 тэрбум ₮", ["Огноо: 2026.10.26"]), null);
    assert.equal(ctx("1.5 тэрбум ₮", ["Нийт 11.5 тэрбум төгрөг"]), null);
    assert.equal(ctx("5 тэрбум ₮", ["2025 онд 15 тэрбум төгрөг зарцуулна.", "Нийт 5 тэрбум төгрөг"]), "Нийт 5 тэрбум төгрөг");
    assert.equal(ctx("12 тэрбум ₮", ["2012 оноос хойш 120 сая төгрөг", "10-р сарын 12-нд хуралдсан"]), null);
  });
  it("matches grouped and decimal spellings of the same number", () => {
    const ctx = (amount: string, facts: string[]) => keyNumbers([amount], facts)[0].context;
    assert.equal(ctx("4 500 000 ₮", ["Цалинг 4 500 000 төгрөг болгоно."]), "Цалинг 4 500 000 төгрөг болгоно.");
    assert.equal(ctx("4 500 000 ₮", ["Цалинг 4,500,000 төгрөг болгоно."]), "Цалинг 4,500,000 төгрөг болгоно.");
    assert.equal(ctx("51.4 сая ₮", ["51,4 сая төгрөгийн хохирол"]), "51,4 сая төгрөгийн хохирол");
    assert.equal(ctx("186.2 тэрбум ₮", ["Төсөв 186.2 болно."]), "Төсөв 186.2 болно.");
  });
  it("reads written numbers as values", () => {
    assert.deepEqual([...numberValues("1,250.5")], ["1250.5"]);
    assert.deepEqual([...numberValues("1 250,5")], ["1250.5"]);
    assert.deepEqual([...numberValues("4 500 000")], ["4500000"]);
    assert.deepEqual([...numberValues("1.250")].sort(), ["1.25", "1250"]);
    assert.deepEqual([...numberValues("2026.10.27")], []);
  });
  it("caps the list", () => {
    assert.equal(keyNumbers(["1 сая ₮", "2 сая ₮", "3 сая ₮", "4 сая ₮", "5 сая ₮", "6 сая ₮"], []).length, 5);
  });
});

describe("the scale word must follow the number (Nov 2026 audit)", () => {
  it("does not pair 5 тэрбум with a sentence about 5 schools and 12 тэрбум", () => {
    const facts = ["2025 онд 5 сургууль барихад 12 тэрбум төгрөг зарцуулна.", "Нийт 5 тэрбум төгрөгийн хөрөнгө оруулалт."];
    assert.equal(contextFor("5", "тэрбум ₮", facts), facts[1]);
    assert.equal(contextFor("5", "тэрбум ₮", [facts[0]]), null);
  });
});
