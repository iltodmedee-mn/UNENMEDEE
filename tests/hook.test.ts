import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hookWords } from "@/lib/social/hook";

const hot = (t: string) =>
  hookWords(t)
    .filter((w) => w.hot)
    .map((w) => w.word)
    .join(" ");

describe("hook highlight", () => {
  it("marks the first number with its units and the next word", () => {
    assert.equal(hot("Нийслэлд 250 мянган ам.долларын систем суурилуулав"), "250 мянган ам.долларын систем");
    assert.equal(hot("Төмс хураалт 100 хувь дуусаж"), "100 хувь дуусаж");
    assert.equal(hot("ҮАГ 20 аудитын тайланг нийтэллээ"), "20 аудитын");
  });

  it("stops at a clause end and never runs into the next number", () => {
    assert.equal(hot("Хадлан 57, тэжээл 75 хувь"), "57,");
    assert.equal(hot("195.5 мянган өрхийн 61.8 сая мал"), "195.5 мянган өрхийн");
  });

  it("skips a year and strips brackets around the number", () => {
    assert.equal(hot("2026 оны төсөвт 1.2 их наяд төгрөг нэмэгдлээ"), "1.2 их наяд төгрөг");
    assert.equal(hot("Шинэ журам (250 мянган ₮ торгууль) батлагдлаа"), "(250 мянган ₮ торгууль)");
    assert.equal(hot("2026 онд хэрэгжинэ"), "");
  });

  it("leaves headlines without numbers plain", () => {
    assert.equal(hot("Шинэ хууль батлагдлаа"), "");
    assert.equal(hookWords("Шинэ хууль").length, 2);
  });
  it("highlights a ₮ amount written currency-first, as the plain headlines do", () => {
    const hot = hookWords("Хөгжлийн бэрхшээлтэй хүний тэтгэвэр 11-р сарын 1-нээс ₮600,000 болно")
      .filter((w) => w.hot)
      .map((w) => w.word);
    assert.deepEqual(hot, ["₮600,000", "болно"]);
  });

  it("highlights a number typed with space thousands as one number", () => {
    const words = (t: string) => hot(t).split(" ");
    assert.deepEqual(words("2027 оноос 792 000 ₮ хүртэлх цалин татваргүй"), ["792", "000", "₮", "хүртэлх"]);
    assert.deepEqual(words("Тэтгэвэр 1 000 000 төгрөг болно"), ["1", "000", "000", "төгрөг", "болно"]);
    assert.deepEqual(words("4 500 айл орон сууцтай болно"), ["4", "500", "айл"]);
  });

  it("a year followed by 'он:' is a year, not the fact", () => {
    assert.equal(hot("2026 он: 5 тэрбум төгрөг"), "5 тэрбум төгрөг");
  });
});
