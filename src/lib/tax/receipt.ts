/**
 * "Миний татвар": a reader's yearly taxes spread over the state budget's spending structure.
 * Taxes are pooled, not earmarked, so this is "your share if it were split like the budget".
 * Pure functions (unit-tested); the page passes the latest NSO economic split as `shares`.
 */

/** Employee social insurance (НДШ), share of gross pay. Source: PwC Worldwide Tax Summaries. */
export const SI_RATE = 0.115;
/** Personal income tax (ХХОАТ) base rate, applied after НДШ. Reliefs and 2026 changes are not modelled. */
export const PIT_RATE = 0.1;
/** The day the rates above were last written against their source; the watchdog asks for a re-check yearly. */
export const RATES_CHECKED = "2026-10-24";
/**
 * The tax package Parliament passed on 2026-06-26 changes ХХОАТ from 2027-01-01 (the bill and the
 * press: a monthly 792,000 ₮ exempt, a 1 % band up to 2 сая, its start year reported as 2027 or
 * 2028). Not modelled until the enacted text is on legalinfo.mn; /tax says so, and from
 * `effective` the watchdog asks for the calculator to be updated. Delete once it is.
 */
export const PIT_CHANGE: { passed: string; effective: string; sources: { name: string; url: string }[] } | null = {
  passed: "2026-06-26",
  effective: "2027-01-01",
  sources: [
    { name: "УИХ, хуулийн төсөл", url: "https://d.parliament.mn/tusul/68992d11-313a-4470-aa70-ece2bfc03b37" },
    { name: "ikon.mn", url: "https://ikon.mn/n/3ok6" },
  ],
};
/** Shop prices include 10% VAT, so the VAT inside a price is price / 11. */
export const VAT_SHARE_OF_PRICE = 1 / 11;

export interface BudgetShare {
  name: string;
  /** 0..1, sums to ~1 */
  share: number;
}

/** Monthly НДШ and ХХОАТ for a gross salary (an estimate: no tax credit, no 2026 changes). */
export function payrollParts(grossMonthly: number): { si: number; pit: number; total: number } {
  if (!Number.isFinite(grossMonthly) || grossMonthly <= 0) return { si: 0, pit: 0, total: 0 };
  const si = Math.round(grossMonthly * SI_RATE);
  const pit = Math.round((grossMonthly - grossMonthly * SI_RATE) * PIT_RATE);
  return { si, pit, total: si + pit };
}

/** Rough monthly ХХОАТ + НДШ for a gross salary (shown to the reader as an estimate). */
export function estimatePayrollTax(grossMonthly: number): number {
  return payrollParts(grossMonthly).total;
}

/** The exact amount from a payslip wins; otherwise the estimate from the salary. */
export function payrollFromInputs(input: { salary: number; exact: number }): { monthly: number; source: "exact" | "estimate" | "none" } {
  if (Number.isFinite(input.exact) && input.exact > 0) return { monthly: input.exact, source: "exact" };
  const monthly = estimatePayrollTax(input.salary);
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
