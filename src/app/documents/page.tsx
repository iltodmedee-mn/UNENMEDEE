import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Chip } from "@/components/iltod/badges";
import { DataAge } from "@/components/iltod/data-age";
import { Empty } from "@/components/iltod/empty";
import { PageHeader } from "@/components/iltod/page-header";
import { Panel } from "@/components/iltod/panel";
import { ShareButton } from "@/components/iltod/share-button";
import { FeedSkeleton } from "@/components/iltod/skeletons";
import { WP_SITES } from "@/lib/documents/watch";
import { formatDateMn } from "@/lib/format";
import { getDocuments } from "@/lib/queries";
import { safeHttpUrl } from "@/lib/site";

const TITLE = "Шинэ тайлан, тендерийн баримт бичиг";
const DESCRIPTION =
  "Төрийн аудитын газрын шинэ аудитын тайлан, яам, аймгийн «Тайлан», «Тендер», «Ил тод байдал» хуудсанд шинээр нэмэгдсэн файлууд. Мэдээ биш, хуудсанд байршуулдаг баримт бичгийг өдөр бүр шалгана.";

export const metadata: Metadata = {
  title: "Шинэ аудитын тайлан, тендерийн баримт бичиг — төрийн байгууллагууд",
  alternates: { canonical: "/documents" },
  description: DESCRIPTION,
};

const SITE_NAME = new Map(WP_SITES.map((s) => [s.domain, s.name]));
const KIND_LABEL: Record<string, string> = { audit: "Аудит", tender: "Тендер", report: "Тайлан" };

function ExternalLink({ href, children, className }: { href: string | null; children: React.ReactNode; className?: string }) {
  const url = href ? safeHttpUrl(href) : null;
  if (!url) return <span className={className}>{children}</span>;
  return (
    <a href={url} target="_blank" rel="noopener nofollow" className={className}>
      {children}
    </a>
  );
}

async function Documents() {
  const data = await getDocuments();
  if (!data) {
    return <Empty title="Баримт бичиг хараахан ороогүй байна" description="audit.mn болон яамдын тайлангийн хуудсуудыг өдөр бүр шалгана. Удахгүй энд гарна." />;
  }
  return (
    <div className="flex flex-col gap-8">
      {data.checkedAt && <DataAge at={data.checkedAt} staleDays={3} className="label-mono normal-case text-tertiary" />}

      {data.audits.length > 0 && (
        <Panel title="Төрийн аудитын газрын тайлан" note="audit.mn">
          <ol className="flex flex-col divide-y divide-line-soft">
            {data.audits.map((d) => (
              <li key={d.id} className="flex flex-col gap-1 py-3.5">
                <p className="label-mono normal-case text-tertiary">
                  {[d.meta?.office, d.meta?.auditType].filter(Boolean).join(" · ") || "Төрийн аудитын байгууллага"}
                </p>
                <ExternalLink href={d.url} className="font-semibold text-pretty text-primary hover:text-brand-secondary">
                  {d.title}
                </ExternalLink>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Panel title="Хуудсанд шинээр нэмэгдсэн файл" note={`${data.added.length}`}>
        {data.added.length === 0 ? (
          <p className="py-4 text-sm text-tertiary">Хянаж эхэлснээс хойш шинэ файл нэмэгдээгүй байна. Доорх хуудсуудад шинэ файл орвол энд гарна.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-line-soft">
            {data.added.map((d) => (
              <li key={d.id} className="flex flex-col gap-1.5 py-3.5">
                <p className="label-mono normal-case text-tertiary">
                  {SITE_NAME.get(d.domain) ?? d.domain} · {formatDateMn(d.firstSeenAt)}-нд олдсон
                </p>
                <ExternalLink href={d.url} className="font-semibold text-pretty break-words text-primary hover:text-brand-secondary">
                  {d.title}
                </ExternalLink>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="brand">{KIND_LABEL[d.kind] ?? d.kind}</Chip>
                  {d.fileType && <Chip>{d.fileType.toUpperCase()}</Chip>}
                  {d.pageTitle && (
                    <ExternalLink href={d.pageUrl} className="min-w-0 text-xs text-secondary underline-offset-2 hover:underline">
                      {d.pageTitle}
                    </ExternalLink>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {data.pages.length > 0 && (
        <Panel title="Хянаж буй хуудсууд" note={`${data.pages.length}`}>
          <ol className="flex flex-col divide-y divide-line-soft">
            {data.pages.map((p) => (
              <li key={p.url} className="flex flex-col gap-1 py-3">
                <ExternalLink href={p.url} className="text-sm font-medium text-pretty text-primary hover:text-brand-secondary">
                  {p.title}
                </ExternalLink>
                <p className="label-mono normal-case text-tertiary">
                  {SITE_NAME.get(p.domain) ?? p.domain} · {p.fileCount} файл · засварласан {formatDateMn(p.modified)}
                </p>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <section className="flex flex-col gap-2 text-sm text-secondary">
        <h2 className="label-mono text-tertiary">Хэрхэн ажилладаг вэ</h2>
        <p>
          Олон байгууллага тайлан, тендерийн урилгаа мэдээ болгон биш, «Ил тод байдал», «Тайлан» гэх мэт хуудсанд файлаар байршуулдаг. Бид тэдгээр хуудсыг өдөр бүр шалгаж, өмнө нь байгаагүй файлыг энд жагсаана. Анх шалгахад хуудсанд байсан файлыг «шинэ» гэж тооцдоггүй.
        </p>
        <p>
          Бид зөвхөн холбоос, нэр, байрлах хуудсыг хадгалдаг; файл өөрөө эх сайт дээрээ нээгдэнэ. Одоогоор audit.mn болон WordPress ашигладаг {WP_SITES.length} байгууллагын сайтыг хянаж байна. Тендерийн үр дүнг{" "}
          <Link href="/tenders" className="font-medium text-brand-secondary underline-offset-2 hover:underline">
            Тендер
          </Link>{" "}
          хуудаснаас үзнэ үү.
        </p>
      </section>
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <PageHeader eyebrow="Тайлан · тендер · ил тод байдал · өдөр бүр" title={TITLE} description={DESCRIPTION}>
        <ShareButton path="/documents" title={TITLE} className="w-fit" />
      </PageHeader>
      <Suspense fallback={<FeedSkeleton />}>
        <Documents />
      </Suspense>
    </div>
  );
}
