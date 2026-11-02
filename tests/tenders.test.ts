import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { recentMonths } from "@/lib/procurement/fetch";
import { amount, methodLabel, parseTenders, resultDate, tenderQuery, unitSuspect } from "@/lib/procurement/tenders";

// Real rows from Шилэн данс form 1831 (Nov 2026): awarded lots, an empty-code row, an undated lot,
// "оролцогч ирээгүй", a "-" code, a 2029 typo date, a month-only date, a decimal amount, ШХА.
const rows = JSON.parse(readFileSync(new URL("./fixtures/shilendans-tenders.json", import.meta.url), "utf8")) as Record<string, unknown>[];
const TODAY = "2026-11-02";

describe("tenders: Шилэн данс form 1831", () => {
  const tenders = parseTenders([rows], 2026, TODAY);

  it("keeps only rows with a real tender code and item", () => {
    assert.ok(tenders.length > 0);
    for (const t of tenders) assert.match(t.code, /^[\p{L}\d-]+\/\d{8,14}$/u);
    assert.ok(!tenders.some((t) => t.code === "-"));
  });

  it("reads an awarded lot as filed", () => {
    const t = tenders.find((x) => x.code === "ССАЖЗЯ/20260101060");
    assert.ok(t);
    assert.equal(t.budgetMnt, 1_070_000_000);
    assert.equal(t.contractMnt, 1_068_516_025);
    assert.equal(t.winner, "Монголиа бюлдинг консалтинг групп");
    assert.equal(t.method, "Нээлттэй тендер");
    assert.equal(t.resultDate, "2026-08-10");
    assert.equal(t.awarded, true);
  });

  it("never counts a 'nobody came' cell as an award", () => {
    const t = tenders.find((x) => /ирээгүй/.test(x.winner ?? ""));
    assert.ok(t);
    assert.equal(t.awarded, false);
  });

  it("an award needs both a winner and an amount", () => {
    for (const t of tenders) if (t.awarded) assert.ok(t.winner && t.contractMnt);
  });

  it("dates: real days only, inside the report year, not in the future", () => {
    assert.equal(resultDate("2026-04-15", 2026, TODAY), "2026-04-15");
    assert.equal(resultDate("2026.05.13", 2026, TODAY), "2026-05-13");
    assert.equal(resultDate("2026/05/025", 2026, TODAY), "2026-05-25");
    assert.equal(resultDate("2026.04", 2026, TODAY), null);
    assert.equal(resultDate("2029.01.29", 2026, TODAY), null);
    assert.equal(resultDate("2026-02-30", 2026, TODAY), null);
    assert.equal(resultDate("2026-12-01", 2026, TODAY), null);
    assert.equal(resultDate("2025-12-20", 2026, TODAY), "2025-12-20");
    assert.equal(resultDate(null, 2026, TODAY), null);
  });

  it("amounts: whole tögrög, decimals rounded, junk refused", () => {
    assert.equal(amount("355543123.27"), 355_543_123);
    assert.equal(amount("1 070 000 000"), 1_070_000_000);
    assert.equal(amount("0"), null);
    assert.equal(amount("1,2 тэрбум"), null);
    assert.equal(amount(null), null);
  });

  it("method abbreviations", () => {
    assert.equal(methodLabel("НТШ"), "Нээлттэй тендер");
    assert.equal(methodLabel("НТША"), "Нээлттэй тендер");
    assert.equal(methodLabel("ХА"), "Харьцуулалтын арга");
    assert.equal(methodLabel("харьцуулалт"), "Харьцуулалтын арга");
    assert.equal(methodLabel("ШХА"), "Шууд гэрээ");
    assert.equal(methodLabel("Ерөнхий гэрээний арга"), "Ерөнхий гэрээ");
    assert.equal(methodLabel(null), null);
  });

  it("merges the same lot across monthly filings, the later filing filling the gaps", () => {
    const base = { A: "БЯ/20260102163", B: "Лабораторийн тоног төхөөрөмж", C: "180000000", E: "НТШ", name: "Боловсролын яам", registerNo: "9116621" };
    const merged = parseTenders([[{ ...base }], [{ ...base, D: "179000000", G: "Тест ХХК", J: "2026-05-02" }]], 2026, TODAY);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].awarded, true);
    assert.equal(merged[0].contractMnt, 179_000_000);
    assert.equal(merged[0].resultDate, "2026-05-02");
  });

  it("flags amounts in an unclear unit instead of rescaling them", () => {
    // Орхон (Nov 2026): "337 230" for a 337 сая contract, a 4.17 тэрбум contract against "4 343 956".
    assert.equal(unitSuspect(373_868, 337_230), true);
    assert.equal(unitSuspect(4_343_956, 4_174_085_524), true);
    assert.equal(unitSuspect(423_450_130, 423_450), true);
    assert.equal(unitSuspect(1_070_000_000, 1_068_516_025), false);
    assert.equal(unitSuspect(null, 180_000_000), false);
    assert.equal(unitSuspect(30_923_700_000, 29_521_914_636), false);
    const t = tenders.find((x) => x.code === "ССАЖЗЯ/20260101060");
    assert.equal(t?.unitSuspect, false);
  });

  it("asks for one group and month", () => {
    const q = tenderQuery(117, 2026, 10);
    assert.deepEqual([q.reportFormId, q.reportGroupIds, q.years, q.months], [1831, [117], [2026], [10]]);
  });

  it("recent report months cross the year in Ulaanbaatar time", () => {
    assert.deepEqual(recentMonths(new Date("2026-01-15T00:00:00Z"), 3), [
      { year: 2026, month: 1 },
      { year: 2025, month: 12 },
      { year: 2025, month: 11 },
    ]);
    // 2026-10-31 20:00 UTC is already November 1 in Ulaanbaatar.
    assert.deepEqual(recentMonths(new Date("2026-10-31T20:00:00Z"), 1), [{ year: 2026, month: 11 }]);
  });
});
