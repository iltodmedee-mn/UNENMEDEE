import type { Metadata } from "next";

import { EmailLink } from "@/components/iltod/email-link";
import { PageHeader } from "@/components/iltod/page-header";
import { GLOSSARY, GLOSSARY_GROUPS, type GlossaryTerm } from "@/lib/glossary";
import { jsonLd } from "@/lib/site";
import { breadcrumbLd } from "@/lib/structured-data";

const TITLE = "Төрийн мэдээний нэр томьёо, энгийн үгээр";
const DESCRIPTION = "Тогтоол, захирамж, тодотгол, НӨАТ, ТЭЗҮ, ХАСХОМ… Төрийн мэдээнд байнга гардаг үгсийг нэг өгүүлбэрээр тайлбарлав.";

export const metadata: Metadata = {
  title: "Нэр томьёо — тогтоол, тодотгол, НӨАТ гэж юу вэ",
  alternates: { canonical: "/glossary" },
  description: DESCRIPTION,
};

const GROUPS = Object.entries(GLOSSARY_GROUPS) as [GlossaryTerm["group"], string][];

export default function GlossaryPage() {
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "DefinedTermSet",
        name: TITLE,
        hasDefinedTerm: GLOSSARY.map((t) => ({ "@type": "DefinedTerm", name: t.term, description: t.text, url: `/glossary#${t.slug}` })),
      },
      breadcrumbLd([{ name: "Нэр томьёо", path: "/glossary" }]),
    ],
  };
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <PageHeader eyebrow="Энгийн үгээр · нэр томьёо" title={TITLE} description={DESCRIPTION} />
      {GROUPS.map(([key, label]) => (
        <section key={key} className="flex flex-col gap-2" aria-labelledby={`g-${key}`}>
          <h2 id={`g-${key}`} className="label-mono text-tertiary">
            {label}
          </h2>
          <dl className="flex flex-col divide-y divide-line-soft border-t border-line">
            {GLOSSARY.filter((t) => t.group === key).map((t) => (
              <div key={t.slug} id={t.slug} className="flex scroll-mt-24 flex-col gap-1 py-3 target:bg-secondary sm:flex-row sm:gap-6">
                <dt className="shrink-0 font-semibold text-primary sm:w-48">{t.term}</dt>
                <dd className="text-secondary">{t.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="text-sm text-tertiary">
        Тайлбарыг Ил Тод Мэдээ бичсэн (AI биш). Мэдээний AI хураангуйд эдгээр үгийн эхнийх нь доогуур цэгтэй зураастай гарна: дарахад тайлбар нь гарна. Алдаа, нэмэх үг байвал: <EmailLink className="font-medium text-brand-secondary hover:underline" />
      </p>
    </div>
  );
}
