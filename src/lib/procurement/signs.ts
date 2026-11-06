/**
 * Procurement "warning signs" on /tenders (pure half; the SQL is getTenderSigns in queries.ts).
 *
 * Open Contracting Partnership's red-flag guide (2024) lists indicators that "do not necessarily
 * demonstrate the presence of corruption" and warns that a flag hitting most procedures says
 * nothing. Form 1831 has no bid counts, no announcement dates and only a few months of history,
 * so of its indicators three can be computed honestly from what Шилэн данс publishes:
 *
 * - a contract signed above its approved budget (one lot; 53 of 4 738 clean 2026 awards, Nov 2026),
 * - one supplier winning half or more of a buyer's lots (TI Georgia's TenderMonitor threshold;
 *   1 of the 110 buyers with ≥ 8 awards),
 * - a buyer awarding half or more of its lots without competition (direct contract / single
 *   source; 6.2 % nationally, 12 buyers at ≥ 50 %).
 *
 * "Price within 3 % of the budget" was measured and left out: it matched 47 % of all awards.
 * A sign names the procedure or the buying organisation, never a person, always next to the
 * national figure, and the page says it is not a finding of wrongdoing. Rows whose amounts have
 * an unclear unit are never used.
 */

/** Direct contracts and single-source purchases, as the bodies type them. */
export const NON_COMPETITIVE = /шууд|нэг эх үүсвэр|^шгб$/iu;

/**
 * A buyer needs this many awarded lots before its shares mean anything: with 5, a school's 3 of 5
 * lots to the local supplier was a "sign" (TI Georgia uses 5 wins for its supplier-side flag).
 */
export const MIN_BUYER_LOTS = 8;
/** Half or more of a buyer's lots to one supplier, or without competition. */
export const BUYER_SHARE = 0.5;

export function isNonCompetitive(method: string | null): boolean {
  return method !== null && NON_COMPETITIVE.test(method.trim());
}

/** How far a contract went above its approved budget, in whole percent, or null when it did not. */
export function overBudgetPct(t: { budgetMnt: number | null; contractMnt: number | null; unitSuspect: boolean }): number | null {
  if (t.unitSuspect || t.budgetMnt === null || t.contractMnt === null || t.budgetMnt <= 0) return null;
  if (t.contractMnt <= t.budgetMnt) return null;
  return Math.max(1, Math.round(((t.contractMnt - t.budgetMnt) / t.budgetMnt) * 100));
}

/** One buyer's awarded lots this year (clean amounts only), as the SQL counts them. */
export interface BuyerStats {
  orgName: string;
  lots: number;
  /** The supplier with the most lots, and how many. */
  topWinner: string | null;
  topWinnerLots: number;
  nonCompetitiveLots: number;
}

export interface BuyerSign {
  orgName: string;
  lots: number;
  kind: "concentration" | "non_competitive";
  /** 0–100, whole percent. */
  pct: number;
  /** The supplier for "concentration". */
  winner: string | null;
  count: number;
}

const pct = (part: number, whole: number) => Math.round((part / whole) * 100);

/**
 * The buyers that show a sign, strongest first. A buyer with fewer than `MIN_BUYER_LOTS` lots is
 * never flagged: 3 of 5 lots to one supplier is ordinary for a village school.
 */
export function buyerSigns(stats: BuyerStats[]): BuyerSign[] {
  const out: BuyerSign[] = [];
  for (const s of stats) {
    if (s.lots < MIN_BUYER_LOTS) continue;
    if (s.topWinner && s.topWinnerLots / s.lots >= BUYER_SHARE)
      out.push({ orgName: s.orgName, lots: s.lots, kind: "concentration", pct: pct(s.topWinnerLots, s.lots), winner: s.topWinner, count: s.topWinnerLots });
    if (s.nonCompetitiveLots / s.lots >= BUYER_SHARE)
      out.push({ orgName: s.orgName, lots: s.lots, kind: "non_competitive", pct: pct(s.nonCompetitiveLots, s.lots), winner: null, count: s.nonCompetitiveLots });
  }
  return out.sort((a, b) => b.pct - a.pct || b.lots - a.lots || a.orgName.localeCompare(b.orgName, "mn"));
}

/** The national figures a sign is shown next to. */
export interface NationalShares {
  /** Share of all clean awarded lots made without competition, 0–100 with one decimal. */
  nonCompetitivePct: number;
  /** Buyers with ≥ MIN_BUYER_LOTS lots, and how many show each sign. */
  buyers: number;
  concentrated: number;
  nonCompetitive: number;
}

export function nationalShares(stats: BuyerStats[], totalLots: number, nonCompetitiveLots: number): NationalShares {
  const signs = buyerSigns(stats);
  return {
    nonCompetitivePct: totalLots > 0 ? Math.round((nonCompetitiveLots / totalLots) * 1000) / 10 : 0,
    buyers: stats.filter((s) => s.lots >= MIN_BUYER_LOTS).length,
    concentrated: signs.filter((s) => s.kind === "concentration").length,
    nonCompetitive: signs.filter((s) => s.kind === "non_competitive").length,
  };
}
