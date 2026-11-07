import { ProgrammeClock } from "@/components/promises/programme-clock";
import { ubDateKey } from "@/lib/archive";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/iltod/page-header";
import { ShareButton } from "@/components/iltod/share-button";
import { cacheLife } from "next/cache";

import { GOVERNMENTS_VERIFIED_THROUGH, governmentsBetween } from "@/lib/budget/governments";
import { formatDateMn } from "@/lib/format";
import { ALL_GOALS, MEASURABLE_GOALS, PROGRAMME } from "@/lib/promises";
import { PROJECTS } from "@/lib/projects/data";
import { directionGoals, directionSlug, PROGRAMME_END } from "@/lib/promises/programme";
import { absoluteUrl, jsonLd, SITE_NAME } from "@/lib/site";

const TITLE = "Засгийн газрын амлалт: 2024–2028 оны хөтөлбөрийн 620 зорилт";
const DESCRIPTION = `Засгийн газрын 2024–2028 оны үйл ажиллагааны хөтөлбөрийн ${ALL_GOALS.length} зорилт, 14 мега төсөл: УИХ-ын 2024 оны 21 дүгээр тогтоолоор батлагдсан эх текстээр, чиглэл тус бүрээр.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/promises" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/promises" },
};

/**
 * Whether the programme's term has ended, from a daily cached clock: the page stays static, and
 * after PROGRAMME_END it stops presenting the 2024–2028 programme as the current one.
 */
async function programmeEnded(): Promise<boolean> {
  "use cache";
  cacheLife("days");
  return ubDateKey(Date.now()) >= PROGRAMME_END;
}

/** Today in Ulaanbaatar for the programme clock (daily cache, the page stays static). */
async function programmeToday(): Promise<string> {
  "use cache";
  cacheLife("days");
  return ubDateKey(Date.now());
}

function Facts() {
  const facts = [
    { value: ALL_GOALS.length, label: "зорилт" },
    { value: MEASURABLE_GOALS, label: "нь тоон хэмжүүртэй" },
    { value: PROGRAMME.megaProjects.length, label: "мега төсөл" },
    {
      value: PROGRAMME.policies.reduce((n, p) => n + p.directions.length, 0),
      label: "чиглэл",
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {facts.map((f) => (
        <div key={f.label} className="flex flex-col gap-1 border-t border-line-soft py-3">
          <dt className="label-mono text-tertiary">{f.label}</dt>
          <dd className="num-mono text-2xl text-primary">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PromisesJsonLd() {
  const url = absoluteUrl("/promises");
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${url}#page`,
        url,
        name: TITLE,
        description: DESCRIPTION,
        inLanguage: "mn",
        isPartOf: { "@id": `${absoluteUrl("/")}#website` },
        isBasedOn: PROGRAMME.sourceUrl,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: SITE_NAME,
            item: absoluteUrl("/"),
          },
          { "@type": "ListItem", position: 2, name: "Амлалт", item: url },
        ],
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
    />
  );
}

export default async function PromisesPage() {
  // Prime Ministers since approval, as far as the list was last checked (labels only).
  const pms = governmentsBetween(PROGRAMME.approved, PROGRAMME_END);
  const ended = await programmeEnded();
  return (
    // PageHeader brings its own bottom padding, so only the blocks after it are spaced by the gap.
    <div className="mx-auto flex max-w-3xl flex-col">
      <PromisesJsonLd />
      <PageHeader
        eyebrow={ended ? "📜 Амлалт · өмнөх хөтөлбөр" : "📜 Амлалт"}
        title={ended ? "2024–2028 онд Засгийн газар юу хийнэ гэж амласан бэ?" : "Засгийн газар юу хийнэ гэж амласан бэ?"}
        description={
          <>
            {PROGRAMME.title}: {PROGRAMME.act} (
            {formatDateMn(new Date(`${PROGRAMME.approved}T00:00:00+08:00`))}).
            Зорилт бүрийг эх текстээр нь, хөтөлбөрийн өөрийн дугаарлалтаар
            харуулав.
          </>
        }
      >
        <ShareButton path="/promises" title={TITLE} className="w-fit" />
      </PageHeader>

      <div className="flex flex-col gap-8">
        {ended && (
          <p className="rounded-2xl bg-secondary p-4 text-sm text-secondary ring-1 ring-line ring-inset">
            Энэ хөтөлбөрийн хугацаа ({PROGRAMME_END.slice(0, 4)} оны УИХ-ын сонгуулиар) дууссан. Шинэ Засгийн газрын хөтөлбөр батлагдсаны дараа энд нэмэгдэнэ.
          </p>
        )}
        <Facts />
        <ProgrammeClock today={await programmeToday()} approved={PROGRAMME.approved} />

        <aside className="flex flex-col gap-2 rounded-2xl bg-secondary p-4 text-sm text-secondary ring-1 ring-line ring-inset">
          <p>
            <span className="font-semibold text-primary">
              Хэрэгжилтийг бид дүгнэдэггүй.
            </span>{" "}
            Энд зөвхөн батлагдсан текст байна; AI ямар нэг зорилтыг «биелсэн»,
            «биелээгүй» гэж үнэлэхгүй. Хэрэгжилтийн албан тайланг холбоосоор нь
            нэмнэ.
          </p>
          <p>
            Хөтөлбөр батлагдсанаас хойш Засгийн газрыг{" "}
            {pms.map((g) => g.pm).join(", ")} тэргүүлсэн (жагсаалтыг{" "}
            {formatDateMn(new Date(`${GOVERNMENTS_VERIFIED_THROUGH}T00:00:00+08:00`))}-нд шалгасан). Хөтөлбөрт өөрчлөлт
            орсон эсэхийг{" "}
            <a
              href={PROGRAMME.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand-secondary hover:underline"
            >
              legalinfo.mn
            </a>{" "}
            дээрх эх тогтоолоос шалгана уу. «Тоон хэмжүүртэй» гэдэг нь зорилтын
            текстэд нэгжтэй тоо (МВт, км, хувь, тонн…) байгааг л хэлнэ.
          </p>
        </aside>

        <section aria-labelledby="mega" className="flex flex-col gap-3">
          <h2 id="mega" className="text-lg font-semibold text-primary">
            14 мега төсөл
          </h2>
          <ol className="flex flex-col gap-2">
            {PROGRAMME.megaProjects.map((m, i) => {
              const [first, ...rest] = m.split(/(?<=\.)\s+/);
              const tracked = PROJECTS.find((p) => p.links.megaIndex === i);
              return (
                <li
                  key={i}
                  className="rounded-2xl bg-primary p-4 ring-1 ring-line ring-inset"
                >
                  <details>
                    <summary className="cursor-pointer font-semibold text-primary">
                      <span className="mr-2 text-tertiary tabular-nums">
                        {i + 1}.
                      </span>
                      {first}
                    </summary>
                    {rest.length > 0 && (
                      <p className="mt-2 text-sm text-secondary">
                        {rest.join(" ")}
                      </p>
                    )}
                    {tracked && (
                      <p className="mt-2 text-sm">
                        <Link href={`/projects/${tracked.slug}`} className="font-semibold text-brand-secondary hover:underline">
                          Албан шийдвэр, төсөв, үе шат →
                        </Link>
                      </p>
                    )}
                  </details>
                </li>
              );
            })}
          </ol>
        </section>

        {PROGRAMME.policies.map((p) => (
          <section
            key={p.n}
            aria-labelledby={`policy-${p.n}`}
            className="flex flex-col gap-3"
          >
            <h2
              id={`policy-${p.n}`}
              className="text-lg font-semibold text-primary"
            >
              {p.n}. {p.title}
            </h2>
            {p.intro && <p className="text-sm text-tertiary">{p.intro}</p>}
            <ul className="grid gap-3 sm:grid-cols-2">
              {p.directions.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/promises/${directionSlug(d.id)}`}
                    prefetch={false}
                    className="flex h-full flex-col gap-1 rounded-2xl bg-primary p-4 ring-1 ring-line transition ring-inset hover:bg-primary_hover"
                  >
                    <span className="text-xs font-semibold text-tertiary tabular-nums">
                      {d.id}
                    </span>
                    <span className="font-semibold text-balance text-primary">
                      {d.title}
                    </span>
                    <span className="text-sm text-tertiary">
                      {directionGoals(d).length} зорилт →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="text-xs text-tertiary">
          Эх сурвалж:{" "}
          <a
            href={PROGRAMME.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-secondary"
          >
            {PROGRAMME.act}
          </a>{" "}
          (
          <a
            href={PROGRAMME.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-secondary"
          >
            Word файл
          </a>
          ), {PROGRAMME.importedAt}-нд татсан.
        </p>
      </div>
    </div>
  );
}
