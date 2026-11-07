/**
 * When a video may go out. GitHub starts scheduled runs late (the first evening price video went
 * out at 01:12 Ulaanbaatar, 5.5 h after its 19:41 slot), so the time is decided here, not by the
 * cron: a video is made only inside a slot, once per slot. The 30-minute pipeline and video.yml
 * both ask; whichever runs first in the slot makes it.
 */
export interface VideoSlot {
  /** Ulaanbaatar hours [from, to). */
  from: number;
  to: number;
  prefer: "prices" | "impact";
}

/**
 * Lunch and evening scrolling time, Ulaanbaatar. Both slots tell one fresh story the way a news
 * creator does (impact-video.ts) since Nov 6 2026; a price video only when no story qualifies.
 * The "ХҮН БҮРТ ХУВААВАЛ" money video is off (the owner, Nov 6 2026: a per-person split of a
 * budget line reads as what each person pays, and what one citizen's taxes pay for cannot be
 * told honestly from a news story).
 */
export const VIDEO_SLOTS: VideoSlot[] = [
  { from: 12, to: 16, prefer: "impact" },
  { from: 19, to: 23, prefer: "impact" },
];

/** The kinds a slot tries, in order, until one has something new to make. */
export function kindsFor(prefer: VideoSlot["prefer"]): VideoSlot["prefer"][] {
  return prefer === "prices" ? ["prices", "impact"] : ["impact", "prices"];
}

const UB_MS = 8 * 3_600_000;

/** The slot `now` falls in, if it has no video yet (the newest video was made before the slot began). */
export function dueSlot(now: Date, lastVideoAt: Date | null): VideoSlot | null {
  const ub = new Date(now.getTime() + UB_MS);
  const hour = ub.getUTCHours();
  const slot = VIDEO_SLOTS.find((s) => hour >= s.from && hour < s.to);
  if (!slot) return null;
  const start = Date.UTC(ub.getUTCFullYear(), ub.getUTCMonth(), ub.getUTCDate(), slot.from) - UB_MS;
  return !lastVideoAt || lastVideoAt.getTime() < start ? slot : null;
}

/** The Ulaanbaatar start of `slot` on `now`'s Ulaanbaatar day, as an instant. */
export function slotStart(now: Date, slot: VideoSlot): Date {
  const ub = new Date(now.getTime() + UB_MS);
  return new Date(Date.UTC(ub.getUTCFullYear(), ub.getUTCMonth(), ub.getUTCDate(), slot.from) - UB_MS);
}

/** How long a run owns a slot before another run may take it over (voicing + rendering takes minutes). */
export const CLAIM_LEASE_MS = 20 * 60_000;
