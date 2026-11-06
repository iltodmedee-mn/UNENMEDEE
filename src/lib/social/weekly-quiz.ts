/**
 * "7 хоногийн тест": every Sunday evening a carousel of up to five questions built from the week's
 * own stories (Facebook album, Instagram and Threads carousels), and the answers the next evening
 * as one card. Each question is a story's headline with its ₮ amount hidden ("2027 оноос ❓ ₮
 * хэмнэнэ"); the four options are that amount and three multiples of it at the same precision, in
 * ascending order, the right one at a different place in each question. Rule-based, no AI: the
 * amount must be one the story's text also names (`amounts_mnt`), it must be written as ₮, and
 * headlines that weigh or accuse (`weighsOrAccuses`) never become a question.
 *
 * No engagement asks (Meta demotes them): the posts say where the answers come, never "comment".
 */
import { amountValue, formatMntShort } from "@/lib/format";
import { perPersonLine } from "@/lib/per-person";
import { PRODUCTION_URL } from "@/lib/site";
import { weighsOrAccuses } from "@/lib/video/money-video";

import { hashtags } from "./hashtags";
import { roundLike, significantDigits, TITLE_AMOUNT } from "./quiz";
import { cut, THREADS_MAX, threadsLength } from "./threads";
import { isoWeek, ubDay } from "./weekly";

/** app_settings key holding the newest quiz: the cards and the answer post read it. */
export const WEEKLY_QUIZ_KEY = "weekly_quiz";
export const QUIZ_QUESTIONS = 5;
/** Fewer questions than this and there is no quiz that week. */
export const QUIZ_MIN_QUESTIONS = 3;
/** Smaller amounts make a dull question. */
export const WEEKLY_QUIZ_MIN = 1e7;
/** Sunday from 19:00 Ulaanbaatar (and until 06:00 Monday, for a late run); answers from 19:00 the next day. */
export const QUIZ_HOUR = 19;
/** Answers are not posted later than this after their quiz. */
export const ANSWERS_WITHIN_H = 72;
export const OPTION_LETTERS = ["А", "Б", "В", "Г"] as const;

const UB_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

/** A story the quiz may ask about. `title` is the headline readers saw (reader_title or title). */
export interface QuizCandidate {
  id: number;
  slug: string;
  title: string;
  amounts: string[];
  importance: number | null;
  clusterId: number | null;
  sourceName: string;
  /** The topic's label ("Эдийн засаг"), from the site's own rule (topicFor). */
  topic: string;
  publishedAt: Date;
}

export interface WeeklyQuestion {
  articleId: number;
  slug: string;
  /** The headline around the hidden amount: before + [?] + after (after starts with "₮" / "төгрөг…"). */
  before: string;
  after: string;
  /** The whole headline, for the answers. */
  title: string;
  /** "1.3 их наяд ₮". */
  answer: string;
  /** Four labels without the ₮ sign ("430 тэрбум"), ascending. */
  options: string[];
  correct: number;
  source: string;
  topic: string;
  /** "11.03", the Ulaanbaatar day it was published. */
  day: string;
}

export interface WeeklyQuiz {
  /** ISO week (yyyyww) of the Sunday it is posted, the social_posts ref id. */
  week: number;
  /** "11.02–11.08". */
  label: string;
  createdAt: string;
  questions: WeeklyQuestion[];
}

const near = (a: number, b: number) => Math.abs(a - b) <= b * 0.005;
const pad = (n: number) => String(n).padStart(2, "0");
/** "11.03" in Ulaanbaatar time. */
export function ubDayLabel(d: Date): string {
  const u = new Date(d.getTime() + UB_MS);
  return `${pad(u.getUTCMonth() + 1)}.${pad(u.getUTCDate())}`;
}

/** The number + unit part of an amount and the ₮ word after it ("90 тэрбум" + " ₮-ээр"). */
const CURRENCY_TAIL = /^([\s\S]*?)(\s*(?:₮|төгрөг)[\p{L}-]*)$/u;

/**
 * The headline with its ₮ amount hidden: the amount must also be one of the story's extracted
 * amounts, be written with ₮ / төгрөг (so "164 сая кВт.ц" and "тэрбум мод" never qualify), and
 * not appear a second time in the headline. The ₮ word stays, so the sentence still reads.
 */
export function maskAnswer(title: string, amounts: string[]): { before: string; after: string; value: number } | null {
  const known = amounts.map(amountValue).filter((v): v is number => v !== null);
  for (const m of title.matchAll(TITLE_AMOUNT)) {
    const value = amountValue(m[0]);
    if (value === null || !known.some((k) => near(k, value))) continue;
    const parts = CURRENCY_TAIL.exec(m[0]);
    if (!parts) continue;
    const start = m.index ?? 0;
    const before = title.slice(0, start);
    const after = parts[2].trimStart() + title.slice(start + m[0].length);
    const rest = `${before} ${after}`;
    if ([...rest.matchAll(TITLE_AMOUNT)].some((o) => { const v = amountValue(o[0]); return v !== null && near(v, value); })) return null;
    return { before: before.trimEnd(), after, value };
  }
  return null;
}

/** The right answer is at `position` (0–3); the others are multiples of it, all ascending. */
const SETS = [
  [1, 3, 10, 30],
  [1 / 3, 1, 3, 10],
  [0.1, 1 / 3, 1, 3],
  [1 / 30, 0.1, 1 / 3, 1],
] as const;

/** "430 тэрбум": the card's label, without the ₮ sign. */
export const optionLabel = (v: number) => formatMntShort(v).replace(/\s*₮$/, "");

/**
 * Four options with the right one at `position`, rounded to its precision so the digits never give
 * it away; null when two would read the same.
 */
export function quizOptions(value: number, position: number): string[] | null {
  const sig = significantDigits(value);
  const labels = SETS[position].map((f) => optionLabel(f === 1 ? value : roundLike(value * f, sig)));
  return new Set(labels).size === labels.length ? labels : null;
}

/**
 * Up to `max` questions from the week's stories: the most important first, one per cluster, never
 * the same amount twice. Each question puts its right answer one place further than the last
 * (unless rounding makes two options read the same), so the letters differ from one to the next.
 */
export function pickQuestions(stories: QuizCandidate[], max = QUIZ_QUESTIONS): WeeklyQuestion[] {
  const sorted = [...stories].sort((a, b) => (b.importance ?? -1) - (a.importance ?? -1) || b.publishedAt.getTime() - a.publishedAt.getTime());
  const out: WeeklyQuestion[] = [];
  const clusters = new Set<number>();
  const values: number[] = [];
  let seed: number | null = null;
  for (const s of sorted) {
    if (out.length >= max) break;
    if (s.clusterId !== null && clusters.has(s.clusterId)) continue;
    if (weighsOrAccuses(s.title)) continue;
    const mask = maskAnswer(s.title, s.amounts);
    if (!mask || mask.value < WEEKLY_QUIZ_MIN || mask.value >= 1e15 || values.some((v) => near(v, mask.value))) continue;
    // The first question's story picks where the run of letters starts; each next one moves on.
    const first = ((seed ?? s.id) + out.length) % SETS.length;
    let options: string[] | null = null;
    let correct = first;
    for (let k = 0; k < SETS.length && !options; k++) {
      correct = (first + k) % SETS.length;
      options = quizOptions(mask.value, correct);
    }
    if (!options) continue;
    out.push({
      articleId: s.id,
      slug: s.slug,
      before: mask.before,
      after: mask.after,
      title: s.title,
      answer: formatMntShort(mask.value),
      options,
      correct,
      source: s.sourceName,
      topic: s.topic,
      day: ubDayLabel(s.publishedAt),
    });
    values.push(mask.value);
    seed ??= s.id;
    if (s.clusterId !== null) clusters.add(s.clusterId);
  }
  return out;
}

/** The week whose quiz is due: the Sunday (Ulaanbaatar) the quiz belongs to, also for a run after midnight. */
export function quizWeek(now: Date): number {
  return isoWeek(ubDay(new Date(now.getTime() - 6 * 3_600_000)));
}

/** Sunday 19:00 – Monday 06:00 Ulaanbaatar. */
export function isQuizTime(now: Date): boolean {
  const u = new Date(now.getTime() + UB_MS);
  const dow = u.getUTCDay();
  const h = u.getUTCHours();
  return (dow === 0 && h >= QUIZ_HOUR) || (dow === 1 && h < 6);
}

/** "Хариулт маргааш 19:00": from 19:00 on a later Ulaanbaatar day than the quiz post, within 72 h of it. */
export function answersDue(now: Date, postedAt: Date): boolean {
  const u = new Date(now.getTime() + UB_MS);
  return ubDay(now).getTime() > ubDay(postedAt).getTime() && u.getUTCHours() >= QUIZ_HOUR && now.getTime() - postedAt.getTime() < ANSWERS_WITHIN_H * 3_600_000;
}

/** The quiz from the 7 days before `now`, or null with fewer than QUIZ_MIN_QUESTIONS questions. */
export function buildWeeklyQuiz(stories: QuizCandidate[], now: Date): WeeklyQuiz | null {
  const questions = pickQuestions(stories);
  if (questions.length < QUIZ_MIN_QUESTIONS) return null;
  return { week: quizWeek(now), label: `${ubDayLabel(new Date(now.getTime() - 6 * DAY_MS))}–${ubDayLabel(now)}`, createdAt: now.toISOString(), questions };
}

/** The stored quiz, or null when it is missing or not in the shape the cards expect. */
export function parseWeeklyQuiz(raw: string | null | undefined): WeeklyQuiz | null {
  if (!raw) return null;
  try {
    const q = JSON.parse(raw) as WeeklyQuiz;
    const ok =
      Number.isInteger(q.week) &&
      typeof q.label === "string" &&
      typeof q.createdAt === "string" &&
      Array.isArray(q.questions) &&
      q.questions.length >= 1 &&
      q.questions.length <= QUIZ_QUESTIONS &&
      q.questions.every((x) => typeof x.before === "string" && typeof x.after === "string" && typeof x.title === "string" && typeof x.answer === "string" && Array.isArray(x.options) && x.options.length === 4 && Number.isInteger(x.correct) && x.correct >= 0 && x.correct < 4);
    return ok ? q : null;
  } catch {
    return null;
  }
}

/** The carousel: cover, one card per question, the closing card. */
export function quizImageUrls(q: WeeklyQuiz, site = PRODUCTION_URL): string[] {
  return Array.from({ length: q.questions.length + 2 }, (_, n) => `${site}/quiz-image?w=${q.week}&n=${n}`);
}

export function answersImageUrl(q: WeeklyQuiz, site = PRODUCTION_URL): string {
  return `${site}/quiz-image?w=${q.week}&n=a`;
}

/** "Гэр бүлийн гараашийг татвараас чөлөөлж, 2027 оноос ❓ ₮ хэмнэнэ". */
export const maskedText = (x: WeeklyQuestion) => `${x.before} ❓ ${x.after}`.replace(/\s+/g, " ").trim();

const optionLine = (x: WeeklyQuestion) => x.options.map((o, i) => `${OPTION_LETTERS[i]}) ${o}`).join(" · ");

/** Facebook (link clickable) and Instagram (link in bio) captions for the quiz carousel. */
export function quizCaption(q: WeeklyQuiz, platform: "facebook" | "instagram", site = PRODUCTION_URL): string {
  const lines = [
    `🧠 7 ХОНОГИЙН ТЕСТ · ${q.label}`,
    "",
    `Энэ долоо хоногийн албан мэдээнээс ${q.questions.length} тоо. Зургийг гүйлгээд таагаарай, хариулт маргааш 19:00-д.`,
    "",
    ...q.questions.flatMap((x, i) => [`${i + 1}. ${maskedText(x)}`, optionLine(x), ""]),
    platform === "facebook" ? `Бүх мэдээ эх сурвалжтай нь 👉 ${site}` : "Бүх мэдээ эх сурвалжтай нь: iltodmedee.mn (холбоос bio-д)",
    "",
    hashtags(platform),
  ];
  const text = lines.join("\n");
  return text.length <= 2200 ? text : `${text.slice(0, 2199)}…`;
}

export function quizThreadsText(q: WeeklyQuiz, site = PRODUCTION_URL): string {
  const tail = `\n\n👉 ${site}\n${hashtags("threads")}`;
  const head = `🧠 7 хоногийн тест · ${q.label}\n\nЭнэ долоо хоногийн албан мэдээнээс ${q.questions.length} тоо. Гүйлгээд таагаарай, хариулт маргааш 19:00-д.`;
  return cut(head, THREADS_MAX - threadsLength(tail)) + tail;
}

/** The answers, each with its story, the per-person share for amounts from 1 тэрбум and (Facebook) the link. */
export function answersCaption(q: WeeklyQuiz, platform: "facebook" | "instagram", site = PRODUCTION_URL): string {
  const lines = [`✅ 7 ХОНОГИЙН ТЕСТИЙН ХАРИУЛТ · ${q.label}`, ""];
  let shared = false;
  q.questions.forEach((x, i) => {
    const share = perPersonLine([x.answer]);
    shared ||= share !== null;
    lines.push(`${i + 1}. ${OPTION_LETTERS[x.correct]}) ${x.answer}`, x.title, ...(share ? [share] : []), ...(platform === "facebook" ? [`👉 ${site}/article/${x.slug}`] : []), "");
  });
  if (shared) lines.push("👤 = энгийн хуваалт (ҮСХ-ны хүн ам), хүн бүр төлнө гэсэн үг биш.", "");
  if (platform === "instagram") lines.push("Эх мэдээ бүр: iltodmedee.mn (холбоос bio-д)", "");
  lines.push(hashtags(platform));
  const text = lines.join("\n");
  return text.length <= 2200 ? text : `${text.slice(0, 2199)}…`;
}

export function answersThreadsText(q: WeeklyQuiz, site = PRODUCTION_URL): string {
  const tail = `\n\nЭх мэдээ 👉 ${site}\n${hashtags("threads")}`;
  const body = [`✅ 7 хоногийн тестийн хариулт · ${q.label}`, "", ...q.questions.map((x, i) => `${i + 1}-${OPTION_LETTERS[x.correct]}: ${x.answer}`)].join("\n");
  return cut(body, THREADS_MAX - threadsLength(tail)) + tail;
}
