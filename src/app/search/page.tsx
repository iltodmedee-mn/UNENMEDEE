import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Empty } from "@/components/iltod/empty";
import { PageHeader } from "@/components/iltod/page-header";
import { TimeAgo } from "@/components/iltod/time-ago";
import { tldrSentences } from "@/lib/format";
import { search } from "@/lib/queries";
import { MpPhoto } from "@/components/officials/mp-photo";

export const metadata: Metadata = {
  title: "Хайлт",
  alternates: { canonical: "/search" },
  // Result pages are thin and endless: keep them out of the index, follow the links.
  robots: { index: false, follow: true },
};

const EXAMPLES = ["төсөв", "тендер", "тэтгэвэр", "Оюу толгой", "авлига", "цалин"];

function SearchForm({ q }: { q: string }) {
  return (
    <form action="/search" role="search" className="flex gap-2">
      <label htmlFor="q" className="sr-only">
        Хайх үг
      </label>
      <input
        id="q"
        name="q"
        type="search"
        defaultValue={q}
        maxLength={100}
        placeholder="Жишээ нь: тендер, тэтгэвэр, гишүүний нэр"
        autoComplete="off"
        className="min-w-0 flex-1 rounded-lg bg-primary px-3.5 py-2.5 text-md text-primary ring-1 ring-line-strong ring-inset outline-none focus:ring-2 focus:ring-brand"
      />
      <button type="submit" className="shrink-0 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-bg-primary transition hover:opacity-90">
        Хайх
      </button>
    </form>
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : (raw ?? "")).slice(0, 100);
  if (!q.trim()) {
    return (
      <div className="flex flex-col gap-4">
        <SearchForm q="" />
        <p className="flex flex-wrap gap-2 text-sm text-tertiary">
          Түгээмэл:
          {EXAMPLES.map((e) => (
            <Link key={e} href={`/search?q=${encodeURIComponent(e)}`} className="rounded-full bg-secondary px-3 py-1 font-medium text-secondary hover:bg-primary_hover">
              {e}
            </Link>
          ))}
        </p>
      </div>
    );
  }
  const { articles, politicians } = await search(q);
  return (
    <div className="flex flex-col gap-6">
      <SearchForm q={q} />
      {politicians.length > 0 && (
        <section aria-labelledby="mps" className="flex flex-col gap-2">
          <h2 id="mps" className="text-sm font-semibold text-tertiary">
            УИХ-ын гишүүд
          </h2>
          <ul className="flex flex-wrap gap-2">
            {politicians.map((p) => (
              <li key={p.id}>
                <Link href={`/officials/${p.id}`} className="flex items-center gap-2 rounded-full bg-primary py-1 pr-3 pl-1 text-sm ring-1 ring-line ring-inset hover:bg-primary_hover">
                  {p.photoUrl ? <MpPhoto src={p.photoUrl} size={28} className="size-7 rounded-full object-cover" /> : <span className="size-7 rounded-full bg-secondary" />}
                  <span className="font-semibold text-primary">{p.fullName}</span>
                  <span className="text-tertiary">{p.party}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="hits" className="flex flex-col gap-2">
        <h2 id="hits" className="text-sm font-semibold text-tertiary">
          {articles.length ? `“${q}”: ${articles.length}${articles.length === 30 ? "+" : ""} мэдээ` : `“${q}”: мэдээ олдсонгүй`}
        </h2>
        {articles.length === 0 ? (
          <Empty title="Илэрц олдсонгүй" description="Үгээ богиносгох эсвэл өөр үгээр хайгаад үзээрэй." />
        ) : (
          <ol className="divide-y divide-line-soft border-y border-line">
            {articles.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 py-4">
                <p className="text-xs text-tertiary">
                  {a.sourceName} · <TimeAgo date={a.publishedAt} />
                </p>
                <Link href={`/article/${a.slug}`} className="text-lg font-semibold text-balance text-primary hover:text-brand-secondary">
                  {a.title}
                </Link>
                {a.tldr && <p className="line-clamp-2 text-sm text-secondary">{tldrSentences(a.tldr, 1)[0]}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export default function SearchPage(props: PageProps<"/search">) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      <PageHeader eyebrow="🔍 Хайлт" title="Мэдээ, улстөрчдөөс хайх" />
      <Suspense fallback={<SearchForm q="" />}>
        <Results searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
