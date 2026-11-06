import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DataAge } from "@/components/iltod/data-age";
import { Empty } from "@/components/iltod/empty";
import { PageHeader } from "@/components/iltod/page-header";
import { Panel } from "@/components/iltod/panel";
import { ShareButton } from "@/components/iltod/share-button";
import { FeedSkeleton } from "@/components/iltod/skeletons";
import { formatDateMn, formatNumber } from "@/lib/format";
import { PETITION_SITE, type Petition, type PetitionsSnapshot } from "@/lib/participation/petitions";
import { getIndicator } from "@/lib/queries";
import { jsonLd } from "@/lib/site";
import { breadcrumbLd } from "@/lib/structured-data";

const TITLE = "Оролцох: нээлттэй өргөдөл, санал өгөх, мэдээлэл хүсэх";
const DESCRIPTION = "УИХ-ын нийтийн өргөдлийн системд одоо гарын үсэг цуглуулж буй өргөдлүүд, хуулийн төсөлд санал өгөх, төрөөс мэдээлэл хүсэх арга. Өдөрт 2 удаа шинэчилнэ.";

export const metadata: Metadata = {
  title: "Нээлттэй өргөдөл, хуулийн төсөлд санал өгөх — иргэний оролцоо",
  alternates: { canonical: "/participate" },
  description: DESCRIPTION,
};

const D_PARLIAMENT = "https://d.parliament.mn/";

function PetitionRow({ p }: { p: Petition }) {
  const pct = p.threshold > 0 ? Math.min(100, Math.round((p.signatures / p.threshold) * 100)) : 0;
  return (
    <li className="flex flex-col gap-1.5 py-4">
      <p className="label-mono normal-case text-tertiary">
        {p.code}
        {p.kind && ` · ${p.kind.replace(/^\d+\.\s*/, "")}`}
      </p>
      <a href={p.url} target="_blank" rel="noopener nofollow" className="font-semibold text-pretty text-primary hover:underline">
        {p.title}
      </a>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary ring-1 ring-line ring-inset" role="img" aria-label={`Босгын ${pct}%`}>
        <div className="h-full rounded-full bg-brand-solid" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-secondary">
        <span className="num-mono text-primary">{formatNumber(p.signatures)}</span> / <span className="num-mono">{formatNumber(p.threshold)}</span> гарын үсэг
        {p.endsAt && <> · {formatDateMn(new Date(p.endsAt))} хүртэл</>}
      </p>
    </li>
  );
}

async function Petitions() {
  const snap = await getIndicator<PetitionsSnapshot>("petitions");
  if (!snap || snap.data.items.length === 0) {
    return <Empty title="Өргөдлийн жагсаалт хараахан ороогүй байна" description="petition.parliament.mn-ээс өдөрт 2 удаа уншина." />;
  }
  const { items, skippedNamed, fetchedAt } = snap.data;
  return (
    <Panel title="Гарын үсэг цуглуулж буй өргөдөл" note={`${items.length}`}>
      <ol className="flex flex-col divide-y divide-line-soft">
        {items.slice(0, 30).map((p) => (
          <PetitionRow key={p.id} p={p} />
        ))}
      </ol>
      <div className="flex flex-col gap-1 border-t border-line-soft pt-3 text-xs text-tertiary">
        <DataAge at={fetchedAt} staleDays={3} className="label-mono normal-case text-tertiary" />
        <p>
          Өргөдлийг иргэд бичсэн; агуулгыг нь бид шалгаагүй, дэмжих эсвэл эсэргүүцэх байр суурьгүй. Хэн бичсэнийг харуулдаггүй.
          {skippedNamed > 0 && ` Хүний нэр дурдсан ${skippedNamed} өргөдлийг энд оруулаагүй.`} Гарын үсэг зурахад ДАН эсвэл тоон гарын үсэг хэрэгтэй.{" "}
          <a href={PETITION_SITE} target="_blank" rel="noopener" className="font-medium text-brand-secondary hover:underline">
            petition.parliament.mn
          </a>
        </p>
      </div>
    </Panel>
  );
}

export default function ParticipatePage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbLd([{ name: "Оролцох", path: "/participate" }])) }} />
      <PageHeader eyebrow="Иргэний оролцоо · УИХ" title={TITLE} description={DESCRIPTION}>
        <ShareButton path="/participate" title={TITLE} className="w-fit" />
      </PageHeader>

      <section className="grid grid-cols-1 gap-3 text-sm text-secondary sm:grid-cols-3">
        <a href={PETITION_SITE} target="_blank" rel="noopener" className="rounded-xl bg-secondary p-4 ring-1 ring-line ring-inset hover:ring-brand">
          <b className="block text-primary">Өргөдөл дэмжих</b>
          Босгод хүрсэн өргөдлийг УИХ хэлэлцэх ёстой.
        </a>
        <a href={D_PARLIAMENT} target="_blank" rel="noopener" className="rounded-xl bg-secondary p-4 ring-1 ring-line ring-inset hover:ring-brand">
          <b className="block text-primary">Хуулийн төсөлд санал өгөх</b>
          d.parliament.mn: хэлэлцэж буй төсөл, санал асуулга.
        </a>
        <Link href="/request" className="rounded-xl bg-secondary p-4 ring-1 ring-line ring-inset hover:ring-brand">
          <b className="block text-primary">Мэдээлэл хүсэх</b>
          Төрийн байгууллагаас ажлын 5 өдөрт хариу авах захидал.
        </Link>
      </section>

      <Suspense fallback={<FeedSkeleton />}>
        <Petitions />
      </Suspense>
    </div>
  );
}
