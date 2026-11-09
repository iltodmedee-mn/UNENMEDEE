"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { formatMntShort } from "@/lib/format";
import { formatPercent, MIN_ASSETS_FOR_JUMP } from "@/lib/officials/flags";
import type { PoliticianSummary } from "@/lib/queries";
import { cx } from "@/utils/cx";
import { MpPhoto } from "@/components/officials/mp-photo";

type Sort = "assets" | "income" | "change" | "name";

const SORTS: { key: Sort; label: string }[] = [
  { key: "assets", label: "Хөрөнгө" },
  { key: "income", label: "Орлого" },
  { key: "change", label: "Өөрчлөлт" },
  { key: "name", label: "Нэр" },
];

/** The earlier year is too small to compare against (the profile's markers skip these too). */
const smallBase = (p: PoliticianSummary) => p.previousAssets !== null && p.previousAssets < MIN_ASSETS_FOR_JUMP;

/**
 * Change against the newest comparable earlier year; null when the years cannot be compared or the
 * earlier figure is under 50 сая (8 сая → 300 сая read "▲ 500%+" and topped the change sort).
 */
function change(p: PoliticianSummary): number | null {
  return p.latestAssets !== null && p.previousAssets && !smallBase(p) ? p.latestAssets / p.previousAssets - 1 : null;
}

/** "▲ 18%" / "▼ 4%" / "= 0": a number, never a verdict (neutral colour on purpose). */
function changeLabel(c: number | null, p: PoliticianSummary): string {
  if (c === null) return p.comparisonLimited ? "харьцуулахгүй" : smallBase(p) ? "бага суурь" : "—";
  if (Math.abs(c) < 0.005) return "= 0";
  return `${c > 0 ? "▲" : "▼"} ${formatPercent(Math.abs(c))}`;
}

/**
 * The members as a ledger: one hairline row each with the latest declared assets (a bar against the
 * largest figure in the current list), income and the change to the newest comparable year, all
 * linking to the profile with the original filings. Filter by party, sort by the declared figures.
 */
export function OfficialsTable({ people }: { people: PoliticianSummary[] }) {
  const parties = useMemo(() => [...new Set(people.map((p) => p.party ?? "Бусад"))].sort(), [people]);
  const [party, setParty] = useState<string>("all");
  const [sort, setSort] = useState<Sort>("assets");

  const rows = useMemo(() => {
    const list = people.filter((p) => party === "all" || (p.party ?? "Бусад") === party);
    // Assets rank by `rankAssets`: a suspected unit-error filing ranks by its member's last
    // comparable year, never by the figure the site itself flags.
    const key = (p: PoliticianSummary) => (sort === "assets" ? p.rankAssets : sort === "income" ? p.latestIncome : sort === "change" ? change(p) : null) ?? -Infinity;
    return sort === "name" ? [...list].sort((a, b) => a.fullName.localeCompare(b.fullName, "mn")) : [...list].sort((a, b) => key(b) - key(a));
  }, [people, party, sort]);
  const max = useMemo(() => Math.max(0, ...rows.map((p) => p.rankAssets ?? 0)), [rows]);
  // The newest filing year in the list. Members whose newest filing is older are labelled with
  // their own year, so a 2024 figure is never read as 2025.
  const years = useMemo(() => {
    const latest = Math.max(0, ...rows.map((p) => p.latestYear ?? 0));
    return latest ? { latest, mixed: rows.some((p) => p.latestYear !== null && p.latestYear !== latest) } : null;
  }, [rows]);
  const money = (v: number | null) => (v === null ? "—" : formatMntShort(v));

  const chip = (active: boolean) =>
    cx("label-mono shrink-0 cursor-pointer rounded-full px-3 py-1.5 ring-1 ring-inset transition", active ? "bg-ink text-bg-primary ring-transparent" : "text-secondary ring-line hover:bg-primary_hover");

  return (
    <div className="flex flex-col gap-4">
      <div className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4">
        <button type="button" className={chip(party === "all")} onClick={() => setParty("all")}>
          Бүгд ({people.length})
        </button>
        {parties.map((p) => (
          <button key={p} type="button" className={chip(party === p)} onClick={() => setParty(p)}>
            {p} ({people.filter((x) => (x.party ?? "Бусад") === p).length})
          </button>
        ))}
      </div>
      <div className="label-mono flex flex-wrap items-center gap-2 text-tertiary">
        Эрэмбэ:
        {SORTS.map((s) => (
          <button key={s.key} type="button" className={chip(sort === s.key)} onClick={() => setSort(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="border-y border-line">
        {/* Column heads on wide screens; phones read the labels from the row itself. */}
        <div className="label-mono hidden grid-cols-[40px_1.6fr_1fr_1fr_0.8fr] gap-x-3 border-b border-line py-2 text-tertiary xl:grid">
          <span />
          <span>Гишүүн</span>
          <span className="text-right">Хөрөнгө{years && !years.mixed ? ` ${years.latest}` : " (сүүлийн мэдүүлэг)"}</span>
          <span className="text-right">Орлого{years && !years.mixed ? ` ${years.latest}` : ""}</span>
          <span className="text-right">Өөрчлөлт</span>
        </div>
        <ul className="divide-y divide-line-soft">
          {rows.map((p) => {
            const c = change(p);
            // A suspect filing draws no bar: its bar would be the figure the site calls a probable error.
            const width = max > 0 && p.rankAssets && !p.latestSuspect ? `${Math.max(1, (p.rankAssets / max) * 100)}%` : "0%";
            return (
              <li key={p.id}>
                <Link
                  href={`/officials/${p.id}`}
                  // ~126 rows: prefetching every profile (and its chart code) as the list scrolls.
                  prefetch={false}
                  className="grid grid-cols-[40px_1fr_auto] items-center gap-x-3 gap-y-1 py-3 transition hover:bg-primary_hover xl:grid-cols-[40px_1.6fr_1fr_1fr_0.8fr] xl:py-2.5"
                >
                  {p.photoUrl ? <MpPhoto src={p.photoUrl} size={40} className="row-span-2 size-10 rounded-full bg-secondary object-cover xl:row-span-1" /> : <span className="row-span-2 size-10 rounded-full bg-secondary xl:row-span-1" />}
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold text-primary">{p.fullName}</span>
                    <span className="label-mono flex flex-wrap items-center gap-x-1.5 truncate text-tertiary">
                      {p.party ?? "—"}
                      {p.constituency ? ` · ${p.constituency}` : ""}
                      {p.latestSuspect && p.latestYear && (
                        <span className="rounded px-1 normal-case ring-1 ring-line ring-inset" title="Мэдүүлгийн нэгж (мянган ₮ / ₮) зөрсөн байж болзошгүй: харьцуулалтад оруулаагүй">
                          нэгжийн зөрүү {p.latestYear}
                        </span>
                      )}
                    </span>
                  </span>
                  {p.latestYear ? (
                    <>
                      <span className="flex min-w-[6.5rem] flex-col items-end gap-1">
                        <span className="num-mono text-md text-primary">
                          {money(p.latestAssets)}
                          {years?.mixed && p.latestYear !== years.latest && <span className="label-mono ml-1.5 text-tertiary">{p.latestYear}</span>}
                        </span>
                        {p.latestSuspect ? (
                          <span className="label-mono normal-case text-tertiary" title="Эрэмбэ, мөрийн урт: өмнөх харьцуулж болох оны дүнгээр">
                            {p.rankYear && p.rankAssets !== null ? `${p.rankYear}: ${money(p.rankAssets)}` : "харьцуулах он алга"}
                          </span>
                        ) : (
                          <span className="block h-[3px] w-full bg-line-soft" aria-hidden>
                            <span className="block h-full bg-brand-solid/75" style={{ width }} />
                          </span>
                        )}
                      </span>
                      <span className="label-mono col-start-2 text-right normal-case text-secondary xl:col-start-auto">
                        <span className="xl:hidden">орлого </span>
                        <span className="num-mono text-sm">{money(p.latestIncome)}</span>
                      </span>
                      <span className="label-mono text-right normal-case text-tertiary" title={p.previousYear ? `${p.previousYear}→${p.latestYear}` : undefined}>
                        {changeLabel(c, p)}
                      </span>
                    </>
                  ) : (
                    <span className="label-mono col-span-3 text-right normal-case text-quaternary xl:col-span-3">Мэдүүлэг олдоогүй</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="label-mono normal-case text-tertiary">
        Мөрийн урт = энэ жагсаалтын хамгийн их хөрөнгөтэй харьцуулсан хувь · нэгжийн зөрүүтэй байж болзошгүй мэдүүлгийг өмнөх харьцуулж болох оных нь дүнгээр эрэмбэлнэ · 50 саяас бага суурьтай өөрчлөлтийг хувиар харьцуулахгүй · ▲▼ тоо, үнэлгээ биш · мэдүүлэг бүр ХАСХОМ-ын эх холбоостой (хувийн хуудсанд)
      </p>
    </div>
  );
}
