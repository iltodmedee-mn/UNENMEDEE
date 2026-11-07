"use client";

import { ArrowUp } from "@untitledui/icons";
import { useSyncExternalStore } from "react";

/** Shown once the reader is this far down (about two screens of stories). */
const SHOW_AFTER_PX = 900;

function subscribe(onChange: () => void) {
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

/**
 * "Дээш буцах": a round button bottom right once the page is scrolled down, on every page (the
 * owner, Nov 2026). Ledger look: paper surface, hairline ring, the brand's teal arrow, the menus'
 * shadow because it floats over the stories. On phones it sits above the topic / digest bar.
 * Fixed and rendered only after scrolling, so it never moves the page (no CLS).
 */
export function BackToTop() {
  const show = useSyncExternalStore(subscribe, scrolledDown, () => false);
  if (!show) return null;
  const toTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };
  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="Дээш буцах"
      title="Дээш буцах"
      className="fade-enter fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 grid size-11 place-items-center rounded-full bg-primary text-brand-secondary shadow-lg ring-1 ring-line transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand md:right-6 md:bottom-6"
    >
      <ArrowUp aria-hidden className="size-5" strokeWidth={2.25} />
    </button>
  );
}
