import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { HomeFeed } from "@/components/iltod/home-feed";
import { FEED_FILTERS, type FeedFilter } from "@/lib/queries";
import { absoluteUrl, jsonLd, SITE_NAME } from "@/lib/site";
import { topicSeo, topicTitle } from "@/lib/topic-seo";
import { findTopic } from "@/lib/topics";

const LABELS: Record<string, string> = { risk: "Эрсдэлтэй мэдээ", budget: "Төсөв, тендер", ministry: "Яамдын шийдвэр" };

function filterFrom(key: string): FeedFilter | null {
  return key !== "all" && (FEED_FILTERS as readonly string[]).includes(key) ? (key as FeedFilter) : null;
}

/** Every topic is prerendered, so its title and description are in <head> for crawlers. */
export function generateStaticParams() {
  return FEED_FILTERS.filter((f) => f !== "all").map((key) => ({ key }));
}

export async function generateMetadata({ params }: PageProps<"/topic/[key]">): Promise<Metadata> {
  const filter = filterFrom((await params).key);
  if (!filter) return { title: "Сэдэв олдсонгүй", robots: { index: false } };
  const label = findTopic(filter)?.label ?? LABELS[filter] ?? filter;
  const title = topicTitle(filter, label);
  const description = topicSeo(filter)?.intro ?? `${label} сэдвийн өнөөдрийн шинэ мэдээ: төрийн байгууллагуудын албан мэдээг AI-аар шүүж, баримтыг пи-араас салгасан товч хураангуй.`;
  return { title, description, alternates: { canonical: `/topic/${filter}` }, openGraph: { title, description, url: `/topic/${filter}` } };
}

/** CollectionPage + BreadcrumbList: tells search engines this page is the site's section on one subject. */
function TopicJsonLd({ filter }: { filter: FeedFilter }) {
  const seo = topicSeo(filter);
  const name = seo?.heading ?? findTopic(filter)?.label ?? LABELS[filter] ?? filter;
  const url = absoluteUrl(`/topic/${filter}`);
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": `${url}#page`, url, name, description: seo?.intro, inLanguage: "mn", isPartOf: { "@id": `${absoluteUrl("/")}#website` }, publisher: { "@id": `${absoluteUrl("/")}#org` } },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name, item: url },
        ],
      },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}

async function TopicFeed({ params }: { params: PageProps<"/topic/[key]">["params"] }) {
  const filter = filterFrom((await params).key);
  if (!filter) notFound();
  return (
    <>
      <TopicJsonLd filter={filter} />
      <HomeFeed filter={filter} />
    </>
  );
}

export default async function TopicPage(props: PageProps<"/topic/[key]">) {
  // Checked before anything streams, so an unknown topic is a real 404 (see the article page).
  if (!filterFrom((await props.params).key)) notFound();
  return (
    <Suspense fallback={<div className="mx-auto h-[32rem] w-full max-w-2xl animate-pulse rounded-2xl bg-secondary" />}>
      <TopicFeed params={props.params} />
    </Suspense>
  );
}
