import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { MoneyMapView } from "@/components/money/money-map-view";
import { Empty } from "@/components/iltod/empty";
import { PageHeader } from "@/components/iltod/page-header";
import { formatMntShort } from "@/lib/format";
import { MONEY_MAP_KEY, type MoneyMap } from "@/lib/money-map/build";
import { getIndicator } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Миний ₮: төсвийн мөнгө аймаг, сум бүрт хаашаа явав",
  alternates: { canonical: "/money" },
  description: "Энэ оны төрийн худалдан авалтын гэрээ аймаг, сум, дүүрэг бүрээр бодит газрын зураг дээр: юу, хэнээс, хэдэн төгрөгөөр. Шилэн дансны албан ёсны маягт 1831.",
};

async function Map() {
  const snap = await getIndicator<MoneyMap>(MONEY_MAP_KEY);
  const m = snap?.data;
  if (!m || m.points.length === 0) return <Empty title="Газрын зургийн өгөгдөл хараахан бэлдэгдээгүй" description="Тендерийн дараагийн шинэчлэлээр гарна." />;
  const total = m.aimags.reduce((s, a) => s + a.mnt, 0);
  return (
    <div className="flex flex-col gap-6">
      <MoneyMapView map={m} />
      <section className="rounded-2xl bg-primary p-4 ring-1 ring-line">
        <h2 className="label-mono text-brand-secondary">Аймаг, хотоор · {m.year} он</h2>
        <ol className="mt-3 flex flex-col">
          {m.aimags.map((a) => (
            <li key={a.aimag} className="flex items-baseline gap-3 border-t border-line py-2 first:border-t-0">
              <span className="font-semibold text-primary">{a.aimag}</span>
              <span className="label-mono text-tertiary">{a.count} гэрээ</span>
              <span className="num-mono ml-auto text-primary">{formatMntShort(a.mnt)}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 border-t border-line pt-3 text-sm text-secondary">
          Аймагт хамаарах нийт {formatMntShort(total)}. Яамд, агентлагуудын улсын хэмжээний {m.national.count} гэрээ ({formatMntShort(m.national.mnt)}) байршилгүй тул газрын зураг дээр байхгүй.
        </p>
      </section>
    </div>
  );
}

export default function MoneyPage() {
  return (
    <>
      <PageHeader
        eyebrow="🗺 Миний ₮"
        title="Төсвийн мөнгө хаашаа явав?"
        description={
          <>
            Энэ оны төрийн худалдан авалтын гэрээ аймаг, сум, дүүргээр. Цэгээ товшоод юу, хэнээс, хэдээр авсныг хар. Байршлыг худалдан авагчийн нэр, төсвийн захирагчаас тогтоосон; зөвхөн аймаг нь тодорхой гэрээ аймгийн төв дээр байна. Эх сурвалж:{" "}
            <Link href="/tenders" className="font-semibold text-brand-secondary hover:underline">
              Тендер
            </Link>{" "}
            (Шилэн данс, маягт 1831).
          </>
        }
      />
      <Suspense fallback={<div className="h-[28rem] animate-pulse rounded-2xl bg-secondary" />}>
        <Map />
      </Suspense>
    </>
  );
}
