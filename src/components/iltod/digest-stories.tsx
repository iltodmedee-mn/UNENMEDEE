"use client";

import { ArrowDown, ArrowUpRight, Check } from "@untitledui/icons";
import Link from "next/link";
import { useState } from "react";

import { type DigestTrail, rowId, saveTrail } from "@/lib/digest-trail";
import { tldrSentences } from "@/lib/format";
import { useLocalStorage } from "@/lib/local-store";
import type { DigestView } from "@/lib/queries";
import { addIds, parseIds, READ_KEY } from "@/lib/read-state";
import { safeHttpUrl } from "@/lib/site";
import { cx } from "@/utils/cx";

import { AIBullets, AIMessage } from "./ai-message";
import { Chip, MoneyTags, RiskBadge } from "./badges";
import { STORY_BUTTON_OUTLINE, STORY_BUTTON_PRIMARY } from "./story-buttons";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A digest's stories, readable without leaving /digest: a tap on a headline opens its summary in
 * place (like the home StoryList) and marks it read, "Дараагийн мэдээ" opens the next one and
 * scrolls to it. The headline stays a real link (crawlers, Ctrl/Cmd-click). Opening the full
 * article records the digest for this tab (`saveTrail`), so the article shows "← Тойм · n/N ·
 * Дараагийнх →" instead of sending the reader back through the browser history.
 */
export function DigestStories({ edition, items, track }: { edition: number; items: DigestView["items"]; track: boolean }) {
  const [raw, setRaw] = useLocalStorage(READ_KEY, "[]");
  const read = parseIds(raw);
  const [open, setOpen] = useState<number | null>(null);
  const trail: DigestTrail = { edition, items: items.map((it) => ({ id: it.articleId, slug: it.slug, headline: it.headline })) };

  const markRead = (id: number) => setRaw(addIds(raw, [id]));
  const openAt = (i: number, scroll: boolean) => {
    setOpen(i);
    markRead(items[i].articleId);
    // After React has committed the swap (the previous panel closed), bring the next row to the top.
    if (scroll) requestAnimationFrame(() => document.getElementById(rowId(edition, i + 1))?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" }));
  };

  return (
    <ol className="flex flex-col divide-y divide-line-soft">
      {items.map((it, i) => {
        const isOpen = open === i;
        const isRead = read.has(it.articleId);
        const next = i + 1 < items.length ? i + 1 : null;
        return (
          <li key={it.articleId} id={rowId(edition, i + 1)} className="flex scroll-mt-24 gap-3 py-3 first:pt-0 last:pb-0">
            <span aria-hidden className={cx("num-mono mt-0.5 w-7 shrink-0 text-lg leading-none", track && isRead ? "text-brand-secondary" : track ? "text-tertiary" : "text-brand-secondary")}>
              {track && isRead ? <Check className="size-4" strokeWidth={2.5} /> : String(i + 1).padStart(2, "0")}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <a
                href={`/article/${it.slug}`}
                aria-expanded={it.story ? isOpen : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  if (!it.story) {
                    // Nothing to open in place: go to the article, with the way back.
                    markRead(it.articleId);
                    saveTrail(trail);
                    return;
                  }
                  e.preventDefault();
                  if (isOpen) setOpen(null);
                  else openAt(i, false);
                }}
                className={cx(
                  "font-display text-md font-bold tracking-[-0.02em] hover:text-brand-secondary hover:underline",
                  track && isRead && !isOpen ? "text-tertiary" : "text-primary",
                )}
              >
                {it.headline}
              </a>
              {it.whyItMatters && (
                <p className="text-sm text-secondary">
                  <span className="font-semibold text-primary">Яагаад чухал вэ: </span>
                  {it.whyItMatters}
                </p>
              )}
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="label-mono normal-case text-tertiary">{it.sourceName}</span>
                {it.otherSources > 0 && <Chip tone="brand">+{it.otherSources} эх сурвалж</Chip>}
                {it.riskScore >= 65 && <RiskBadge score={it.riskScore} />}
              </div>

              {isOpen && it.story && (
                <div className="panel-enter mt-3 flex flex-col gap-3">
                  {it.story.summaryFallback ? (
                    <AIMessage compact tier="tier1" title="Эх текстийн эхний өгүүлбэр" note="AI ажиллаагүй">
                      <AIBullets items={tldrSentences(it.story.tldr)} />
                    </AIMessage>
                  ) : (
                    <AIMessage compact tier="tier1" title="AI хураангуй" note="AI-ийн үнэлгээ, буруутгал биш">
                      <AIBullets items={tldrSentences(it.story.tldr)} />
                    </AIMessage>
                  )}
                  <MoneyTags amounts={it.story.amounts} />
                  <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
                    <Link href={`/article/${it.slug}`} onClick={() => saveTrail(trail)} className={STORY_BUTTON_OUTLINE}>
                      Дэлгэрэнгүй →
                    </Link>
                    <a href={safeHttpUrl(it.story.originalUrl)} target="_blank" rel="noreferrer" data-track="source" className={STORY_BUTTON_OUTLINE}>
                      Эх сурвалж <ArrowUpRight className="size-4" />
                    </a>
                    {next !== null ? (
                      <button type="button" onClick={() => openAt(next, true)} className={cx(STORY_BUTTON_PRIMARY, "ml-auto")}>
                        Дараагийн мэдээ <ArrowDown className="size-4" />
                        <span className="num-mono ml-1 text-xs opacity-70">
                          {next + 1}/{items.length}
                        </span>
                      </button>
                    ) : (
                      <span className="label-mono ml-auto text-brand-secondary">✓ Тойм дууслаа</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
