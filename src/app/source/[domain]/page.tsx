import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Empty } from "@/components/iltod/empty";
import { PageHeader } from "@/components/iltod/page-header";
import { FeedSkeleton } from "@/components/iltod/skeletons";
import { StoryList } from "@/components/iltod/story-list";
import { CATEGORY_LABEL } from "@/lib/format";
import { getSourceHub, getSourceHubDomains, type SourceHub } from "@/lib/queries";
import { absoluteUrl, jsonLd, SITE_NAME } from "@/lib/site";
import { SOURCE_SEEDS } from "@/lib/sources";

/** Lower-case host names only: anything else is not one of our sources. */
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function domainParam(value: string): string | null {
  const d = decodeURIComponent(value).toLowerCase();
  return DOMAIN.test(d) ? d : null;
}

/** Sources with stories are prerendered (the seed list when the build has no database). */
export async function generateStaticParams() {
  const hubs = await getSourceHubDomains();
  const domains = hubs.length ? hubs.map((h) => h.domain) : SOURCE_SEEDS.map((s) => s.domain);
  return domains.map((domain) => ({ domain }));
}

function description(s: SourceHub): string {
  return `${s.name} (${s.domain}) албан сайтад гарсан сүүлийн мэдээ, шийдвэр, мэдэгдэл: AI-аар товчилсон, эх сурвалжийн холбоостой.`;
}

export async function generateMetadata({ params }: PageProps<"/source/[domain]">): Promise<Metadata> {
  const domain = domainParam((await params).domain);
  const hub = domain ? await getSourceHub(domain) : null;
  if (!hub) return { title: "Эх сурвалж олдсонгүй", robots: { index: false } };
  // People search an agency by its address too ("mpr gov", "emd gov" in Search Console).
  const title = `${hub.source.name} (${hub.source.domain}) — мэдээ, шийдвэр`;
  const desc = description(hub.source);
  return {
    title,
    description: desc,
    alternates: { canonical: `/source/${hub.source.domain}` },
    openGraph: { title, description: desc, url: `/source/${hub.source.domain}` },
    // A source with nothing published yet is an empty list: readable, not offered to search engines.
    robots: hub.stories.length ? undefined : { index: false, follow: true },
  };
}

function SourceJsonLd({ source }: { source: SourceHub }) {
  const url = absoluteUrl(`/source/${source.domain}`);
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${url}#page`,
        url,
        name: `${source.name} — мэдээ`,
        description: description(source),
        inLanguage: "mn",
        isPartOf: { "@id": `${absoluteUrl("/")}#website` },
        about: { "@type": "GovernmentOrganization", name: source.name, url: `https://${source.domain}` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: "Эх сурвалжууд", item: absoluteUrl("/sources") },
          { "@type": "ListItem", position: 3, name: source.name, item: url },
        ],
      },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}

async function SourceView({ params }: { params: PageProps<"/source/[domain]">["params"] }) {
  const domain = domainParam((await params).domain);
  const hub = domain ? await getSourceHub(domain) : null;
  if (!hub) notFound();
  const { source, stories } = hub;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <SourceJsonLd source={source} />
      <PageHeader eyebrow={`Эх сурвалж · ${CATEGORY_LABEL[source.category]}`} title={source.name} description={description(source)}>
        <p className="label-mono flex flex-wrap gap-x-4 gap-y-1 normal-case text-tertiary">
          <a href={`https://${source.domain}`} target="_blank" rel="noopener noreferrer" className="text-brand-secondary hover:underline">
            {source.domain} ↗
          </a>
          <Link href="/sources" prefetch={false} className="hover:text-primary">
            Бүх эх сурвалж
          </Link>
          {!source.isActive && <span>Одоогоор хянагдахгүй байна</span>}
        </p>
      </PageHeader>
      {stories.length ? (
        <section aria-labelledby="source-stories">
          {/* The rows are h3 headlines: this h2 keeps the outline in order. */}
          <h2 id="source-stories" className="label-mono mb-2 text-tertiary">
            Сүүлийн {stories.length} мэдээ
          </h2>
          <StoryList stories={stories} />
        </section>
      ) : (
        <Empty title="Нийтлэгдсэн мэдээ алга" description="Энэ сайтаас мэдээ хараахан татаагүй, эсвэл сайт түр ажиллахгүй байна. Скрапер цаг тутам шалгадаг." />
      )}
    </div>
  );
}

export default async function SourcePage(props: PageProps<"/source/[domain]">) {
  // Checked before anything streams, so an unknown source is a real 404 (see the article page).
  const domain = domainParam((await props.params).domain);
  if (!domain || !(await getSourceHub(domain))) notFound();
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <SourceView params={props.params} />
    </Suspense>
  );
}
