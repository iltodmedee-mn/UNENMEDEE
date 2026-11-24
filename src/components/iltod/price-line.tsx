import { formatNumber } from "@/lib/format";
import { LINE_H, LINE_W, linePath, yearTicks } from "@/lib/spark";
import { cx } from "@/utils/cx";

/**
 * A 15-year monthly price line: server-rendered inline SVG (the sparkline's bigger sibling), a
 * fixed 80 px row so nothing shifts, min/max in mono on the right, and year labels as HTML under
 * it (text inside a non-uniformly scaled SVG would distort). No client JS, no chart library.
 */
export function PriceLine({ months, values, unit, label, className }: { months: string[]; values: (number | null)[]; unit: string; label: string; className?: string }) {
  const path = linePath(values);
  if (!path) return null;
  const ticks = yearTicks(months);
  const first = months[0];
  const last = months[months.length - 1];
  return (
    <figure className={cx("flex flex-col gap-1", className)}>
      <div className="flex items-stretch gap-3">
        <svg viewBox={`0 0 ${LINE_W} ${LINE_H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: Улаанбаатар хотын сарын дундаж үнэ, ${first}-аас ${last}`} className="h-20 min-w-0 flex-1 overflow-visible text-fg-brand-primary">
          <path d={path.area} fill="currentColor" opacity={0.08} />
          <polyline points={path.line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="label-mono flex w-16 shrink-0 flex-col justify-between py-0.5 text-right normal-case text-tertiary" aria-hidden>
          <span>{formatNumber(path.max)}</span>
          <span>{formatNumber(path.min)}</span>
        </div>
      </div>
      <figcaption className="label-mono relative h-4 text-tertiary" aria-hidden>
        <span className="sr-only">Жил</span>
        <span className="absolute inset-y-0 right-0 w-16" />
        <span className="absolute inset-y-0 left-0 right-19">
          {ticks.map((t) => (
            <span key={t.label} className="absolute top-0" style={{ left: `${(t.x * 100).toFixed(1)}%`, transform: t.x === 0 ? undefined : t.x === 1 ? "translateX(-100%)" : "translateX(-50%)" }}>
              {t.label}
            </span>
          ))}
        </span>
      </figcaption>
      <p className="sr-only">
        Хамгийн их {formatNumber(path.max)} {unit}, хамгийн бага {formatNumber(path.min)} {unit}.
      </p>
    </figure>
  );
}

/**
 * A few yearly values (an MP's declared assets): the same server-rendered line, one label per year
 * spread evenly. Replaced a recharts chart that shipped the whole chart library to ~126 MP pages
 * for 2–5 points the table under it already lists (audit P-10).
 */
export function YearLine({ years, values, unit, label, className }: { years: string[]; values: (number | null)[]; unit: string; label: string; className?: string }) {
  const path = linePath(values);
  if (!path) return null;
  const last = years.length - 1;
  return (
    <figure className={cx("flex flex-col gap-1", className)}>
      <div className="flex items-stretch gap-3">
        <svg viewBox={`0 0 ${LINE_W} ${LINE_H}`} preserveAspectRatio="none" role="img" aria-label={`${label}, ${years[0]}–${years[last]}`} className="h-20 min-w-0 flex-1 overflow-visible text-fg-brand-primary">
          <path d={path.area} fill="currentColor" opacity={0.08} />
          <polyline points={path.line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="label-mono flex w-16 shrink-0 flex-col justify-between py-0.5 text-right normal-case text-tertiary" aria-hidden>
          <span>{formatNumber(path.max)}</span>
          <span>{formatNumber(path.min)}</span>
        </div>
      </div>
      <figcaption className="label-mono relative h-4 text-tertiary" aria-hidden>
        <span className="absolute inset-y-0 left-0 right-19">
          {years.map((y, i) => (
            <span key={y} className="absolute top-0" style={{ left: `${((i / last) * 100).toFixed(1)}%`, transform: i === 0 ? undefined : i === last ? "translateX(-100%)" : "translateX(-50%)" }}>
              {y}
            </span>
          ))}
        </span>
      </figcaption>
      <p className="sr-only">
        Хамгийн их {formatNumber(path.max)} {unit}, хамгийн бага {formatNumber(path.min)} {unit}.
      </p>
    </figure>
  );
}
