import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/iltod/page-header";
import { ShareButton } from "@/components/iltod/share-button";
import { EmailLink } from "@/components/iltod/email-link";
import { type About, paragraphs } from "@/lib/about";
import { formatNumber, formatUsd } from "@/lib/format";
import { getAbout, getSiteStats } from "@/lib/queries";
import { absoluteUrl, CONTACT_EMAIL, jsonLd, REPO_URL, SITE_NAME } from "@/lib/site";
import { breadcrumbLd } from "@/lib/structured-data";

export const metadata: Metadata = {
  title: "Бид хэн бэ: «Ил тод» гэдэг юу гэсэн үг вэ",
  alternates: { canonical: "/about" },
  description:
    "ИЛ ТОД МЭДЭЭ гэж юу вэ, хэн ажиллуулдаг, санхүүжилт хаанаас ирдэг, алдааг хэрхэн засдаг вэ. Ил тод гэдгийн дөрвөн амлалт: эх сурвалж бүр холбоостой, AI-ийн заавар нээлттэй, зардал бүр ил, код нээлттэй.",
};

const SECTIONS: { key: Exclude<keyof About, "lead">; id: string; title: string }[] = [
  { key: "who", id: "who", title: "Хэн ажиллуулдаг вэ" },
  { key: "funding", id: "funding", title: "Санхүүжилт" },
  { key: "independence", id: "independence", title: "Хараат бус байдал" },
  { key: "corrections", id: "corrections", title: "Алдаа, залруулга" },
];

function Text({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {paragraphs(text).map((p, i) => (
        <p key={i} className={`whitespace-pre-line ${className ?? ""}`}>
          {p}
        </p>
      ))}
    </>
  );
}

export default async function AboutPage() {
  const [about, stats] = await Promise.all([getAbout(), getSiteStats()]);

  // What "ил тод" promises, each with the page that proves it. Numbers are live.
  const promises = [
    {
      title: "Эх сурвалж бүр холбоостой",
      text: `${formatNumber(stats.activeSources)} төрийн сайтын мэдээг уншиж, мэдээ бүрийг эх хуудас руу нь холбоно. Цэвэрлэсэн текст бүрийн SHA-256 хэшийг хадгалж, эх сурвалж өөрчлөгдсөнийг бүртгэнэ.`,
      href: "/sources",
      link: "Эх сурвалжууд",
    },
    {
      title: "AI-д өгдөг заавар нээлттэй",
      text: "AI-д өгдөг зааврыг үг үсгээр нь нийтэлсэн. Эрсдэлийн оноо бол AI-ийн үнэлгээ, баримт биш гэдгийг мэдээ бүрийн дэргэд бичдэг.",
      href: "/method",
      link: "Арга зүй",
    },
    {
      title: "Зардал бүр ил",
      text: `Энэ сард AI-д ${formatUsd(stats.aiCostThisMonthUsd)} зарцуулсан. AI-ийн дуудлага бүрийн зардал, хандивын орлогыг өгөгдлийн сангаас шууд харуулна.`,
      href: "/transparency",
      link: "Ил тод тайлан",
    },
    {
      title: "Код нээлттэй",
      text: "Мэдээ цуглуулах, шинжлэх, оноо гаргах бүх код GitHub дээр. Хэн ч шалгаж, алдааг нь олж, засвар санал болгож болно.",
      href: REPO_URL,
      link: "GitHub",
      external: true,
    },
  ];

  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "AboutPage", name: `Бид хэн бэ · ${SITE_NAME}`, url: absoluteUrl("/about"), inLanguage: "mn", about: { "@type": "NewsMediaOrganization", name: SITE_NAME, url: absoluteUrl("/"), email: CONTACT_EMAIL } },
      breadcrumbLd([{ name: "Бид хэн бэ", path: "/about" }]),
    ],
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 pb-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <PageHeader eyebrow="Бид хэн бэ" title="Ил тод мэдээ гэж юу вэ" description={paragraphs(about.lead)[0]}>
        {paragraphs(about.lead).length > 1 && <Text text={paragraphs(about.lead).slice(1).join("\n\n")} className="max-w-3xl text-md text-secondary" />}
        <ShareButton path="/about" title="Ил тод мэдээ гэж юу вэ" className="w-fit" />
      </PageHeader>

      <section aria-labelledby="promises" className="flex flex-col gap-3">
        <h2 id="promises" className="label-mono text-tertiary">
          «Ил тод» гэдгийн дөрвөн амлалт
        </h2>
        <ol className="flex flex-col divide-y divide-line border-y border-line">
          {promises.map((p, i) => (
            <li key={p.title} className="grid grid-cols-[2.5rem_1fr] gap-x-3 py-4">
              <span className="num-mono pt-0.5 text-lg text-brand-secondary">{String(i + 1).padStart(2, "0")}</span>
              <div className="flex flex-col gap-1">
                <h3 className="story-headline text-md text-primary">{p.title}</h3>
                <p className="text-sm text-secondary">{p.text}</p>
                {p.external ? (
                  <a href={p.href} target="_blank" rel="noreferrer" className="w-fit text-sm font-semibold text-brand-secondary hover:underline">
                    {p.link} ↗
                  </a>
                ) : (
                  <Link href={p.href} prefetch={false} className="w-fit text-sm font-semibold text-brand-secondary hover:underline">
                    {p.link} →
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {SECTIONS.map((s) => (
        <section key={s.key} id={s.id} aria-labelledby={`${s.id}-h`} className="flex scroll-mt-24 flex-col gap-2">
          <h2 id={`${s.id}-h`} className="text-lg font-semibold text-primary">
            {s.title}
          </h2>
          <Text text={about[s.key]} className="text-md text-secondary" />
        </section>
      ))}

      <section aria-labelledby="contact" className="flex flex-col gap-2 border-t border-line pt-6">
        <h2 id="contact" className="text-lg font-semibold text-primary">
          Холбоо барих
        </h2>
        <p className="text-md text-secondary">
          Санал хүсэлт, алдаа, хамтын ажиллагааны асуудлаар:{" "}
          <EmailLink className="font-semibold text-brand-secondary hover:underline">
            {CONTACT_EMAIL}
          </EmailLink>
        </p>
        <p className="text-sm text-tertiary">
          Энэ ажлыг дэмжих бол{" "}
          <Link href="/support" prefetch={false} className="font-semibold text-brand-secondary hover:underline">
            хандивын хуудас
          </Link>
          . Орлого, зарлага бүр{" "}
          <Link href="/transparency" prefetch={false} className="font-semibold text-brand-secondary hover:underline">
            ил тод тайланд
          </Link>{" "}
          гарна.
        </p>
      </section>
    </div>
  );
}
