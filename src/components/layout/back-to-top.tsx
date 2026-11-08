"use client";

import { ArrowUp, XClose } from "@untitledui/icons";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Bar, DIAL_WIDTHS, DialRow, Ring } from "@/components/progress/dial-row";
import { formatNumber } from "@/lib/format";
import { StreakStrip } from "@/components/progress/streak-strip";
import { LEVELS, levelOf, liveStreak, parseProgress, streakWindow } from "@/lib/progress";
import { checkBadges, markSeen, onProgressEvent, progressRaw, readingNow, subscribeProgress, subscribeReading } from "@/lib/progress-store";

/** The badge row brings the badge rules with it: loaded only when the dial opens. */
const DialBadge = dynamic(() => import("@/components/progress/dial-badge").then((m) => m.DialBadge), {
  ssr: false,
  loading: () => <span aria-hidden className="mr-[3.375rem] block h-[4.75rem] w-[16rem] max-w-[calc(100vw-6rem)] animate-pulse rounded-2xl bg-secondary" />,
});

/** Shown once the reader is this far down (about two screens of stories). */
const SHOW_AFTER_PX = 900;
const FLASH_MS = 2_000;
const TOAST_MS = 4_000;
const STREAK_ORANGE = "#ff6a3d";

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

function FlameIcon() {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className="size-5">
      <path fill="#fff" d="M17 3c1 6 8 8.5 8 16a9 9 0 0 1-18 0c0-4.5 2.5-7 5-9 0 3.5 1.2 5 3.4 6C15 11 14.5 7 17 3z" />
    </svg>
  );
}

function TopIcon() {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className="size-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h16M16 27V12M9.5 18.5 16 12l6.5 6.5" />
    </svg>
  );
}

/**
 * "Дээш буцах" and the reader's progress in one (the owner, Nov 2026). Closed, the ring around the
 * arrow shows the way to the next level (teal) or, on an article, how far toward a counted read this
 * story is (yellow); "+N" flashes when XP arrives and a dot marks a new badge. A tap opens the dial:
 * the next badge, the level, the streak and «Дээш буцах» (nearest the thumb). Fixed and client-only,
 * so it never moves the page (no CLS). Progress: src/lib/progress.ts; badges: src/lib/badges.ts.
 */
export function BackToTop() {
  const down = useSyncExternalStore(subscribeScroll, scrolledDown, () => false);
  const reading = useSyncExternalStore(subscribeReading, readingNow, noReading);
  const raw = useSyncExternalStore(subscribeProgress, progressRaw, noProgress);
  const progress = useMemo(() => parseProgress(raw), [raw]);
  const level = levelOf(progress.xp);
  const [flash, setFlash] = useState<number | null>(null);
  const [toast, setToast] = useState<{ text: string; badge: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let flashTimer = 0;
    let toastTimer = 0;
    const off = onProgressEvent((e) => {
      if (e.gained > 0) {
        setFlash(e.gained);
        window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => setFlash(null), FLASH_MS);
      }
      const text = e.note ?? (e.badge ? `Шинэ badge · ${e.badge}` : e.level && e.levelName ? `${e.level}-р түвшин · ${e.levelName}` : null);
      if (text) {
        setToast({ text, badge: Boolean(e.note || e.badge) });
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

  // A browser that read here before reader progress existed gets its history once (badge-award.ts),
  // when the page is idle so it never competes with loading.
  useEffect(() => {
    if (parseProgress(progressRaw()).flags.includes("imported")) return;
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2_000));
    idle(() => checkBadges());
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      button.current?.focus();
    };
    // The reader scrolling (a swipe or the wheel) closes it; a page's own layout moving the scroll
    // position (content-visibility, late images) does not, so this listens to gestures, not "scroll".
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchmove", close, { passive: true });
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchmove", close);
      window.removeEventListener("wheel", close);
    };
  }, [open]);

  // An article page shows the button from the start: it is the story's reading meter.
  if (!down && reading === null && flash === null && toast === null && !open) return null;

  const toggle = () => {
    if (open) return setOpen(false);
    setNow(Date.now());
    setOpen(true);
    markSeen();
    // Follows, push and the installed app count the moment the reader looks.
    checkBadges(markSeen);
  };
  const close = () => setOpen(false);
  const toTop = () => {
    setOpen(false);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  const readingStory = reading !== null && reading < 1;
  const ring = readingStory ? reading : level.fraction;
  const label = `Миний ахиц, дээш буцах · ${readingStory ? `энэ мэдээ ${Math.round(reading * 100)}% уншсан` : `${level.level}-р түвшин, дараагийнх хүртэл ${Math.round(level.fraction * 100)}%`}`;
  const nextLevel = LEVELS[level.level];
  const streak = open ? liveStreak(progress, now) : 0;
  const days = open ? streakWindow(progress, now) : [];
  const readToday = days[2]?.mark === "today-read";

  return (
    <>
      {open && <button type="button" tabIndex={-1} aria-label="Хаах" onClick={close} className="fade-enter fixed inset-0 z-50 bg-primary/90" />}
      <div className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom)+var(--install-lift,0px))] z-50 flex flex-col items-end gap-3 transition-[bottom] duration-300 ease-out motion-reduce:transition-none md:right-6 md:bottom-6">
        {toast && !open && (
          <p role="status" className="fade-enter flex items-center gap-2 rounded-full bg-brand-solid py-1.5 pr-1.5 pl-3 text-sm font-semibold text-white shadow-lg">
            {toast.badge ? "🏅" : "⬆"} {toast.text}
            {toast.badge && (
              <Link href="/amjilt" prefetch={false} className="rounded-full bg-white/20 px-2 py-0.5 hover:bg-white/30">
                Харах
              </Link>
            )}
          </p>
        )}
        {open && (
          <nav id="progress-dial" aria-label="Миний ахиц" className="flex flex-col items-end gap-3">
            <DialBadge progress={progress} delay={120} onGo={close} />
            <DialRow
              href="/amjilt"
              onClick={close}
              delay={80}
              width={DIAL_WIDTHS[1]}
              circle={
                <span className="grid size-11 place-items-center rounded-full bg-brand-solid font-display text-lg font-extrabold text-white">
                  <Ring fraction={level.fraction} color="var(--color-signal)" />
                  {level.level}
                </span>
              }
            >
              <b className="block text-primary">
                {level.level}-р түвшин · {level.name}
              </b>
              <Bar fraction={level.fraction} color="var(--color-fg-brand-primary)" />
              <span className="block text-xs text-tertiary">
                {nextLevel ? `${formatNumber(progress.xp)} / ${formatNumber(nextLevel.xp)} XP · дараагийнх «${nextLevel.name}»` : `${formatNumber(progress.xp)} XP · хамгийн дээд түвшин`}
              </span>
            </DialRow>
            <DialRow
              href="/amjilt#streak"
              onClick={close}
              delay={40}
              width={DIAL_WIDTHS[2]}
              circle={
                <span className="grid size-11 place-items-center rounded-full" style={{ background: STREAK_ORANGE }}>
                  <FlameIcon />
                </span>
              }
            >
              <b className="block text-primary">{streak} өдөр дараалан</b>
              <span className="my-1.5 block">
                <StreakStrip days={days} small />
              </span>
              <span className="block text-xs text-tertiary">
                {readToday ? "Өнөөдөр уншсан ✓" : streak > 0 ? `Өнөөдөр уншвал ${streak + 1} болно` : progress.bestStreak > 1 ? `Хамгийн урт: ${progress.bestStreak} өдөр` : "Өнөөдөр эхлүүлээрэй"}
              </span>
            </DialRow>
            <DialRow
              onClick={toTop}
              delay={0}
              width={DIAL_WIDTHS[3]}
              circle={
                <span className="grid size-11 place-items-center rounded-full bg-primary-solid text-white ring-1 ring-line">
                  <TopIcon />
                </span>
              }
            >
              <b className="text-primary">Дээш буцах</b>
            </DialRow>
          </nav>
        )}
        <button
          ref={button}
          type="button"
          onClick={toggle}
          aria-label={open ? "Хаах" : label}
          aria-expanded={open}
          aria-controls={open ? "progress-dial" : undefined}
          title={open ? "Хаах" : label}
          className={`fade-enter relative grid size-11 place-items-center rounded-full shadow-lg ring-1 ring-line transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${open ? "bg-primary-solid text-white" : flash !== null ? "bg-brand-solid text-white" : "bg-primary text-brand-secondary hover:bg-secondary"}`}
        >
          {!open && (
            <svg aria-hidden viewBox="0 0 56 56" className="pointer-events-none absolute -inset-1.5 size-14 -rotate-90">
              <circle cx="28" cy="28" r="25" fill="none" stroke="var(--color-line-soft)" strokeWidth="3" />
              <circle
                cx="28"
                cy="28"
                r="25"
                fill="none"
                stroke={flash !== null || readingStory ? "var(--color-signal)" : "var(--color-fg-brand-primary)"}
                strokeWidth="3"
                // At 0 a round cap would still draw a dot at the top.
                strokeLinecap={flash !== null || ring > 0 ? "round" : "butt"}
                pathLength={100}
                strokeDasharray={`${Math.max(0, Math.min(100, (flash !== null ? 1 : ring) * 100))} 100`}
                className="transition-[stroke-dasharray] duration-500 motion-reduce:transition-none"
              />
            </svg>
          )}
          {open ? (
            <XClose aria-hidden className="size-5" strokeWidth={2.5} />
          ) : flash !== null ? (
            <span className="text-sm font-extrabold tabular-nums">+{flash}</span>
          ) : (
            <ArrowUp aria-hidden className="size-5" strokeWidth={2.25} />
          )}
          {!open && progress.unseen.length > 0 && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-error-solid ring-2 ring-bg-primary" />}
        </button>
      </div>
    </>
  );
}
