/**
 * Reader progress (GLOSSARY.md: counted read, XP, level, badge, tier): XP, the ten levels and the
 * counters badges are built from. Kept only in the reader's browser (no accounts, nothing sent);
 * pure functions over a plain object, unit-tested (tests/progress.test.ts). The browser side is
 * src/lib/progress-store.ts.
 *
 * Hard on purpose (the owner, Nov 2026: easy badges are not interesting): a story counts once,
 * at most DAILY_CAP counted reads, fact views and source visits a day earn anything, and the top
 * level takes about a year of daily reading (~100 XP a day).
 */
import { ubDay } from "@/lib/read-state";

export const PROGRESS_KEY = "iltod-progress";
export const PROGRESS_VERSION = 1;

/** Counted reads, fact views, source visits (and press links, list rows, pages) that count, per day. */
export const DAILY_CAP = 20;
/** A day with this many counted reads is a full day (the «Номын хорхой» badge). */
export const FULL_DAY = 10;
/** Story ids remembered so one story never counts twice. */
const ID_MEMORY = 3_000;

export const XP = { read: 10, fact: 5, source: 5, digest: 30, streakDay: 20 } as const;

export const LEVELS: { name: string; xp: number }[] = [
  { name: "Шинэ уншигч", xp: 0 },
  { name: "Сонирхогч", xp: 100 },
  { name: "Ажиглагч", xp: 300 },
  { name: "Уншигч", xp: 700 },
  { name: "Шалгагч", xp: 1_500 },
  { name: "Мөрдөгч", xp: 3_000 },
  { name: "Шинжээч", xp: 6_000 },
  { name: "Хянагч", xp: 11_000 },
  { name: "Ил тод иргэн", xp: 20_000 },
  { name: "Ил тод баатар", xp: 36_000 },
];

export interface Progress {
  v: number;
  xp: number;
  /** counted reads, all time */
  reads: number;
  readIds: number[];
  facts: number;
  factIds: number[];
  sources: number;
  sourceIds: number[];
  digests: number;
  digestIds: number[];
  /** Ulaanbaatar day the day counters belong to */
  day: string;
  dayReads: number;
  dayFacts: number;
  daySources: number;
  /** consecutive Ulaanbaatar days with a counted read, ending on `lastDay` */
  streak: number;
  bestStreak: number;
  lastDay: string | null;
  /** counted reads per topic key */
  topics: Record<string, number>;
  /** counted reads before 08:00, from 23:00, on Saturday or Sunday (Ulaanbaatar time) */
  morning: number;
  night: number;
  weekend: number;
  /** counted reads of a story within 10 minutes of its publication */
  fast: number;
  /** came back after 7 or more days away */
  returns: number;
  /** days that reached FULL_DAY counted reads */
  fullDays: number;
  /** counted reads of a story several outlets wrote (a cluster), with a high risk score, of a legal act */
  multi: number;
  risky: number;
  laws: number;
  /** counted reads per place slug (a local government site's story) */
  places: Record<string, number>;
  /** press links opened from a story, once per story */
  press: number;
  pressIds: number[];
  /** distinct Ulaanbaatar days each section page was read (SECTION_SECONDS on screen) */
  sections: Record<string, { days: number; last: string }>;
  /** distinct things seen per kind: an MP's page, an archive day, a tender row */
  items: Record<string, { n: number; ids: string[] }>;
  /** today's count per capped kind (press, item kinds) */
  dayCounts: Record<string, number>;
  /** facts about this browser that stay true once seen (follows, push, installed, a holiday read) */
  flags: string[];
  /** earned badges: the Ulaanbaatar day each tier was reached, in tier order (src/lib/badges.ts) */
  badges: Record<string, string[]>;
  /** badges earned and not looked at yet (the dot on the back-to-top button) */
  unseen: string[];
}

export function emptyProgress(): Progress {
  return {
    v: PROGRESS_VERSION,
    xp: 0,
    reads: 0,
    readIds: [],
    facts: 0,
    factIds: [],
    sources: 0,
    sourceIds: [],
    digests: 0,
    digestIds: [],
    day: "",
    dayReads: 0,
    dayFacts: 0,
    daySources: 0,
    streak: 0,
    bestStreak: 0,
    lastDay: null,
    topics: {},
    morning: 0,
    night: 0,
    weekend: 0,
    fast: 0,
    returns: 0,
    fullDays: 0,
    multi: 0,
    risky: 0,
    laws: 0,
    places: {},
    press: 0,
    pressIds: [],
    sections: {},
    items: {},
    dayCounts: {},
    flags: [],
    badges: {},
    unseen: [],
  };
}

/** The stored value, or a fresh start when it is missing, broken or another version. */
export function parseProgress(raw: string | null | undefined): Progress {
  if (!raw) return emptyProgress();
  try {
    const p = JSON.parse(raw) as Partial<Progress>;
    if (p?.v !== PROGRESS_VERSION || typeof p.xp !== "number") return emptyProgress();
    return { ...emptyProgress(), ...p };
  } catch {
    return emptyProgress();
  }
}

export interface LevelInfo {
  /** 1-based */
  level: number;
  name: string;
  /** XP into this level, and the span to the next (null at the top) */
  into: number;
  span: number | null;
  /** 0..1 toward the next level (1 at the top) */
  fraction: number;
}

export function levelOf(xp: number): LevelInfo {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].xp) i++;
  const floor = LEVELS[i].xp;
  const next = LEVELS[i + 1]?.xp ?? null;
  const span = next === null ? null : next - floor;
  return { level: i + 1, name: LEVELS[i].name, into: xp - floor, span, fraction: span ? Math.min(1, (xp - floor) / span) : 1 };
}

export interface Outcome {
  progress: Progress;
  /** XP this event earned (0 when it did not count) */
  gained: number;
  /** the new level when this event crossed into one */
  levelUp: LevelInfo | null;
}

const UB_MS = 8 * 3_600_000;
const prevDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const remember = (ids: number[], id: number) => [...ids, id].slice(-ID_MEMORY);

/** Day counters belong to one Ulaanbaatar day: a new day starts them at zero. */
function onDay(p: Progress, now: number): Progress {
  const today = ubDay(now);
  return p.day === today ? p : { ...p, day: today, dayReads: 0, dayFacts: 0, daySources: 0, dayCounts: {} };
}

function finish(before: Progress, after: Progress, gained: number): Outcome {
  const progress = { ...after, xp: before.xp + gained };
  const was = levelOf(before.xp);
  const is = levelOf(progress.xp);
  return { progress, gained, levelUp: is.level > was.level ? is : null };
}

const none = (p: Progress): Outcome => ({ progress: p, gained: 0, levelUp: null });

export interface ReadEvent {
  id: number;
  topic: string;
  /** null = an undated story (never a fast read) */
  publishedAt: number | null;
  now: number;
  /** a legal act (legalinfo.mn) */
  law?: boolean;
  /** the place slug of a local government site's story */
  place?: string | null;
  /** several outlets wrote this story (it is in a cluster) */
  multi?: boolean;
  /** the AI risk score is high (src/lib/format.ts riskLevel) */
  risky?: boolean;
}

/** Ulaanbaatar holidays a counted read is remembered for (secret badges): month-day ranges. */
const HOLIDAY_READS: { flag: string; from: string; to: string }[] = [
  { flag: "new-year", from: "01-01", to: "01-01" },
  { flag: "naadam", from: "07-11", to: "07-13" },
];

const addFlag = (flags: string[], flag: string) => (flags.includes(flag) ? flags : [...flags, flag]);

/** A counted read (the article page's reading meter decides when: 15 s on screen and past half). */
export function recordRead(prev: Progress, e: ReadEvent): Outcome {
  if (prev.readIds.includes(e.id)) return none(prev);
  const p = onDay(prev, e.now);
  if (p.dayReads >= DAILY_CAP) return none(p);
  const today = p.day;
  let gained = XP.read;
  let { streak, bestStreak, returns } = p;
  if (p.lastDay !== today) {
    if (p.lastDay && daysBetween(p.lastDay, today) >= 7) returns++;
    if (p.lastDay === prevDay(today)) {
      streak++;
      gained += XP.streakDay;
    } else streak = 1;
    bestStreak = Math.max(bestStreak, streak);
  }
  const ub = new Date(e.now + UB_MS);
  const hour = ub.getUTCHours();
  const dow = ub.getUTCDay();
  const fast = e.publishedAt !== null && e.now - e.publishedAt >= 0 && e.now - e.publishedAt <= 10 * 60_000;
  const monthDay = today.slice(5);
  const flags = HOLIDAY_READS.filter((h) => monthDay >= h.from && monthDay <= h.to).reduce((f, h) => addFlag(f, h.flag), p.flags);
  return finish(
    prev,
    {
      ...p,
      reads: p.reads + 1,
      readIds: remember(p.readIds, e.id),
      dayReads: p.dayReads + 1,
      streak,
      bestStreak,
      lastDay: today,
      returns,
      topics: { ...p.topics, [e.topic]: (p.topics[e.topic] ?? 0) + 1 },
      morning: p.morning + (hour < 8 ? 1 : 0),
      night: p.night + (hour >= 23 ? 1 : 0),
      weekend: p.weekend + (dow === 0 || dow === 6 ? 1 : 0),
      fast: p.fast + (fast ? 1 : 0),
      fullDays: p.fullDays + (p.dayReads + 1 === FULL_DAY ? 1 : 0),
      multi: p.multi + (e.multi ? 1 : 0),
      risky: p.risky + (e.risky ? 1 : 0),
      laws: p.laws + (e.law ? 1 : 0),
      places: e.place ? { ...p.places, [e.place]: (p.places[e.place] ?? 0) + 1 } : p.places,
      flags,
    },
    gained,
  );
}

/** The facts-versus-spin view of a story was read (on screen for a few seconds). */
export function recordFact(prev: Progress, e: { id: number; now: number }): Outcome {
  if (prev.factIds.includes(e.id)) return none(prev);
  const p = onDay(prev, e.now);
  if (p.dayFacts >= DAILY_CAP) return none(p);
  return finish(prev, { ...p, facts: p.facts + 1, factIds: remember(p.factIds, e.id), dayFacts: p.dayFacts + 1 }, XP.fact);
}

/** The reader opened the story's original government page. */
export function recordSource(prev: Progress, e: { id: number; now: number }): Outcome {
  if (prev.sourceIds.includes(e.id)) return none(prev);
  const p = onDay(prev, e.now);
  if (p.daySources >= DAILY_CAP) return none(p);
  return finish(prev, { ...p, sources: p.sources + 1, sourceIds: remember(p.sourceIds, e.id), daySources: p.daySources + 1 }, XP.source);
}

/** A digest edition read to the end. */
export function recordDigest(prev: Progress, e: { edition: number; now: number }): Outcome {
  if (prev.digestIds.includes(e.edition)) return none(prev);
  return finish(prev, { ...prev, digests: prev.digests + 1, digestIds: remember(prev.digestIds, e.edition) }, XP.digest);
}

/** One more of a capped kind today, or null when today's cap is reached. */
function bump(p: Progress, kind: string): Progress | null {
  const n = p.dayCounts[kind] ?? 0;
  return n >= DAILY_CAP ? null : { ...p, dayCounts: { ...p.dayCounts, [kind]: n + 1 } };
}

/** A press link (another outlet on the same story) opened from a story, once per story. */
export function recordPress(prev: Progress, e: { id: number; now: number }): Outcome {
  if (prev.pressIds.includes(e.id)) return none(prev);
  const p = bump(onDay(prev, e.now), "press");
  if (!p) return none(prev);
  return finish(prev, { ...p, press: p.press + 1, pressIds: remember(p.pressIds, e.id) }, 0);
}

/** One thing seen once: an MP's page, an archive day, a tender row on /tenders. */
export function recordItem(prev: Progress, e: { kind: string; id: string; now: number }): Outcome {
  const seen = prev.items[e.kind] ?? { n: 0, ids: [] };
  if (seen.ids.includes(e.id)) return none(prev);
  const p = bump(onDay(prev, e.now), e.kind);
  if (!p) return none(prev);
  const ids = [...seen.ids, e.id].slice(-ID_MEMORY);
  return finish(prev, { ...p, items: { ...p.items, [e.kind]: { n: seen.n + 1, ids } } }, 0);
}

/** Section pages counted by distinct days read (the badges that follow money and the state). */
const SECTION_PATHS: [RegExp, string][] = [
  [/^\/budget$/, "budget"],
  [/^\/prices$/, "prices"],
  [/^\/tenders$/, "tenders"],
  [/^\/tax$/, "tax"],
  [/^\/officials\/companies$/, "soe"],
  [/^\/promises(\/[^/]+)?$/, "promises"],
  [/^\/participate$/, "participate"],
  [/^\/changes$/, "changes"],
  [/^\/glossary$/, "glossary"],
  [/^\/request$/, "request"],
];
/** Pages counted once each: an MP's page, an archive day. */
const ITEM_PATHS: [RegExp, string][] = [
  [/^\/officials\/(\d+)$/, "mp"],
  [/^\/archive\/(\d{4}-\d{2}-\d{2})$/, "archive"],
];

/** What reading this path counts toward, if anything. */
export function pageOf(path: string): { section: string | null; item: { kind: string; id: string } | null } {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const section = SECTION_PATHS.find(([re]) => re.test(clean))?.[1] ?? null;
  for (const [re, kind] of ITEM_PATHS) {
    const m = re.exec(clean);
    if (m) return { section, item: { kind, id: m[1] } };
  }
  return { section, item: null };
}

/** A page read for a while (the page meter decides when). A section counts once per day. */
export function recordPage(prev: Progress, e: { path: string; now: number }): Outcome {
  const { section, item } = pageOf(e.path);
  let out = none(prev);
  if (section) {
    const p = onDay(prev, e.now);
    const s = p.sections[section];
    if (s?.last !== p.day) out = finish(prev, { ...p, sections: { ...p.sections, [section]: { days: (s?.days ?? 0) + 1, last: p.day } } }, 0);
  }
  if (item) {
    const next = recordItem(out.progress, { ...item, now: e.now });
    if (next.progress !== out.progress) out = next;
  }
  return out;
}

/** A fact about this browser that stays true once seen (a follow, push on, the app installed). */
export function recordFlag(prev: Progress, flag: string): Outcome {
  if (prev.flags.includes(flag)) return none(prev);
  return finish(prev, { ...prev, flags: [...prev.flags, flag] }, 0);
}

/** The streak as it stands today: alive if the last counted read was today or yesterday. */
export function liveStreak(p: Progress, now: number): number {
  const today = ubDay(now);
  return p.lastDay === today || p.lastDay === prevDay(today) ? p.streak : 0;
}

/** The last `n` Ulaanbaatar days, oldest first: true on a day of the current streak. */
export function recentDays(p: Progress, now: number, n = 5): boolean[] {
  let day = ubDay(now);
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(p.lastDay !== null && day <= p.lastDay && daysBetween(day, p.lastDay) < p.streak);
    day = prevDay(day);
  }
  return out;
}
