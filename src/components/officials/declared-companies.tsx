import Link from "next/link";

import { formatDateMn, formatMntShort } from "@/lib/format";
import { type CompanyCheck, type DeclaredOrg, declaredCompanies, type OfficialCompaniesSnapshot, SHILENDANS_SITE } from "@/lib/officials/companies";
import type { CompanyTenders } from "@/lib/queries";

/**
 * "Мэдүүлсэн компаниуд": the organisations a member named in their own latest ХАСХОМ filing, and
 * for each one whether Шилэн данс records state payments to a company of exactly that name. Server
 * markup only. Facts side by side, no verdict: the note says what a match does and does not mean.
 */
export function DeclaredCompanies({
  details,
  year,
  xacxomUrl,
  snapshot,
  tenders = {},
}: {
  details: Record<string, string> | null | undefined;
  year: number;
  xacxomUrl: string | null;
  snapshot: OfficialCompaniesSnapshot | null;
  tenders?: Record<string, CompanyTenders>;
}) {
  const c = declaredCompanies(details);
  if (c.stocks.length === 0 && c.lenders.length === 0) return null;
  const paid = [...c.stocks, ...c.lenders].filter((o) => snapshot?.companies[o.key]?.status === "found").length;
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4" aria-labelledby="declared-companies">
      <header className="flex flex-col gap-1">
        <h2 id="declared-companies" className="text-lg font-semibold text-primary">
          Мэдүүлсэн компаниуд
        </h2>
        <p className="text-sm text-tertiary">
          {year} оны ХАСХОМ мэдүүлэгтээ өөрөө бичсэн байгууллагууд.
          {snapshot ? ` Шилэн дансанд ижил нэртэй компанид төрийн байгууллага төлбөр шилжүүлсэн эсэх (${snapshot.from.slice(0, 4)} оноос): ${paid} компани.` : ""}
        </p>
      </header>
      {c.stocks.length > 0 && <Group title="Хувьцаа эзэмшдэг" orgs={c.stocks} snapshot={snapshot} tenders={tenders} />}
      {c.lenders.length > 0 && <Group title="Зээлдүүлэгч" orgs={c.lenders} snapshot={snapshot} tenders={tenders} />}
      <p className="text-xs text-tertiary">
        Шилэн дансны мөр нь тухайн нэртэй компанид төрийн байгууллага мөнгө шилжүүлсэн гэсэн нийтийн бүртгэл: хууль зөрчсөн гэсэн үг биш. Нэрийг бүтнээр нь тулгадаг; ижил нэртэй хэд хэдэн компани байвал холбохгүй. Регистрийн дугаараар Шилэн дансанд шалгаж болно.
        {c.hiddenPeople > 0 && ` Хувь хүний нэр (${c.hiddenPeople}) энд харуулаагүй.`} Банк, сан, Эрдэнэс Тавантолгойн хувьцааг Шилэн дансанд хайгаагүй.
      </p>
      <p className="text-xs text-quaternary">
        Эх сурвалж:{" "}
        {xacxomUrl ? (
          <a href={xacxomUrl} target="_blank" rel="noreferrer" className="hover:underline">
            АТГ, ХАСХОМ
          </a>
        ) : (
          "АТГ, ХАСХОМ"
        )}{" "}
        ·{" "}
        <a href={SHILENDANS_SITE} target="_blank" rel="noreferrer" className="hover:underline">
          Шилэн данс
        </a>
        {snapshot && <span className="whitespace-nowrap"> ({snapshot.to} хүртэл)</span>}
      </p>
    </section>
  );
}

function Group({ title, orgs, snapshot, tenders }: { title: string; orgs: DeclaredOrg[]; snapshot: OfficialCompaniesSnapshot | null; tenders: Record<string, CompanyTenders> }) {
  return (
    <div className="flex flex-col">
      <h3 className="label-mono text-tertiary">{title}</h3>
      <ul className="flex flex-col divide-y divide-line-soft">
        {orgs.map((o) => (
          <li key={o.key} className="flex flex-col gap-0.5 py-2">
            <span className="text-sm font-medium text-primary">{o.name}</span>
            <Payments check={o.lookup ? (snapshot?.companies[o.key] ?? null) : null} lookup={o.lookup} />
            {o.lookup && tenders[o.key] && <TenderWins t={tenders[o.key]} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Payments({ check, lookup }: { check: CompanyCheck | null; lookup: boolean }) {
  if (!lookup) return null;
  if (!check) return <span className="text-xs text-quaternary">Шилэн дансанд хараахан шалгаагүй</span>;
  if (check.status === "none") return <span className="text-xs text-tertiary">Шилэн дансанд төрөөс төлбөр авсан бүртгэл олдсонгүй</span>;
  if (check.status === "ambiguous") return <span className="text-xs text-tertiary">Шилэн дансанд ижил нэртэй {check.registers} байгууллага бий: аль нь болохыг тогтоох боломжгүй тул холбосонгүй</span>;
  return (
    <span className="flex flex-col gap-0.5 text-xs text-secondary">
      <span>
        Шилэн данс: төрийн байгууллагаас <strong className="num-mono text-primary">{formatMntShort(check.amount)}</strong> · {check.count} гүйлгээ · регистр <span className="num-mono">{check.register}</span>
      </span>
      {check.payers.length > 0 && <span className="text-tertiary">Төлсөн: {check.payers.map((p) => `${p.name} ${formatMntShort(p.amount)}`).join(" · ")}</span>}
    </span>
  );
}

/** Form-1831 tender lots this company won, as filed: shown only when there are some. */
export function TenderWins({ t }: { t: CompanyTenders }) {
  return (
    <span className="flex flex-col gap-0.5 text-xs text-secondary">
      <span>
        Тендерт шалгарсан (Шилэн данс, маягт 1831):{" "}
        <Link href="/tenders#mp-companies" className="font-medium text-brand-secondary hover:underline">
          {t.count} гэрээ
        </Link>
        {t.sum > 0 && (
          <>
            {" "}
            · <strong className="num-mono text-primary">{formatMntShort(t.sum)}</strong>
          </>
        )}
      </span>
      {t.items.slice(0, 3).map((i) => (
        <span key={i.id} className="text-tertiary">
          {i.orgName} · {i.title}
          {i.resultDate ? ` · ${formatDateMn(i.resultDate)}` : ""}
        </span>
      ))}
    </span>
  );
}
