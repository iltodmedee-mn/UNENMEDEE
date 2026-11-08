"use client";

import { ArrowUp } from "@untitledui/icons";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { levelOf, parseProgress } from "@/lib/progress";
import { onProgressEvent, progressRaw, readingNow, subscribeProgress, subscribeReading } from "@/lib/progress-store";

/** Shown once the reader is this far down (about two screens of stories). */
const SHOW_AFTER_PX = 900;
const FLASH_MS = 2_000;
const TOAST_MS = 3_500;

function subscribeScroll(onChange: () => void) {
  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onChange();
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    window.removeEventListener("scroll", onScroll);
    cancelAnimationFrame(frame);
  };
}

const scrolledDown = () => window.scrollY > SHOW_AFTER_PX;
const noReading = () => null;
const noProgress = () => null;

/**
 * "Дээш буцах" (the owner, Nov 2026) and the reader's XP meter in one: the ring around the
 * arrow shows the way to the next level (teal), or on an article page how far toward a counted
 * read this story is (yellow); at the moment a read counts the button shows "+10" for two
 * seconds, and a new level shows a short note above it. Tapping always goes to the top.
 * Fixed and client-only, so it never moves the page (no CLS). Progress: src/lib/progress.ts.
 */
export function BackToTop() {
  const down = useSyncExternalStore(subscribeScroll, scrolledDown, () => false);
  const reading = useSyncExternalStore(subscribeReading, readingNow, noReading);
  const raw = useSyncExternalStore(subscribeProgress, progressRaw, noProgress);
  const level = useMemo(() => levelOf(parseProgress(raw).xp), [raw]);
  const [flash, setFlash] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let flashTimer = 0;
    let toastTimer = 0;
    const off = onProgressEvent((e) => {
      setFlash(e.gained);
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => setFlash(null), FLASH_MS);
      if (e.level && e.levelName) {
        setToast(`${e.level}-р түвшин · ${e.levelName}`);
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => setToast(null), TOAST_MS);
      }
    });
    return () => {
      off();
      window.clearTimeout(flashTimer);
      window.clearTimeout(toastTimer);
    };
  }, []);

  // An article page shows the button from the start: it is the story's reading meter.
  if (!down && reading === null && flash === null) return null;
  const toTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };
  const readingStory = reading !== null && reading < 1;
  const ring = readingStory ? reading : level.fraction;
  const label = readingStory ? `Дээш буцах · энэ мэдээ ${Math.round(reading * 100)}% уншсан` : `Дээш буцах · ${level.level}-р түвшин, дараагийнх хүртэл ${Math.round(level.fraction * 100)}%`;

  return (
    <div className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-end gap-2 md:right-6 md:bottom-6">
      {toast && (
        <p role="status" className="fade-enter rounded-full bg-brand-solid px-3 py-1.5 text-sm font-semibold text-white shadow-lg">
          ⬆ {toast}
        </p>
      )}
      <button
        type="button"
        onClick={toTop}
        aria-label={label}
        title={label}
        className={`fade-enter relative grid size-11 place-items-center rounded-full shadow-lg ring-1 ring-line transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${flash !== null ? "bg-brand-solid text-white" : "bg-primary text-brand-secondary hover:bg-secondary"}`}
      >
        <svg aria-hidden viewBox="0 0 56 56" className="pointer-events-none absolute -inset-1.5 size-14 -rotate-90">
          <circle cx="28" cy="28" r="25" fill="none" stroke="var(--color-line-soft)" strokeWidth="3" />
          <circle
            cx="28"
            cy="28"
            r="25"
            fill="none"
            stroke={flash !== null || readingStory ? "var(--color-signal)" : "var(--color-fg-brand-primary)"}
            strokeWidth="3"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${Math.max(0, Math.min(100, (flash !== null ? 1 : ring) * 100))} 100`}
            className="transition-[stroke-dasharray] duration-500 motion-reduce:transition-none"
          />
        </svg>
        {flash !== null ? <span className="text-sm font-extrabold tabular-nums">+{flash}</span> : <ArrowUp aria-hidden className="size-5" strokeWidth={2.25} />}
      </button>
    </div>
  );
}
