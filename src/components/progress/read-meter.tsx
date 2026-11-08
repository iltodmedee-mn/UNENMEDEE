"use client";

import { useEffect, useRef } from "react";

import { parseProgress, type ReadEvent, recordFact, recordPress, recordRead, recordSource } from "@/lib/progress";
import { applyProgress, progressRaw, setReading } from "@/lib/progress-store";

/** A counted read (GLOSSARY.md): this long on screen and past this share of the story. */
export const READ_SECONDS = 15;
export const READ_SHARE = 0.5;
/** The facts-versus-spin panel counts as read after this long half on screen. */
const FACT_SECONDS = 3;
const TICK_MS = 500;

type StoryKind = Pick<ReadEvent, "law" | "place" | "multi" | "risky">;

/**
 * The article page's reading meter: renders nothing, measures. It feeds the back-to-top ring
 * (setReading) and records the counted read, the facts view (`data-progress="facts"`), the source
 * visit (`data-progress="source"`) and a press link (`data-progress="press"`) in the reader's own
 * browser (src/lib/progress.ts). `kind` says what else the read counts toward (badges).
 */
export function ReadMeter({ id, topic, publishedAt, law = false, place = null, multi = false, risky = false }: { id: number; topic: string; publishedAt: string | null } & StoryKind) {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const article = anchor.current?.closest("article");
    if (!article) return;
    const published = publishedAt ? Date.parse(publishedAt) : null;
    let counted = parseProgress(progressRaw()).readIds.includes(id);
    let seconds = 0;
    let share = 0;
    setReading(counted ? 1 : 0);

    const tick = window.setInterval(() => {
      if (counted || document.visibilityState !== "visible") return;
      seconds += TICK_MS / 1000;
      const rect = article.getBoundingClientRect();
      share = Math.max(share, Math.min(1, (window.innerHeight - rect.top) / Math.max(1, rect.height)));
      const toward = (Math.min(1, seconds / READ_SECONDS) + Math.min(1, share / READ_SHARE)) / 2;
      setReading(Math.round(toward * 50) / 50);
      if (seconds >= READ_SECONDS && share >= READ_SHARE) {
        counted = true;
        applyProgress((p) => recordRead(p, { id, topic, publishedAt: Number.isFinite(published) ? published : null, now: Date.now(), law, place, multi, risky }));
        setReading(1);
      }
    }, TICK_MS);

    // Facts versus spin: half on screen for FACT_SECONDS.
    const facts = article.querySelector('[data-progress="facts"]');
    let factTimer = 0;
    const observer = facts
      ? new IntersectionObserver(
          ([entry]) => {
            window.clearTimeout(factTimer);
            if (entry.isIntersecting) factTimer = window.setTimeout(() => applyProgress((p) => recordFact(p, { id, now: Date.now() })), FACT_SECONDS * 1000);
          },
          { threshold: 0.5 },
        )
      : null;
    if (facts) observer?.observe(facts);

    const onClick = (e: MouseEvent) => {
      const target = (e.target as Element | null)?.closest?.("[data-progress]")?.getAttribute("data-progress");
      if (target === "source") applyProgress((p) => recordSource(p, { id, now: Date.now() }));
      else if (target === "press") applyProgress((p) => recordPress(p, { id, now: Date.now() }));
    };
    article.addEventListener("click", onClick);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(factTimer);
      observer?.disconnect();
      article.removeEventListener("click", onClick);
      setReading(null);
    };
  }, [id, topic, publishedAt, law, place, multi, risky]);

  return <span ref={anchor} hidden />;
}
