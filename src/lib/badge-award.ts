import { award, TIER_NAMES } from "@/lib/badges";
import { INSTALLED_KEY } from "@/lib/install-ask";
import { FOLLOW_KEY } from "@/lib/officials/follow";
import { parseProgress, recordFlag } from "@/lib/progress";
import { announce, progressRaw, saveProgress } from "@/lib/progress-store";
import { PLACE_FOLLOW_KEY, TOPIC_FOLLOW_KEY } from "@/lib/topic-follow";

/**
 * The browser half of badges, loaded lazily by progress-store's checkBadges(): note the Эхлэл facts
 * this browser shows (follows, push, the installed app), stamp new tiers (src/lib/badges.ts award)
 * and announce the newest one. Never part of a page's first load.
 */
const PUSH_ON_KEY = "iltod-push-on";

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function nonEmptyList(key: string): boolean {
  try {
    const v: unknown = JSON.parse(stored(key) ?? "[]");
    return Array.isArray(v) && v.length > 0;
  } catch {
    return false;
  }
}

/** Facts about this browser that earn the Эхлэл badges. */
export function browserFlags(): string[] {
  const flags: string[] = [];
  if (nonEmptyList(TOPIC_FOLLOW_KEY) || nonEmptyList(PLACE_FOLLOW_KEY)) flags.push("follow-topic");
  if (nonEmptyList(FOLLOW_KEY)) flags.push("follow-mp");
  try {
    if (stored(PUSH_ON_KEY) === "1" && "Notification" in window && Notification.permission === "granted") flags.push("push-on");
  } catch {
    /* no Notification API */
  }
  if (stored(INSTALLED_KEY) === "1" || window.matchMedia?.("(display-mode: standalone)").matches) flags.push("app");
  return flags;
}

export function awardNow(now = Date.now()): void {
  const start = parseProgress(progressRaw());
  let p = start;
  for (const f of browserFlags()) p = recordFlag(p, f).progress;
  const a = award(p, now);
  if (a.progress === start) return;
  saveProgress(a.progress);
  const last = a.earned.at(-1);
  if (last) {
    const tier = last.badge.steps.length === 4 ? ` · ${TIER_NAMES[last.tier]}` : "";
    announce({ gained: a.gained, level: a.levelUp?.level ?? null, levelName: a.levelUp?.name ?? null, badge: `${last.badge.name}${tier}` });
  }
}
