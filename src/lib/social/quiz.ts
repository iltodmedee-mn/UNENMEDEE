/**
 * "Өдрийн асуулт": a Discord poll built from one real story whose headline names a ₮ amount. The
 * question is the headline with that amount masked ("Эрчим хүчний салбарт ❓ төсөв баталлаа"), the
 * right answer is the amount, and the three other options are it scaled (÷10, ÷3, ×3), shown in
 * the same format so the format never gives the answer away. The amount must also be one of the
 * story's extracted ₮ amounts (so "тэрбум мод" or "сая ам.доллар" never become a ₮ question). The
 * answer is printed under the poll as a spoiler with the link to the story. Rule-based, no AI.
 */
import { amountValue, formatMntShort } from "@/lib/format";
import { PRODUCTION_URL } from "@/lib/site";

/** Smaller amounts make a dull question. */
export const QUIZ_MIN_AMOUNT = 1e8;
/** Discord's limits: question 300 characters, answer 55. */
const QUESTION_MAX = 300;
const FACTORS = [0.1, 1 / 3, 1, 3];

export interface QuizStory {
  id: number;
  slug: string;
  title: string;
  amounts: string[];
}

export interface Quiz {
  question: string;
  answers: string[];
  correct: number;
  link: string;
}

/** Significant digits of an amount (186.2 тэрбум → 4, 3 их наяд → 1), between 2 and 4. */
export function significantDigits(v: number): number {
  const digits = v.toPrecision(15).replace(/e.*$/, "").replace(".", "").replace(/^0+/, "").replace(/0+$/, "");
  return Math.min(4, Math.max(2, digits.length));
}

/**
 * The wrong options get as many significant digits as the right one, so precision never gives the
 * answer away ("186.2" next to "18.62" and "558.6", not next to "19" and "560").
 */
export function roundLike(v: number, sig: number): number {
  const p = 10 ** (Math.floor(Math.log10(v)) - sig + 1);
  return Math.round(v / p) * p;
}

/** An amount in a headline: the number, an optional unit word with its suffix, an optional ₮ / төгрөг. */
export const TITLE_AMOUNT = /\d[\d\s.,]*\s*(?:их наяд|тэрбум|сая|мянга)[\p{L}-]*(?:\s*(?:₮|төгрөг)[\p{L}-]*)?|\d[\d\s.,]*\s*(?:₮|төгрөг)[\p{L}-]*/giu;

/** The headline with every amount replaced by "❓" ("186.2 тэрбум төгрөгийн" → "❓"). */
export function maskAmounts(title: string): string {
  return title.replace(TITLE_AMOUNT, "❓");
}

/** The ₮ value the headline names, when it is also one of the story's extracted ₮ amounts. */
export function headlineAmount(title: string, amounts: string[]): number | null {
  const named = [...title.matchAll(TITLE_AMOUNT)].map((m) => amountValue(m[0])).filter((v): v is number => v !== null);
  const known = amounts.map(amountValue).filter((v): v is number => v !== null);
  return named.find((v) => known.some((k) => Math.abs(k - v) <= v * 0.005)) ?? null;
}

export function makeQuiz(story: QuizStory, site = PRODUCTION_URL): Quiz | null {
  const value = headlineAmount(story.title, story.amounts);
  if (value === null || value < QUIZ_MIN_AMOUNT) return null;
  const masked = maskAmounts(story.title).replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
  const sig = significantDigits(value);
  const options = FACTORS.map((f) => (f === 1 ? value : roundLike(value * f, sig)));
  const labels = options.map(formatMntShort);
  // Rounding can make two options read the same: then the question would be unfair.
  if (new Set(labels).size !== labels.length) return null;
  // The right answer's position depends on the story, so it is not always the third.
  const shift = story.id % labels.length;
  const answers = labels.map((_, i) => labels[(i + shift) % labels.length]);
  const question = `${masked}. ❓ хэд вэ?`;
  return {
    question: question.length > QUESTION_MAX ? `${question.slice(0, QUESTION_MAX - 1)}…` : question,
    answers,
    correct: answers.indexOf(formatMntShort(value)),
    link: `${site}/article/${story.slug}`,
  };
}
