import { type Outcome, PROGRESS_KEY, parseProgress, type Progress } from "@/lib/progress";

/**
 * The browser side of reader progress (src/lib/progress.ts): read and write the one localStorage
 * value, and tell the page's listeners (the back-to-top XP ring) what changed. Storage can be
 * blocked (private mode): every access is guarded, and progress then simply does not stick.
 */
const PROGRESS_EVENT = "iltod:progress";
const READING_EVENT = "iltod:reading";

export interface ProgressEvent {
  gained: number;
  level: number | null;
  levelName: string | null;
}

export function progressRaw(): string | null {
  try {
    return localStorage.getItem(PROGRESS_KEY);
  } catch {
    return null;
  }
}

/** Applies one event to the stored progress; saves and announces it when it earned XP. */
export function applyProgress(fn: (p: Progress) => Outcome): Outcome {
  const out = fn(parseProgress(progressRaw()));
  if (out.gained > 0) {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(out.progress));
    } catch {
      /* not kept */
    }
    const detail: ProgressEvent = { gained: out.gained, level: out.levelUp?.level ?? null, levelName: out.levelUp?.name ?? null };
    window.dispatchEvent(new CustomEvent(PROGRESS_EVENT, { detail }));
  }
  return out;
}

export function subscribeProgress(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => e.key === PROGRESS_KEY && cb();
  window.addEventListener(PROGRESS_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PROGRESS_EVENT, cb);
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
