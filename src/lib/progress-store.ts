import { type Outcome, PROGRESS_KEY, parseProgress, type Progress } from "@/lib/progress";

/**
 * The browser side of reader progress (src/lib/progress.ts): read and write the one localStorage
 * value, and tell the page's listeners (the back-to-top dial, /amjilt) what changed. Storage can be
 * blocked (private mode): every access is guarded, and progress then simply does not stick.
 * Badges are checked after every change by src/lib/badge-award.ts, loaded only then.
 */
const PROGRESS_EVENT = "iltod:progress";
const CHANGE_EVENT = "iltod:progress-change";
const READING_EVENT = "iltod:reading";

/** XP arrived: the dial flashes "+N"; a new level or badge shows a note. */
export interface ProgressEvent {
  gained: number;
  level: number | null;
  levelName: string | null;
  /** a badge tier this event earned: "Баримт шалгагч · Хүрэл" */
  badge: string | null;
  /** a one-off note, shown before a badge or level ("Өмнө уншсан 240 мэдээ тоологдлоо") */
  note?: string | null;
}

export function progressRaw(): string | null {
  try {
    return localStorage.getItem(PROGRESS_KEY);
  } catch {
    return null;
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* not kept */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function announce(detail: ProgressEvent): void {
  window.dispatchEvent(new CustomEvent(PROGRESS_EVENT, { detail }));
}

/** Loads the badge rules (a separate chunk) and stamps any tier reached since the last check. */
export function checkBadges(then?: () => void): void {
  import("@/lib/badge-award")
    .then((m) => {
      m.awardNow();
      then?.();
    })
    .catch(() => {});
}

/** Applies one event to the stored progress; saves it when it changed and announces XP. */
export function applyProgress(fn: (p: Progress) => Outcome): Outcome {
  const before = parseProgress(progressRaw());
  const out = fn(before);
  if (out.progress === before) return out;
  saveProgress(out.progress);
  if (out.gained > 0) announce({ gained: out.gained, level: out.levelUp?.level ?? null, levelName: out.levelUp?.name ?? null, badge: null });
  checkBadges();
  return out;
}

/** The reader looked at their badges: the dot goes away. */
export function markSeen(): void {
  const p = parseProgress(progressRaw());
  if (p.unseen.length > 0) saveProgress({ ...p, unseen: [] });
}

export function subscribeProgress(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => e.key === PROGRESS_KEY && cb();
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function onProgressEvent(cb: (e: ProgressEvent) => void): () => void {
  const listener = (e: Event) => cb((e as CustomEvent<ProgressEvent>).detail);
  window.addEventListener(PROGRESS_EVENT, listener);
  return () => window.removeEventListener(PROGRESS_EVENT, listener);
}

/* The article page's reading meter: how far toward a counted read this story is (null = no meter). */
let reading: number | null = null;

export function setReading(value: number | null): void {
  if (value === reading) return;
  reading = value;
  window.dispatchEvent(new Event(READING_EVENT));
}

export const readingNow = (): number | null => reading;

export function subscribeReading(cb: () => void): () => void {
  window.addEventListener(READING_EVENT, cb);
  return () => window.removeEventListener(READING_EVENT, cb);
}
