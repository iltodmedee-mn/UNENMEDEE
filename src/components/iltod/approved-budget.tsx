import {
  APPROVED_2027 as B,
  COUNCIL,
  FOR_YOU,
  HIGHLIGHTS,
  OYU_TOLGOI,
  SOURCES,
  VIEWS,
} from "@/lib/budget/approved-2027";
import { formatMntShort } from "@/lib/format";
import { POPULATION } from "@/lib/per-person";

/** тэрбум ₮ → "41.6 их наяд ₮": one decimal so the tiles fit a phone's half width. */
export function trillions(billion: number): string {
  const n = Math.abs(billion) / 1000;
  return `${billion < 0 ? "−" : ""}${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} их наяд ₮`;
}

/** Expenditure per resident, сая ₮ with one decimal (plain division, as the page says). */
export function perPersonMillions(billion: number): string {
  return ((billion * 1e9) / POPULATION.count / 1e6).toLocaleString("en-US", {
    maximumFractionDigits: 1,
  });
}

export function growthPct(now: number, before: number): number {
  return Math.round((now / before - 1) * 100);
}

function Link({ source }: { source: keyof typeof SOURCES }) {
  const s = SOURCES[source];
  return (
    <a
      href={s.url}
      target="_blank"
      rel="noreferrer"
      className="font-semibold text-brand-secondary hover:underline"
    >
      {s.label}
    </a>
  );
}

function Tile({
  label,
  value,
  sub,
  bad,
}: {
  label: string;
  value: string;
  sub: string;
  bad?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-t border-line-soft py-3">
      <p className="label-mono truncate text-tertiary">{label}</p>
      <p className="num-mono text-lg text-primary md:text-xl">{value}</p>
      <p className={bad ? "text-xs text-risk" : "text-xs text-tertiary"}>
        {sub}
      </p>
    </div>
  );
}

function Bar({
  name,
  sub,
  value,
  max,
  total,
}: {
  name: string;
  sub: string;
  value: number;
  max: number;
  total: number;
}) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 text-secondary">
          {name}
          <span className="block text-xs text-tertiary">{sub}</span>
        </span>
        <span className="shrink-0 text-right font-semibold text-primary tabular-nums">
          {formatMntShort(value * 1e9)}{" "}
          <span className="font-normal text-tertiary">
            · {((value / total) * 100).toFixed(1)}%
          </span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-secondary" aria-hidden>
        <div
          className="h-2 rounded-full bg-[var(--series-1)]"
          style={{ width: `${Math.max(1, (value / max) * 100)}%` }}
        />
      </div>
    </li>
  );
}

/**
 * "2027 оны төсөв": the approved budget at the top of /budget (Nov 2026, the owner's pick from the
 * mockup). Static figures from `approved-2027.ts`; only the current inflation line comes from the
 * Mongolbank snapshot the page may pass in. Server markup, no client JS.
 */
export function ApprovedBudget({
  inflation,
}: {
  inflation?: { value: number; month: string } | null;
}) {
  const highlightMax = Math.max(...HIGHLIGHTS.map((h) => h.value));
  const shareMax = Math.max(B.current, B.capital);
  return (
    <section
      id="y2027"
      aria-labelledby="y2027-title"
      className="flex flex-col gap-4 rounded-3xl bg-primary p-5 ring-1 ring-line ring-inset md:p-6"
      style={{ boxShadow: "inset 0 4px 0 var(--color-signal)" }}
    >
      <header className="flex flex-col gap-1">
        <p className="label-mono text-brand-secondary">
          Шинэ · УИХ 2026.11.13-нд баталсан
        </p>
        <h2
          id="y2027-title"
          className="headline text-[1.75rem] leading-tight text-primary"
        >
          {B.year} оны төсөв:{" "}
          <span className="num-mono rounded bg-signal px-1 text-signal-ink">
            {trillions(B.expenditure)}
          </span>
        </h2>
        <p className="text-xs text-tertiary">
          Эх сурвалж: УИХ, Засгийн газар, Төсвийн тогтвортой байдлын зөвлөл.
          Батлагдсан <strong>төлөвлөгөө</strong>, гүйцэтгэл биш. Нэгдсэн төсвийн
          зарлагын дээд хэмжээ 41 586 тэрбум ₮.
        </p>
      </header>

      <div className="flex flex-col gap-1 rounded-2xl bg-secondary p-4">
        <p className="label-mono text-tertiary">Хүн бүрт хуваавал</p>
        <p className="num-mono text-[2.25rem] leading-tight text-primary">
          {perPersonMillions(B.expenditure)} сая ₮
        </p>
        <p className="text-sm text-secondary">
          Өдөрт{" "}
          <strong className="text-primary">
            {Math.round(B.expenditure / 365)} тэрбум ₮
          </strong>{" "}
          зарцуулна. {(POPULATION.count / 1e6).toFixed(2)} сая хүнд хуваасан
          тооцоо ({POPULATION.source}, {POPULATION.year}).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Зарлага"
          value={trillions(B.expenditure)}
          sub={`2026 оноос +${growthPct(B.expenditure, B.expenditure2026)}%`}
        />
        <Tile
          label="Орлого"
          value={trillions(B.revenue)}
          sub={`ДНБ-ий ${B.gdp.revenue}%`}
        />
        <Tile
          label="Алдагдал"
          value={trillions(B.balance)}
          sub={`ДНБ-ий ${Math.abs(B.gdp.balance).toFixed(1)}%`}
          bad
        />
        <Tile
          label="Засгийн газрын өр"
          value={trillions(B.debt)}
          sub={`ДНБ-ий ${B.gdp.debt}% · хүн бүрт ${perPersonMillions(B.debt)} сая`}
          bad
        />
      </div>

      <h3 className="text-sm font-semibold text-primary">
        100 төгрөг тутмын хаашаа явах вэ
      </h3>
      <ol className="flex flex-col gap-3">
        <Bar
          name="Урсгал зардал"
          sub="цалин, тэтгэвэр, тэтгэмж, үйл ажиллагаа"
          value={B.current}
          max={shareMax}
          total={B.expenditure}
        />
        <Bar
          name="Хөрөнгийн зардал"
          sub="барилга, зам, сургууль, эмнэлэг"
          value={B.capital}
          max={shareMax}
          total={B.expenditure}
        />
      </ol>
      <p className="text-sm text-secondary">
        УИХ төсвийг 2 их наядаар танахдаа бүгдийг нь хөрөнгийн зардлаас хассан.
        Тиймээс урсгал зардлын хувь{" "}
        <strong className="text-primary">
          {B.currentShare.before}%-иас {B.currentShare.after}%
        </strong>{" "}
        болсон (Төсвийн тогтвортой байдлын зөвлөлийн тооцоо).
      </p>

      <h3 className="pt-2 text-sm font-semibold text-primary">Танд хамаатай</h3>
      <ul className="flex flex-col divide-y divide-line-soft text-sm">
        {FOR_YOU.map((f) => (
          <li
            key={f.text}
            className="flex items-baseline justify-between gap-3 py-2"
          >
            <span className="text-secondary">
              {f.text} <strong className="text-primary">{f.strong}</strong>
            </span>
            <span className="shrink-0 text-xs text-tertiary">{f.note}</span>
          </li>
        ))}
      </ul>

      <h3 className="pt-2 text-sm font-semibold text-primary">
        Онцлох зардал, хөнгөлөлт
      </h3>
      <ol className="flex flex-col gap-3">
        {HIGHLIGHTS.map((h) => (
          <Bar
            key={h.name}
            name={h.name}
            sub={h.sub}
            value={h.value}
            max={highlightMax}
            total={B.expenditure}
          />
        ))}
      </ol>
      <p className="text-xs text-tertiary">
        Хувь нь нийт зарлагатай харьцуулсан. Сургууль, эмнэлгийн мөр нь зөвхөн
        барилга, тоног төхөөрөмж: эмч, багшийн цалин урсгал зардалд ордог.
      </p>

      <div className="flex flex-col gap-1 rounded-2xl bg-secondary p-4">
        <p className="label-mono text-tertiary">
          Оюу толгойн ногдол ашиг · 3 их наяд ₮
        </p>
        <p className="text-sm text-secondary">{OYU_TOLGOI}</p>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl bg-risk-soft p-4">
        <p className="label-mono text-risk">
          Төсвийн тогтвортой байдлын зөвлөлийн дүгнэлт
        </p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-secondary">
          {COUNCIL.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="text-xs text-tertiary">
          Мөн: төсвийг {B.assumed.inflation.toFixed(1)}%-ийн инфляцаар тооцсон
          {inflation
            ? `, ${inflation.month} сарын инфляц ${inflation.value.toFixed(1)}% (Монголбанк)`
            : ""}
          .
        </p>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-tertiary">
          Сөрөг хүчин ба Засгийн газрын тайлбар
        </summary>
        <div className="mt-2 flex flex-col gap-2 text-secondary">
          {VIEWS.map((v) => (
            <p key={v.who}>
              <strong className="text-primary">{v.who}:</strong> {v.text}{" "}
              <Link source={v.source} />
            </p>
          ))}
        </div>
      </details>

      <p className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-tertiary">
        <span>Эх сурвалж:</span>
        <Link source="framework" /> <span aria-hidden>·</span>{" "}
        <Link source="pm" /> <span aria-hidden>·</span>{" "}
        <Link source="oyuTolgoi" /> <span aria-hidden>·</span>{" "}
        <Link source="culture" /> <span aria-hidden>·</span>{" "}
        <Link source="revised2026" />
      </p>
    </section>
  );
}
