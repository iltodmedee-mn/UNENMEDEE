"use client";

import { type ReactNode, useState } from "react";

import { formatMntShort, formatNumber } from "@/lib/format";
import { type BudgetShare, looksLikeSalary, payrollFromInputs, payrollParts, pitSchedule, RATES_CHECKED, SI_RATE, taxReceipt, upcomingSchedules } from "@/lib/tax/receipt";

const toNumber = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;
const pct = (x: number) => `${(x * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;

function MoneyInput({ id, label, hint, value, onChange }: { id: string; label: string; hint: ReactNode; value: string; onChange: (v: string) => void }) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-primary">{label}</span>
      <span className="flex items-center rounded-lg bg-primary ring-1 ring-line-strong ring-inset focus-within:ring-2 focus-within:ring-brand">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(formatNumber(toNumber(e.target.value)).replace(/^0$/, ""))}
          placeholder="0"
          className="w-full bg-transparent px-3.5 py-2.5 text-md text-primary tabular-nums outline-none"
        />
        <span className="shrink-0 pr-3.5 text-sm whitespace-nowrap text-tertiary">₮ / сар</span>
      </span>
      <span className="text-xs text-tertiary">{hint}</span>
    </label>
  );
}

/** Calculator for /tax. Nothing typed here leaves the browser. */
/** "0% / 10%" style summary of the rates on a schedule's bands, lowest first. */
function ratesLabel(day: string): string {
  return [...new Set(pitSchedule(day).bands.map((b) => b.rate))].map(pct).join(" / ");
}

/** `day` = today in Ulaanbaatar (from the page's cached clock): picks the ХХОАТ schedule. */
export function TaxReceiptCalculator({ shares, year, day }: { shares: BudgetShare[]; year: string; day: string }) {
  const [salary, setSalary] = useState("");
  const [exact, setExact] = useState("");
  // Controlled: `open={exact > 0}` collapsed the box (and its input) the moment the field was
  // cleared, and a box closed by hand with a value in it never reopened.
  const [exactOpen, setExactOpen] = useState(false);
  const [purchases, setPurchases] = useState("");
  const parts = payrollParts(toNumber(salary), day);
  const later = upcomingSchedules(day).map((from) => ({ from, pit: payrollParts(toNumber(salary), from).pit }));
  const payroll = payrollFromInputs({ salary: toNumber(salary), exact: toNumber(exact), day });
  const suspicious = looksLikeSalary(toNumber(exact), toNumber(salary));
  const r = taxReceipt({ payrollMonthly: payroll.monthly, purchasesMonthly: toNumber(purchases) }, shares);
  const max = r.lines[0]?.amount || 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-5 rounded-3xl bg-primary p-5 ring-1 ring-line ring-inset md:grid-cols-2 md:p-6">
        <div className="flex flex-col gap-3">
          <MoneyInput
            id="salary"
            label="Сарын цалин (татвар суутгахаас өмнө)"
            hint={
              parts.total > 0 ? (
                <>
                  ≈ НДШ {formatNumber(parts.si)} + ХХОАТ {formatNumber(parts.pit)} = <strong className="font-semibold text-secondary">{formatNumber(parts.total)} ₮</strong> сард суутгагдана (НДШ {pct(SI_RATE)}, ХХОАТ {ratesLabel(day)} шатлалаар НДШ хассаны дараа; хөнгөлөлтгүй; хувь хэмжээг {RATES_CHECKED}-нд шалгасан).
                  {later.map((l) => (
                    <span key={l.from} className="block">
                      {l.from}-нээс ижил цалинд ХХОАТ ≈ <strong className="font-semibold text-secondary">{formatNumber(l.pit)} ₮</strong> / сар.
                    </span>
                  ))}
                </>
              ) : (
                "Цалингүй бол хоосон орхи. Татварын хөнгөлөлтийг тооцоогүй тул ойролцоо."
              )
            }
            value={salary}
            onChange={setSalary}
          />
          <details className="text-sm" open={exactOpen} onToggle={(e) => setExactOpen(e.currentTarget.open)}>
            <summary className="cursor-pointer text-xs font-semibold text-brand-secondary">Цалингийн хуудсан дээрх яг дүнгээ оруулах</summary>
            <div className="mt-2 flex flex-col gap-2">
              <MoneyInput id="exact" label="Суутгагдсан ХХОАТ + НДШ (татварын дүн)" hint="Цалингийн хуудас эсвэл e-barimt-аас харна. Оруулбал дээрх тооцооллын оронд үүнийг ашиглана." value={exact} onChange={setExact} />
              {suspicious && (
                <p role="status" className="rounded-lg bg-signal-soft px-3 py-2 text-xs text-primary">
                  Энэ дүн цалингийн 40%-иас их байна. Цалингаа энд биш, дээрх &quot;Сарын цалин&quot; талбарт оруулсан уу? Ихэнх хүний суутгал цалингийн ~20% байдаг.
                </p>
              )}
            </div>
          </details>
        </div>
        <MoneyInput id="purchases" label="Сард дэлгүүр, үйлчилгээнд зарцуулдаг мөнгө" hint="Үнэд 10% НӨАТ орсон байдаг: үнийн 1/11 нь татвар. Оюутан ч гэсэн татвар төлдөг гэсэн үг." value={purchases} onChange={setPurchases} />
      </div>

      {r.total > 0 && (
        <section aria-live="polite" className="flex flex-col gap-4 rounded-3xl bg-primary p-5 ring-1 ring-line ring-inset md:p-6">
          <header className="flex flex-col gap-1">
            <p className="text-sm text-tertiary">Таны жилд төлдөг татвар (ойролцоо)</p>
            <p className="num-mono text-2xl text-primary">{formatNumber(r.total)} ₮</p>
            <p className="text-xs text-tertiary">
              {payroll.source === "estimate"
                ? `НДШ ${formatMntShort(parts.si * 12)} · ХХОАТ ${formatMntShort(parts.pit * 12)} (цалингаас тооцоолсон)`
                : payroll.source === "exact"
                  ? `ХХОАТ + НДШ ${formatMntShort(r.payrollYear)} (цалингийн хуудаснаас)`
                  : "Цалингийн татвар оруулаагүй"}{" "}
              · НӨАТ {formatMntShort(r.vatYear)}
            </p>
          </header>
          <h2 className="text-sm font-semibold text-primary">{year} оны улсын төсвийн бүтцээр хуваавал:</h2>
          <ol className="flex flex-col gap-3">
            {r.lines.map((l) => (
              <li key={l.name} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 text-secondary">{l.name}</span>
                  <span className="shrink-0 font-semibold text-primary tabular-nums">
                    {formatNumber(l.amount)} ₮ <span className="font-normal text-tertiary">· {pct(l.share)}</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-secondary" aria-hidden>
                  <div className="h-2 rounded-full bg-[var(--series-1)]" style={{ width: `${Math.max(1, (l.amount / max) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ol>
          <p className="text-xs text-tertiary">
            Татвар тодорхой зардалд шууд очдоггүй: бүгд нэг төсөвт нийлж, УИХ-ын баталсан төсвөөр зарцуулагдана. Энэ нь &quot;таны төлсөн мөнгийг төсөвтэй ижил харьцаагаар хуваавал&quot; гэсэн тооцоо.
          </p>
        </section>
      )}
    </div>
  );
}
