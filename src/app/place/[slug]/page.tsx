import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Empty } from "@/components/iltod/empty";
import { FollowCard } from "@/components/iltod/follow-card";
import { FollowPlaceButton } from "@/components/iltod/follow-topic";
import { PlacePicker } from "@/components/iltod/place-picker";
import { StoryList } from "@/components/iltod/story-list";
import { findPlace, type Place, placeGenitive, placeLabel, placeMatchesConstituency, PLACES } from "@/lib/places";
import { getPlaceFeed, getPoliticians } from "@/lib/queries";
import { absoluteUrl, jsonLd, SITE_NAME } from "@/lib/site";

/** Every place is prerendered, so its title and description are in <head> for crawlers. */
export function generateStaticParams() {
  return PLACES.map((p) => ({ slug: p.slug }));
}

function description(p: Place): string {
  const what = p.kind === "aimag" ? "Засаг даргын Тамгын газар, Иргэдийн Төлөөлөгчдийн Хурлын" : p.kind === "district" ? "дүүргийн Засаг даргын Тамгын газрын" : "нийслэл болон дүүргүүдийн";
  return `${placeGenitive(p)} шинэ мэдээ: ${what} албан мэдээ, шийдвэр, тойргийн УИХ-ын гишүүд. Эх сурвалжийн холбоостой, AI-аар товчилсон.`;
}

export async function generateMetadata({ params }: PageProps<"/place/[slug]">): Promise<Metadata> {
  const place = findPlace((await params).slug);
  if (!place) return { title: "Газар олдсонгүй", robots: { index: false } };
  const title = `${placeGenitive(place)} мэдээ — өнөөдрийн шинэ мэдээ`;
  return { title, description: description(place), alternates: { canonical: `/place/${place.slug}` }, openGraph: { title, description: description(place), url: `/place/${place.slug}` } };
}

function PlaceJsonLd({ place }: { place: Place }) {
  const url = absoluteUrl(`/place/${place.slug}`);
  const name = `${placeGenitive(place)} мэдээ`;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": `${url}#page`, url, name, description: description(place), inLanguage: "mn", about: { "@type": "Place", name: placeLabel(place) }, isPartOf: { "@id": `${absoluteUrl("/")}#website` } },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: "Орон нутаг", item: absoluteUrl("/topic/local") },
          { "@type": "ListItem", position: 3, name, item: url },
        ],
      },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}

async function PlaceView({ params }: { params: PageProps<"/place/[slug]">["params"] }) {
  const place = findPlace((await params).slug);
  if (!place) notFound();
  const [stories, people] = await Promise.all([getPlaceFeed(place.domains), getPoliticians()]);
  // By the areas the constituency lists, so a renamed or redrawn constituency after an election still matches.
  const mps = people.filter((p) => placeMatchesConstituency(place, p.constituency));
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <PlaceJsonLd place={place} />
      <header className="flex flex-col gap-2">
        <p className="label-mono text-tertiary">
          <Link href="/topic/local" prefetch={false} className="hover:text-secondary">
            Орон нутаг
          </Link>
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="headline text-[1.875rem] text-primary md:text-[2.5rem]">{placeGenitive(place)} мэдээ</h1>
          <FollowPlaceButton place={place.slug} />
        </div>
        <p className="text-sm text-secondary">{description(place)}</p>
        {place.domains.length > 0 && (
          <p className="text-sm text-tertiary">
            Эх сурвалж:{" "}
            {place.domains.map((d, i) => (
              <span key={d}>
                {i > 0 && ", "}
                <a href={`https://${d}`} target="_blank" rel="noopener noreferrer" className="underline hover:text-secondary">
                  {d}
                </a>
              </span>
            ))}
          </p>
        )}
      </header>

      {mps.length > 0 && (
        <section aria-labelledby="mps" className="rounded-2xl bg-secondary p-4 ring-1 ring-line-soft ring-inset">
          <h2 id="mps" className="text-sm font-semibold text-primary">
            {place.kind === "capital" ? "Нийслэлийн тойргуудын УИХ-ын гишүүд" : "Тойргийн УИХ-ын гишүүд"}{" "}
            <span className="font-normal text-tertiary">· {[...new Set(mps.map((m) => m.constituency))].join(" · ")}</span>
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {mps.map((m) => (
              <li key={m.id}>
                <Link href={`/officials/${m.id}`} prefetch={false} className="inline-flex h-9 items-center rounded-full bg-primary px-3 text-sm font-medium text-secondary ring-1 ring-line ring-inset hover:text-primary">
                  {m.shortName}
                  {m.party && <span className="ml-1.5 text-xs text-tertiary">{m.party}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stories.length ? (
        <StoryList stories={stories} />
      ) : (
        <Empty
          title="Сүүлийн үед мэдээ ирээгүй"
          description={place.domains.length ? "Энэ газрын албан сайт шинэ мэдээ нийтлээгүй, эсвэл түр ажиллахгүй байна. Скрапер цаг тутам шалгадаг." : "Энэ дүүргийн албан сайт одоогоор ажиллахгүй байна."}
        />
      )}

      <FollowCard />
      <PlacePicker current={place.slug} title="Бусад аймаг, дүүрэг" />
    </div>
  );
}

export default async function PlacePage(props: PageProps<"/place/[slug]">) {
  // Checked before anything streams, so an unknown place is a real 404 (see the article page).
  if (!findPlace((await props.params).slug)) notFound();
  return (
    <Suspense fallback={<div className="mx-auto h-[32rem] w-full max-w-2xl animate-pulse rounded-2xl bg-secondary" />}>
      <PlaceView params={props.params} />
    </Suspense>
  );
}
