/**
 * Badges (GLOSSARY.md: badge, tier): the catalog, which tiers a reader has reached, and the award
 * step that stamps new ones with their date and a small XP bonus. Pure functions over Progress
 * (src/lib/progress.ts), unit-tested (tests/badges.test.ts).
 *
 * Hard on purpose (the owner, Nov 2026): the «Ил тод» tier of a habit takes about a year of it.
 * Badge ids are stored in the reader's browser: append new badges, never rename or reuse an id.
 * This module is loaded lazily (after a progress event, on the dial, on /amjilt), never with the page.
 */
import { DISTRICTS, PLACES } from "@/lib/places";
import { levelOf, type LevelInfo, type Progress } from "@/lib/progress";
import { ubDay } from "@/lib/read-state";
import { TOPICS } from "@/lib/topics";

export type Collection = "start" | "streak" | "read" | "check" | "money" | "state" | "habit" | "explore" | "secret";
export type Shape = "circle" | "hex" | "shield" | "diamond" | "star";
export type TierKey = "b" | "s" | "g" | "p";
export type Glyph =
  | "eye" | "mag" | "doc" | "coin" | "scale" | "flame" | "compass" | "scroll" | "build" | "mega" | "mail" | "pin" | "book"
  | "cal" | "sun" | "moon" | "lock" | "two" | "tag" | "bell" | "phone" | "bolt" | "star" | "back" | "warn" | "news"
  | "diff" | "receipt" | "flag" | "spark" | "target" | "ember" | "campfire" | "hearth" | "torch" | "wildfire" | "volcano"
  | "eternal" | "crown";

export const COLLECTIONS: { key: Collection; label: string; shape: Shape }[] = [
  { key: "start", label: "Эхлэл", shape: "circle" },
  { key: "streak", label: "Дараалсан өдөр", shape: "circle" },
  { key: "read", label: "Унших", shape: "circle" },
  { key: "check", label: "Шалгах", shape: "hex" },
  { key: "money", label: "Мөнгө", shape: "shield" },
  { key: "state", label: "Төр ба иргэн", shape: "diamond" },
  { key: "habit", label: "Зуршил", shape: "star" },
  { key: "explore", label: "Нээлт", shape: "circle" },
  { key: "secret", label: "Нууц", shape: "hex" },
];

export const TIER_NAMES: Record<TierKey, string> = { b: "Хүрэл", s: "Мөнгө", g: "Алт", p: "Ил тод" };
const FOUR: TierKey[] = ["b", "s", "g", "p"];
/** XP for reaching each tier of a four-tier badge; kept small so badges never race the levels. */
export const TIER_XP: Record<TierKey, number> = { b: 25, s: 50, g: 100, p: 250 };
const START_XP = 25;
const SECRET_XP = 100;

interface Step {
  need: number;
  /** what this step counts, when it is not the badge's own value */
  of?: (p: Progress) => number;
  /** what this step asks, when it differs from the badge's `how` */
  how?: string;
}

export interface Badge {
  /** stored in the reader's browser: never renamed or reused */
  id: string;
  name: string;
  collection: Collection;
  glyph: Glyph;
  /** how to earn it, shown under the badge (a secret badge shows it only once earned) */
  how: string;
  /** what one step of progress is: "мэдээ", "өдөр" */
  unit: string;
  value: (p: Progress) => number;
  steps: Step[];
  /** the look and XP of a one-step badge on a ladder (the streak milestones) */
  tier?: TierKey;
}

const section = (key: string) => (p: Progress) => p.sections[key]?.days ?? 0;
const items = (kind: string) => (p: Progress) => p.items[kind]?.n ?? 0;
const flag = (name: string) => (p: Progress) => (p.flags.includes(name) ? 1 : 0);
const tiers = (...needs: number[]): Step[] => needs.map((need) => ({ need }));
const DAYS_LADDER = tiers(3, 10, 30, 100);

/** The streak milestones: days, name, look. */
export const STREAK_MILESTONES: { days: number; name: string; glyph: Glyph; tier: TierKey }[] = [
  { days: 3, name: "Оч", glyph: "ember", tier: "b" },
  { days: 7, name: "Гал", glyph: "flame", tier: "b" },
  { days: 14, name: "Түүдэг", glyph: "campfire", tier: "s" },
  { days: 30, name: "Голомт", glyph: "hearth", tier: "s" },
  { days: 60, name: "Бамбар", glyph: "torch", tier: "g" },
  { days: 100, name: "Түймэр", glyph: "wildfire", tier: "g" },
  { days: 200, name: "Галт уул", glyph: "volcano", tier: "g" },
  { days: 365, name: "Мөнхийн гал", glyph: "eternal", tier: "p" },
  { days: 500, name: "Нар", glyph: "sun", tier: "p" },
  { days: 1_000, name: "Домог", glyph: "crown", tier: "p" },
];

function streakLadder(): Badge[] {
  return STREAK_MILESTONES.map((m) => ({
    id: `streak-${m.days}`,
    name: m.name,
    collection: "streak" as const,
    glyph: m.glyph,
    how: `${m.days} өдөр дараалан уншина`,
    unit: "өдөр",
    value: (p: Progress) => p.bestStreak,
    steps: tiers(m.days),
    tier: m.tier,
  }));
}

const READ_TOPICS = TOPICS.map((t) => t.key).filter((k) => k !== "other");
const AIMAGS = PLACES.filter((p) => p.kind === "aimag").map((p) => p.slug);
const DISTRICT_SLUGS = DISTRICTS.map((d) => d.slug);
const topicsRead = (p: Progress, min: number) => READ_TOPICS.filter((k) => (p.topics[k] ?? 0) >= min).length;
const aimagsRead = (p: Progress) => AIMAGS.filter((s) => (p.places[s] ?? 0) > 0).length;
const aimagsAndDistricts = (p: Progress) => aimagsRead(p) + DISTRICT_SLUGS.filter((s) => (p.places[s] ?? 0) > 0).length;

export const BADGES: Badge[] = [
  // Эхлэл: one step each, the first things a new reader can do.
  { id: "first-read", name: "Анхны алхам", collection: "start", glyph: "eye", how: "Анхны мэдээгээ бүтэн уншина", unit: "мэдээ", value: (p) => p.reads, steps: tiers(1) },
  { id: "first-digest", name: "Анхны тойм", collection: "start", glyph: "cal", how: "Онцлох тоймыг эхнээс нь дуустал уншина", unit: "тойм", value: (p) => p.digests, steps: tiers(1) },
  { id: "follow-topic", name: "Сэдэв сонгосон", collection: "start", glyph: "tag", how: "Нэг сэдэв эсвэл аймаг дагана", unit: "", value: flag("follow-topic"), steps: tiers(1) },
  { id: "follow-mp", name: "Гишүүнээ дагасан", collection: "start", glyph: "build", how: "УИХ-ын нэг гишүүн дагана", unit: "", value: flag("follow-mp"), steps: tiers(1) },
  { id: "push-on", name: "Хонх асаасан", collection: "start", glyph: "bell", how: "Шинэ мэдээний мэдэгдэл асаана", unit: "", value: flag("push-on"), steps: tiers(1) },
  { id: "app", name: "Утсандаа суулгасан", collection: "start", glyph: "phone", how: "Сайтыг утсандаа апп болгож суулгана", unit: "", value: flag("app"), steps: tiers(1) },

  // Унших
  { id: "reader", name: "Уншигч", collection: "read", glyph: "eye", how: "Мэдээ бүтэн уншина", unit: "мэдээ", value: (p) => p.reads, steps: tiers(50, 300, 1_500, 5_000) },
  { id: "digests", name: "Тойм дуусгагч", collection: "read", glyph: "cal", how: "Онцлох тоймыг дуустал уншина", unit: "тойм", value: (p) => p.digests, steps: tiers(10, 60, 250, 730) },
  { id: "full-days", name: "Номын хорхой", collection: "read", glyph: "book", how: "Нэг өдөрт 10 мэдээ уншина", unit: "өдөр", value: (p) => p.fullDays, steps: tiers(5, 30, 100, 300) },

  // Шалгах
  { id: "facts", name: "Баримт шалгагч", collection: "check", glyph: "mag", how: "«Баримт ба пи-ар» хэсгийг уншина", unit: "мэдээ", value: (p) => p.facts, steps: tiers(25, 150, 600, 2_000) },
  { id: "sources", name: "Эх сурвалж руу", collection: "check", glyph: "doc", how: "Мэдээний анхны төрийн сайтыг нээнэ", unit: "мэдээ", value: (p) => p.sources, steps: tiers(10, 75, 300, 1_000) },
  { id: "multi", name: "Олон талаас", collection: "check", glyph: "two", how: "Олон сайт бичсэн мэдээг уншина", unit: "мэдээ", value: (p) => p.multi, steps: tiers(10, 75, 300, 1_000) },
  { id: "press", name: "Хэвлэлтэй харьцуулагч", collection: "check", glyph: "news", how: "Мэдээний доорх хэвлэлийн холбоосыг нээнэ", unit: "мэдээ", value: (p) => p.press, steps: tiers(5, 30, 120, 400) },
  { id: "changes", name: "Өөрчлөлт мөрдөгч", collection: "check", glyph: "diff", how: "«Өөрчлөлт» хуудсыг уншина", unit: "өдөр", value: section("changes"), steps: DAYS_LADDER },

  // Мөнгө
  { id: "tenders", name: "Тендерийн нүд", collection: "money", glyph: "coin", how: "«Тендер» хуудасны гэрээг нэг бүрчлэн харна", unit: "тендер", value: items("tender"), steps: tiers(25, 150, 500, 2_000) },
  { id: "budget", name: "Төсвийн мөрдөгч", collection: "money", glyph: "coin", how: "«Төсөв» хуудсыг уншина", unit: "өдөр", value: section("budget"), steps: DAYS_LADDER },
  { id: "prices", name: "Үнийн анчин", collection: "money", glyph: "tag", how: "«Үнэ» хуудсыг уншина", unit: "өдөр", value: section("prices"), steps: DAYS_LADDER },
  { id: "soe", name: "ТӨК шинжээч", collection: "money", glyph: "build", how: "«Төрийн компани» хуудсыг уншина", unit: "өдөр", value: section("soe"), steps: DAYS_LADDER },
  { id: "risk", name: "Эрсдэл анзаарагч", collection: "money", glyph: "warn", how: "Өндөр эрсдэлтэй гэж үнэлсэн мэдээг уншина", unit: "мэдээ", value: (p) => p.risky, steps: tiers(5, 25, 100, 300) },
  { id: "tax", name: "Миний татвар", collection: "money", glyph: "receipt", how: "«Миний татвар» тооцоолуурыг ашиглана", unit: "", value: section("tax"), steps: tiers(1) },

  // Төр ба иргэн
  { id: "laws", name: "Хууль уншигч", collection: "state", glyph: "scale", how: "Шинэ хууль, тогтоолыг бүтэн уншина", unit: "акт", value: (p) => p.laws, steps: tiers(5, 25, 100, 300) },
  { id: "mps", name: "УИХ-ын хянагч", collection: "state", glyph: "build", how: "УИХ-ын гишүүдийн хуудсыг нэг бүрчлэн үзнэ", unit: "гишүүн", value: items("mp"), steps: tiers(5, 25, 76, 126) },
  { id: "promises", name: "Амлалт хянагч", collection: "state", glyph: "target", how: "«Амлалт» хуудсыг уншина", unit: "өдөр", value: section("promises"), steps: DAYS_LADDER },
  { id: "participate", name: "Иргэний дуу", collection: "state", glyph: "mega", how: "«Оролцох» хуудсыг уншина", unit: "өдөр", value: section("participate"), steps: DAYS_LADDER },
  { id: "glossary", name: "Толь бичиг", collection: "state", glyph: "book", how: "«Нэр томьёо» хуудсыг уншина", unit: "өдөр", value: section("glossary"), steps: DAYS_LADDER },
  { id: "request", name: "Мэдээлэл хүсэгч", collection: "state", glyph: "mail", how: "Төрөөс мэдээлэл хүсэх захидал бичнэ", unit: "", value: flag("request"), steps: tiers(1) },

  // Дараалсан өдөр: one badge per milestone, each with its own name (Reddit's streak ladder, the
  // owner's pick). Replaced the four-tier "streak" badge (7/30/100/365, retired Nov 8 2026: its id
  // is never reused); those four days are still milestones here.
  ...streakLadder(),

  // Зуршил
  { id: "morning", name: "Өглөөний уншигч", collection: "habit", glyph: "sun", how: "Өглөө 08:00-аас өмнө уншина", unit: "мэдээ", value: (p) => p.morning, steps: tiers(10, 50, 200, 500) },
  { id: "night", name: "Шөнийн шувуу", collection: "habit", glyph: "moon", how: "Шөнө 23:00-аас хойш уншина", unit: "мэдээ", value: (p) => p.night, steps: tiers(10, 50, 200, 500) },
  { id: "weekend", name: "Амралтын өдөр", collection: "habit", glyph: "cal", how: "Бямба, ням гарагт уншина", unit: "мэдээ", value: (p) => p.weekend, steps: tiers(20, 100, 300, 800) },
  { id: "return", name: "Буцаж ирсэн", collection: "habit", glyph: "back", how: "7 хоногоос дээш завсарласны дараа дахин уншина", unit: "", value: (p) => p.returns, steps: tiers(1) },

  // Нээлт
  {
    id: "topics",
    name: "Олон талт",
    collection: "explore",
    glyph: "compass",
    how: "Өөр өөр сэдвийн мэдээ уншина",
    unit: "сэдэв",
    value: (p) => topicsRead(p, 1),
    steps: [{ need: 5 }, { need: 10 }, { need: READ_TOPICS.length }, { need: READ_TOPICS.length, of: (p) => topicsRead(p, 50), how: "Сэдэв бүрээс 50 мэдээ уншина" }],
  },
  {
    id: "places",
    name: "Аймаг судлаач",
    collection: "explore",
    glyph: "pin",
    how: "Өөр өөр аймгийн мэдээ уншина",
    unit: "аймаг",
    value: aimagsRead,
    steps: [{ need: 5 }, { need: 12 }, { need: AIMAGS.length }, { need: AIMAGS.length + DISTRICT_SLUGS.length, of: aimagsAndDistricts, how: "21 аймаг, нийслэлийн 9 дүүргийн мэдээ уншина" }],
  },
  { id: "archive", name: "Архивч", collection: "explore", glyph: "scroll", how: "Архивын өөр өөр өдрийг нээнэ", unit: "өдөр", value: items("archive"), steps: tiers(5, 25, 100, 365) },

  // Нууц: the condition stays hidden until earned.
  { id: "fast", name: "Шуурхай", collection: "secret", glyph: "bolt", how: "Мэдээ гарснаас хойш 10 минутад уншсан", unit: "", value: (p) => p.fast, steps: tiers(1) },
  { id: "thousand", name: "Мянгат", collection: "secret", glyph: "star", how: "1 000 дахь мэдээгээ уншсан", unit: "", value: (p) => p.reads, steps: tiers(1_000) },
  { id: "naadam", name: "Наадам", collection: "secret", glyph: "flag", how: "Наадмын өдөр мэдээ уншсан", unit: "", value: flag("naadam"), steps: tiers(1) },
  { id: "new-year", name: "Шинэ он", collection: "secret", glyph: "spark", how: "1-р сарын 1-нд мэдээ уншсан", unit: "", value: flag("new-year"), steps: tiers(1) },
];

export const isSecret = (b: Badge) => b.collection === "secret";

/** The tier look of step `i` of a badge: four-step badges climb хүрэл → ил тод. */
export function tierOf(b: Badge, i: number): TierKey {
  if (b.tier) return b.tier;
  if (b.steps.length === 4) return FOUR[i];
  return isSecret(b) ? "p" : "b";
}

function stepXp(b: Badge, i: number): number {
  if (b.tier) return TIER_XP[b.tier];
  if (b.steps.length === 4) return TIER_XP[FOUR[i]];
  return isSecret(b) ? SECRET_XP : START_XP;
}

const have = (b: Badge, step: Step, p: Progress) => (step.of ?? b.value)(p);

/** Steps reached now (a prefix: a later step never counts before an earlier one). */
function reachedNow(b: Badge, p: Progress): number {
  let i = 0;
  while (i < b.steps.length && have(b, b.steps[i], p) >= b.steps[i].need) i++;
  return i;
}

export interface BadgeState {
  badge: Badge;
  /** tiers earned so far (never goes down) */
  earned: number;
  /** the Ulaanbaatar day each earned tier was reached */
  dates: string[];
  /** the next tier to reach, or null when every tier is earned */
  next: { tier: TierKey; have: number; need: number; how: string } | null;
  /** 0..1 toward `next` */
  fraction: number;
}

export function badgeState(b: Badge, p: Progress): BadgeState {
  const dates = p.badges[b.id] ?? [];
  const earned = Math.min(b.steps.length, dates.length);
  const step = b.steps[earned];
  if (!step) return { badge: b, earned, dates, next: null, fraction: 1 };
  const value = Math.min(have(b, step, p), step.need);
  return { badge: b, earned, dates, next: { tier: tierOf(b, earned), have: value, need: step.need, how: step.how ?? b.how }, fraction: value / step.need };
}

export const allBadges = (p: Progress): BadgeState[] => BADGES.map((b) => badgeState(b, p));

/**
 * The badge to show on the dial: the open (not secret) badge closest to its next tier; for a new
 * reader, the first Эхлэл badge. Null when everything visible is earned.
 */
export function nextBadge(p: Progress): BadgeState | null {
  let best: BadgeState | null = null;
  for (const s of allBadges(p)) {
    if (!s.next || isSecret(s.badge)) continue;
    if (!best || s.fraction > best.fraction) best = s;
  }
  return best;
}

export interface Award {
  progress: Progress;
  /** bonus XP the new tiers earned */
  gained: number;
  levelUp: LevelInfo | null;
  /** tiers reached by this award, in catalog order */
  earned: { badge: Badge; tier: TierKey }[];
}

/** Stamps every newly reached tier with today's date and its XP bonus. Earned tiers never go away. */
export function award(p: Progress, now: number): Award {
  const today = ubDay(now);
  const earned: Award["earned"] = [];
  let gained = 0;
  let badges = p.badges;
  for (const b of BADGES) {
    const had = badges[b.id]?.length ?? 0;
    const reached = reachedNow(b, p);
    if (reached <= had) continue;
    const dates = [...(badges[b.id] ?? [])];
    for (let i = had; i < reached; i++) {
      dates.push(today);
      gained += stepXp(b, i);
      earned.push({ badge: b, tier: tierOf(b, i) });
    }
    badges = { ...badges, [b.id]: dates };
  }
  if (earned.length === 0) return { progress: p, gained: 0, levelUp: null, earned };
  const unseen = [...new Set([...p.unseen, ...earned.map((e) => e.badge.id)])];
  const progress = { ...p, badges, unseen, xp: p.xp + gained };
  const was = levelOf(p.xp);
  const is = levelOf(progress.xp);
  return { progress, gained, levelUp: is.level > was.level ? is : null, earned };
}

/** Earned tiers across all badges, and all tiers there are. */
export function tierCount(p: Progress): { earned: number; total: number } {
  let earned = 0;
  let total = 0;
  for (const b of BADGES) {
    total += b.steps.length;
    earned += Math.min(b.steps.length, p.badges[b.id]?.length ?? 0);
  }
  return { earned, total };
}
