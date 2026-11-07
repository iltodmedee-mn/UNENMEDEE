import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";

import { Empty } from "@/components/iltod/empty";
import { PageHeader } from "@/components/iltod/page-header";
import { ShareButton } from "@/components/iltod/share-button";
import { TaxReceiptCalculator } from "@/components/iltod/tax-receipt";
import type { BudgetNsoSnapshot } from "@/lib/budget/nso";
import { getIndicator } from "@/lib/queries";
import { absoluteUrl, jsonLd } from "@/lib/site";
import { breadcrumbLd } from "@/lib/structured-data";
import { ubDateKey } from "@/lib/archive";
import { PIT_SOURCES, sharesFromSpending, SI_SOURCES } from "@/lib/tax/receipt";

export const metadata: Metadata = {
  title: "Цалингийн татвар тооцоолуур: ХХОАТ, НДШ хаашаа явдаг вэ",
  alternates: { canonical: "/tax" },
  description: "Цалингаа оруулаад ХХОАТ, НДШ, НӨАТ-аа тооцоол, тэр мөнгө улсын төсөвт юунд зарцуулагддагийг 1 минутад хар. Үндэсний статистикийн хорооны албан тоогоор, тооцоо зөвхөн таны төхөөрөмж дээр.",
};

/** Today in Ulaanbaatar ("2027-01-01"): picks the ХХОАТ schedule. A daily cached clock keeps the page static. */
async function taxDay(): Promise<string> {
  "use cache";
  cacheLife("hours");
  return ubDateKey(Date.now());
}

async function Calculator() {
  const nso = await getIndicator<BudgetNsoSnapshot>("budget_nso");
  const economic = nso?.data.spending.economic;
  const year = economic && [...economic.years].reverse().find((y) => economic.total[y]);
  if (!economic || !year) return <Empty title="Төсвийн өгөгдөл хараахан татагдаагүй" description="Удахгүй шинэчлэгдэнэ." />;
  return <TaxReceiptCalculator shares={sharesFromSpending(economic.categories, year)} year={year} day={await taxDay()} />;
}

const TAX_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "Цалингийн татвар тооцоолуур",
      url: absoluteUrl("/tax"),
      description: "Сарын цалингаас ХХОАТ, НДШ, худалдан авалтаас НӨАТ-ыг тооцоолж, улсын төсвийн зардлын бүтцээр хуваана. Тооцоо хөтөч дотор хийгдэнэ.",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Any",
      inLanguage: "mn",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "MNT" },
    },
    breadcrumbLd([{ name: "Цалингийн татвар тооцоолуур", path: "/tax" }]),
  ],
};

export default async function TaxPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(TAX_LD) }} />
      <PageHeader
        eyebrow="🧾 Миний татвар · юунд зарцуулагддаг вэ"
        title="Цалингийн татвар тооцоолуур"
        description={
          <>
            Сарын цалин, дэлгүүрт зарцуулдаг мөнгөө оруулаарай. Оруулсан тоо тань зөвхөн таны төхөөрөмж дээр тооцоологдоно, хаашаа ч илгээгдэхгүй. Төсвийн бүтэц:{" "}
            <Link href="/budget" className="font-semibold text-brand-secondary hover:underline">
              Улсын төсөв
            </Link>{" "}
            (ҮСХ, Сангийн яам).
          </>
        }
      >
        <ShareButton path="/tax" title="Миний татвар хаашаа явдаг вэ? 1 минутад тооцоол" className="w-fit" />
      </PageHeader>
      <aside className="mb-6 border-l-2 border-line pl-3 text-sm text-tertiary">
        УИХ 2026-06-26-нд баталсан татварын багц хуулиар цалингийн ХХОАТ өөрчлөгдөнө: <strong className="text-secondary">2027-01-01</strong>-нээс НДШ хассаны дараах сарын
        792,000 ₮ хүртэлх цалин татваргүй, цалингийн татварын хөнгөлөлт хүчингүй болно; <strong className="text-secondary">2028-01-01</strong>-нээс 792,000–2,000,000 ₮-ийн хэсэгт 1%,
        түүнээс дээш 10% (жилд 120 саяас дээш 15%, 180 саяас дээш 20%). Тооцоолуур өнөөдрийн хүчинтэй шатлалаар тооцож, ирэх өөрчлөлтийг доор нь харуулна. Эх сурвалж:{" "}
        {[...PIT_SOURCES, ...SI_SOURCES].map((src, i) => (
          <span key={src.url}>
            {i > 0 && ", "}
            <a href={src.url} target="_blank" rel="noopener nofollow" className="underline hover:text-secondary">
              {src.name}
            </a>
          </span>
        ))}
        .
      </aside>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-3xl bg-primary ring-1 ring-line ring-inset" />}>
        <Calculator />
      </Suspense>
    </>
  );
}
