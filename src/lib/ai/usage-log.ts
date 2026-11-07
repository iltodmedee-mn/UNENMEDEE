import { and, eq, gte, lt, ne, sql } from "drizzle-orm";

import type { DB } from "@/db";
import { aiUsageLogs, transparencyLedger } from "@/db/schema";

import { createBudgetGuard, type BudgetGuard, type UsageSnapshot } from "./limits";
import type { UsageLogger } from "./router";

/** Logs every LLM call to `ai_usage_logs` (CLAUDE.md rule #4). */
export function dbUsageLogger(db: DB): UsageLogger {
  return async (r) => {
    await db.insert(aiUsageLogs).values({
      provider: r.provider,
      model: r.model,
      purpose: r.purpose,
      articleId: r.articleId ?? null,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      estimatedCostUsd: r.estimatedCostUsd.toFixed(6),
      success: r.success,
    });
  };
}

/** Prints usage instead of storing it (dry runs). */
export const consoleUsageLogger: UsageLogger = async (r) => {
  console.log(
    `   💸 ${r.provider}/${r.model} [${r.purpose}] in=${r.promptTokens} out=${r.completionTokens} $${r.estimatedCostUsd.toFixed(6)}${r.success ? "" : " (failed)"}`,
  );
};

export function monthKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 7);
}

/**
 * Whether a month's AI spend can still be recomputed from ai_usage_logs. The retention job deletes
 * logs after 13 months (`LOG_KEEP_MONTHS`), so only the last 12 months are complete; older months
 * keep the total already stored in the ledger.
 */
export function monthRecomputable(month: string, now: Date = new Date()): boolean {
  const oldest = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  return month >= monthKey(oldest);
}

/**
 * Recomputes this month's AI spend from ai_usage_logs and upserts it into the ledger.
 * Idempotent: safe to run after every batch. A month whose logs may be pruned keeps its stored
 * total (an admin edit of an old ledger row must not shrink its AI cost to the logs that are left).
 */
export async function syncLedgerAiCost(db: DB, month: string = monthKey()): Promise<number> {
  if (!monthRecomputable(month)) {
    const [stored] = await db.select({ usd: transparencyLedger.aiCostUsd }).from(transparencyLedger).where(eq(transparencyLedger.month, month)).limit(1);
    return Number(stored?.usd ?? 0);
  }
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)` })
    .from(aiUsageLogs)
    .where(sql`to_char(${aiUsageLogs.createdAt} at time zone 'UTC', 'YYYY-MM') = ${month}`);
  const total = Number(row?.total ?? 0);
  await db
    .insert(transparencyLedger)
    .values({ month, aiCostUsd: total.toFixed(6), infraCostUsd: "0" })
    .onConflictDoUpdate({ target: transparencyLedger.month, set: { aiCostUsd: total.toFixed(6) } });
  return total;
}

/**
 * Current month / UTC-day spend and today's call counts per provider, from ai_usage_logs. The
 * ElevenLabs narration is left out of the USD sums: it is a prepaid monthly plan with its own
 * credit pacing (src/lib/video/elevenlabs.ts), and the text models' pay-as-you-go budget
 * (AI_MONTHLY_BUDGET_USD) must not shrink because a video was voiced.
 */
export async function loadUsageSnapshot(db: DB, now: Date = new Date()): Promise<UsageSnapshot> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [[month], perProvider] = await Promise.all([
    // gte() maps the Date through the column type; a raw sql`` param would reach the driver as a Date and fail.
    db.select({ usd: sql<string>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)` }).from(aiUsageLogs).where(and(gte(aiUsageLogs.createdAt, monthStart), ne(aiUsageLogs.provider, "elevenlabs"))),
    db
      .select({
        provider: aiUsageLogs.provider,
        calls: sql<number>`count(*)::int`,
        usd: sql<string>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)`,
      })
      .from(aiUsageLogs)
      .where(gte(aiUsageLogs.createdAt, dayStart))
      .groupBy(aiUsageLogs.provider),
  ]);
  const dayCalls: UsageSnapshot["dayCalls"] = {};
  let dayUsd = 0;
  for (const r of perProvider) {
    dayCalls[r.provider] = r.calls;
    if (r.provider !== "elevenlabs") dayUsd += Number(r.usd);
  }
  return { monthUsd: Number(month?.usd ?? 0), dayUsd, dayCalls };
}

/**
 * USD spent per UTC day for the last `days` days, today included, oldest first (zero for a day with
 * no calls). The budget guard's own day (UTC) and provider set (everything but the prepaid
 * ElevenLabs plan), so "how often did the daily cap bite" is answered with the numbers the guard
 * checked. For the watchdog.
 */
export async function dailySpendUsd(db: DB, days: number, now: Date = new Date()): Promise<number[]> {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const from = new Date(todayStart - (days - 1) * 86_400_000);
  const until = new Date(todayStart + 86_400_000);
  const day = sql<string>`to_char(${aiUsageLogs.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day, usd: sql<string>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)` })
    .from(aiUsageLogs)
    .where(and(gte(aiUsageLogs.createdAt, from), lt(aiUsageLogs.createdAt, until), ne(aiUsageLogs.provider, "elevenlabs")))
    .groupBy(day);
  const byDay = new Map(rows.map((r) => [r.day, Number(r.usd)]));
  return Array.from({ length: days }, (_, i) => byDay.get(new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10)) ?? 0);
}

/** Budget guard backed by the real spend in ai_usage_logs. */
export function dbBudgetGuard(db: DB): BudgetGuard {
  return createBudgetGuard(() => loadUsageSnapshot(db));
}
