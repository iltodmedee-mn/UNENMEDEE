"use client";

import Link from "next/link";
import { Suspense, use } from "react";

import type { ArticleListItem } from "@/lib/queries";
import { useLocalStorage } from "@/lib/local-store";
import { PLACES } from "@/lib/places";
import { parsePlaceFollows, parseTopicFollows, PLACE_FOLLOW_KEY, TOPIC_FOLLOW_KEY } from "@/lib/topic-follow";
import { TOPICS } from "@/lib/topics";

import { FollowPlaceButton, FollowTopicButton } from "./follow-topic";
import { StoryList } from "./story-list";

const MAX_STORIES = 40;
/** Fetched lists are reused this long; a failed fetch only briefly (a PWA that was offline recovers). */
const FRESH_MS = 5 * 60_000;
const FAILED_MS = 30_000;
/** null = the request failed (offline, server error): told apart from "no stories". */
type FeedResult = ArticleListItem[] | null;
const requests = new Map<string, { at: number; ttl: number; p: Promise<FeedResult> }>();

/** "place:<slug>" is a followed aimag or district, anything else a topic key. */
const feedUrl = (key: string) => (key.startsWith("place:") ? `/api/place-feed/${key.slice(6)}` : `/api/topic-feed/${key}`);

/** One request per feed per few minutes; JSON dates come back as strings. */
function topicFeed(key: string): Promise<FeedResult> {
  const now = Date.now();
  const cached = requests.get(key);
  if (cached && now - cached.at < cached.ttl) return cached.p;
  const entry = { at: now, ttl: FRESH_MS, p: Promise.resolve<FeedResult>([]) };
  entry.p = fetch(feedUrl(key))
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<ArticleListItem[]>;
    })
    .then((items) => items.map((s) => ({ ...s, publishedAt: s.publishedAt ? new Date(s.publishedAt) : null })))
    .catch(() => {
      entry.ttl = FAILED_MS;
      return null;
    });
  requests.set(key, entry);
  return entry.p;
}

/** Newest first, each story once, one per cross-source cluster. */
function merge(lists: ArticleListItem[][]): ArticleListItem[] {
  const seen = new Set<number>();
  const clusters = new Set<number>();
  return lists
    .flat()
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .filter((s) => {
      if (seen.has(s.id) || (s.clusterId !== null && clusters.has(s.clusterId))) return false;
      seen.add(s.id);
      if (s.clusterId !== null) clusters.add(s.clusterId);
      return true;
    })
    .slice(0, MAX_STORIES);
}

// use() needs the same promise on every render of the same keys: rebuilt only when a topic's
// request was renewed (expired or failed).
const keyPromises = new Map<string, { parts: Promise<FeedResult>[]; all: Promise<FeedResult[]> }>();
function feeds(keys: string[]): Promise<FeedResult[]> {
  const id = keys.join(",");
  const parts = keys.map(topicFeed);
  const cached = keyPromises.get(id);
  if (cached && cached.parts.every((p, i) => p === parts[i])) return cached.all;
  const all = Promise.all(parts);
  keyPromises.set(id, { parts, all });
  return all;
}

function Stories({ keys }: { keys: string[] }) {
  const results = use(feeds(keys));
  const failed = results.filter((r) => r === null).length;
  const stories = merge(results.filter((r): r is ArticleListItem[] => r !== null));
  // A failed request is not "no news": say so, so an offline reader does not think the feed is empty.
  const note =
    failed > 0 ? (
      <p role="status" className="text-sm text-tertiary">
        {failed === results.length ? "Мэдээг ачаалж чадсангүй." : `${failed} урсгалыг ачаалж чадсангүй.`} Холболтоо шалгаад хуудсаа дахин ачаална уу.
      </p>
    ) : null;
  if (stories.length === 0) return note ?? <p className="py-10 text-center text-sm text-tertiary">Дагасан сэдэв, газруудад шинэ мэдээ алга байна.</p>;
  return (
    <>
      {note}
      <StoryList stories={stories} />
    </>
  );
}

function TopicPicker({ follows }: { follows: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TOPICS.map((t) => (
        <FollowTopicButton key={t.key} topic={t.key} label={t.label} className={follows.includes(t.key) ? undefined : "text-tertiary"} />
      ))}
    </div>
  );
}

/** Followed places as ⭐ toggles, plus a link to pick more. */
function PlacePicks({ places }: { places: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {places.map((slug) => (
        <FollowPlaceButton key={slug} place={slug} label={PLACES.find((p) => p.slug === slug)?.name} />
      ))}
      <Link href="/topic/local#places" prefetch={false} className="text-sm font-semibold text-brand-secondary hover:underline">
        Аймаг, дүүрэг сонгох →
      </Link>
    </div>
  );
}

/** "Миний мэдээ": the newest stories of the topics and places this browser follows. */
export function MyFeed() {
  const [raw] = useLocalStorage(TOPIC_FOLLOW_KEY, "[]");
  const [rawPlaces] = useLocalStorage(PLACE_FOLLOW_KEY, "[]");
  const follows = parseTopicFollows(raw);
  const places = parsePlaceFollows(rawPlaces);
  const keys = [...follows, ...places.map((slug) => `place:${slug}`)];
  if (keys.length === 0) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl bg-primary p-5 ring-1 ring-line ring-inset">
        <p className="text-md font-semibold text-primary">Сонирхсон сэдэв, аймаг дүүргээ ⭐ дагаарай</p>
        <p className="text-sm text-tertiary">Сонгосон сэдэв, газруудын шинэ мэдээ энд нэг урсгалд цуглана. Сонголт зөвхөн энэ төхөөрөмжид хадгалагдана.</p>
        <TopicPicker follows={follows} />
        <PlacePicks places={places} />
      </div>
    );
  }
  const names = [...follows.map((k) => TOPICS.find((t) => t.key === k)?.label), ...places.map((slug) => PLACES.find((p) => p.slug === slug)?.name)];
  return (
    <div className="flex flex-col gap-6">
      <details className="rounded-2xl bg-primary p-4 ring-1 ring-line ring-inset">
        <summary className="cursor-pointer text-sm font-semibold text-secondary">
          Дагаж буй: {names.join(", ")} · засах
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <TopicPicker follows={follows} />
          <PlacePicks places={places} />
        </div>
      </details>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-secondary" />}>
        <Stories keys={keys} />
      </Suspense>
    </div>
  );
}
