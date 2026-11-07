import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { amountValue, largestAmount } from "@/lib/format";

import { toPrefixQuery } from "@/lib/search";

describe("search query", () => {
  it("builds a prefix query that survives Mongolian suffixes", () => {
    assert.equal(toPrefixQuery("Татварын тендер"), "татва:* & тендер:*");
    assert.equal(toPrefixQuery("УИХ"), "уих:*");
    assert.equal(toPrefixQuery("Оюу толгой 2025"), "оюу:* & толгой:* & 2025:*");
  });

  it("strips operators and injection attempts", () => {
    assert.equal(toPrefixQuery("a & b | !c ) ( ' ; --"), null);
    assert.equal(toPrefixQuery("тест' | drop:*"), "тест:* & drop:*");
    assert.equal(toPrefixQuery("   "), null);
  });

  it("caps the number of terms", () => {
    assert.equal(toPrefixQuery("aa bb cc dd ee ff gg hh")?.split(" & ").length, 6);
  });
});

describe("₮ chips", () => {
  it("reads amounts with Mongolian units and picks the largest", () => {
    assert.equal(amountValue("12,5 тэрбум ₮"), 12_500_000_000);
    assert.equal(amountValue("850 сая ₮"), 850_000_000);
    assert.equal(amountValue("1 250 000 ₮"), 1_250_000);
    assert.equal(largestAmount(["850 сая ₮", "1,2 тэрбум ₮", "3 000 000 ₮"]), "1,2 тэрбум ₮");
    assert.equal(largestAmount([]), undefined);
    // Nothing in ₮: no ₮ chip at all (the first entry used to be shown).
    assert.equal(largestAmount(["5 сая доллар"]), undefined);
    // A comma before three digits groups thousands, also before a unit word.
    assert.equal(amountValue("2,500 сая ₮"), 2_500_000_000);
    assert.equal(amountValue("12,5 тэрбум ₮"), 12_500_000_000);
  });

  it("reads mixed separators, refuses foreign currency and amounts without digits", () => {
    assert.equal(amountValue("1,250.5 сая ₮"), 1_250_500_000);
    assert.equal(amountValue("1.250.000 ₮"), 1_250_000);
    assert.equal(amountValue("4,500 ₮"), 4_500);
    assert.equal(amountValue("1.2 их наяд ₮"), 1_200_000_000_000);
    assert.equal(amountValue("хэдэн тэрбум ₮"), null);
    assert.equal(amountValue("250 мянган ам.доллар"), null);
    assert.equal(amountValue("ам.доллар 5 сая"), null);
    assert.equal(largestAmount(["250 мянган ам.доллар", "40 сая ₮"]), "40 сая ₮");
  });

  it("reads only amounts carrying a ₮ / төгрөг mark (Audit 6 W2)", () => {
    for (const t of ["3 сая хүн", "2 тэрбум кВт.ц", "2026 он", "1.5 тэрбум кВт.ц", "300 төгсөгч", "2 сая төгсөлтийн"]) assert.equal(amountValue(t), null, t);
    assert.equal(amountValue("2026 онд 5 тэрбум ₮"), 5_000_000_000);
    assert.equal(amountValue("5 тэрбум төгрөг"), 5_000_000_000);
    assert.equal(largestAmount(["2 тэрбум кВт.ц", "40 сая ₮"]), "40 сая ₮");
    assert.equal(largestAmount(["3 сая хүн"]), undefined);
  });
});
