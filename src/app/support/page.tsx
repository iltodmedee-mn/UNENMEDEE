import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/iltod/page-header";
import { ShareButton } from "@/components/iltod/share-button";
import { DonateCard } from "@/components/layout/donate";
import { EmailLink } from "@/components/iltod/email-link";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Ил тод мэдээг дэмжих — хандив",
  alternates: { canonical: "/support" },
  description: "ИЛ ТОД МЭДЭЭ-г хандиваар дэмжээрэй: AI шинжилгээ, шинэ эх сурвалж, сервер. Хандивын дүн, зарцуулалтыг ил тод тайланд нийтэлнэ.",
};

const USES = [
  { icon: "🤖", title: "AI шинжилгээ", text: "Илүү олон мэдээг баримт, пи-ар гэж ялгаж, эрсдэлтэй тендер, төсвийг гүнзгий шинжлэх AI API-ийн зардал." },
  { icon: "🗂", title: "Шинэ өгөгдөл", text: "Орон нутаг, тендер, шүүхийн шийдвэр зэрэг шинэ эх сурвалжаас бодит тоо баримт цуглуулах." },
  { icon: "🖥", title: "Сервер, хурд", text: "Сайтыг хурдан, найдвартай ажиллуулах сервер, өгөгдлийн сангийн зардал." },
];

export default function SupportPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <PageHeader
        eyebrow="💙 Дэмжих"
        title="Ил тод мэдээг хамтдаа бүтээе"
        description="ИЛ ТОД МЭДЭЭ нь төрийн 130 гаруй эх сурвалжийг цаг тутам уншиж, албан баримтыг пи-араас салгаж, төсөв, улстөрчдийн хөрөнгийн мэдээллийг хүн бүрт үнэгүй хүргэдэг. Таны өгсөн бага ч гэсэн хандив энэ ажлыг үргэлжлүүлж, илүү сайн болгоно."
      >
        <ShareButton path="/support" title="Ил тод мэдээг дэмжээрэй" className="w-fit" />
      </PageHeader>

      <section aria-labelledby="account" className="flex flex-col gap-3">
        <h2 id="account" className="text-lg font-semibold text-primary">
          Хандивын данс
        </h2>
        <Suspense fallback={<div className="h-24 animate-pulse rounded-2xl bg-primary ring-1 ring-line ring-inset" />}>
          <DonateCard />
        </Suspense>
        <p className="text-sm text-tertiary">
          Гүйлгээний утга дээр &quot;Дэмжлэг&quot; гэж бичнэ үү. Хандив бүр{" "}
          <Link href="/transparency" className="font-semibold text-brand-secondary hover:underline">
            ил тод тайланд
          </Link>{" "}
          өдөр, дүнгээрээ нийтлэгдэнэ: нэрийг товчилж (Б.Б.) бичнэ. Бүтэн нэрээрээ гаргуулах бол &quot;Дэмжлэг нэрээр&quot;, нэргүй бол &quot;Дэмжлэг нууц&quot; гэж бичээрэй.
        </p>
      </section>

      <section aria-labelledby="uses" className="flex flex-col gap-3">
        <h2 id="uses" className="text-lg font-semibold text-primary">
          Хандив юунд зарцуулагдах вэ?
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {USES.map((u) => (
            <li key={u.title} className="flex flex-col gap-1 rounded-2xl bg-primary p-4 ring-1 ring-line ring-inset">
              <span aria-hidden className="text-2xl">
                {u.icon}
              </span>
              <h3 className="font-semibold text-primary">{u.title}</h3>
              <p className="text-sm text-secondary">{u.text}</p>
            </li>
          ))}
        </ul>
        <p className="text-sm text-secondary">
          Бид бусдаас нээлттэй байхыг шаарддаг тул өөрсдөө ч мөн адил: AI-ын зардал токен бүрээр, хандив бүр{" "}
          <Link href="/transparency" className="font-semibold text-brand-secondary hover:underline">
            ил тод тайлан
          </Link>
          -д нийтлэгдэнэ.
        </p>
      </section>

      <section aria-labelledby="contact" className="flex flex-col gap-2 rounded-2xl bg-primary p-5 ring-1 ring-line ring-inset">
        <h2 id="contact" className="text-lg font-semibold text-primary">
          Холбоо барих
        </h2>
        <p className="text-sm text-secondary">
          Сайттай холбоотой санал хүсэлт, алдаа засвар, шинэ эх сурвалж, хамтын ажиллагаа, хэвлэл мэдээллийн асуудлаар{" "}
          <EmailLink className="font-semibold text-brand-secondary hover:underline">
            {CONTACT_EMAIL}
          </EmailLink>{" "}
          хаягаар бичээрэй.
        </p>
      </section>
    </div>
  );
}
