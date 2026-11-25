import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ApprovedBudget } from "@/components/iltod/approved-budget";
import { GroupedBarChart, SeriesLineChart, SignedBarChart } from "@/components/iltod/charts";
import { Empty } from "@/components/iltod/empty";
import { PageHeader } from "@/components/iltod/page-header";
import { ShareButton } from "@/components/iltod/share-button";
import { FeedSkeleton } from "@/components/iltod/skeletons";
import { YearTable } from "@/components/iltod/year-table";
import { AUDIT_URL, type AuditSnapshot, OPINIONS, type Opinion } from "@/lib/budget/audit";
import { GOVERNMENTS_SOURCE, GOVERNMENTS_VERIFIED_THROUGH, governmentsInYear, yearUnverified } from "@/lib/budget/governments";
import { type BudgetNsoSnapshot, type CategorySeries, NSO_SOURCE_URL } from "@/lib/budget/nso";
import { SHILENDANS_URL, type ShilendansSnapshot } from "@/lib/budget/shilendans";
import type { TaxShareSnapshot } from "@/lib/budget/worldbank";
import type { MacroSnapshot } from "@/lib/mongolbank/client";
import { formatDateMn, formatMntShort } from "@/lib/format";
import { getIndicator } from "@/lib/queries";
import { jsonLd } from "@/lib/site";
import { breadcrumbLd, datasetLd } from "@/lib/structured-data";
import { cx } from "@/utils/cx";
import { DataAge } from "@/components/iltod/data-age";

export const metadata: Metadata = {
  title: "Улсын төсөв: 2027 оны төсөв, 1990 оноос хойшхи орлого, зарлага, өр, аудит",
  alternates: { canonical: "/budget" },
  description:
    "Монгол Улсын 2027 оны батлагдсан төсөв (41.6 их наяд ₮, хүн бүрт 12 сая ₮) ба нэгдсэн төсвийн орлого, зарлага, алдагдал 1990 оноос хойш, тухайн үеийн Ерөнхий сайдтай нь. Татварын мөнгө юунд зарцуулагдсан, Засгийн газрын өр, Шилэн данс, Үндэсний аудитын газрын дүгнэлт. Бүгд албан ёсны эх сурвалжтай.",
};

/** NSO amounts are million ₮; debt is billion ₮. */
const mln = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatMntShort(v * 1e6));
function pct(part: number, whole: number): string {
  if (!whole) return "—";
  const p = (part / whole) * 100;
  return p > 0 && p < 0.1 ? "<0.1%" : `${p.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}
const trillion = (v: number | null) => (v === null ? null : Math.round(v / 1e4) / 100);

/** Clearer names for two NSO revenue lines that are only "Аж ахуйн нэгжийн" / "Хүн амын" there. */
const REVENUE_NAME: Record<string, string> = {
  "7": "Аж ахуйн нэгжийн орлогын албан татвар",
  "8": "Хүн амын орлогын албан татвар (ХХОАТ)",
};

const OPINION_INFO: Record<Opinion, string> = {
  "Сөрөг дүгнэлт": "Тайлан бодит байдлыг ноцтой буруу харуулсан гэж аудитор үзсэн.",
  "Татгалзсан дүгнэлт": "Хангалттай баримт өгөөгүй тул аудитор дүгнэлт гаргахаас татгалзсан.",
  "Хязгаарлалтай дүгнэлт": "Тодорхой зөрчлөөс бусад нь зөв гэж үзсэн.",
};

/** audit.mn titles are in capitals; sentence case reads easier (the link keeps the original). */
function sentenceCase(title: string): string {
  return title === title.toLocaleUpperCase("mn") ? title.charAt(0) + title.slice(1).toLocaleLowerCase("mn") : title;
}

function Section({ id, title, source, children }: { id: string; title: string; source: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-3xl bg-primary p-5 ring-1 ring-line ring-inset md:p-6">
      <header className="flex flex-col gap-1">
        <h2 id={id} className="text-lg font-semibold text-primary">
          {title}
        </h2>
        <p className="text-xs text-tertiary">Эх сурвалж: {source}</p>
      </header>
      {children}
    </section>
  );
}

function SourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-brand-secondary hover:underline">
      {children}
    </a>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" | "good" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-t border-line-soft py-3">
      <p className="label-mono truncate text-tertiary">{label}</p>
      <p className="num-mono text-lg text-primary md:text-xl">{value}</p>
      {sub && <p className={cx("text-xs", tone === "bad" ? "text-risk" : tone === "good" ? "text-brand-secondary" : "text-tertiary")}>{sub}</p>}
    </div>
  );
}

/** Horizontal share bars in plain HTML: readable as a list, no chart JS. Past `limit` rows the rest is one "Бусад" line. */
function ShareBars({ rows: all, total, format, limit = 12 }: { rows: { name: string; value: number; sub?: string }[]; total: number; format: (v: number) => string; limit?: number }) {
  const rest = all.slice(limit - 1);
  const rows = all.length > limit ? [...all.slice(0, limit - 1), { name: "Бусад", sub: rest.map((r) => r.name).join(", "), value: rest.reduce((a, r) => a + r.value, 0) }] : all;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.name} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 text-secondary">
              {r.name}
              {r.sub && <span className="block text-xs text-tertiary">{r.sub}</span>}
            </span>
            <span className="shrink-0 text-right font-semibold text-primary tabular-nums">
              {format(r.value)} <span className="font-normal text-tertiary">· {pct(r.value, total)}</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-secondary" aria-hidden>
            <div className="h-2 rounded-full bg-[var(--series-1)]" style={{ width: `${Math.max(1, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Latest year that has a total (the newest NSO year can be empty for a while). */
function latestYear(years: string[], total: Record<string, number | null>): string | undefined {
  return [...years].reverse().find((y) => total[y] !== null && total[y] !== undefined);
}

function byLatest(cats: CategorySeries[], year: string, rename: Record<string, string> = {}) {
  return cats
    .map((c) => ({ name: rename[c.code] ?? c.name, value: c.values[year] ?? 0, values: c.values }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);
}

function History({ nso }: { nso: BudgetNsoSnapshot }) {
  const rows = nso.history.filter((y) => y.revenue !== null && y.expenditure !== null);
  const last = rows.at(-1);
  const debt = nso.debt.at(-1);
  if (!last) return null;
  const chart = rows.map((y) => ({ label: String(y.year), revenue: trillion(y.revenue), expenditure: trillion(y.expenditure) }));
  const balance = rows.filter((y) => y.balance !== null && y.revenue).map((y) => ({ label: String(y.year), value: Math.round(((y.balance as number) / (y.revenue as number)) * 1000) / 10 }));
  const deficits = rows.filter((y) => (y.balance ?? 0) < 0).length;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label={`${last.year} оны орлого`} value={mln(last.revenue)} sub="гүйцэтгэлээр" />
        <Tile label={`${last.year} оны зарлага`} value={mln(last.expenditure)} sub="гүйцэтгэлээр" />
        <Tile
          label={`${last.year} оны тэнцэл`}
          value={mln(last.balance)}
          sub={(last.balance ?? 0) < 0 ? "алдагдалтай" : "ашигтай"}
          tone={(last.balance ?? 0) < 0 ? "bad" : "good"}
        />
        {debt && <Tile label={`Засгийн газрын нийт өр (${debt.label.replace("-", " оны ")}-р улирал)`} value={formatMntShort(debt.value * 1e9)} />}
      </div>

      <Section
        id="history"
        title={`Нэгдсэн төсөв ${rows[0].year}–${last.year}: орлого ба зарлага`}
        source={
          <>
            Сангийн яам, <SourceLink href={NSO_SOURCE_URL}>Үндэсний статистикийн хороо (1212.mn)</SourceLink>
            {nso.updated.balance ? ` · шинэчлэгдсэн ${formatDateMn(nso.updated.balance)}` : ""}. Ерөнхий сайд:{" "}
            <SourceLink href={GOVERNMENTS_SOURCE}>Wikipedia</SourceLink>
          </>
        }
      >
        <p className="text-sm text-secondary">
          Батлагдсан төлөвлөгөө биш, жил бүрийн <strong>гүйцэтгэл</strong>. Нэрлэсэн үнээр (инфляцийг тооцоогүй), тиймээс 1990-ээд оны тоо одоогийнхтой харьцуулахад маш бага харагдана.{" "}
          {rows.length} жилийн {deficits}-д нь төсөв алдагдалтай гарсан.
        </p>
        <GroupedBarChart
          data={chart}
          series={[
            { key: "revenue", name: "Орлого" },
            { key: "expenditure", name: "Зарлага" },
          ]}
          unit="их наяд ₮"
          ariaLabel="Нэгдсэн төсвийн орлого, зарлага жилээр, их наяд төгрөгөөр"
        />
        <h3 className="text-sm font-semibold text-primary">Тэнцэл, орлогын хувиар (хасах = алдагдал)</h3>
        <SignedBarChart data={balance} name="Тэнцэл" unit="% (орлоготой харьцуулсан)" ariaLabel="Төсвийн тэнцэл, орлогын хувиар, жилээр" />
        <div className="max-h-[32rem] overflow-auto rounded-2xl ring-1 ring-line ring-inset">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">Нэгдсэн төсвийн орлого, зарлага, тэнцэл, тухайн оны Ерөнхий сайд</caption>
            <thead className="sticky top-0 border-b border-line bg-secondary text-xs text-tertiary">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Он
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Ерөнхий сайд (нам)
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Орлого
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Зарлага
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Тэнцэл
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {[...rows].reverse().map((y) => (
                <tr key={y.year}>
                  <th scope="row" className="px-3 py-2 font-semibold text-primary tabular-nums">
                    {y.year}
                  </th>
                  <td className="px-3 py-2 text-xs text-secondary">
                    {governmentsInYear(y.year)
                      .map((g) => `${g.pm} (${g.party})`)
                      .join(", ") || "—"}
                    {yearUnverified(y.year) && governmentsInYear(y.year).length > 0 && " …"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-secondary tabular-nums">{mln(y.revenue)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-secondary tabular-nums">{mln(y.expenditure)}</td>
                  <td className={cx("px-3 py-2 text-right whitespace-nowrap tabular-nums", (y.balance ?? 0) < 0 ? "text-error-primary" : "text-success-primary")}>{mln(y.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-tertiary">
          Ерөнхий сайдын нэр нь тухайн онд Засгийн газрыг хэн тэргүүлж байсныг л харуулна. Төсвийг УИХ баталдаг; алдагдал, өсөлтийг нэг хүн эсвэл намд оноосон дүгнэлт биш.
          {rows.some((y) => yearUnverified(y.year)) &&
            ` Ерөнхий сайдын жагсаалтыг ${GOVERNMENTS_VERIFIED_THROUGH}-нд шалгасан: түүнээс хойших хугацааг «…» эсвэл «—» гэж тэмдэглэв.`}
        </p>
      </Section>
    </>
  );
}

function Spending({ nso }: { nso: BudgetNsoSnapshot }) {
  const { economic, programmes } = nso.spending;
  const year = latestYear(economic.years, economic.total);
  if (!year) return null;
  const total = economic.total[year] ?? 0;
  const econ = byLatest(economic.categories, year);
  const prog = byLatest(programmes.categories, year);
  const recent = economic.years.slice(-5);
  return (
    <Section
      id="spending"
      title={`Татварын мөнгө юунд зарцуулагдав (${year})`}
      source={
        <>
          Сангийн яам, <SourceLink href="https://www.1212.mn/mn/statistic/statcate/573051/table-view/DT_NSO_0800_001V3">1212.mn, зарлага зориулалтаар</SourceLink>
          {nso.updated.purpose ? ` · шинэчлэгдсэн ${formatDateMn(nso.updated.purpose)}` : ""}
        </>
      }
    >
      <p className="text-sm text-secondary">
        {year} онд нэгдсэн төсвөөс нийт <strong className="text-primary">{mln(total)}</strong> зарцуулсан. Үүний хэдийг цалин, тэтгэвэр, хөрөнгө оруулалт, өрийн төлбөрт зарсныг доор харуулав.
      </p>
      <ShareBars rows={econ} total={total} format={mln} />
      <YearTable caption="Төсвийн зарлага, эдийн засгийн ангиллаар" years={recent} rows={econ} format={mln} />

      {prog.length > 0 && (
        <>
          <h3 className="pt-2 text-sm font-semibold text-primary">Зорилтот арга хэмжээ, хөтөлбөрүүд зориулалтаар</h3>
          <p className="text-xs text-tertiary">
            Энэ нь зөвхөн хөтөлбөр, арга хэмжээний зардал. Жишээ нь эмнэлэг, сургуулийн цалин, урсгал зардал дээрх ангилалд багтсан тул энэ жагсаалт эрүүл мэнд, боловсролын нийт зардал биш.
          </p>
          <ShareBars rows={prog} total={programmes.total[year] ?? 0} format={mln} limit={10} />
        </>
      )}
    </Section>
  );
}

function Revenue({ nso, tax }: { nso: BudgetNsoSnapshot; tax: TaxShareSnapshot | null }) {
  const { revenue } = nso;
  const year = latestYear(revenue.years, revenue.total);
  if (!year) return null;
  const total = revenue.total[year] ?? 0;
  const rows = byLatest(revenue.categories, year, REVENUE_NAME);
  const funds = byLatest(revenue.funds ?? [], year);
  return (
    <Section
      id="revenue"
      title={`Төсвийн мөнгө хаанаас ирдэг вэ (${year})`}
      source={
        <>
          Сангийн яам, <SourceLink href="https://www.1212.mn/mn/statistic/statcate/573051/table-view/DT_NSO_0800_003V1">1212.mn, орлого нэр төрлөөр</SourceLink>
          {tax && (
            <>
              ; татвар/ДНБ: <SourceLink href="https://data.worldbank.org/indicator/GC.TAX.TOTL.GD.ZS?locations=MN">Дэлхийн банк</SourceLink>
            </>
          )}
        </>
      }
    >
      <p className="text-sm text-secondary">
        {year} оны тэнцвэржүүлсэн орлого <strong className="text-primary">{mln(total)}</strong>.
        {funds.length > 0 && <> Үүн дээр уул уурхайн орлогоос {funds.map((f) => `${f.name} ${mln(f.value)}`).join(", ")} руу төвлөрүүлсэн.</>}
      </p>
      <ShareBars rows={rows} total={total} format={mln} />
      <YearTable caption="Төсвийн орлого, нэр төрлөөр" years={revenue.years.slice(-5)} rows={rows} format={mln} />
      {tax && tax.series.length > 0 && (
        <>
          <h3 className="pt-2 text-sm font-semibold text-primary">Татварын орлого, ДНБ-ий хувиар</h3>
          <SeriesLineChart data={tax.series} name="Татвар / ДНБ" unit="%" ariaLabel="Татварын орлого, ДНБ-ий хувиар, Дэлхийн банк" />
          <YearTable caption="Татварын орлого, ДНБ-ий хувиар" years={tax.series.slice(-8).map((p) => p.label)} rows={[{ name: "Татвар / ДНБ, %", values: Object.fromEntries(tax.series.map((p) => [p.label, p.value])) }]} format={(v) => (v === null ? "—" : `${v}%`)} />
        </>
      )}
    </Section>
  );
}

function Debt({ nso }: { nso: BudgetNsoSnapshot }) {
  if (nso.debt.length === 0) return null;
  const series = nso.debt.map((d) => ({ label: d.label, value: Math.round(d.value / 10) / 100 }));
  return (
    <Section
      id="debt"
      title="Засгийн газрын нийт өр, улирлаар"
      source={
        <>
          <SourceLink href="https://www.1212.mn/mn/statistic/statcate/573051/table-view/DT_NSO_0700_028V1">1212.mn</SourceLink>
          {nso.updated.debt ? ` · шинэчлэгдсэн ${formatDateMn(nso.updated.debt)}` : ""}
        </>
      }
    >
      <SeriesLineChart data={series} name="Нийт өр" unit="их наяд ₮" ariaLabel="Засгийн газрын нийт өр, их наяд төгрөгөөр, улирлаар" />
      <YearTable
        caption="Засгийн газрын нийт өр"
        years={series.slice(-8).map((p) => p.label)}
        rows={[{ name: "Нийт өр, их наяд ₮", values: Object.fromEntries(series.map((p) => [p.label, p.value])) }]}
        format={(v) => (v === null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 2 }))}
      />
    </Section>
  );
}

function Shilendans({ s, updatedAt }: { s: ShilendansSnapshot; updatedAt: Date }) {
  const catTotal = s.categories.reduce((a, c) => a + c.amount, 0);
  return (
    <Section
      id="shilendans"
      title={`Шилэн данс: ${s.from.slice(0, 4)} онд хамгийн их төлбөр авсан 10 байгууллага`}
      source={
        <>
          <SourceLink href={SHILENDANS_URL}>Шилэн данс</SourceLink> · {formatDateMn(s.from)} – {formatDateMn(s.to)} · <DataAge at={updatedAt} staleDays={14} />
        </>
      }
    >
      <p className="text-sm text-secondary">Төрийн байгууллагуудын Шилэн дансанд нийтэлсэн төлбөрүүдээс хамгийн их мөнгө хүлээн авсан байгууллагууд. Регистрийн дугаараар нь шалгаж болно.</p>
      <ol className="flex flex-col divide-y divide-line-soft">
        {s.topPayees.map((p, i) => (
          <li key={`${p.registerNo}-${i}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="mr-2 text-tertiary tabular-nums">{i + 1}.</span>
              <span className="font-medium text-primary">{p.name}</span>
              {p.registerNo && <span className="block pl-6 text-xs text-tertiary">РД {p.registerNo}</span>}
            </span>
            <span className="shrink-0 font-semibold text-primary tabular-nums">{formatMntShort(p.amount)}</span>
          </li>
        ))}
      </ol>
      {s.categories.length > 0 && (
        <>
          <h3 className="pt-2 text-sm font-semibold text-primary">Шилэн дансны зарлага, ангиллаар</h3>
          <ShareBars rows={s.categories.map((c) => ({ name: c.name, value: c.amount }))} total={catTotal} format={formatMntShort} />
        </>
      )}
    </Section>
  );
}

function Audit({ a, updatedAt }: { a: AuditSnapshot; updatedAt: Date }) {
  return (
    <Section
      id="audit"
      title="Үндэсний аудитын газрын сөрөг, татгалзсан, хязгаарлалттай дүгнэлтүүд"
      source={
        <>
          <SourceLink href={AUDIT_URL}>audit.mn, аудитын тайлангийн сан</SourceLink> · <DataAge at={updatedAt} staleDays={30} />
        </>
      }
    >
      <ul className="grid gap-3 md:grid-cols-3">
        {OPINIONS.map((o) => (
          <li key={o} className="flex flex-col gap-1 rounded-2xl bg-secondary p-4">
            <p className="text-xs font-semibold text-tertiary">{o}</p>
            <p className="text-xl font-semibold text-primary tabular-nums">{a.totals[o] ?? "—"}</p>
            <p className="text-xs text-tertiary">{OPINION_INFO[o]}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-tertiary">Тоо нь audit.mn-ийн бүртгэлд байгаа бүх оны тайлангийн нийлбэр. Доор дүгнэлт тус бүрийн хамгийн сүүлийн тайлангууд.</p>
      {OPINIONS.map((o) => {
        const list = a.reports.filter((r) => r.opinion === o);
        if (list.length === 0) return null;
        return (
          <details key={o} className="text-sm" open={o === OPINIONS[0]}>
            <summary className="cursor-pointer font-semibold text-primary">
              {o} ({list.length})
            </summary>
            <ul className="mt-2 flex flex-col divide-y divide-line-soft">
              {list.map((r) => (
                <li key={r.id} className="flex flex-col gap-0.5 py-2">
                  <a href={r.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                    {sentenceCase(r.title)}
                  </a>
                  <span className="text-xs text-tertiary">{[r.office, r.auditType].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </Section>
  );
}

async function Budget() {
  const [nso, tax, shilendans, audit, macro] = await Promise.all([
    getIndicator<BudgetNsoSnapshot>("budget_nso"),
    getIndicator<TaxShareSnapshot>("worldbank_tax"),
    getIndicator<ShilendansSnapshot>("shilendans"),
    getIndicator<AuditSnapshot>("audit_opinions"),
    // Shared cache entry with the home page's macro strip: no extra read once it is warm.
    getIndicator<MacroSnapshot>("mongolbank"),
  ]);
  const cpi = macro?.data.inflation;
  const inflation = cpi && cpi.national !== null ? { value: cpi.national, month: cpi.month } : null;
  // The approved budget is static, so it shows even with no database (CI, contributors).
  if (!nso && !shilendans && !audit) {
    return (
      <div className="flex flex-col gap-6 pb-10">
        <ApprovedBudget inflation={inflation} />
        <Empty title="Төсвийн өгөгдөл хараахан татагдаагүй" description="Сангийн яам, ҮСХ, Шилэн данс, Аудитын газрын өгөгдлийг өдөр бүр автоматаар шинэчилнэ." />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6 pb-10">
      <ApprovedBudget inflation={inflation} />
      {nso && <History nso={nso.data} />}
      {nso && <Spending nso={nso.data} />}
      {nso && <Revenue nso={nso.data} tax={tax?.data ?? null} />}
      {nso && <Debt nso={nso.data} />}
      {shilendans && <Shilendans s={shilendans.data} updatedAt={shilendans.updatedAt} />}
      {audit && <Audit a={audit.data} updatedAt={audit.updatedAt} />}
    </div>
  );
}

const BUDGET_LD = {
  "@context": "https://schema.org",
  "@graph": [
    datasetLd(
      {
        name: "Монгол Улсын нэгдсэн төсвийн орлого, зарлага, тэнцэл 1990 оноос",
        description: "Үндэсний статистикийн хорооны нэгдсэн төсвийн гүйцэтгэл (сая төгрөгөөр): орлого, зарлага, тэнцэл, зардлын эдийн засгийн ангилал, орлогын бүтэц, Засгийн газрын өр улирлаар. ИЛ ТОД МЭДЭЭ өдөр бүр татаж харуулна.",
        creator: { name: "Үндэсний статистикийн хороо", url: "https://www.1212.mn" },
        sourceUrl: NSO_SOURCE_URL,
        temporalCoverage: "1990/..",
        keywords: ["улсын төсөв", "төсвийн орлого", "төсвийн зарлага", "Засгийн газрын өр", "ҮСХ"],
      },
      "/budget",
    ),
    breadcrumbLd([{ name: "Улсын төсөв", path: "/budget" }]),
  ],
};

export default function BudgetPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(BUDGET_LD) }} />
      <PageHeader
        eyebrow="💰 Татварын мөнгө хаашаа явдаг вэ"
        title="Монгол Улсын төсөв"
        description="2027 оны батлагдсан төсөв, 1990 оноос хойшхи нэгдсэн төсвийн орлого, зарлага, алдагдал, юунд зарцуулсан, хэнд төлсөн, аудит юу гэж дүгнэсэн. Зөвхөн албан ёсны статистик, тоо бүр эх сурвалж руугаа холбогдоно; бид хэнийг ч буруутгахгүй."
      >
        <div className="flex flex-wrap gap-2">
          <Link href="/tax" className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-bg-primary transition hover:opacity-90">
            🧾 Миний татвар хаашаа явдаг вэ?
          </Link>
          <ShareButton path="/budget" title="Татварын мөнгө хаашаа явдаг вэ? 1990 оноос хойшхи улсын төсөв" />
        </div>
      </PageHeader>
      <Suspense fallback={<FeedSkeleton />}>
        <Budget />
      </Suspense>
    </>
  );
}
