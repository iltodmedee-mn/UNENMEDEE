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
import { SHILENDANS_URL } from "@/lib/procurement/tenders";
import { getTenders, type TenderItem } from "@/lib/queries";

const TITLE = "Тендерийн үр дүн: хэн, юуг, хэдээр";
const DESCRIPTION =
  "Төрийн байгууллагууд Шилэн дансанд тайлагнасан тендерийн үр дүн: юу худалдан авсан, батлагдсан төсөв, гэрээний дүн, сонгон шалгаруулалтын арга, шалгарсан компани. Өдөр бүр шинэчилнэ.";

export const metadata: Metadata = {
  title: "Тендерийн үр дүн — хэн, юуг, хэдээр авав (Шилэн данс)",
  alternates: { canonical: "/tenders" },
  description: DESCRIPTION,
};

function TenderRow({ t }: { t: TenderItem }) {
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
      </div>
      <p className="label-mono normal-case text-quaternary">{t.code}</p>
    </li>
  );
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
          Гэрээний дүн төсвөөс бага эсвэл их байх, нэг компани олон удаа шалгарах нь өөрөө зөрчил гэсэн үг биш. Бид дүгнэлт хийдэггүй, зөвхөн албан ёсны тоог харуулна. Tender.gov.mn-ийг шууд уншдаггүй: тэр сайт роботуудыг хаадаг.
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
    </div>
  );
}
