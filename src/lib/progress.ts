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
import { type Streak, ubDay } from "@/lib/read-state";

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
  /** stories carried over from before reader progress existed (importHistory) */
  imported: number;
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
    imported: 0,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const numList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).slice(-ID_MEMORY) : []);
const strList = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length <= 64).slice(0, max) : []);
const record = <T>(v: unknown, max: number, item: (x: unknown) => T | null): Record<string, T> => {
  if (!isObj(v)) return {};
  const out: Record<string, T> = {};
  for (const [k, x] of Object.entries(v).slice(0, max)) {
    const ok = k.length <= 64 ? item(x) : null;
    if (ok !== null) out[k] = ok;
  }
  return out;
};

/**
 * A progress value read from storage or a restore code, field by field: anything of the wrong
 * type falls back to empty, so a broken or hand-made value can never break the page. Null when it
 * is not progress of this version.
 */
export function sanitizeProgress(v: unknown): Progress | null {
  if (!isObj(v) || v.v !== PROGRESS_VERSION || typeof v.xp !== "number") return null;
  const e = emptyProgress();
  return {
    ...e,
    xp: num(v.xp),
    reads: num(v.reads),
    readIds: numList(v.readIds),
    facts: num(v.facts),
    factIds: numList(v.factIds),
    sources: num(v.sources),
    sourceIds: numList(v.sourceIds),
    digests: num(v.digests),
    digestIds: numList(v.digestIds),
    day: day(v.day) ?? "",
    dayReads: num(v.dayReads),
    dayFacts: num(v.dayFacts),
    daySources: num(v.daySources),
    streak: num(v.streak),
    bestStreak: num(v.bestStreak),
    lastDay: day(v.lastDay),
    topics: record(v.topics, 64, (x) => (typeof x === "number" ? num(x) : null)),
    morning: num(v.morning),
    night: num(v.night),
    weekend: num(v.weekend),
    fast: num(v.fast),
    returns: num(v.returns),
    fullDays: num(v.fullDays),
    multi: num(v.multi),
    risky: num(v.risky),
    laws: num(v.laws),
    places: record(v.places, 64, (x) => (typeof x === "number" ? num(x) : null)),
    press: num(v.press),
    pressIds: numList(v.pressIds),
    sections: record(v.sections, 64, (x) => (isObj(x) && day(x.last) ? { days: num(x.days), last: day(x.last)! } : null)),
    items: record(v.items, 16, (x) => (isObj(x) ? { n: num(x.n), ids: strList(x.ids, ID_MEMORY) } : null)),
    dayCounts: record(v.dayCounts, 16, (x) => (typeof x === "number" ? num(x) : null)),
    flags: strList(v.flags, 64),
    badges: record(v.badges, 256, (x) => {
      const days = strList(x, 4).filter((d) => day(d));
      return days.length > 0 ? days : null;
    }),
    unseen: strList(v.unseen, 256),
    imported: num(v.imported),
  };
}

/** The stored value, or a fresh start when it is missing, broken or another version. */
export function parseProgress(raw: string | null | undefined): Progress {
  if (!raw) return emptyProgress();
  try {
    return sanitizeProgress(JSON.parse(raw)) ?? emptyProgress();
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

/**
 * A browser that read here before reader progress existed (the owner, Nov 8 2026: loyal readers
 * must not start at zero). Once per browser: the stories it already marked read (`iltod-read`, up
 * to its last 600) become counted reads with their XP, and so never count again; the daily digest
 * streak (`iltod-streak`) carries over as the streak, and as the best streak even if it has ended.
 */
export function importHistory(prev: Progress, e: { readIds: number[]; digestStreak: Streak | null; now: number }): Outcome {
  if (prev.flags.includes("imported")) return none(prev);
  const fresh = [...new Set(e.readIds)].filter((id) => !prev.readIds.includes(id));
  const today = ubDay(e.now);
  const s = e.digestStreak;
  let { streak, lastDay } = prev;
  if (s && (s.d === today || s.d === prevDay(today))) {
    if (lastDay === null || lastDay < s.d) {
      streak = s.n;
      lastDay = s.d;
    } else if (lastDay === s.d) streak = Math.max(streak, s.n);
    else if (lastDay === today && s.d === prevDay(today)) streak = Math.max(streak, s.n + 1);
  }
  return finish(
    prev,
    {
      ...prev,
      reads: prev.reads + fresh.length,
      readIds: fresh.reduce(remember, prev.readIds),
      streak,
      lastDay,
      bestStreak: Math.max(prev.bestStreak, streak, s?.n ?? 0),
      imported: fresh.length,
      flags: [...prev.flags, "imported"],
    },
    fresh.length * XP.read,
  );
}

/** The streak as it stands today: alive if the last counted read was today or yesterday. */
export function liveStreak(p: Progress, now: number): number {
  const today = ubDay(now);
  return p.lastDay === today || p.lastDay === prevDay(today) ? p.streak : 0;
}

export type DayMark = "read" | "missed" | "today-read" | "today-open" | "future";

/**
 * Five Ulaanbaatar days around today for the streak strip (Reddit's, the owner's pick): two before,
 * today, two after. A past day is "read" when it belongs to the streak that ended on `lastDay`.
 */
export function streakWindow(p: Progress, now: number): { day: string; date: number; mark: DayMark }[] {
  const today = ubDay(now);
  return [-2, -1, 0, 1, 2].map((offset) => {
    const day = new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
    const read = p.lastDay !== null && day <= p.lastDay && daysBetween(day, p.lastDay) < p.streak;
    const mark: DayMark = offset > 0 ? "future" : offset === 0 ? (read ? "today-read" : "today-open") : read ? "read" : "missed";
    return { day, date: Number(day.slice(8)), mark };
  });
}

