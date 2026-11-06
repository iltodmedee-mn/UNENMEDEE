import type { Metadata } from "next";
import { Suspense } from "react";

import { Chip } from "@/components/iltod/badges";
import { DataAge } from "@/components/iltod/data-age";
import { Empty } from "@/components/iltod/empty";
import { Ledger } from "@/components/iltod/macro-strip";
import { PageHeader } from "@/components/iltod/page-header";
import { Panel } from "@/components/iltod/panel";
import { ShareButton } from "@/components/iltod/share-button";
import { FeedSkeleton } from "@/components/iltod/skeletons";
import { formatDateMn, formatMntShort, formatNumber } from "@/lib/format";
import { BUYER_SHARE, MIN_BUYER_LOTS, overBudgetPct } from "@/lib/procurement/signs";
import { SHILENDANS_URL } from "@/lib/procurement/tenders";
import Link from "next/link";

import { getCompanyTenders, getTenders, getTenderSigns, type TenderItem, type TenderSigns } from "@/lib/queries";

const TITLE = "Тендерийн үр дүн: хэн, юуг, хэдээр";
const DESCRIPTION =
  "Төрийн байгууллагууд Шилэн дансанд тайлагнасан тендерийн үр дүн: юу худалдан авсан, батлагдсан төсөв, гэрээний дүн, сонгон шалгаруулалтын арга, шалгарсан компани. Өдөр бүр шинэчилнэ.";

export const metadata: Metadata = {
  title: "Тендерийн үр дүн — хэн, юуг, хэдээр авав (Шилэн данс)",
  alternates: { canonical: "/tenders" },
  description: DESCRIPTION,
};

function TenderRow({ t }: { t: TenderItem }) {
  const over = overBudgetPct(t);
  return (
    <li className="flex flex-col gap-1.5 py-4">
      <p className="label-mono normal-case text-tertiary">
        <span className="text-secondary">{t.orgName}</span>
        {" · "}
        {t.resultDate ? formatDateMn(t.resultDate) : "огноо бичээгүй"}
        {t.method && ` · ${t.method}`}
      </p>
      <p className="font-semibold text-pretty text-primary">{t.title}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        {t.contractMnt !== null &&
          (t.unitSuspect ? (
            <span title="Байгууллага дүнг өөр нэгжээр (мянган ₮ гэх мэт) бичсэн байж магадгүй: тайлагнасан тоог өөрчлөлтгүй харуулав">
              <Chip>{formatNumber(t.contractMnt)} · нэгж тодорхойгүй</Chip>
            </span>
          ) : (
            <Chip tone="mnt">{formatMntShort(t.contractMnt)}</Chip>
          ))}
        <span className="min-w-0 text-secondary">
          Шалгарсан: <span className="font-medium text-primary">{t.winner}</span>
        </span>
        {t.budgetMnt !== null && <span className="num-mono text-xs text-tertiary">төсөв {t.unitSuspect ? formatNumber(t.budgetMnt) : formatMntShort(t.budgetMnt)}</span>}
        {over !== null && (
          <span title="Гэрээний дүн батлагдсан төсвөөс их. Төсөв тодотгогдсон байж болно: зөрчил гэсэн үг биш.">
            <Chip>төсвөөс +{over}%</Chip>
          </span>
        )}
      </div>
      <p className="label-mono normal-case text-quaternary">{t.code}</p>
    </li>
  );
}

const pctLabel = (share: number) => `${Math.round(share * 100)}%`;

/** OCP-style signs (src/lib/procurement/signs.ts): procedures and buyers, never people. */
function Signs({ data }: { data: TenderSigns }) {
  const concentrated = data.buyers.filter((b) => b.kind === "concentration");
  const nonCompetitive = data.buyers.filter((b) => b.kind === "non_competitive");
  return (
    <section id="signs" className="flex scroll-mt-24 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="headline text-2xl text-primary">Анхаарах шинж</h2>
        <p className="text-sm text-secondary text-pretty">
          Олон улсын Open Contracting Partnership-ийн аргачлалаар {data.year} оны гэрээнээс автоматаар тооцсон шинж. Шинж нь зөрчил гэсэн үг <b>биш</b>: тайлбар нэхэх, нягтлах шаардлагатай байж
          болох газрыг л харуулна. Хүнийг биш, худалдан авалтын журам, захиалагч байгууллагыг тэмдэглэнэ. Нэгж тодорхойгүй дүнтэй мөрийг тооцоонд оруулаагүй.
        </p>
      </div>

      <Ledger
        cells={[
          { label: "Шууд гэрээ", value: String(data.national.nonCompetitivePct).replace(".", ","), unit: "%", note: "улсын дундаж" },
          { label: "Захиалагч", value: formatNumber(data.national.buyers), note: `${MIN_BUYER_LOTS}+ гэрээтэй` },
          { label: "Нэг компанид", value: formatNumber(data.national.concentrated), note: `≥ ${pctLabel(BUYER_SHARE)} гэрээ нь` },
          { label: "Өрсөлдөөнгүй", value: formatNumber(data.national.nonCompetitive), note: `≥ ${pctLabel(BUYER_SHARE)} гэрээ нь` },
        ]}
      />

      {concentrated.length > 0 && (
        <Panel title="Нэг нийлүүлэгчид төвлөрсөн захиалагч" note={`${concentrated.length}`}>
          <p className="pt-3 text-sm text-tertiary">Захиалагчийн энэ оны гэрээний тал ба түүнээс дээш хувийг нэг компани авсан ({MIN_BUYER_LOTS}-аас дээш гэрээтэй байгууллага).</p>
          <ul className="flex flex-col divide-y divide-line-soft">
            {concentrated.map((b) => (
              <li key={b.orgName} className="flex flex-col gap-1 py-3">
                <p className="font-semibold text-primary text-pretty">{b.orgName}</p>
                <p className="text-sm text-secondary">
                  <span className="num-mono">{b.lots}</span> гэрээний <span className="num-mono">{b.count}</span> (<span className="num-mono">{b.pct}%</span>) нь{" "}
                  <span className="font-medium text-primary">{b.winner}</span>
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {nonCompetitive.length > 0 && (
        <Panel title="Өрсөлдөөнгүй аргын хувь өндөр захиалагч" note={`${nonCompetitive.length}`}>
          <p className="pt-3 text-sm text-tertiary">
            Шууд гэрээ, нэг эх үүсвэрээс авах аргаар олгосон гэрээ захиалагчийн гэрээний талаас их. Улсын дундаж {String(data.national.nonCompetitivePct).replace(".", ",")}%. Хууль зарим тохиолдолд (яаралтай,
            ганц нийлүүлэгчтэй) энэ аргыг зөвшөөрдөг.
          </p>
          <ul className="flex flex-col divide-y divide-line-soft">
            {nonCompetitive.map((b) => (
              <li key={b.orgName} className="flex flex-col gap-1 py-3">
                <p className="font-semibold text-primary text-pretty">{b.orgName}</p>
                <p className="text-sm text-secondary">
                  <span className="num-mono">{b.lots}</span> гэрээний <span className="num-mono">{b.count}</span> (<span className="num-mono">{b.pct}%</span>) нь өрсөлдөөнгүй аргаар
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {data.overBudget.length > 0 && (
        <Panel title="Төсвөөс их дүнтэй гэрээ" note={`${data.overBudgetCount}`}>
          <p className="pt-3 text-sm text-tertiary">Гэрээний дүн батлагдсан төсвөөс их. Төсөв тодотгогдсон, нэмэлт ажил орсон байж болно. Хамгийн их зөрүүтэй {data.overBudget.length}.</p>
          <ol className="flex flex-col divide-y divide-line-soft">
            {data.overBudget.map((t) => (
              <TenderRow key={t.id} t={t} />
            ))}
          </ol>
        </Panel>
      )}

      <p className="text-sm text-tertiary text-pretty">
        Тооцож чадаагүй шинж: нэг оролцогчтой тендер, зарлалын богино хугацаа, оны эцсийн зардлын огцом өсөлт. Шилэн дансны маягт 1831-д оролцогчийн тоо, зарласан огноо байдаггүй, түүх нь хэдхэн сар.
      </p>
    </section>
  );
}

/** Lots won by a company an active member declared shares in: shown only when there are some. */
async function MemberCompanies() {
  const all = Object.values(await getCompanyTenders()).filter((c) => c.owners.length > 0);
  if (all.length === 0) return null;
  return (
    <Panel title="УИХ-ын гишүүний мэдүүлсэн компанид олгосон гэрээ" note={`${all.length}`}>
      <div id="mp-companies" className="scroll-mt-24" />
      <p className="pt-3 text-sm text-tertiary text-pretty">
        Гишүүн ХАСХОМ мэдүүлэгтээ хувьцааг нь эзэмшдэг гэж өөрөө бичсэн компани тендерт шалгарсан мөрүүд. Нэрийг бүтнээр тулгасан, Шилэн дансанд тэр нэртэй ганц компани бүртгэлтэй. Энэ нь
        хууль зөрчсөн гэсэн үг <b>биш</b>: ашиг сонирхлын зөрчлийг холбогдох байгууллага шалгадаг.
      </p>
      <ul className="flex flex-col divide-y divide-line-soft">
        {all.map((c) => (
          <li key={c.name} className="flex flex-col gap-1.5 py-4">
            <p className="font-semibold text-primary">
              {c.name}
              <span className="font-normal text-secondary">
                {" "}
                ·{" "}
                {c.owners.map((o, i) => (
                  <span key={o.id}>
                    {i > 0 && ", "}
                    <Link href={`/officials/${o.id}`} className="text-brand-secondary hover:underline">
                      {o.shortName}
                    </Link>
                  </span>
                ))}
              </span>
            </p>
            <p className="text-sm text-secondary">
              <span className="num-mono">{c.count}</span> гэрээ{c.sum > 0 && <> · <span className="num-mono">{formatMntShort(c.sum)}</span></>}
            </p>
            <ol className="flex flex-col divide-y divide-line-soft">
              {c.items.map((t) => (
                <TenderRow key={t.id} t={t} />
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

async function TenderSignsSection() {
  const data = await getTenderSigns();
  return data ? <Signs data={data} /> : null;
}

async function Tenders() {
  const data = await getTenders();
  if (!data) {
    return <Empty title="Тендерийн мэдээлэл хараахан ороогүй байна" description="Шилэн данснаас өдөр бүр татна. Удахгүй энд гарна." />;
  }
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Ledger
          cells={[
            { label: `${data.year} оны гэрээ`, value: formatNumber(data.awardedCount), note: "ялагч, дүнтэй" },
            { label: "Гэрээний нийт дүн", value: formatMntShort(data.contractSum).replace(" ₮", ""), unit: "₮", note: data.unitSuspectCount ? `нэгж тодорхойгүй ${formatNumber(data.unitSuspectCount)} ороогүй` : "тайлагнасан дүнгээр" },
            { label: "Байгууллага", value: formatNumber(data.orgCount), note: "тайлагнасан" },
            { label: "Ялагчгүй", value: formatNumber(data.noAwardCount), note: "оролцогч ирээгүй гэх мэт" },
          ]}
        />
        {data.syncedAt && <DataAge at={data.syncedAt} staleDays={3} className="label-mono normal-case text-tertiary" />}
      </div>

      <Panel title="Шинээр тайлагнасан гэрээ" note={`${data.latest.length}`}>
        <ol className="flex flex-col divide-y divide-line-soft">
          {data.latest.map((t) => (
            <TenderRow key={t.id} t={t} />
          ))}
        </ol>
      </Panel>

      {data.largest.length > 0 && (
        <Panel title={`${data.year} оны хамгийн том гэрээ`} note={`${data.largest.length}`}>
          <ol className="flex flex-col divide-y divide-line-soft">
            {data.largest.map((t) => (
              <TenderRow key={t.id} t={t} />
            ))}
          </ol>
        </Panel>
      )}

      <section className="flex flex-col gap-2 text-sm text-secondary">
        <h2 className="label-mono text-tertiary">Энэ мэдээлэл юу вэ</h2>
        <p>
          Төсвийн байгууллага бүр тендерийн үр дүнгээ{" "}
          <a href={SHILENDANS_URL} className="font-medium text-brand-secondary underline-offset-2 hover:underline" target="_blank" rel="noopener">
            Шилэн дансанд
          </a>{" "}
          (маягт 1831) өөрсдөө оруулдаг. Бид тэр нээлттэй өгөгдлийг өдөр бүр уншиж, өөрчлөлтгүйгээр харуулдаг. Огноо, нэр, дүнг байгууллага гараар бичдэг тул алдаатай байж болно: уншиж болохгүй огноог «огноо бичээгүй» гэж үлдээдэг. Зарим байгууллага ₮-ийн баганад мянган төгрөгөөр бичдэг: 1 саяас бага дүн эсвэл төсөв, гэрээний дүн 20 дахин зөрүүтэй мөрийг «нэгж тодорхойгүй» гэж тэмдэглээд нийлбэр, жагсаалтад оруулдаггүй. Бид тоог өөрчилж, тааж засдаггүй.
        </p>
        <p>
          Гэрээний дүн төсвөөс бага эсвэл их байх, нэг компани олон удаа шалгарах нь өөрөө зөрчил гэсэн үг биш (доорх «Анхаарах шинж» хэсгийг үз). Бид дүгнэлт хийдэггүй, зөвхөн албан ёсны тоог харуулна. Tender.gov.mn-ийг шууд уншдаггүй: тэр сайт роботуудыг хаадаг.
        </p>
      </section>
    </div>
  );
}

export default function TendersPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <PageHeader eyebrow="Шилэн данс · тендерийн үр дүн · өдөр бүр" title={TITLE} description={DESCRIPTION}>
        <ShareButton path="/tenders" title={TITLE} className="w-fit" />
      </PageHeader>
      <Suspense fallback={<FeedSkeleton />}>
        <Tenders />
      </Suspense>
      <div className="mt-10">
        <Suspense fallback={null}>
          <TenderSignsSection />
        </Suspense>
      </div>
      <div className="mt-10">
        <Suspense fallback={null}>
          <MemberCompanies />
        </Suspense>
      </div>
    </div>
  );
}
