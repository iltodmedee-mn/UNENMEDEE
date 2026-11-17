import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Chip } from "@/components/iltod/badges";
import { PageHeader } from "@/components/iltod/page-header";
import { ShareButton } from "@/components/iltod/share-button";
import { TimeAgo } from "@/components/iltod/time-ago";
import { SourceLink } from "@/components/projects/source-link";
import { StageLadder } from "@/components/projects/stage-ladder";
import { formatDateMn, formatMntShort } from "@/lib/format";
import { linkPeople } from "@/lib/officials/links";
import { POPULATION_LABEL } from "@/lib/per-person";
import { PROGRAMME } from "@/lib/promises";
import { BUDGET_KIND_LABEL, findProject, KIND_LABEL, latestBudget, officialSpent, perPerson, projectLd, PROJECTS, sinceLabel, whenLabel } from "@/lib/projects";
import { getPoliticianNames, search } from "@/lib/queries";
import { jsonLd, safeHttpUrl } from "@/lib/site";

export function generateStaticParams() {
  return PROJECTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/projects/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const p = findProject(slug);
  if (!p) return { title: "Төсөл олдсонгүй", robots: { index: false } };
  return {
    title: `${p.name}: албан шийдвэр, төсөв, үе шат`,
    alternates: { canonical: `/projects/${p.slug}` },
    description: `${p.summary} Зарласан: ${whenLabel(p.announced.date)}. Төсвийн мөр, гүйцэтгэл, үе шат, албан үүрэгтэй хүмүүс: бүгд эх сурвалжтай, бидний дүгнэлтгүй.`,
  };
}

async function today(): Promise<Date> {
  "use cache";
  cacheLife("days");
  return new Date();
}

const money = (amount: number, currency: "MNT" | "USD") => (currency === "USD" ? `${(amount / 1e9).toLocaleString("en-US", { maximumFractionDigits: 3 })} тэрбум ам.доллар` : formatMntShort(amount));

function Tile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-t border-line-soft py-3">
      <p className="label-mono truncate text-tertiary">{label}</p>
      <p className="num-mono text-lg text-primary">{value}</p>
      {sub && <p className="text-xs text-tertiary">{sub}</p>}
    </div>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-24 flex-col gap-3 border-t border-line pt-5">
      <h2 id={`${id}-title`} className="text-lg font-semibold text-primary">
        {title}
      </h2>
      {note && <p className="text-xs text-tertiary">{note}</p>}
      {children}
    </section>
  );
}

/** The project's recent news from our own archive (the same search as /search), inside Suspense. */
async function RelatedNews({ phrase }: { phrase: string }) {
  const results = await search(phrase).catch(() => ({ articles: [] }));
  const rows = results.articles.slice(0, 5);
  if (rows.length === 0) return <p className="text-sm text-tertiary">Манай архивт «{phrase}» гэсэн мэдээ одоогоор алга.</p>;
  return (
    <ul className="flex flex-col divide-y divide-line-soft">
      {rows.map((a) => (
        <li key={a.id} className="flex flex-col gap-0.5 py-2">
          <Link href={`/article/${a.slug}`} className="font-medium text-primary hover:underline">
            {a.title}
          </Link>
          <span className="text-xs text-tertiary">
            {a.sourceDomain}
            {a.publishedAt && !a.dateUnknown && (
              <>
                {" · "}
                <TimeAgo date={a.publishedAt} />
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function ProjectPage({ params }: PageProps<"/projects/[slug]">) {
  const { slug } = await params;
  const p = findProject(slug);
  if (!p) notFound();
  const now = await today();
  const spent = officialSpent(p);
  const latest = latestBudget(p);
  const latestSum = latest.reduce((a, b) => a + b.amount, 0);
  const people = p.people.length ? linkPeople(p.people.map((x) => x.name), await getPoliticianNames(p.people.map((x) => x.name))) : [];
  const mega = p.links.megaIndex !== undefined ? PROGRAMME.megaProjects[p.links.megaIndex] : undefined;
  const official = safeHttpUrl(p.links.official);
  const events = [...p.events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 pb-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(projectLd(p)) }} />
      <nav aria-label="Breadcrumb" className="label-mono normal-case text-tertiary">
        <Link href="/" className="hover:underline">
          Нүүр
        </Link>{" "}
        ›{" "}
        <Link href="/projects" className="hover:underline">
          Төслүүд
        </Link>
      </nav>
      <PageHeader eyebrow={`🏗 ${KIND_LABEL[p.kind]} · зарласан ${whenLabel(p.announced.date)}`} title={p.name} description={p.summary}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-secondary">
            <span className="font-semibold text-primary">Зарласнаас хойш {sinceLabel(p.announced.date, now)}.</span> Эхний албан шийдвэр: {p.announced.act} (<SourceLink source={p.announced.source} short />).
          </p>
          <div className="flex flex-wrap gap-2">
            <ShareButton path={`/projects/${p.slug}`} title={`${p.name}: зарласнаас хойш ${sinceLabel(p.announced.date, now)}`} />
          </div>
        </div>
      </PageHeader>

      <StageLadder project={p} />

      <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
        <Tile
          label="Төлөвлөсөн өртөг"
          value={p.planned ? money(p.planned.amount, p.planned.currency) : "—"}
          sub={
            p.planned ? (
              <>
                {p.planned.note ? `${p.planned.note} · ` : ""}
                {whenLabel(p.planned.asOf)} · <SourceLink source={p.planned.source} short />
              </>
            ) : (
              "албан дүн энэ хуудсанд байхгүй"
            )
          }
        />
        <Tile label="Албан гүйцэтгэл" value={spent ? formatMntShort(spent) : "—"} sub={spent ? p.budgets.filter((b) => b.kind === "spent").map((b) => b.note ?? String(b.year)).join("; ") : "гүйцэтгэл гэж тайлагнасан мөр байхгүй"} />
        <Tile label={latest.length ? `${latest[0].year} оны төсөв` : "Жилийн төсөв"} value={latestSum ? formatMntShort(latestSum) : "—"} sub={latest.length ? latest.map((b) => BUDGET_KIND_LABEL[b.kind]).join(" + ") : "төсвийн мөр энэ хуудсанд байхгүй"} />
        <Tile label={`${POPULATION_LABEL} хүнд хуваавал`} value={spent ? (perPerson(spent) ?? "—") : "—"} sub="албан гүйцэтгэлийг хүн амд хуваасан энгийн тоо" />
      </div>

      {p.budgets.length > 0 && (
        <Section id="budget" title="Төсвийн мөрүүд" note="«Төсвийн төсөл» = Засгийн газрын өргөн барьсан дүн, «батлагдсан» = УИХ-ын баталсан, «тодотгол» = жилийн дундах өөрчлөлт, «гүйцэтгэл» = зарцуулсан гэж тайлагнасан дүн. Нэг төслийн мөрүүд нэг хэмжүүрээр биш байж болно (дэд бүтэц, ажлын алба, судалгаа).">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <caption className="sr-only">{p.name}: жил бүрийн төсвийн мөрүүд</caption>
              <thead className="border-b border-line text-xs text-tertiary">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Он
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Төрөл
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Дүн
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Юунд · эх сурвалж
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {p.budgets.map((b, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-3 whitespace-nowrap text-primary tabular-nums">{b.year}</td>
                    <td className="py-2 pr-3">
                      <Chip tone={b.kind === "spent" ? "mnt" : b.kind === "plan" ? "plain" : "brand"}>{BUDGET_KIND_LABEL[b.kind]}</Chip>
                    </td>
                    <td className="num-mono py-2 pr-3 text-right whitespace-nowrap text-primary">{formatMntShort(b.amount)}</td>
                    <td className="py-2 text-secondary">
                      {b.note ? `${b.note} · ` : ""}
                      <SourceLink source={b.source} short />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section id="timeline" title="Он цагийн дараалал" note="Албан шийдвэр, мэдэгдэл, тендер: огноо нь эх хуудсанд бичигдсэн нарийвчлалаар.">
        <ol className="flex flex-col divide-y divide-line-soft">
          {events.map((e, i) => (
            <li key={i} className="grid grid-cols-[6.5rem_1fr] gap-x-3 py-2.5 sm:grid-cols-[9rem_1fr]">
              <span className="label-mono normal-case text-tertiary">{whenLabel(e.date)}</span>
              <span className="flex flex-col gap-1 text-sm text-secondary">
                <span>{e.text}</span>
                <SourceLink source={e.source} className="text-xs" />
              </span>
            </li>
          ))}
        </ol>
      </Section>

      {p.people.length > 0 && (
        <Section id="people" title="Албан үүрэгтэй хүмүүс" note="Зөвхөн албан томилгоо, сонгуулийн баримт; хэн нэгний тухай дүгнэлт биш.">
          <ul className="flex flex-col divide-y divide-line-soft">
            {p.people.map((x, i) => {
              const link = people[i]?.id;
              return (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                  <span>
                    <span className="font-semibold text-primary">{link ? <Link href={`/officials/${link}`} className="hover:underline">{x.name}</Link> : x.name}</span> <span className="text-secondary">· {x.role}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-tertiary">
                    {whenLabel(x.from)}-ээс
                    <SourceLink source={x.source} short />
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section id="links" title="Холбоотой">
        <ul className="flex flex-col gap-2 text-sm">
          {official && (
            <li>
              <a href={official} target="_blank" rel="noreferrer" className="font-semibold text-brand-secondary hover:underline">
                Албан хуудас ↗
              </a>
            </li>
          )}
          {p.links.shilendansOrgId && (
            <li>
              <a href={`https://shilendans.gov.mn/organization/${encodeURIComponent(p.links.shilendansOrgId)}`} target="_blank" rel="noreferrer" className="font-semibold text-brand-secondary hover:underline">
                Шилэн данс: байгууллагын хуудас ↗
              </a>
            </li>
          )}
          {mega && (
            <li className="text-secondary">
              Засгийн газрын 2024–2028 оны хөтөлбөрийн мега төсөл №{(p.links.megaIndex ?? 0) + 1}:{" "}
              <Link href="/promises#mega" className="font-semibold text-brand-secondary hover:underline">
                эх текст
              </Link>{" "}
              — «{mega.split(/(?<=\.)\s+/)[0]}»
            </li>
          )}
          <li>
            <Link href={`/search?q=${encodeURIComponent(p.links.search[0])}`} className="font-semibold text-brand-secondary hover:underline">
              Манай архиваас «{p.links.search[0]}» хайх
            </Link>
          </li>
        </ul>
      </Section>

      <Section id="news" title="Сүүлийн мэдээ" note="Төрийн сайтуудаас цуглуулсан манай архиваас, гарчгаар хайсан; төслийн тухай бүх мэдээ биш.">
        <Suspense fallback={<p className="text-sm text-tertiary">Хайж байна…</p>}>
          <RelatedNews phrase={p.links.search[0]} />
        </Suspense>
      </Section>

      <footer className="flex flex-col gap-1 border-t border-line pt-4 text-xs text-tertiary">
        <p>Энэ хуудасны эх сурвалжуудыг сүүлд {formatDateMn(p.verifiedThrough)}-нд хүн дахин уншсан. Тоо дутуу бол энэ хуудсанд байхгүй гэсэн үг, тэг гэсэн үг биш.</p>
        <p>
          Шинэ албан шийдвэр, төсвийн мөр мэдэж байвал{" "}
          <Link href="/support" className="font-semibold text-brand-secondary hover:underline">
            бидэнд бичээрэй
          </Link>
          : эх сурвалжтай нь нэмнэ.
        </p>
      </footer>
    </div>
  );
}
