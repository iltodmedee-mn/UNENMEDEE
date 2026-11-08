"use client";

import { ArrowUpRight, Check } from "@untitledui/icons";
import dynamic from "next/dynamic";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState, ViewTransition } from "react";

import { PushInvite } from "@/components/pwa/push-invite";
import { largestAmount, tldrSentences } from "@/lib/format";
import { useLocalStorage } from "@/lib/local-store";
import { parseIds, READ_KEY, READ_MAX } from "@/lib/read-state";
import { perPersonLine } from "@/lib/per-person";
import type { ArticleListItem } from "@/lib/queries";
import { safeHttpUrl } from "@/lib/site";
import { storyTag } from "@/lib/topics";
import { cx } from "@/utils/cx";

import { AIBullets, AIMessage } from "./ai-message";
import { Chip, MoneyTags } from "./badges";
import { impactTeaser, isProtocolStory, ProtocolNote, ReaderImpactBlock } from "./reader-impact";
import { SpinMeter } from "./spin-meter";
import { TimeAgo } from "./time-ago";
import { TopicMark } from "./topic-icon";

// Shown only inside an opened story: loaded on the first open, not with the home page.
const ShareButton = dynamic(() => import("./share-button").then((m) => m.ShareButton), {
  loading: () => <span aria-hidden className="h-10 w-34 rounded-lg ring-1 ring-line ring-inset" />,
});

/** Outline button inside an opened story (the primary one is ink on the page colour). */
import { STORY_BUTTON_OUTLINE, STORY_BUTTON_PRIMARY } from "./story-buttons";

export { STORY_BUTTON, STORY_BUTTON_OUTLINE, STORY_BUTTON_PRIMARY } from "./story-buttons";

interface RowProps {
  s: ArticleListItem;
  isRead: boolean;
  isOpen: boolean;
  lead: boolean;
  onOpen: (id: number) => void;
  onToggleRead: (id: number) => void;
}

/** One story. Memoised with stable handlers, so marking or opening one story re-renders one row, not 40. */
const StoryRow = memo(function StoryRow({ s, isRead, isOpen, lead, onOpen, onToggleRead }: RowProps) {
  const { key: topicKey, tag, color, tile } = storyTag(s.sourceDomain, s.sourceCategory, s.sourceName, s.topic);
  // The ✓ pops only on a tap (a class on rows restored from localStorage would pop on every load).
  const [pop, setPop] = useState(false);
  // "Танд хамаатай юу?" leads the teaser when the text says who a story changes things for.
  const forYou = impactTeaser(s.impact);
  const teaser = forYou ? forYou.text : tldrSentences(s.tldr, lead ? 2 : 1).join(" ");
  const protocol = isProtocolStory(s);
  const amount = largestAmount(s.amounts);
  const share = lead ? null : perPersonLine(s.amounts);
  const Heading = lead ? "h2" : "h3";
  return (
    <li key={s.id} className={lead ? "pt-6 pb-6" : "py-5"}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="label-mono flex flex-wrap items-center gap-x-2 gap-y-1 text-tertiary">
            <span className={cx("flex items-center gap-2", color)}>
              <TopicMark topic={topicKey} tile={tile} color={color} />
              {lead ? (
                <>
                  {/* The lead's marker: a signal chip that says what it is (a bare yellow rule read as a mystery). */}
                  <Chip tone="mnt">Гол мэдээ</Chip> · {tag}
                </>
              ) : (
                tag
              )}
            </span>
            {s.riskFlag && <Chip tone="risk">⚠ Өндөр эрсдэл · {s.riskScore}</Chip>}
            {protocol && <Chip>Протокол</Chip>}
          </p>
          {/* A real link (crawlers and new-tab clicks reach the article); a plain tap expands in place.
              The view-transition name is shared with the article's <h1>, so the headline morphs there. */}
          {/* A heading per story (h2 for the lead, h3 for rows): the page gets a real outline. */}
          <Heading className="mt-2">
            <ViewTransition name={`hl-${s.slug}`}>
              <a
                href={`/article/${s.slug}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  onOpen(s.id);
                }}
                aria-expanded={isOpen}
                className={cx(
                  "block w-full cursor-pointer text-left transition-colors",
                  lead ? "headline text-[1.75rem] md:text-[2.5rem]" : "story-headline text-balance",
                  // Mouse hover: a 2 px brand underline (Tailwind's hover: variant is gated on (hover: hover)).
                  isRead && !isOpen ? "text-tertiary" : "text-primary hover:text-brand-secondary hover:underline hover:decoration-[var(--color-bg-brand-solid)] hover:decoration-2 hover:underline-offset-4",
                )}
              >
                {s.title}
              </a>
            </ViewTransition>
          </Heading>
          {teaser && !isOpen && (
            <p className={cx("mt-2 text-secondary", lead ? "line-clamp-3 text-md" : "line-clamp-2 text-sm")}>
              {forYou && (
                <>
                  <span className="label-mono mr-1.5 text-brand-secondary">Танд</span>
                  {forYou.who && <span className="font-semibold text-primary">{forYou.who}: </span>}
                </>
              )}
              {teaser}
            </p>
          )}
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/* TimeAgo swaps the server's full date for "7 цагийн өмнө" after hydration: with chips
                after it, a narrow row re-wrapped (CLS), so on phones the label takes its own line. */}
            <span className={cx("label-mono text-tertiary", (amount || share || s.clusterSize > 1 || s.pressCount > 0) && "basis-full sm:basis-auto")}>
              {s.dateUnknown ? (
                // The page printed no date: say when we found it, so the row still tells the reader how fresh it is.
                <span title="Эх хуудсанд нийтэлсэн огноо байхгүй: бидний олсон цаг">
                  Огноо тодорхойгүй · <TimeAgo date={s.publishedAt} /> олдсон
                </span>
              ) : (
                <TimeAgo date={s.publishedAt} />
              )}
              <span className="normal-case tracking-normal"> · {s.sourceName}</span>
            </span>
            {amount && <Chip tone="mnt">{amount}</Chip>}
            {share && <Chip>{share}</Chip>}
            {s.clusterSize > 1 && <Chip tone="brand">{s.clusterSize} эх сурвалж</Chip>}
            {s.pressCount > 0 && <Chip>📰 {s.pressCount} хэвлэлд</Chip>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setPop(!isRead);
            onToggleRead(s.id);
          }}
          onAnimationEnd={() => setPop(false)}
          aria-pressed={isRead}
          aria-label={isRead ? "Уншаагүй болгох" : "Уншсан гэж тэмдэглэх"}
          className={cx(
            "mt-5 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition",
            isRead ? "bg-brand-solid text-primary_on-brand" : "text-fg-quaternary ring-1 ring-line ring-inset hover:ring-brand",
            pop && isRead && "check-pop",
          )}
        >
          <Check className="size-4" strokeWidth={2.5} />
        </button>
      </div>

      {isOpen && (
        <div className="panel-enter flex flex-col gap-4 pt-4">
          {s.impact && <ReaderImpactBlock compact impact={s.impact} />}
          {protocol && <ProtocolNote />}
          {s.summaryFallback ? (
            // No AI answered: the first sentences of the article itself, labelled as such, and no AI meter.
            <AIMessage compact tier="tier1" title="Эх текстийн эхний өгүүлбэр" note="AI ажиллаагүй">
              <AIBullets items={tldrSentences(s.tldr)} />
            </AIMessage>
          ) : (
            <AIMessage compact tier="tier1" title="AI хураангуй" note="AI-ийн үнэлгээ, буруутгал биш">
              <AIBullets items={tldrSentences(s.tldr)} />
            </AIMessage>
          )}
          <MoneyTags amounts={s.amounts} />
          {!s.summaryFallback && <SpinMeter neutrality={s.neutralityScore} />}
          <div className="flex flex-wrap gap-2">
            <Link href={`/article/${s.slug}`} className={STORY_BUTTON_PRIMARY}>
              Дэлгэрэнгүй{s.hasDeepAnalysis ? " ⚡" : ""} →
            </Link>
            <a href={safeHttpUrl(s.originalUrl)} target="_blank" rel="noreferrer" className={STORY_BUTTON_OUTLINE}>
              Эх сурвалж <ArrowUpRight className="size-4" />
            </a>
            <ShareButton path={`/article/${s.slug}`} title={s.title} />
          </div>
        </div>
      )}
    </li>
  );
});

/**
 * Kagi News-style story list: colored topic label, big headline, the AI's first sentence as a
 * teaser, ₮ / source-count chips and a check to mark it read. `leadId` renders that story as the
 * lead on top (the home page's most important recent story). Tapping a headline opens the AI
 * summary in place (and marks the story read); the full analysis is one more tap away. Read
 * state lives in this browser only.
 */
/**
 * The next stories of the same feed (`/api/feed/<key>`), without the ones already shown or another
 * source's copy of a shown story. JSON dates come back as strings.
 */
async function loadMore(feed: string, shown: ArticleListItem[]): Promise<ArticleListItem[]> {
  const res = await fetch(`/api/feed/${feed}`);
  if (!res.ok) throw new Error(String(res.status));
  const items = ((await res.json()) as ArticleListItem[]).map((s) => ({ ...s, publishedAt: s.publishedAt ? new Date(s.publishedAt) : null }));
  const ids = new Set(shown.map((s) => s.id));
  const clusters = new Set(shown.map((s) => s.clusterId).filter((c): c is number => c !== null));
  return items.filter((s) => {
    if (ids.has(s.id) || (s.clusterId !== null && clusters.has(s.clusterId))) return false;
    ids.add(s.id);
    if (s.clusterId !== null) clusters.add(s.clusterId);
    return true;
  });
}

/**
 * `moreFeed` (a feed key) adds a "Цааш үзэх" button: the page renders only the first stories, so
 * phones hydrate half as many rows (mobile Total Blocking Time), and the rest load on demand.
 */
export function StoryList({ stories: first, leadId, moreFeed }: { stories: ArticleListItem[]; leadId?: number; moreFeed?: string }) {
  const [more, setMore] = useState<ArticleListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const stories = useMemo(() => (more ? [...first, ...more] : first), [first, more]);
  const [raw, setRaw] = useLocalStorage(READ_KEY, "[]");
  const read = useMemo(() => parseIds(raw), [raw]);
  const [open, setOpen] = useState<number | null>(null);

  // The handlers read the current set through a ref so their identity never changes: a changing
  // callback would re-render every memoised row on each tap.
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  }, [read]);
  const update = useCallback(
    (fn: (s: Set<number>) => void) => {
      const next = new Set(readRef.current);
      fn(next);
      setRaw(JSON.stringify([...next].slice(-READ_MAX)));
    },
    [setRaw],
  );
  const toggleOpen = useCallback(
    (id: number) => {
      setOpen((cur) => (cur === id ? null : id));
      update((s) => s.add(id));
    },
    [update],
  );
  const toggleRead = useCallback((id: number) => update((set) => (set.has(id) ? set.delete(id) : set.add(id))), [update]);
  const unread = stories.filter((s) => !read.has(s.id)).length;

  const item = (s: ArticleListItem) => <StoryRow key={s.id} s={s} isRead={read.has(s.id)} isOpen={open === s.id} lead={s.id === leadId} onOpen={toggleOpen} onToggleRead={toggleRead} />;
  const lead = stories.find((s) => s.id === leadId);
  const rest = lead ? stories.filter((s) => s !== lead) : stories;

  return (
    <div>
      {lead && <ul className="border-t border-line">{item(lead)}</ul>}
      <ul className="story-rows divide-y divide-line-soft border-y border-line">{rest.map(item)}</ul>

      {moreFeed && more === null && stories.length > 0 && (
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setMoreError(false);
            loadMore(moreFeed, first)
              .then(setMore)
              .catch(() => setMoreError(true))
              .finally(() => setLoading(false));
          }}
          className="mt-4 h-12 w-full cursor-pointer rounded-xl text-md font-semibold text-brand-secondary ring-1 ring-line transition ring-inset hover:bg-primary_hover disabled:cursor-wait disabled:opacity-70"
        >
          {loading ? "Ачаалж байна…" : moreError ? "Ачаалж чадсангүй. Дахин оролдох" : "Цааш үзэх ↓"}
        </button>
      )}

      {stories.length > 0 && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => update((set) => stories.forEach((s) => set.add(s.id)))}
            disabled={unread === 0}
            className="w-full cursor-pointer rounded-xl bg-secondary py-3.5 text-md font-semibold text-secondary ring-1 ring-line-soft transition ring-inset hover:bg-secondary_hover disabled:cursor-default disabled:opacity-60"
          >
            {unread === 0 ? "Бүгдийг уншсан ✓" : `Бүгдийг уншсан болгох (${unread})`}
          </button>
        </div>
      )}
      {stories.length > 0 && <PushInvite />}
    </div>
  );
}
