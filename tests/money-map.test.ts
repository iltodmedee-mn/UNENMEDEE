import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMoneyMap } from "@/lib/money-map/build";
import { aimagOf, ALL_PLACES, AIMAGS, centreOf, placeIn, placeKey } from "@/lib/money-map/regions";

describe("money map places", () => {
  it("one spelling for Cyrillic and GeoNames' Latin", () => {
    assert.equal(placeKey("Ханбогд"), placeKey("Hanbogd"));
    assert.equal(placeKey("Ханбогд"), placeKey("Khanbogd"));
    assert.equal(placeKey("Завхан"), placeKey("Dzavhan"));
    assert.equal(placeKey("Баян-Өлгий"), placeKey("Bayan-Ölgiy"));
    assert.notEqual(placeKey("Баянзүрх"), placeKey("Баянгол"));
  });

  it("every aimag has a centre, and the data has the sums", () => {
    for (const a of AIMAGS) assert.ok(centreOf(a), a);
    assert.ok(ALL_PLACES.filter((p) => p.kind === "sum").length > 250);
  });

  it("the aimag comes from the budget governor, else the buyer's name; ministries have none", () => {
    assert.equal(aimagOf({ governor: "Өмнөговь", orgName: "Ханбогд сумын ЗДТГ" }), "Өмнөговь");
    assert.equal(aimagOf({ governor: "Нийслэл", orgName: "Нийслэлийн ЗДТГ" }), "Улаанбаатар");
    assert.equal(aimagOf({ governor: "Говь-сүмбэр", orgName: "x" }), "Говьсүмбэр");
    assert.equal(aimagOf({ governor: "Хууль зүй, дотоод хэргийн сайд", orgName: "Завхан аймгийн цагдаагийн газар" }), "Завхан");
    assert.equal(aimagOf({ governor: "Эрүүл мэндийн сайд", orgName: "Сонгинохайрхан дүүргийн эрүүл мэндийн төв" }), "Улаанбаатар");
    assert.equal(aimagOf({ governor: "Эрүүл мэндийн сайд", orgName: "Цэргийн төв эмнэлэг" }), null);
    // Sükhbaatar the aimag, not the Ulaanbaatar district
    assert.equal(aimagOf({ governor: null, orgName: "Сүхбаатар аймгийн Засаг даргын Тамгын газар" }), "Сүхбаатар");
  });

  it("a sum, town or district the text names, inside that aimag only", () => {
    assert.equal(placeIn("Өмнөговь аймгийн Даланзадгад хотын захирагчийн ажлын алба", "Өмнөговь")?.name, "Даланзадгад");
    assert.equal(placeIn("Сонгинохайрхан дүүргийн засаг даргын тамгын газар", "Улаанбаатар")?.kind, "district");
    assert.equal(placeIn("Сонгинохайрхан дүүргийн засаг даргын тамгын газар", "Өмнөговь"), null);
    assert.equal(placeIn("Боловсролын газар", "Өмнөговь"), null);
  });
});

describe("buildMoneyMap", () => {
  const lot = (o: Partial<{ title: string; orgName: string; governor: string | null; winner: string | null; contractMnt: number | null }>) => ({
    title: "Барилга",
    orgName: "Газар",
    governor: null,
    winner: "Х ХХК",
    contractMnt: 1_000_000,
    resultDate: "2026-05-01",
    ...o,
  });

  it("sums by aimag and place, keeps national lots apart, skips empty amounts, biggest first", () => {
    const m = buildMoneyMap(
      [
        lot({ governor: "Өмнөговь", orgName: "Өмнөговь аймгийн Даланзадгад хотын захирагчийн ажлын алба", contractMnt: 5e9 }),
        lot({ governor: "Өмнөговь", orgName: "Өмнөговь аймгийн Боловсролын газар", contractMnt: 2e9 }),
        lot({ governor: "Нийслэл", orgName: "Баянзүрх дүүргийн ЗДТГ", contractMnt: 3e9 }),
        lot({ governor: "Сангийн сайд", orgName: "Сангийн яам", contractMnt: 9e9 }),
        lot({ governor: "Өмнөговь", contractMnt: null }),
      ],
      2026,
      new Date("2026-11-11T00:00:00Z"),
    );
    assert.deepEqual(m.aimags.map((a) => [a.aimag, a.mnt, a.count]), [["Өмнөговь", 7e9, 2], ["Улаанбаатар", 3e9, 1]]);
    assert.deepEqual(m.national, { mnt: 9e9, count: 1 });
    assert.equal(m.points[0].name, "Даланзадгад");
    assert.equal(m.points.find((p) => p.kind === "district")?.name, "Баянзүрх");
    // The aimag-only lot sits on the aimag centre (Dalanzadgad), so that point holds both.
    assert.equal(m.points.filter((p) => p.aimag === "Өмнөговь").length, 1);
    assert.equal(m.points[0].count, 2);
  });
});
