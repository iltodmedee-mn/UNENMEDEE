import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { annualPit, estimatePayrollTax, looksLikeSalary, minWage, payrollFromInputs, payrollParts, pitSchedule, sharesFromSpending, siCapMonthly, taxReceipt, upcomingSchedules } from "@/lib/tax/receipt";

describe("Миний татвар", () => {
  it("estimates НДШ 11.5% plus ХХОАТ 10% after НДШ", () => {
    // 1,000,000: НДШ 115,000; ХХОАТ (1,000,000 - 115,000) * 10% = 88,500
    assert.equal(estimatePayrollTax(1_000_000, "2026-11-04"), 203_500);
    assert.equal(estimatePayrollTax(0, "2026-11-04"), 0);
    assert.equal(estimatePayrollTax(Number.NaN, "2026-11-04"), 0);
  });

  it("adds the VAT inside purchases (price / 11) and splits the total by budget shares", () => {
    const r = taxReceipt({ payrollMonthly: 100_000, purchasesMonthly: 1_100_000 }, [
      { name: "Цалин", share: 0.75 },
      { name: "Хөрөнгө оруулалт", share: 0.25 },
    ]);
    assert.equal(r.payrollYear, 1_200_000);
    assert.equal(r.vatYear, 1_200_000);
    assert.equal(r.total, 2_400_000);
    assert.deepEqual(
      r.lines.map((l) => [l.name, l.amount]),
      [
        ["Цалин", 1_800_000],
        ["Хөрөнгө оруулалт", 600_000],
      ],
    );
  });

  it("ignores negative or empty input", () => {
    assert.equal(taxReceipt({ payrollMonthly: -5, purchasesMonthly: Number.NaN }, [{ name: "A", share: 1 }]).total, 0);
  });

  it("builds shares from one year of the NSO split", () => {
    const s = sharesFromSpending(
      [
        { name: "A", values: { "2025": 30, "2024": 1 } },
        { name: "B", values: { "2025": 10 } },
        { name: "C", values: { "2025": null } },
      ],
      "2025",
    );
    assert.deepEqual(s, [
      { name: "A", share: 0.75 },
      { name: "B", share: 0.25 },
    ]);
  });

  it("estimates a 3 000 000 ₮ salary and 1 000 000 ₮ of shopping", () => {
    assert.deepEqual(payrollParts(3_000_000, "2026-11-04"), { si: 345_000, pit: 265_500, total: 610_500, capped: false });
    const payroll = payrollFromInputs({ salary: 3_000_000, exact: 0, day: "2026-11-04" });
    assert.deepEqual(payroll, { monthly: 610_500, source: "estimate" });
    const r = taxReceipt({ payrollMonthly: payroll.monthly, purchasesMonthly: 1_000_000 }, [{ name: "A", share: 1 }]);
    assert.equal(r.payrollYear, 7_326_000);
    assert.equal(r.vatYear, 1_090_909);
    assert.equal(r.total, 8_416_909);
  });

  it("prefers the payslip amount and spots a salary typed as tax", () => {
    assert.deepEqual(payrollFromInputs({ salary: 3_000_000, exact: 590_000, day: "2026-11-04" }), { monthly: 590_000, source: "exact" });
    assert.deepEqual(payrollFromInputs({ salary: 0, exact: 0, day: "2026-11-04" }), { monthly: 0, source: "none" });
    assert.equal(looksLikeSalary(3_000_000, 3_000_000), true);
    assert.equal(looksLikeSalary(3_000_000, 0), true);
    assert.equal(looksLikeSalary(590_000, 3_000_000), false);
    assert.equal(looksLikeSalary(150_000, 0), false);
  });
});

describe("ХХОАТ schedules (law of 2026-06-26)", () => {
  it("picks the schedule in force on an Ulaanbaatar day", () => {
    assert.equal(pitSchedule("2026-12-31").from, "2000-01-01");
    assert.equal(pitSchedule("2027-01-01").from, "2027-01-01");
    assert.equal(pitSchedule("2028-06-30").from, "2028-01-01");
    assert.deepEqual(upcomingSchedules("2026-11-04"), ["2027-01-01", "2028-01-01"]);
    assert.deepEqual(upcomingSchedules("2028-01-01"), []);
  });

  it("taxes each band only on its own part", () => {
    // 2 сая a month (24 сая a year) taxable: 10 % now, 0 % + 10 % in 2027, 0 % + 1 % in 2028 (the press's 12 мянга).
    assert.equal(annualPit(24_000_000, "2026-06-01"), 2_400_000);
    assert.equal(Math.round(annualPit(24_000_000, "2027-06-01")), 1_449_600);
    assert.equal(Math.round(annualPit(24_000_000, "2028-06-01") / 12), 12_080);
    // Above 120 сая the 15 % band, above 180 сая the 20 % band.
    assert.equal(annualPit(150_000_000, "2026-06-01"), 12_000_000 + 4_500_000);
    assert.equal(annualPit(200_000_000, "2026-06-01"), 12_000_000 + 9_000_000 + 4_000_000);
    assert.equal(annualPit(9_504_000, "2027-01-01"), 0);
    assert.equal(annualPit(0, "2027-01-01"), 0);
  });

  it("a 700 000 ₮ salary pays no ХХОАТ from 2027, only НДШ", () => {
    assert.deepEqual(payrollParts(700_000, "2027-02-01"), { si: 80_500, pit: 0, total: 80_500, capped: false });
    assert.deepEqual(payrollParts(700_000, "2026-11-04"), { si: 80_500, pit: 61_950, total: 142_450, capped: false });
  });

  it("НДШ stops at the law's ceiling, 10 × the minimum wage in force (НДЕХ 19.4); the ХХОАТ base is the pay less that НДШ", () => {
    assert.equal(minWage("2024-06-01"), 660_000);
    assert.equal(minWage("2025-03-31"), 660_000);
    assert.equal(minWage("2025-04-01"), 792_000);
    assert.equal(siCapMonthly("2026-11-07"), 7_920_000);
    assert.equal(siCapMonthly("2027-01-01"), 10_000_000);
    // 10 000 000 ₮ in 2026: НДШ 11.5 % of 7 920 000 = 910 800 (not 1 150 000), ХХОАТ 10 % of the rest.
    assert.deepEqual(payrollParts(10_000_000, "2026-11-07"), { si: 910_800, pit: 908_920, total: 1_819_720, capped: true });
    // 2027: the ceiling moves with the 1 000 000 ₮ minimum wage, so the same salary is not capped.
    assert.equal(payrollParts(10_000_000, "2027-02-01").capped, false);
    assert.equal(payrollParts(10_000_000, "2027-02-01").si, 1_150_000);
    assert.equal(payrollParts(7_920_000, "2026-11-07").capped, false);
  });
});
