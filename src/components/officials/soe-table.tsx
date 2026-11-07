"use client";

import { useMemo, useState } from "react";

import { formatMntShort, formatNumber } from "@/lib/format";
import { cx } from "@/utils/cx";

export interface SoeRow {
  name: string;
  kind: "company" | "enterprise";
  governor: string | null;
  revenue: number | null;
  expenses: number | null;
  netProfit: number | null;
  wageFund: number | null;
  staff: number | null;
}

type Sort = "revenue" | "netProfit" | "wageFund" | "avgWage" | "staff";
const SORTS: { key: Sort; label: string }[] = [
  { key: "revenue", label: "Орлого" },
  { key: "netProfit", label: "Цэвэр ашиг" },
  { key: "wageFund", label: "Цалингийн сан" },
  { key: "avgWage", label: "Дундаж цалин" },
  { key: "staff", label: "Ажилтан" },
];

/** Below this many staff, or above this monthly figure, a self-reported filing is most likely a typo or a unit slip. */
export const MIN_STAFF_FOR_AVG = 3;
export const MAX_PLAUSIBLE_MONTHLY_WAGE = 50_000_000;

/**
 * Monthly average per employee: wage fund ÷ staff ÷ 12 (all staff, executives included). Null
 * ("—", sorted last) when staff < 3 or the result is implausible (> 50 000 000 ₮ a month): the
 * filings are self-reported and a typed staff count of 1 would otherwise top the ranking.
 */
export function avgMonthlyWage(r: Pick<SoeRow, "wageFund" | "staff">): number | null {
  if (!r.wageFund || !r.staff || r.staff < MIN_STAFF_FOR_AVG) return null;
  const avg = r.wageFund / r.staff / 12;
  return avg > MAX_PLAUSIBLE_MONTHLY_WAGE ? null : avg;
}

const money = (v: number | null) => (v === null ? "—" : formatMntShort(v));

export function SoeTable({ rows }: { rows: SoeRow[] }) {
  const [sort, setSort] = useState<Sort>("revenue");
  const [kind, setKind] = useState<"all" | "company" | "enterprise">("all");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const value = (r: SoeRow) => (sort === "avgWage" ? avgMonthlyWage(r) : r[sort]) ?? -Infinity;
    return rows.filter((r) => (kind === "all" || r.kind === kind) && (!term || r.name.toLowerCase().includes(term))).sort((a, b) => value(b) - value(a));
  }, [rows, sort, kind, q]);
  const shown = all ? list : list.slice(0, 30);
  const chip = (on: boolean) => cx("shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition", on ? "bg-brand-solid text-white ring-transparent" : "text-secondary ring-primary hover:bg-primary_hover");

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Компанийн нэрээр хайх"
        aria-label="Компанийн нэрээр хайх"
        className="rounded-lg bg-primary px-3.5 py-2.5 text-md text-primary ring-1 ring-line-strong ring-inset outline-none focus:ring-2 focus:ring-brand"
      />
      <div className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Төрөл">
        {(
          [
            ["all", "Бүгд"],
            ["company", "Компани (ХХК, ХК)"],
            ["enterprise", "Үйлдвэрийн газар (ҮГ)"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={chip(kind === k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Эрэмбэ">
        {SORTS.map((s) => (
          <button key={s.key} type="button" aria-pressed={sort === s.key} onClick={() => setSort(s.key)} className={chip(sort === s.key)}>
            ↓ {s.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-2xl bg-primary ring-1 ring-line ring-inset">
        <table className="w-full min-w-[720px] text-left text-sm">
          <caption className="sr-only">Төрийн өмчит компаниудын {SORTS.find((s) => s.key === sort)?.label}-аар эрэмбэлсэн жагсаалт</caption>
          <thead className="border-b border-line bg-secondary text-xs text-tertiary">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Байгууллага
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Орлого
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Зардал
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Цэвэр ашиг
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Ажилтан
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Сарын дундаж цалин*
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {shown.map((r) => {
              const wage = avgMonthlyWage(r);
              return (
                <tr key={`${r.name}-${r.governor}`}>
                  <th scope="row" className="max-w-xs px-3 py-2 font-medium text-primary">
                    {r.name}
                    {r.governor && <span className="block text-xs font-normal text-tertiary">{r.governor}</span>}
                  </th>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-secondary tabular-nums">{money(r.revenue)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-secondary tabular-nums">{money(r.expenses)}</td>
                  <td className={cx("px-3 py-2 text-right whitespace-nowrap tabular-nums", (r.netProfit ?? 0) < 0 ? "text-error-primary" : "text-secondary")}>{money(r.netProfit)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-secondary tabular-nums">{r.staff ? formatNumber(r.staff) : "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-secondary tabular-nums">{wage ? formatMntShort(wage) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-tertiary">{list.length} байгууллага. * Цалингийн сан ÷ ажилтны тоо ÷ 12: удирдлага, ажилтан бүгдийн дундаж, захирлын цалин биш.</p>
      {!all && list.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="w-fit text-sm font-semibold text-brand-secondary hover:underline">
          Бүгдийг харах ({list.length})
        </button>
      )}
    </div>
  );
}
