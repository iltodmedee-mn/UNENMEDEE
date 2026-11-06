import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buyerSigns, isNonCompetitive, nationalShares, overBudgetPct, type BuyerStats } from "@/lib/procurement/signs";

describe("procurement warning signs", () => {
  it("counts direct contracts and single-source purchases as non-competitive, nothing else", () => {
    for (const m of ["Шууд гэрээ", "шууд гэрээ байгуулах", "Нэг эх үүсвэр", "нэг эх үүсвэрээс", "ШГБ"]) assert.equal(isNonCompetitive(m), true, m);
    for (const m of ["Нээлттэй тендер", "Харьцуулалтын арга", "Ерөнхий гэрээ", "Зөвлөх үйлчилгээ", null]) assert.equal(isNonCompetitive(m), false, String(m));
  });

  it("flags a contract above its budget in whole percent, never one at or under it or with an unclear unit", () => {
    assert.equal(overBudgetPct({ budgetMnt: 100_000_000, contractMnt: 112_000_000, unitSuspect: false }), 12);
    assert.equal(overBudgetPct({ budgetMnt: 100_000_000, contractMnt: 100_200_000, unitSuspect: false }), 1);
    assert.equal(overBudgetPct({ budgetMnt: 100_000_000, contractMnt: 100_000_000, unitSuspect: false }), null);
    assert.equal(overBudgetPct({ budgetMnt: 100_000_000, contractMnt: 99_000_000, unitSuspect: false }), null);
    assert.equal(overBudgetPct({ budgetMnt: 4_343_956, contractMnt: 4_170_000_000, unitSuspect: true }), null);
    assert.equal(overBudgetPct({ budgetMnt: null, contractMnt: 5_000_000, unitSuspect: false }), null);
    assert.equal(overBudgetPct({ budgetMnt: 0, contractMnt: 5_000_000, unitSuspect: false }), null);
  });

  const stats: BuyerStats[] = [
    { orgName: "А сургууль", lots: 3, topWinner: "Нэг ХХК", topWinnerLots: 3, nonCompetitiveLots: 3 },
    { orgName: "Б яам", lots: 10, topWinner: "Хоёр ХХК", topWinnerLots: 6, nonCompetitiveLots: 1 },
    { orgName: "В аймаг", lots: 8, topWinner: "Гурав ХХК", topWinnerLots: 2, nonCompetitiveLots: 5 },
    { orgName: "Г агентлаг", lots: 20, topWinner: "Дөрөв ХХК", topWinnerLots: 9, nonCompetitiveLots: 9 },
  ];

  it("flags a buyer only with enough lots and at half or more, strongest first", () => {
    const signs = buyerSigns(stats);
    assert.deepEqual(
      signs.map((s) => [s.orgName, s.kind, s.pct, s.count]),
      [
        ["В аймаг", "non_competitive", 63, 5],
        ["Б яам", "concentration", 60, 6],
      ],
    );
    assert.equal(signs.find((s) => s.kind === "concentration")?.winner, "Хоёр ХХК");
    assert.ok(!signs.some((s) => s.orgName === "А сургууль"), "3 lots are too few to call a share");
    assert.ok(!signs.some((s) => s.orgName === "Г агентлаг"), "45 % is under half");
  });

  it("gives the national share and how many buyers show each sign", () => {
    assert.deepEqual(nationalShares(stats, 1000, 69), { nonCompetitivePct: 6.9, buyers: 3, concentrated: 1, nonCompetitive: 1 });
    assert.equal(nationalShares([], 0, 0).nonCompetitivePct, 0);
  });
});
