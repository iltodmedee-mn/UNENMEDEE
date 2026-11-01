"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";

import { formatUsd } from "@/lib/format";

const AXIS = { fontSize: 12, fill: "var(--color-text-tertiary)" };

function MoneyTooltip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  // A month whose income nobody entered is null, not $0: it has no bar and no tooltip line.
  const shown = (payload ?? []).filter((p) => p.value !== null && p.value !== undefined);
  if (!active || !shown.length) return null;
  const total = shown.reduce((s, p) => s + Number(p.value ?? 0), 0);
  return (
    <div className="rounded-lg bg-primary px-3 py-2 text-xs shadow-lg ring-1 ring-line ring-inset">
      <p className="mb-1 font-semibold text-primary">{label}</p>
      {shown.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-secondary">
          <span className="size-2 rounded-sm" style={{ background: p.color }} />
          {p.name}: <span className="font-semibold text-primary tabular-nums">{formatUsd(Number(p.value ?? 0), 4)}</span>
        </p>
      ))}
      {shown.length > 1 && <p className="mt-1 border-t border-line pt-1 text-tertiary">Нийт: {formatUsd(total, 4)}</p>}
    </div>
  );
}

function LegendText(value: string) {
  return <span className="text-xs text-secondary">{value}</span>;
}

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];

/**
 * Stacked daily spend of every provider that cost money (last 30 days): `series` comes from the
 * logged USD, so a billed Gemini key or ElevenLabs shows up without a code change. Free providers
 * are $0 and listed in the table.
 */
export function DailySpendChart({ data, series }: { data: { day: string; costs: Record<string, number> }[]; series: { key: string; name: string }[] }) {
  const rows = data.map((d) => ({ label: d.day.slice(5), ...Object.fromEntries(series.map((s) => [s.key, d.costs[s.key] ?? 0])) }));
  return (
    <div className="h-72 w-full" role="img" aria-label="Сүүлийн 30 хоногийн AI зардал, үйлчилгээ үзүүлэгчээр">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%" maxBarSize={48}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="0" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatUsd(v, v < 1 ? 3 : 2)} />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: "var(--color-bg-secondary)" }} />
          <Legend formatter={LegendText} iconType="square" iconSize={10} />
          {/* 2px surface stroke = gap between stacked segments */}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="a"
              fill={SERIES[i % SERIES.length]}
              stroke="var(--chart-surface)"
              strokeWidth={2}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Monthly expenses vs income (one axis, both USD). Income null = not entered: no bar. */
export function LedgerChart({ data }: { data: { month: string; expenses: number; income: number | null }[] }) {
  return (
    <div className="h-72 w-full" role="img" aria-label="Сар бүрийн зардал ба орлого">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} maxBarSize={56}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatUsd(v, 0)} />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: "var(--color-bg-secondary)" }} />
          <Legend formatter={LegendText} iconType="square" iconSize={10} />
          <Bar dataKey="expenses" name="Зардал" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="income" name="Орлого (зар + хандив)" fill="var(--series-2)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One series over time (exchange rate, wages). Always paired with a table on the page. */
export function SeriesLineChart({ data, name, unit, ariaLabel }: { data: { label: string; value: number }[]; name: string; unit: string; ariaLabel: string }) {
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <div className="h-64 w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={32} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={64} domain={["auto", "auto"]} tickFormatter={fmt} />
          <Tooltip
            formatter={(v) => [`${fmt(Number(v))} ${unit}`, name]}
            contentStyle={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border-line)", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "var(--color-text-primary)", fontWeight: 600 }}
          />
          <Line type="monotone" dataKey="value" name={name} stroke="var(--series-1)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const TOOLTIP_STYLE = {
  contentStyle: { background: "var(--color-bg-primary)", border: "1px solid var(--color-border-line)", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "var(--color-text-primary)", fontWeight: 600 },
};

/** Grouped bars per period (budget revenue vs expenditure). Always paired with a table on the page. */
export function GroupedBarChart({
  data,
  series,
  unit,
  ariaLabel,
}: {
  data: ({ label: string } & Record<string, number | string | null>)[];
  series: { key: string; name: string }[];
  unit: string;
  ariaLabel: string;
}) {
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <div className="h-72 w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={1} barCategoryGap="15%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={fmt} />
          <Tooltip formatter={(v, name) => [`${fmt(Number(v))} ${unit}`, name]} cursor={{ fill: "var(--color-bg-secondary)" }} {...TOOLTIP_STYLE} />
          <Legend formatter={LegendText} iconType="square" iconSize={10} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={`var(--series-${i + 1})`} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Bars that go below zero (budget balance): surplus and deficit get their own color. */
export function SignedBarChart({ data, name, unit, ariaLabel }: { data: { label: string; value: number }[]; name: string; unit: string; ariaLabel: string }) {
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return (
    <div className="h-56 w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="15%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={fmt} />
          <Tooltip formatter={(v) => [`${fmt(Number(v))} ${unit}`, name]} cursor={{ fill: "var(--color-bg-secondary)" }} {...TOOLTIP_STYLE} />
          <Bar dataKey="value" name={name} radius={[3, 3, 3, 3]}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.value < 0 ? "var(--series-2)" : "var(--series-3)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
