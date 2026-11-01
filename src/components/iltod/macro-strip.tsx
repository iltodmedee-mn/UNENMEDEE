import { ArrowRight } from "@untitledui/icons";
import Link from "next/link";

import type { MacroSnapshot, Point } from "@/lib/mongolbank/client";
import { DataAge } from "@/components/iltod/data-age";
import { getIndicator } from "@/lib/queries";
import { SPARK_H, SPARK_W, sparkDelta, sparkPath } from "@/lib/spark";
import { cx } from "@/utils/cx";

/** Bank of Mongolia's announced inflation target (shown on its homepage as 6% ± 2). */
const INFLATION_TARGET = "6% (±2)";

const num = (v: number, digits = 2) => v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

interface Cell {
  label: string;
  value: string;
  unit?: string;
  note: string;
  /** Up = brand, down = risk (inflation above the target). */
  tone?: "up" | "down";
  /** The whole cell links there (the digest page's week numbers). */
  href?: string;
  /** The series behind the number (oldest first): a sparkline is drawn from its newest points. */
  series?: number[];
  /** "▲ 0.4" next to the sparkline (sparkDelta). */
  delta?: string | null;
  /** The first shown point's label, for the delta's title ("2024-03-15-аас хойш"). */
  since?: string;
}

/** The newest points of a Mongolbank series as a cell's `series` / `delta` / `since`. */
function trend(history: Point[] | undefined, pct: boolean, digits = 1): Pick<Cell, "series" | "delta" | "since"> {
  if (!history || history.length < 2) return {};
  const values = history.map((p) => p.value);
  return { series: values, delta: sparkDelta(values, pct, digits), since: history.at(-Math.min(history.length, 30))?.label };
}

/**
 * A ledger: a hairline grid of mono numbers, 2 columns on phones and 4 where the container is
 * wide enough (@container, so the same markup serves the home column and /data).
 */
export function Ledger({ cells, className, wide = 4 }: { cells: Cell[]; className?: string; /** Columns once the container is wide (4 or 5). */ wide?: 4 | 5 }) {
  const five = wide === 5;
  return (
    <div className={cx("@container", className)}>
      <div className={cx("grid grid-cols-2 border-b border-line", five ? "@2xl:grid-cols-5" : "@2xl:grid-cols-4")}>
        {cells.map((c, i) => {
          const spark = c.series ? sparkPath(c.series) : null;
          const body = (
            <>
              <p className="label-mono truncate text-tertiary">{c.label}</p>
              <p className={cx("num-mono mt-1 text-xl", c.tone === "down" ? "text-risk" : c.tone === "up" ? "text-brand-secondary" : "text-primary")}>
                {c.value}
                {c.unit && <span className="ml-1 text-xs font-medium text-tertiary">{c.unit}</span>}
              </p>
              {spark && (
                // The trend: server-rendered inline SVG (no chart library), a fixed 22 px row so nothing shifts.
                <div className={cx("mt-1.5 flex items-end gap-2", c.tone === "down" ? "text-risk" : "text-fg-brand-primary")}>
                  <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" aria-hidden className="h-[22px] min-w-0 flex-1 overflow-visible">
                    <path d={spark.area} fill="currentColor" opacity={0.08} />
                    <polyline points={spark.line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  </svg>
                  {c.delta && (
                    <span className={cx("label-mono shrink-0 normal-case", c.tone === "down" ? "text-risk" : c.tone === "up" ? "text-brand-secondary" : "text-tertiary")} title={c.since ? `${c.since}-аас хойш` : undefined}>
                      {c.delta}
                    </span>
                  )}
                </div>
              )}
              <p className="mt-0.5 truncate text-xs text-tertiary">{c.note}</p>
            </>
          );
          const cell = cx(
            "flex min-w-0 flex-col border-t border-line-soft py-3",
            i % 2 === 0 ? "border-r pr-3" : "pl-3",
            "@2xl:border-r @2xl:px-3.5 @2xl:first:pl-0 @2xl:last:border-r-0",
            five ? "@2xl:[&:nth-child(5n)]:border-r-0 @2xl:[&:nth-child(5n+1)]:pl-0" : "@2xl:[&:nth-child(4n)]:border-r-0 @2xl:[&:nth-child(4n+1)]:pl-0",
            c.href && "transition hover:bg-primary_hover",
          );
          return c.href ? (
            <Link key={c.label} href={c.href} prefetch={false} className={cell}>
              {body}
            </Link>
          ) : (
            <div key={c.label} className={cell}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Policy rate, inflation and FX / gold / reserves, like mongolbank.mn's homepage. Server-only
 * markup (no client JS); renders nothing until `npm run macro:sync` has stored a snapshot.
 * The compact strip (home page) shows four numbers; /data shows all of them.
 */
export async function MacroStrip({ compact = false }: { compact?: boolean }) {
  const snap = await getIndicator<MacroSnapshot>("mongolbank");
  if (!snap) return null;
  const { policyRate, inflation, fx, gold, reserves } = snap.data;
  const usd = fx?.rates.find((r) => r.code === "USD");
  const aboveTarget = (v: number | null) => (v !== null && v > 8 ? "down" : undefined);

  const cells: (Cell | false | null | undefined)[] = [
    policyRate && { label: "Бодлогын хүү", value: num(policyRate.value, 1), unit: "%", note: `Монголбанк · ${policyRate.since}`, ...trend(policyRate.history, false) },
    // The compact strip shows the national rate (the stored series, so its trend matches the number);
    // /data lists Ulaanbaatar, core and national.
    compact && inflation && { label: "Инфляц · улс", value: inflation.national === null ? "—" : num(inflation.national, 1), unit: "%", note: `Зорилт ${INFLATION_TARGET}`, tone: aboveTarget(inflation.national), ...trend(inflation.history, false) },
    !compact && inflation && { label: "Инфляц · Улаанбаатар", value: inflation.ub === null ? "—" : num(inflation.ub, 1), unit: "%", note: `Зорилт ${INFLATION_TARGET}`, tone: aboveTarget(inflation.ub) },
    !compact && inflation && { label: "Инфляц · суурь", value: inflation.core === null ? "—" : num(inflation.core, 1), unit: "%", note: `${inflation.month} сар` },
    !compact && inflation && { label: "Инфляц · улс", value: inflation.national === null ? "—" : num(inflation.national, 1), unit: "%", note: `${inflation.month} сар`, tone: aboveTarget(inflation.national), ...trend(inflation.history, false) },
    // Daily rates move by hundredths of a percent: two decimals, or every week reads "= 0".
    usd && fx && { label: "1 USD", value: num(usd.rate), unit: "₮", note: fx.date, ...trend(fx.usdHistory, true, 2) },
    !compact && gold && { label: "Алт (авах, гр)", value: num(gold.buy, 0), unit: "₮", note: gold.date },
    reserves && { label: "ГВУН", value: num(reserves.value, 0), unit: "сая $", note: `${reserves.month} сар`, ...trend(reserves.history, true) },
  ];

  return (
    <section aria-label="Монголбанкны үзүүлэлт" className="flex flex-col gap-2">
      <Ledger cells={cells.filter((c): c is Cell => Boolean(c))} />
      {/* Wraps on the narrowest phones (320 px): one line pushed "Дэлгэрэнгүй" 4 px past the edge. */}
      <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-tertiary">
        <span>
          Эх сурвалж: Монголбанк (mongolbank.mn) · <DataAge at={snap.updatedAt} staleDays={3} />
          {!compact && " · муруй = сүүлийн үеийн хандлага"}
        </span>
        {compact && (
          // No prefetch: /data pulls the chart library, which would load on every home visit.
          <Link href="/data" prefetch={false} className="ml-auto flex shrink-0 items-center gap-1 font-semibold text-brand-secondary hover:underline">
            Дэлгэрэнгүй <ArrowRight className="size-3.5" />
          </Link>
        )}
      </p>
    </section>
  );
}
