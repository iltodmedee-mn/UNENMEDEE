import { ArrowLeft, LinkExternal01 } from "@untitledui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, ViewTransition } from "react";

import { AIMarkdownMessage } from "@/components/iltod/ai-markdown";
import { AIBullets, AIMessage } from "@/components/iltod/ai-message";
import { ArticleGrid } from "@/components/iltod/article-grid";
import { Chip, DeepBadge, RiskBadge, SourceBadge } from "@/components/iltod/badges";
import { FactSpinPanel } from "@/components/iltod/fact-spin-panel";
import { FollowCard } from "@/components/iltod/follow-card";
import { HashBadge } from "@/components/iltod/hash-badge";
import { KeyNumbers } from "@/components/iltod/key-numbers";
import { PressPanel } from "@/components/iltod/press-panel";
import { isProtocolStory, ProtocolNote, ReaderImpactBlock } from "@/components/iltod/reader-impact";
import { Panel } from "@/components/iltod/panel";
import { SourceChangeNotice } from "@/components/iltod/source-change";
import { ShareButton } from "@/components/iltod/share-button";
import { DigestBar } from "@/components/iltod/digest-bar";
import { STORY_BUTTON_PRIMARY } from "@/components/iltod/story-buttons";
import { TimeAgo } from "@/components/iltod/time-ago";
import { aiModelLabel } from "@/lib/ai/model-label";
import { archiveDateLabel, ubDateKey } from "@/lib/archive";
import { formatDateMn, tldrSentences } from "@/lib/format";
import { placeGenitive, placeOfDomain } from "@/lib/places";
import { linkPeople } from "@/lib/officials/links";
import { type ArticleDetail, type FeedFilter, getArticleBySlug, getCluster, getPoliticianNames, getRecentSlugs, getTopicNeighbours } from "@/lib/queries";
import { isThinArticle } from "@/lib/seo";
import { absoluteUrl, jsonLd, safeHttpUrl, SITE_NAME, SITE_URL } from "@/lib/site";
import { topicFor } from "@/lib/topics";

/** Cache Components requires at least one param; unknown slugs render on demand (ISR). */
export async function generateStaticParams() {
  const slugs = await getRecentSlugs(20);
  return (slugs.length ? slugs : ["__placeholder__"]).map((slug) => ({ slug }));
}

function summaryOf(article: ArticleDetail): string {
  const text = tldrSentences(article.tldr).join(" ").replace(/\s+/g, " ").trim();
  if (text.length <= 160) return text;
  const cut = text.slice(0, 157);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 100 ? cut.lastIndexOf(" ") : 157).replace(/[\s.,;:–—-]+$/, "")}…`;
}

export async function generateMetadata({ params }: PageProps<"/article/[slug]">): Promise<Metadata> {
  const article = await getArticleBySlug((await params).slug);
  if (!article) return { title: "Мэдээ олдсонгүй", robots: { index: false } };
  const topic = topicFor(article.sourceDomain, article.sourceCategory, article.topic);
  const description = summaryOf(article);
  const url = `/article/${article.slug}`;
  return {
    title: article.title,
    description,
    keywords: [topic.label, article.sourceName, ...article.entities.orgs.slice(0, 5), ...article.entities.people.slice(0, 3), "мэдээ"],
    alternates: { canonical: url },
    // Minor single-source notices stay readable and linked, but are not offered to search engines.
    robots: isThinArticle(article) ? { index: false, follow: true } : undefined,
    openGraph: {
      type: "article",
      url,
      title: article.title,
      description,
      siteName: SITE_NAME,
      locale: "mn_MN",
      publishedTime: article.scrapeMeta?.date_unknown ? undefined : article.publishedAt?.toISOString(),
      modifiedTime: (article.editedAt ?? article.createdAt).toISOString(),
      section: topic.label,
      tags: article.entities.orgs.slice(0, 5),
    },
    twitter: { card: "summary_large_image", title: article.title, description },
  };
}

/** Google "Top stories" / News: NewsArticle + breadcrumbs. */
function articleJsonLd(article: ArticleDetail) {
  const url = absoluteUrl(`/article/${article.slug}`);
  const topic = topicFor(article.sourceDomain, article.sourceCategory, article.topic);
  // An undated page is dated by when we found it, which is not a publication date: leave it out.
  const published = article.scrapeMeta?.date_unknown ? undefined : (article.publishedAt ?? article.createdAt).toISOString();
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "NewsArticle",
        "@id": `${url}#article`,
        mainEntityOfPage: url,
        url,
        headline: article.title.length > 110 ? `${article.title.slice(0, 109)}…` : article.title,
        ...(article.sourceTitle ? { alternativeHeadline: article.sourceTitle } : {}),
        description: summaryOf(article),
        image: [absoluteUrl(`/article/${article.slug}/opengraph-image`)],
        ...(published ? { datePublished: published } : {}),
        dateModified: (article.editedAt ?? article.createdAt).toISOString(),
        inLanguage: "mn",
        articleSection: topic.label,
        keywords: [topic.label, ...article.entities.orgs.slice(0, 5)].join(", "),
        isBasedOn: article.originalUrl,
        sourceOrganization: { "@type": "GovernmentOrganization", name: article.sourceName, url: `https://${article.sourceDomain}` },
        author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
        publisher: { "@id": `${SITE_URL}/#org` },
        isAccessibleForFree: true,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Мэдээ", item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: topic.label, item: absoluteUrl(topic.key === "other" ? "/" : `/topic/${topic.key}`) },
          { "@type": "ListItem", position: 3, name: article.title, item: url },
        ],
      },
    ],
  };
}

async function Related({ clusterId, currentId }: { clusterId: number; currentId: number }) {
  const data = await getCluster(clusterId);
  const others = data?.articles.filter((a) => a.id !== currentId) ?? [];
  if (!data || others.length === 0) return null;
  return (
    <Panel
      title="Энэ сэдвээр бусад эх сурвалж"
      note={
        <Link href={`/clusters/${clusterId}`} className="font-semibold text-brand-secondary hover:underline">
          {data.cluster.articleCount} мэдээ →
        </Link>
      }
    >
      <ArticleGrid articles={others.slice(0, 3)} />
    </Panel>
  );
}

/** "Энэ сэдвийн сүүлийн мэдээ": crawlable links to the topic's newest stories and its hub. */
async function TopicNeighbours({ filter, label, excludeId, clusterId }: { filter: FeedFilter; label?: string; excludeId: number; clusterId: number | null }) {
  const items = await getTopicNeighbours(filter, excludeId, clusterId, 5);
  if (items.length === 0) return null;
  const hub = filter === "all" ? "/" : `/topic/${filter}`;
  return (
    <Panel
      title={label ? `${label} · сүүлийн мэдээ` : "Сүүлийн мэдээ"}
      note={
        <Link href={hub} prefetch={false} className="font-semibold text-brand-secondary hover:underline">
          Бүгдийг үзэх →
        </Link>
      }
    >
      <ul className="divide-y divide-line-soft">
        {items.map((a) => (
          <li key={a.id} className="flex flex-col gap-1 py-3 first:pt-0">
            <Link href={`/article/${a.slug}`} prefetch={false} className="story-headline text-lg text-primary hover:text-brand-secondary md:text-lg">
              {a.title}
            </Link>
            <span className="label-mono normal-case text-tertiary">
              {a.sourceName} · <TimeAgo date={a.publishedAt} />
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

async function ArticleView({ params }: { params: PageProps<"/article/[slug]">["params"] }) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) notFound();
  // Local stories link to their aimag / district page ("Ховд аймгийн бүх мэдээ →").
  const place = article.sourceCategory === "local" ? placeOfDomain(article.sourceDomain) : undefined;
  const topic = topicFor(article.sourceDomain, article.sourceCategory, article.topic);
  // Named people link to their MP profile when the short name is one active member's.
  const people = article.entities.people.length ? linkPeople(article.entities.people, await getPoliticianNames()) : [];

  const dateUnknown = article.scrapeMeta?.date_unknown === true;
  const day = !dateUnknown && article.publishedAt ? ubDateKey(new Date(article.publishedAt).getTime()) : null;
  const paragraphs = article.cleanContent.split(/\n{2,}|\n/).filter((p) => p.trim().length > 0);
  const summaryTitle = article.summaryFallback ? "Хураангуй · эх текстийн эхний өгүүлбэрүүд" : article.sourceDomain === "opendata.gov.mn" ? "Хураангуй · дүрмээр гаргасан" : "AI хураангуй";
  const summaryNote = article.summaryFallback ? "AI ажиллаагүй" : article.sourceDomain === "opendata.gov.mn" ? "AI ашиглаагүй" : article.tier1Model ? aiModelLabel(article.tier1Model) : undefined;
  return (
    // A 720 px reading column; the progress line on top fills as the reader scrolls (CSS only).
    <article className="mx-auto flex w-full max-w-[45rem] flex-col gap-8">
      <span aria-hidden className="reading-progress" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(articleJsonLd(article)) }} />
      <header className="flex flex-col gap-4">
        {/* Visible breadcrumb (the same trail as the BreadcrumbList JSON-LD): crawlable links up to the hubs. */}
        <nav aria-label="Замын мөр" className="label-mono flex flex-wrap items-center gap-x-2 gap-y-1 text-tertiary">
          <Link href="/" className="flex items-center gap-1.5 hover:text-primary">
            <ArrowLeft className="size-3.5" /> Нүүр
          </Link>
          {topic.key !== "other" && (
            <>
              <span aria-hidden>›</span>
              <Link href={`/topic/${topic.key}`} prefetch={false} className={`hover:text-primary ${topic.color}`}>
                {topic.label}
              </Link>
            </>
          )}
          {place && (
            <>
              <span aria-hidden>›</span>
              <Link href={`/place/${place.slug}`} prefetch={false} className="hover:text-primary">
                {place.name}
              </Link>
            </>
          )}
        </nav>
        {/* On phones the source/time label always takes its own line: the server prints the full
            date and the browser swaps in "7 цагийн өмнө", and when only the shorter text fitted
            beside the badge the whole article jumped up by a line (PageSpeed CLS 0.126). */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SourceBadge domain={article.sourceDomain} category={article.sourceCategory} size="md" />
          <span className="label-mono basis-full normal-case text-tertiary sm:basis-auto">
            <Link href={`/source/${article.sourceDomain}`} prefetch={false} className="hover:text-primary hover:underline">
              {article.sourceName}
            </Link>{" "}
            ·{" "}
            {dateUnknown ? <span title={`Эх хуудсанд огноо байхгүй. ${formatDateMn(article.createdAt)}-нд цуглуулсан.`}>Огноо тодорхойгүй</span> : <TimeAgo date={article.publishedAt} />}
          </span>
        </div>
        {/* The same view-transition name as the story row: the headline morphs into place. */}
        <ViewTransition name={`hl-${article.slug}`}>
          <h1 className="headline text-[1.875rem] text-primary md:text-[2.5rem]">{article.title}</h1>
        </ViewTransition>
        {/* Our plain headline is an edit: the government's own stays one line below, word for word. */}
        {article.sourceTitle && (
          <p className="-mt-2 text-sm text-tertiary">
            <span className="label-mono mr-1.5">Эх гарчиг</span>
            {article.sourceTitle}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <RiskBadge score={article.riskScore} size="md" />
          <Link href="/method#risk" className="label-mono normal-case text-tertiary underline decoration-dotted underline-offset-4 hover:text-primary">
            AI-ийн үнэлгээ
          </Link>
          {article.hasDeepAnalysis && <DeepBadge />}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={safeHttpUrl(article.originalUrl)} target="_blank" rel="noreferrer nofollow" className={STORY_BUTTON_PRIMARY}>
            Эх сурвалж <LinkExternal01 className="size-4" />
          </a>
          <ShareButton path={`/article/${slug}`} title={article.title} text={tldrSentences(article.tldr, 1)[0]} className="w-fit" />
        </div>
      </header>

      {article.impact && <ReaderImpactBlock impact={article.impact} className="border-t border-line pt-3" />}
      {isProtocolStory(article) && <ProtocolNote />}

      <AIMessage tier="tier1" title={summaryTitle} note={summaryNote} className="border-t border-line pt-3">
        <AIBullets items={tldrSentences(article.tldr)} className="text-md" />
      </AIMessage>

      {/* The ₮ amounts moved out of the header row into their own ledger. */}
      {article.amounts.length > 0 && <KeyNumbers amounts={article.amounts} facts={article.facts} />}

      {!article.summaryFallback && <FactSpinPanel facts={article.facts} spin={article.spinDetected} neutrality={article.neutralityScore} />}

      <PressPanel press={article.press} blindspot={article.pressBlindspot} />

      {article.deepAnalysis && (
        <AIMarkdownMessage
          tier="tier2"
          title="⚡ Гүнзгий шинжилгээ"
          note={article.tier2Model ? aiModelLabel(article.tier2Model) : undefined}
          markdown={article.deepAnalysis}
          className="border-t border-line pt-3"
        />
      )}

      {(article.entities.people.length > 0 || article.entities.orgs.length > 0) && (
        <Panel title="Нэр, байгууллага" note="AI ялгасан">
          <div className="flex flex-col gap-3">
            {people.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="label-mono mr-1 text-tertiary">Хүмүүс</span>
                {people.map((p) =>
                  p.id !== null ? (
                    <Link key={p.name} href={`/officials/${p.id}`} prefetch={false} title="УИХ-ын гишүүний хөрөнгө, ирц, мэдээ">
                      <Chip tone="brand" size="md" className="font-sans tracking-normal whitespace-normal hover:underline">
                        {p.name} →
                      </Chip>
                    </Link>
                  ) : (
                    <Chip key={p.name} size="md" className="font-sans tracking-normal whitespace-normal">
                      {p.name}
                    </Chip>
                  ),
                )}
              </div>
            )}
            {article.entities.orgs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="label-mono mr-1 text-tertiary">Байгууллагууд</span>
                {article.entities.orgs.map((o) => (
                  <Chip key={o} size="md" className="font-sans tracking-normal whitespace-normal">
                    {o}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        </Panel>
      )}

      <Panel title="Эх текст · албан ёсны" note={dateUnknown ? `${formatDateMn(article.createdAt)}-нд цуглуулсан` : `${formatDateMn(article.publishedAt)}-нд нийтлэгдсэн`}>
        <div className="flex flex-col gap-3 rounded-2xl bg-secondary p-4 ring-1 ring-line-soft ring-inset md:p-5">
          <SourceChangeNotice status={article.sourceStatus} changedAt={article.sourceChangedAt} diff={article.sourceDiff} />
          {article.contentPrunedAt && (
            <p className="rounded-lg bg-primary px-3 py-2 text-sm text-secondary ring-1 ring-line-soft ring-inset">
              Хадгалах зай хэмнэхийн тулд 6 сараас дээш хугацааны мэдээний эх текстийн зөвхөн эхний хэсгийг хадгалдаг. Бүтэн текстийг эх сурвалжаас уншина уу; SHA-256 хэш анхны бүтэн текстийнх.
            </p>
          )}
          {article.editedAt && (
            <p className="rounded-lg bg-signal-soft px-3 py-2 text-sm text-primary ring-1 ring-signal ring-inset">
              ✏️ Редакцийн засвартай ({formatDateMn(article.editedAt)}). Доорх текстийг редактор зассан; SHA-256 хэш нь анх татсан эх текстэд хамаарна.
            </p>
          )}
          <div className="prose max-w-none text-secondary">
            {paragraphs.slice(0, 60).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <div className="flex flex-col gap-2 border-t border-dashed border-line pt-3">
            <HashBadge hash={article.contentHash} />
            <p className="text-xs text-tertiary">Цэвэрлэсэн текстийн SHA-256 хэш: хэн ч эх хуудсыг дахин татаж шалгах боломжтой.</p>
          </div>
        </div>
      </Panel>

      {article.clusterId && (
        <Suspense fallback={null}>
          <Related clusterId={article.clusterId} currentId={article.id} />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <TopicNeighbours filter={(topic.key === "other" ? "all" : topic.key) as FeedFilter} label={topic.key === "other" ? undefined : topic.label} excludeId={article.id} clusterId={article.clusterId} />
      </Suspense>
      {/* Hubs this story belongs to: its place, its source and its day (crawlable paths both ways). */}
      <nav aria-label="Холбоотой хуудсууд" className="flex flex-col gap-2 text-sm font-semibold text-brand-secondary">
        {place && (
          <Link href={`/place/${place.slug}`} prefetch={false} className="w-fit hover:underline">
            {placeGenitive(place)} бүх мэдээ →
          </Link>
        )}
        <Link href={`/source/${article.sourceDomain}`} prefetch={false} className="w-fit hover:underline">
          {article.sourceName}: бүх мэдээ →
        </Link>
        {day && (
          <Link href={`/archive/${day}`} prefetch={false} className="w-fit hover:underline">
            {archiveDateLabel(day)} бүх мэдээ →
          </Link>
        )}
      </nav>
      <FollowCard />
      {/* Opened from /digest: "← Тойм · n/N · Дараагийнх →" (client-only, this tab). */}
      <DigestBar slug={article.slug} />
    </article>
  );
}

export default async function ArticlePage(props: PageProps<"/article/[slug]">) {
  // A missing story is a real 404: checked before anything streams. Inside <Suspense> the 200 was
  // already sent (soft 404 + noindex), and every made-up slug cost a render and an ISR write.
  if (!(await getArticleBySlug((await props.params).slug))) notFound();
  return (
    <Suspense fallback={<div className="mx-auto h-96 w-full max-w-[45rem] animate-pulse rounded-2xl bg-secondary" />}>
      <ArticleView params={props.params} />
    </Suspense>
  );
}
