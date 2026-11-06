import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { Suspense } from "react";

import { InfoRequestForm } from "@/components/iltod/info-request-form";
import { PageHeader } from "@/components/iltod/page-header";
import { ShareButton } from "@/components/iltod/share-button";
import { ubDateKey } from "@/lib/archive";
import { ANSWER_DAYS, EXTENSION_DAYS, LAW_URL } from "@/lib/info-request";
import { SOURCE_SEEDS } from "@/lib/sources";
import { jsonLd } from "@/lib/site";
import { breadcrumbLd } from "@/lib/structured-data";

const TITLE = "Төрөөс мэдээлэл хүсэх захидал";
const DESCRIPTION = `Нийтийн мэдээллийн ил тод байдлын тухай хуулиар аливаа иргэн төрийн байгууллагаас мэдээлэл хүсэх эрхтэй, байгууллага ажлын ${ANSWER_DAYS} өдөрт хариулах ёстой. Захидлаа энд бэлдээд өөрөө илгээнэ.`;

export const metadata: Metadata = {
  title: "Мэдээлэл хүсэх захидал — Нийтийн мэдээллийн ил тод байдлын тухай хууль",
  alternates: { canonical: "/request" },
  description: DESCRIPTION,
};

/** Today in Ulaanbaatar, cached so the page stays static (the letter's date and the deadline). */
async function requestDay(): Promise<string> {
  "use cache";
  cacheLife("hours");
  return ubDateKey(Date.now());
}

/** The bodies we follow, as name suggestions (the reader can type any other). */
const ORGS = [...new Set(SOURCE_SEEDS.filter((s) => s.category !== "portal").map((s) => s.name.replace(/\s*\([^)]*\)\s*$/, "")))].sort((a, b) => a.localeCompare(b, "mn"));

async function Form() {
  return <InfoRequestForm orgs={ORGS} day={await requestDay()} />;
}

export default function RequestPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbLd([{ name: "Мэдээлэл хүсэх", path: "/request" }])) }} />
      <PageHeader eyebrow="Таны эрх · захидал бэлдэх" title={TITLE} description={DESCRIPTION}>
        <ShareButton path="/request" title={TITLE} className="w-fit" />
      </PageHeader>

      <section className="grid grid-cols-1 gap-3 text-sm text-secondary sm:grid-cols-3">
        <p className="rounded-xl bg-secondary p-4 ring-1 ring-line ring-inset">
          <b className="block text-primary">Шалтгаан хэрэггүй</b>
          Нээлттэй мэдээлэл авахад зорилго, шалтгаанаа тайлбарлах шаардлагагүй (14.1.2).
        </p>
        <p className="rounded-xl bg-secondary p-4 ring-1 ring-line ring-inset">
          <b className="block text-primary">Ажлын {ANSWER_DAYS} өдөр</b>
          Шууд өгч болохыг шууд, бусдыг {ANSWER_DAYS} өдөрт (15.6). Сунгавал дахиад {EXTENSION_DAYS} хүртэл өдөр (15.7).
        </p>
        <p className="rounded-xl bg-secondary p-4 ring-1 ring-line ring-inset">
          <b className="block text-primary">Цахимаар үнэгүй</b>
          Цахимаар авах нь ихэвчлэн төлбөргүй, цаасны хуулбарт зөвхөн бодит зардал (16.1–16.3).
        </p>
      </section>

      <Suspense fallback={null}>
        <Form />
      </Suspense>

      <section className="flex flex-col gap-2 text-sm text-secondary">
        <h2 className="label-mono text-tertiary">Хариу ирэхгүй бол</h2>
        <p>
          Хугацаандаа хариулаагүй, эсвэл үндэслэлгүй татгалзсан бол тухайн байгууллагын дээд байгууллага, албан тушаалтанд гомдол гаргана; байхгүй бол шүүхэд хандана (14.1.6). Мөн Хүний эрхийн
          үндэсний комисст гомдол гаргах эрхтэй (14.2). Хүсэлтээ илгээсэн огноо, бүртгэлийн дугаараа хадгалаарай.
        </p>
        <p>
          2025 онд Глоб интернэшнл төв 59 хүсэлт илгээж туршихад 16 нь л бүрэн хариу авсан. Тиймээс хүсэлтээ тодорхой бичиж, хуулийн заалтыг иш татах нь чухал.
        </p>
        <p>
          Энэ хуудсанд бичсэн зүйл таны төхөөрөмжөөс гарахгүй: бид хадгалдаггүй, илгээдэггүй. Хуулийн бүрэн эх:{" "}
          <a href={LAW_URL} target="_blank" rel="noopener" className="font-medium text-brand-secondary underline-offset-2 hover:underline">
            legalinfo.mn
          </a>
          .
        </p>
      </section>
    </div>
  );
}
