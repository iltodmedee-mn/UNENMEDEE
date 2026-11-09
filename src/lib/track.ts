/**
 * Vercel Web Analytics custom events (the owner, Nov 2026: "6 uulang hii"). The layout loads Vercel's
 * own script behind a `window.va` queue stub (no npm client), so an event is `va("event", {name, data})`,
 * the call @vercel/analytics' `track()` makes. Only on Vercel: elsewhere `va` is undefined and nothing
 * happens. Billed per event like a page view ($0.03 per 1 000 on Pro); Pro keeps two properties an event.
 * Nothing about the reader is sent: no salary, no text typed, only what was tapped.
 */
export const TRACK_EVENTS = ["Reaction", "Source click", "Share", "Push subscribe", "Tax calc", "Digest done"] as const;
export type TrackEvent = (typeof TRACK_EVENTS)[number];
export type TrackData = Record<string, string | number | boolean>;

/** Pro plan limit: two properties per custom event. */
export const MAX_PROPS = 2;
const MAX_VALUE = 120;

/** The properties Vercel will keep: at most two, strings cut to a sane length, nothing else. */
export function eventData(data: TrackData = {}): TrackData {
  const out: TrackData = {};
  for (const [k, v] of Object.entries(data).slice(0, MAX_PROPS)) {
    if (typeof v === "string") out[k] = v.slice(0, MAX_VALUE);
    else if (typeof v === "number" ? Number.isFinite(v) : typeof v === "boolean") out[k] = v;
  }
  return out;
}

type Va = (kind: "event", payload: { name: string; data?: TrackData }) => void;

export function track(name: TrackEvent, data?: TrackData): void {
  try {
    (window as Window & { va?: Va }).va?.("event", { name, data: eventData(data) });
  } catch {
    /* analytics never breaks a tap */
  }
}

/** The host of an outbound link, without "www.", for «Эх сурвалж» clicks. */
export function linkHost(href: string | null | undefined): string {
  try {
    return new URL(href ?? "").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
