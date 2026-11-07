import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attendanceHighlight, blacklistHighlight, fxHighlight, macroHighlight, salaryHighlight, tendersHighlight } from "@/lib/opendata-mn/highlights";
import { formatMntShort, formatUsd } from "@/lib/format";

// Column names copied from the live API (suffixes and stray spaces included).
const fx = (code: string, rate: number, date: string) => ({ "EN (37)": code, "MN (37)": code, "Rate (37)": rate, "date (37)": `${date}T00:00:00Z` });

describe("opendata.mn highlights", () => {
  it("FX: latest rates and the 30-day change", () => {
    const h = fxHighlight([fx("USD", 3500, "2026-09-01"), fx("USD", 3570, "2026-10-08"), fx("CNY", 500, "2026-10-08"), fx("XXX", 1, "2026-10-08")]);
    assert.ok(h?.kind === "fx");
    assert.equal(h.asOf, "2026-10-08");
    assert.deepEqual(
      h.rates.map((r) => [r.code, r.rate, r.changePct]),
      [
        ["USD", 3570, 2],
        ["CNY", 500, null],
      ],
    );
    assert.equal(h.usdSeries.length, 2);
  });

  it("macro: one series per indicator, latest last", () => {
    const row = (name: string, date: string, value: number) => ({ "Макро эдийн засгийн үзүүлэлт": name, Огноо: date, Утга: value, "Хэмжих нэгж": "хувь" });
    const h = macroHighlight([row("Инфляци", "2025-07", 8.1), row("Инфляци", "2025-06", 7.9), row("Ажилгүйдэл", "2025-07", 4.5)]);
    assert.ok(h?.kind === "macro");
    const inflation = h.indicators.find((i) => i.name === "Инфляци")!;
    assert.deepEqual(inflation.latest, { label: "2025-07", value: 8.1 });
    assert.equal(inflation.unit, "хувь");
  });

  it("salary: national series and sector extremes of the latest quarter", () => {
    const row = (sector: string, q: string, v: number) => ({ Салбар: sector, Улирал: q, Утга: v });
    const h = salaryHighlight([row("Улсын дундаж", "2025-1", 2500), row("Улсын дундаж", "2025-2", 2700), row("   Уул уурхай", "2025-2", 5000), row("Хөдөө аж ахуй", "2025-2", 1500)]);
    assert.ok(h?.kind === "salary");
    assert.equal(h.national, 2700);
    assert.equal(h.top[0].label, "Уул уурхай");
    assert.equal(h.bottom[0].label, "Хөдөө аж ахуй");
  });

  it("blacklist: only bans that are still in force", () => {
    const row = (name: string, end: string) => ({ "Байгууллагын нэр": name, "Бүртгэлийн дугаар": 1, "Дуусах огноо": end, Тайлбар: "", Шалтгаан: "Гэрээний үүрэг биелүүлээгүй", "Эхлэх огноо": "2024-01-01" });
    const h = blacklistHighlight([row("А ХХК", "2027-01-01"), row("Б ХХК", "2025-01-01")], new Date("2026-10-20"));
    assert.ok(h?.kind === "blacklist");
    assert.equal(h.activeCount, 1);
    assert.equal(h.items[0].name, "А ХХК");
  });

  it("tenders: totals per year and the largest of the latest year", () => {
    const row = (year: number, budget: number, name: string) => ({ Жил: year, "Нийт төсөв": budget, "Тендерийн нэр": name, Төлөв: "Үр дүн гарсан", "Тендерийн дугаар": name });
    const h = tendersHighlight([row(2024, 100, "a"), row(2025, 5e9, "b"), row(2025, 2e12, "c")]);
    assert.ok(h?.kind === "tenders");
    assert.equal(h.latestYear, 2025);
    assert.deepEqual(h.byYear.map((y) => y.count), [1, 2]);
    assert.equal(h.largest[0].name, "c");
  });

  it("attendance: separates travel, medical leave and unexplained absences", () => {
    const row = (name: string, arrived: string | null, note: string | null, day: string) => ({ "Гишүүдийн нэр": name, "Ирсэн цаг": arrived, Тайлбар: note, "Чуулганы огноо": `${day} 00:00:00` });
    const h = attendanceHighlight([
      row("А", "2025-01-01 10:00:00", null, "2025-01-01"),
      row("А", null, "Томилолт /гадаад/", "2025-01-02"),
      row("Б", null, null, "2025-01-01"),
      row("Б", null, "Эмнэлгийн чөлөөтэй", "2025-01-02"),
    ]);
    assert.ok(h?.kind === "attendance");
    assert.equal(h.sessions, 2);
    assert.deepEqual(h.top[0], { name: "Б", term: 2024, from: "2025-01-01", to: "2025-01-02", records: 2, present: 0, travel: 0, medical: 1, leave: 0, unexplained: 1 });
  });

  it("formats large MNT amounts in words", () => {
    assert.equal(formatMntShort(43_955_551_446_285), "43.96 их наяд ₮");
    assert.equal(formatMntShort(2_100_132_698), "2.1 тэрбум ₮");
    assert.equal(formatMntShort(950), "950 ₮");
  });

  it("rounds before choosing the unit and prints thousands with spaces", () => {
    assert.equal(formatMntShort(999.96e9), "1 их наяд ₮");
    assert.equal(formatMntShort(999.96e6), "1 тэрбум ₮");
    assert.equal(formatMntShort(999_960), "1 сая ₮");
    assert.equal(formatMntShort(999.94e9), "999.9 тэрбум ₮");
    assert.equal(formatMntShort(-1234.5e12), "−1 234.5 их наяд ₮");
  });

  it("never prints a real cost as zero", () => {
    assert.equal(formatUsd(0.00004, 4), "< $0.0001");
    assert.equal(formatUsd(0.00006, 4), "$0.0001");
    assert.equal(formatUsd(0.000004, 4), "< $0.0001");
    assert.equal(formatUsd(0, 4), "$0.0000");
    assert.equal(formatUsd(0.0042), "$0.0042");
  });
});
