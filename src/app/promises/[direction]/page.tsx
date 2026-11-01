import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ShareButton } from "@/components/iltod/share-button";
import { ALL_DIRECTIONS, findDirection, PROGRAMME } from "@/lib/promises";
import {
  directionGoals,
  directionId,
  directionSlug,
  isMeasurable,
  type ProgrammeGoal,
} from "@/lib/promises/programme";
import { absoluteUrl, jsonLd, SITE_NAME } from "@/lib/site";

/** All 16 directions are prerendered: the text never changes between imports. */
export function generateStaticParams() {
  return ALL_DIRECTIONS.map(({ direction }) => ({
    direction: directionSlug(direction.id),
  }));
}

function lookup(slug: string) {
  const id = directionId(slug);
  return id ? findDirection(id) : undefined;
}

export async function generateMetadata({
  params,
}: PageProps<"/promises/[direction]">): Promise<Metadata> {
  const found = lookup((await params).direction);
  if (!found) return { title: "Чиглэл олдсонгүй", robots: { index: false } };
  const { direction } = found;
  const title = `${direction.title} — Засгийн газрын амлалт (${directionGoals(direction).length} зорилт)`;
  const description = `Засгийн газрын 2024–2028 оны үйл ажиллагааны хөтөлбөрийн ${direction.id} «${direction.title}» чиглэлийн бүх зорилт, эх текстээр.`;
  const url = `/promises/${directionSlug(direction.id)}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url },
  };
}

/** Goals in order, with a small heading whenever the section's unnumbered group changes. */
function Goals({ goals }: { goals: ProgrammeGoal[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {goals.map((g, i) => (
        <li key={g.id} className="flex flex-col gap-2">
          {g.group && g.group !== goals[i - 1]?.group && (
            <h4 className="pt-2 label-mono text-tertiary">
              {g.group}
            </h4>
          )}
          <div
            id={g.id}
            className="flex scroll-mt-24 gap-3 rounded-xl bg-primary p-3 ring-1 ring-line ring-inset"
          >
            <a
              href={`#${g.id}`}
              className="shrink-0 pt-0.5 text-xs font-semibold text-tertiary tabular-nums hover:text-secondary"
            >
              {g.id}
            </a>
            <div className="flex flex-col gap-1.5">
              <p className="text-sm text-primary">{g.text}</p>
              {isMeasurable(g.text) && (
                <span className="w-fit rounded-full bg-utility-blue-50 px-2 py-0.5 text-xs font-medium text-utility-blue-700 ring-1 ring-utility-blue-200 ring-inset">
                  тоон хэмжүүртэй
                </span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

async function DirectionView({
  params,
}: {
  params: PageProps<"/promises/[direction]">["params"];
}) {
  const found = lookup((await params).direction);
  if (!found) notFound();
  const { policy, direction } = found;
  const index = ALL_DIRECTIONS.findIndex(
    (d) => d.direction.id === direction.id,
  );
  const prev = ALL_DIRECTIONS[index - 1]?.direction;
  const next = ALL_DIRECTIONS[index + 1]?.direction;
  const path = `/promises/${directionSlug(direction.id)}`;
  const goals = directionGoals(direction);
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: SITE_NAME,
        item: absoluteUrl("/"),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Амлалт",
        item: absoluteUrl("/promises"),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: direction.title,
        item: absoluteUrl(path),
      },
    ],
  };
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumb) }}
      />
      <header className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-brand-secondary">
          <Link href="/promises" prefetch={false} className="hover:underline">
            📜 Амлалт
          </Link>{" "}
          · {policy.n}. {policy.title}
        </p>
        <h1 className="headline text-[1.875rem] text-primary md:text-[2.5rem]">
          <span className="text-tertiary tabular-nums">{direction.id}</span>{" "}
          {direction.title}
        </h1>
        <p className="text-md text-tertiary">
          {goals.length} зорилт,{" "}
          {goals.filter((g) => isMeasurable(g.text)).length} нь тоон хэмжүүртэй.
          Текстийг өөрчлөлтгүй авсан (эх сурвалж: {PROGRAMME.act}); хэрэгжилтийг
          бид дүгнэхгүй.
        </p>
        <ShareButton
          path={path}
          title={`${direction.title}: Засгийн газрын амлалт`}
          className="w-fit"
        />
      </header>

      {direction.sections.map((s) => (
        <section
          key={s.id}
          aria-labelledby={`s-${s.id}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`s-${s.id}`} className="text-md font-semibold text-primary">
            <span className="text-tertiary tabular-nums">{s.id}</span> {s.title}
          </h2>
          <Goals goals={s.goals} />
        </section>
      ))}

      <nav
        aria-label="Бусад чиглэл"
        className="flex flex-wrap justify-between gap-3 border-t border-line pt-4 text-sm font-semibold"
      >
        {prev ? (
          <Link
            href={`/promises/${directionSlug(prev.id)}`}
            prefetch={false}
            className="text-brand-secondary hover:underline"
          >
            ← {prev.id} {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link
            href={`/promises/${directionSlug(next.id)}`}
            prefetch={false}
            className="text-right text-brand-secondary hover:underline"
          >
            {next.id} {next.title} →
          </Link>
        )}
      </nav>
      <p className="text-xs text-tertiary">
        Эх сурвалж:{" "}
        <a
          href={PROGRAMME.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-secondary"
        >
          {PROGRAMME.act}
        </a>
        .
      </p>
    </div>
  );
}

export default async function DirectionPage(
  props: PageProps<"/promises/[direction]">,
) {
  // Checked before anything streams, so an unknown direction is a real 404 (see the article page).
  if (!lookup((await props.params).direction)) notFound();
  return (
    <Suspense
      fallback={
        <div className="mx-auto h-[32rem] w-full max-w-3xl animate-pulse rounded-2xl bg-secondary" />
      }
    >
      <DirectionView params={props.params} />
    </Suspense>
  );
}
