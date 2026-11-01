import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Chip } from "@/components/iltod/badges";
import { PageHeader } from "@/components/iltod/page-header";
import { FeedSkeleton } from "@/components/iltod/skeletons";
import { archiveDateLabel, archiveShortLabel, parseArchiveDate, recentDates, ubTime } from "@/lib/archive";
import { largestAmount } from "@/lib/format";
import { type ArticleListItem, getDayArchive } from "@/lib/queries";
import { absoluteUrl, jsonLd, SITE_NAME } from "@/lib/site";
import { topicFor, TOPICS } from "@/lib/topics";

/** The last two weeks are prerendered; older days render on the first request and are cached. */
export function generateStaticParams() {
  return recentDates(Date.now(), 14).map((date) => ({ date }));
}

export async function generateMetadata({ params }: PageProps<"/archive/[date]">): Promise<Metadata> {
  const date = parseArchiveDate((await params).date);
  if (!date || (await getDayArchive(date)).stories.length === 0) return { title: "Огноо олдсонгүй", robots: { index: false } };
  const title = `${archiveDateLabel(date)} мэдээ — Монголын төрийн мэдээ`;
  const description = `${archiveDateLabel(date)} өдөр яам, агентлаг, аймаг, УИХ-ын албан сайтад гарсан бүх мэдээ, сэдвээр нь. Эх сурвалжийн холбоостой.`;
  return { title, description, alternates: { canonical: `/archive/${date}` }, openGraph: { title, description, url: `/archive/${date}` } };
}

interface Group {
  key: string;
  label: string;
  dot: string;
  stories: ArticleListItem[];
}

/** Stories by topic in the topic bar's order; undated ones (found that day) last. */
function groupByTopic(stories: ArticleListItem[]): Group[] {
  const groups = new Map<string, Group>();
  const undated: ArticleListItem[] = [];
  for (const s of stories) {
    if (s.dateUnknown) {
      undated.push(s);
      continue;
    }
    const t = topicFor(s.sourceDomain, s.sourceCategory, s.topic);
    const g = groups.get(t.key) ?? { key: t.key, label: t.label, dot: t.dot, stories: [] };
    g.stories.push(s);
    groups.set(t.key, g);
  }
  const order = [...TOPICS.map((t) => t.key), "other"];
  const sorted = [...groups.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  if (undated.length) sorted.push({ key: "undated", label: "Огноо тодорхойгүй · энэ өдөр олдсон", dot: "bg-utility-neutral-500", stories: undated });
  return sorted;
}

function ArchiveJsonLd({ date, stories }: { date: string; stories: ArticleListItem[] }) {
  const url = absoluteUrl(`/archive/${date}`);
  const name = `${archiveDateLabel(date)} мэдээ`;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${url}#page`,
        url,
        name,
        inLanguage: "mn",
        isPartOf: { "@id": `${absoluteUrl("/")}#website` },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: stories.length,
          itemListElement: stories.slice(0, 100).map((s, i) => ({ "@type": "ListItem", position: i + 1, url: absoluteUrl(`/article/${s.slug}`), name: s.title })),
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: "Архив", item: absoluteUrl("/archive") },
          { "@type": "ListItem", position: 3, name, item: url },
        ],
      },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}

function DayNav({ prev, next }: { prev: string | null; next: string | null }) {
  if (!prev && !next) return null;
  return (
    <nav aria-label="Өдрүүд" className="label-mono flex items-center justify-between gap-4 border-t border-line pt-4 text-tertiary">
      {prev ? (
        <Link href={`/archive/${prev}`} prefetch={false} className="hover:text-primary">
          ← {archiveShortLabel(prev)}
        </Link>
      ) : (
        <span />
      )}
      <Link href="/archive" prefetch={false} className="hover:text-primary">
        Бүх өдөр
      </Link>
      {next ? (
        <Link href={`/archive/${next}`} prefetch={false} className="hover:text-primary">
          {archiveShortLabel(next)} →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

async function DayView({ params }: { params: PageProps<"/archive/[date]">["params"] }) {
  const date = parseArchiveDate((await params).date);
  if (!date) notFound();
  const { stories, prev, next } = await getDayArchive(date);
  // An empty day (a future date, a day before the site existed) is not a page.
  if (stories.length === 0) notFound();
  const groups = groupByTopic(stories);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <ArchiveJsonLd date={date} stories={stories} />
      <PageHeader
        eyebrow={`Архив · ${stories.length} мэдээ`}
        title={`${archiveDateLabel(date)} мэдээ`}
        description="Тэр өдөр яам, агентлаг, аймаг, УИХ-ын албан сайтад гарсан бүх мэдээ, сэдвээр нь. Цаг нь Улаанбаатарын цагаар."
      />
      <div className="flex flex-col gap-8">
        {groups.map((g) => (
          <section key={g.key} aria-labelledby={`g-${g.key}`} className="flex flex-col gap-3">
            <h2 id={`g-${g.key}`} className="label-mono flex items-center gap-2 text-secondary">
              <span aria-hidden className={`size-2 rounded-[2px] ${g.dot}`} />
              {g.key !== "undated" && g.key !== "other" ? (
                <Link href={`/topic/${g.key}`} prefetch={false} className="hover:text-primary">
                  {g.label}
                </Link>
              ) : (
                g.label
              )}
              <span className="text-quaternary">· {g.stories.length}</span>
            </h2>
            <ol className="flex flex-col divide-y divide-line-soft border-y border-line">
              {g.stories.map((s) => {
                const amount = largestAmount(s.amounts);
                return (
                  <li key={s.id} className="flex flex-col gap-1.5 py-3">
                    <Link href={`/article/${s.slug}`} prefetch={false} className="text-md font-semibold tracking-[-0.01em] text-balance text-primary hover:text-brand-secondary">
                      {s.title}
                    </Link>
                    <p className="label-mono flex flex-wrap items-center gap-x-2 gap-y-1 normal-case text-tertiary">
                      {s.publishedAt && !s.dateUnknown && <span className="num-mono">{ubTime(s.publishedAt)}</span>}
                      <Link href={`/source/${s.sourceDomain}`} prefetch={false} className="hover:text-primary">
                        {s.sourceName}
                      </Link>
                      {amount && <Chip tone="mnt">{amount}</Chip>}
                    </p>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
        <DayNav prev={prev} next={next} />
      </div>
    </div>
  );
}

export default async function ArchiveDayPage(props: PageProps<"/archive/[date]">) {
  // Checked before anything streams: an invalid or empty day is a real 404 (see the article page).
  const date = parseArchiveDate((await props.params).date);
  if (!date || (await getDayArchive(date)).stories.length === 0) notFound();
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <DayView params={props.params} />
    </Suspense>
  );
}
