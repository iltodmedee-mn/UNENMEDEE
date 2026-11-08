import { award, TIER_NAMES } from "@/lib/badges";
import { INSTALLED_KEY } from "@/lib/install-ask";
import { FOLLOW_KEY } from "@/lib/officials/follow";
import { importHistory, levelOf, parseProgress, recordFlag } from "@/lib/progress";
import { announce, progressRaw, saveProgress } from "@/lib/progress-store";
import { parseIds, parseStreak, READ_KEY, STREAK_KEY } from "@/lib/read-state";
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
  // Once per browser: what it read before reader progress existed.
  const history = importHistory(start, { readIds: [...parseIds(stored(READ_KEY) ?? "[]")], digestStreak: parseStreak(stored(STREAK_KEY) ?? ""), now });
  let p = history.progress;
  for (const f of browserFlags()) p = recordFlag(p, f).progress;
  const a = award(p, now);
  if (a.progress === start) return;
  saveProgress(a.progress);
  const last = a.earned.at(-1);
  const after = levelOf(a.progress.xp);
  const level = after.level > levelOf(start.xp).level ? after : null;
  const badge = last ? `${last.badge.name}${last.badge.steps.length === 4 ? ` · ${TIER_NAMES[last.tier]}` : ""}` : null;
  const note = a.progress.imported > 0 && start.imported === 0 ? `Өмнө уншсан ${a.progress.imported} мэдээ тоологдлоо · ${after.level}-р түвшин` : null;
  if (badge || note || level) announce({ gained: note ? 0 : a.gained, level: level?.level ?? null, levelName: level?.name ?? null, badge, note });
}
