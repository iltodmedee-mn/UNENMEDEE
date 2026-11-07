/**
 * "Миний татвар": a reader's yearly taxes spread over the state budget's spending structure.
 * Taxes are pooled, not earmarked, so this is "your share if it were split like the budget".
 * Pure functions (unit-tested); the page passes the latest NSO economic split as `shares`.
 */

/** Employee social insurance (НДШ), share of gross pay. Source: PwC Worldwide Tax Summaries. */
export const SI_RATE = 0.115;
/** The day the rates above were last written against their source; the watchdog asks for a re-check yearly. */
export const RATES_CHECKED = "2026-11-07";

/**
 * The monthly minimum wage (хөдөлмөрийн хөлсний доод хэмжээ), set by the National Tripartite
 * Committee under the Minimum Wage Law; each entry is in force from its day. Only used for the НДШ
 * ceiling below. Checked on RATES_CHECKED against the decisions named in SI_SOURCES.
 */
export const MIN_WAGE: { from: string; monthly: number }[] = [
  { from: "2024-01-01", monthly: 660_000 },
  { from: "2025-04-01", monthly: 792_000 }, // Гурван талт үндэсний хорооны 2024-10-07-ны 03 дугаар тогтоол
  { from: "2027-01-01", monthly: 1_000_000 }, // the committee's 2026-08-17 decision (mlsp.gov.mn)
];
/**
 * Нийгмийн даатгалын ерөнхий хууль (2023, in force 2024-01-01) 19.4: for a mandatorily insured
 * person the monthly wage on which contributions are paid (and benefits are set) is at most the
 * monthly minimum wage × 10 (× 7 for a voluntarily insured one). The employer's share has no
 * ceiling (21.1). The employee's whole 11.5 % (8.5 pension + 0.8 benefit + 0.2 unemployment under
 * 18.1, 2 % health under the Health Insurance Law) is withheld up to that ceiling in practice
 * (ndaatgal.mn: 7 920 000 ₮ → at most 910 800 ₮ a month in 2026).
 */
export const SI_CAP_MULTIPLE = 10;

/** The minimum wage in force on an Ulaanbaatar day ("2026-11-07"). */
export function minWage(day: string): number {
  return (MIN_WAGE.filter((m) => m.from <= day).at(-1) ?? MIN_WAGE[0]).monthly;
}

/** The monthly wage above which no more НДШ is withheld (law 19.4). */
export function siCapMonthly(day: string): number {
  return minWage(day) * SI_CAP_MULTIPLE;
}

/** The ceiling's sources, printed above the calculator with PIT_SOURCES. */
export const SI_SOURCES: { name: string; url: string }[] = [
  { name: "legalinfo.mn, Нийгмийн даатгалын ерөнхий хууль 19.4 (шимтгэлийн дээд хэмжээ)", url: "https://legalinfo.mn/mn/detail?lawId=16760148379551" },
  { name: "ndaatgal.mn, доод цалин 792 000 ₮ (2025-04-01)", url: "https://orhon.ndaatgal.mn/" },
  { name: "mlsp.gov.mn, доод цалин 1 000 000 ₮ (2027-01-01)", url: "https://mlsp.gov.mn/content/detail/4164" },
];

/** One band of the yearly ХХОАТ scale on wages: `rate` applies to the part of the income up to `upTo` (₮ a year). */
export interface PitBand {
  upTo: number | null;
  rate: number;
}

/**
 * ХХОАТ on wages by taxable yearly income (gross minus НДШ), each band taxing only its own part.
 * The tax package Parliament passed on 2026-06-26 (ХХОАТ-ын тухай хууль, legalinfo.mn lawId 14410,
 * in force from 2027-01-01) exempts the first 9,504,000 ₮ a year (792,000 ₮ a month) from 2027
 * and taxes the part up to 24,000,000 ₮ (2 сая a month) at 1 % from 2028; the monthly tax credit
 * on wages ends in 2027. Table as printed by PwC Mongolia's 2026 tax alert no. 4, which matches
 * the parliament's and the press's figures (2 сая a month → 12,080 ₮ from 2028).
 */
export const PIT_SCHEDULES: { from: string; bands: PitBand[] }[] = [
  {
    from: "2000-01-01",
    bands: [
      { upTo: 120_000_000, rate: 0.1 },
      { upTo: 180_000_000, rate: 0.15 },
      { upTo: null, rate: 0.2 },
    ],
  },
  {
    from: "2027-01-01",
    bands: [
      { upTo: 9_504_000, rate: 0 },
      { upTo: 120_000_000, rate: 0.1 },
      { upTo: 180_000_000, rate: 0.15 },
      { upTo: null, rate: 0.2 },
    ],
  },
  {
    from: "2028-01-01",
    bands: [
      { upTo: 9_504_000, rate: 0 },
      { upTo: 24_000_000, rate: 0.01 },
      { upTo: 120_000_000, rate: 0.1 },
      { upTo: 180_000_000, rate: 0.15 },
      { upTo: null, rate: 0.2 },
    ],
  },
];

/** Where the schedules come from (printed on /tax). */
export const PIT_SOURCES: { name: string; url: string }[] = [
  { name: "legalinfo.mn, ХХОАТ-ын тухай хууль", url: "https://legalinfo.mn/mn/detail?lawId=14410" },
  { name: "PwC, татварын мэдээ 2026/4", url: "https://www.pwc.com/mn/en/tax_alerts/pdf/2026/tax_alert_04_mn_2026.pdf" },
  { name: "ikon.mn", url: "https://ikon.mn/n/3ok6" },
];

/** The schedule in force on an Ulaanbaatar day ("2027-03-01"). */
export function pitSchedule(day: string): { from: string; bands: PitBand[] } {
  return PIT_SCHEDULES.filter((s) => s.from <= day).at(-1) ?? PIT_SCHEDULES[0];
}

/** Yearly ХХОАТ on a taxable yearly wage income under the schedule in force on `day`. */
export function annualPit(taxableYear: number, day: string): number {
  if (!Number.isFinite(taxableYear) || taxableYear <= 0) return 0;
  let tax = 0;
  let floor = 0;
  for (const band of pitSchedule(day).bands) {
    const top = band.upTo ?? Infinity;
    if (taxableYear > floor) tax += (Math.min(taxableYear, top) - floor) * band.rate;
    floor = top;
  }
  return tax;
}

/** Schedules that start after `day` (the calculator shows what the same salary pays then). */
export function upcomingSchedules(day: string): string[] {
  return PIT_SCHEDULES.map((s) => s.from).filter((from) => from > day);
}
/** Shop prices include 10% VAT, so the VAT inside a price is price / 11. */
export const VAT_SHARE_OF_PRICE = 1 / 11;

export interface BudgetShare {
  name: string;
  /** 0..1, sums to ~1 */
  share: number;
}

/** Monthly НДШ and ХХОАТ for a gross salary on an Ulaanbaatar day (an estimate: no tax credit). */
export function payrollParts(grossMonthly: number, day: string): { si: number; pit: number; total: number; capped: boolean } {
  if (!Number.isFinite(grossMonthly) || grossMonthly <= 0) return { si: 0, pit: 0, total: 0, capped: false };
  // НДШ stops at the law's ceiling (19.4); the ХХОАТ base is the pay less the НДШ really withheld,
  // so a salary above the ceiling used to show too much НДШ and too little ХХОАТ.
  const cap = siCapMonthly(day);
  const si = Math.round(Math.min(grossMonthly, cap) * SI_RATE);
  const pit = Math.round(annualPit((grossMonthly - si) * 12, day) / 12);
  return { si, pit, total: si + pit, capped: grossMonthly > cap };
}

/** Rough monthly ХХОАТ + НДШ for a gross salary (shown to the reader as an estimate). */
export function estimatePayrollTax(grossMonthly: number, day: string): number {
  return payrollParts(grossMonthly, day).total;
}

/** The exact amount from a payslip wins; otherwise the estimate from the salary. */
export function payrollFromInputs(input: { salary: number; exact: number; day: string }): { monthly: number; source: "exact" | "estimate" | "none" } {
  if (Number.isFinite(input.exact) && input.exact > 0) return { monthly: input.exact, source: "exact" };
  const monthly = estimatePayrollTax(input.salary, input.day);
  return { monthly, source: monthly > 0 ? "estimate" : "none" };
}

/**
 * A "withheld tax" that is really a salary typed into the wrong field: 40%+ of the salary, or
 * 1 000 000 ₮+ when no salary is given (НДШ + ХХОАТ is about 20% of pay).
 */
export function looksLikeSalary(exact: number, salary: number): boolean {
  if (!(exact > 0)) return false;
  return salary > 0 ? exact >= salary * 0.4 : exact >= 1_000_000;
}

export interface TaxReceipt {
  payrollYear: number;
  vatYear: number;
  total: number;
  lines: { name: string; amount: number; share: number }[];
}

export function taxReceipt(input: { payrollMonthly: number; purchasesMonthly: number }, shares: BudgetShare[]): TaxReceipt {
  const clean = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const payrollYear = Math.round(clean(input.payrollMonthly) * 12);
  const vatYear = Math.round(clean(input.purchasesMonthly) * VAT_SHARE_OF_PRICE * 12);
  const total = payrollYear + vatYear;
  const sum = shares.reduce((a, s) => a + s.share, 0) || 1;
  const lines = shares
    .map((s) => ({ name: s.name, share: s.share / sum, amount: Math.round((total * s.share) / sum) }))
    .sort((a, b) => b.amount - a.amount);
  return { payrollYear, vatYear, total, lines };
}

/** Spending shares for one year from the NSO economic split (category values in any unit). */
export function sharesFromSpending(categories: { name: string; values: Record<string, number | null> }[], year: string): BudgetShare[] {
  const rows = categories.map((c) => ({ name: c.name, value: c.values[year] ?? 0 })).filter((c) => c.value > 0);
  const total = rows.reduce((a, r) => a + r.value, 0);
  return total ? rows.map((r) => ({ name: r.name, share: r.value / total })) : [];
}
