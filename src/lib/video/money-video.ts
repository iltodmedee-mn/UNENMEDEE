/**
 * "ХҮН БҮРТ ХУВААВАЛ" videos (Reels / Threads, 1080×1920, ~20 s): one fresh story whose headline
 * names a big ₮ amount, divided by everyone living in Mongolia, as a guess. Chosen over other
 * formats (Oct 2026) because it is new every day (the price videos run out until NSO publishes a
 * month), it is about the reader's own scale ("нэг хүнд хэд?", the most personal way to read a
 * budget line), and it ends in a question people answer in the comments and send to a friend,
 * the signals Reels ranks on (watch time, replays, sends).
 *
 * Facts only, the same rules as the site: the amount must be named in the headline AND be one of
 * the story's extracted ₮ amounts (`headlineAmount`, so an AI headline with a wrong unit is never
 * used); the share is plain division by `POPULATION` and is worded as such ("хуваавал"), never
 * "you pay"; the two wrong answers are labelled options; the comparison is the NSO price of an
 * everyday good. The voice says only fixed phrases and numbers as words, never the headline (it
 * is on screen), so it cannot misread a scraped text.
 */
import { formatMntShort, formatNumber } from "@/lib/format";
import { type PricesSnapshot, valueAt } from "@/lib/budget/prices";
import { POPULATION, POPULATION_LABEL } from "@/lib/per-person";
import { headlineAmount } from "@/lib/social/quiz";

import { numberWords } from "./mn-numbers";
import { cap, type QuizOption, type Sentence, SPOKEN } from "./price-video";

/** Below this the share is a few hundred ₮: not a video. */
export const MONEY_VIDEO_MIN = 1e9;
/** Stories the AI ranked below this are notices and ceremonies, not money decisions. */
export const MONEY_MIN_IMPORTANCE = 50;

export interface MoneyStory {
  id: number;
  slug: string;
  /** The headline readers see (reader_title or the source's). */
  title: string;
  amounts: string[];
  sourceName: string;
  /** Ulaanbaatar day, "2026-10-28". */
  day: string;
  topic: string | null;
}

export interface MoneySpec {
  key: string;
  articleId: number;
  series: string;
  headline: string;
  /** "Засгийн газар · 2026.10.28" */
  sub: string;
  amount: number;
  /** "170.1 тэрбум ₮" */
  amountLabel: string;
  share: number;
  /** "≈ 49 700₮" */
  shareLabel: string;
  question: string;
  options: QuizOption[];
  /** What the share buys at today's NSO price (≥ 1.5 units), or null; `text` as on screen. */
  relate: { goodKey: string; count: number; text: string } | null;
  sentences: Sentence[];
  source: string;
  link: string;
  topic: string | null;
}

const NBSP = "\u00a0";

/** 3 significant digits: a share never looks more precise than a division by a census figure. */
export function roundShare(v: number): number {
  if (v <= 0) return 0;
  const p = 10 ** Math.max(0, Math.floor(Math.log10(v)) - 2);
  return Math.round(v / p) * p;
}

const shareLabel = (v: number) => `≈${NBSP}${formatNumber(v).replace(/ /g, NBSP)}₮`;

/**
 * The amount as a person says it: "есөн тэрбум зуун сая", "зуун далан гаруй тэрбум" (from 100
 * тэрбум whole тэрбум, "гаруй" when there is more), "гурван их наяд", "нэг их наяд зуун тэрбум",
 * "нэг сая таван зуун мянга", "дөрвөн зуун мянга". Below 100 тэрбум the words say the same
 * amount as the digits (to the nearest сая / мянга): "1.5 сая" used to be said "хоёр сая" and
 * "0.4 сая" "тэг сая", next to a caption showing the real number.
 */
export function amountWords(v: number): string {
  if (!Number.isFinite(v) || v < 0) throw new RangeError(`amountWords: ${v}`);
  if (v >= 1e12) {
    let t = Math.floor(v / 1e12);
    let rest = Math.round((v - t * 1e12) / 1e9);
    if (rest >= 1000) [t, rest] = [t + 1, 0];
    return rest ? `${numberWords(t)} их наяд ${numberWords(rest)} тэрбум` : `${numberWords(t)} их наяд`;
  }
  if (v >= 1e11) {
    const b = Math.floor(v / 1e9);
    return v - b * 1e9 >= 1e7 ? `${numberWords(b, "nominative")} гаруй тэрбум` : `${numberWords(b)} тэрбум`;
  }
  if (v >= 1e9) {
    let b = Math.floor(v / 1e9);
    let m = Math.round((v - b * 1e9) / 1e6);
    if (m >= 1000) [b, m] = [b + 1, 0];
    return m ? `${numberWords(b)} тэрбум ${numberWords(m)} сая` : `${numberWords(b)} тэрбум`;
  }
  if (v >= 1e6) {
    let m = Math.floor(v / 1e6);
    let k = Math.round((v - m * 1e6) / 1e3);
    if (k >= 1000) [m, k] = [m + 1, 0];
    if (m >= 1000) return amountWords(m * 1e6);
    return k ? `${numberWords(m)} сая ${numberWords(k)} мянга` : `${numberWords(m)} сая`;
  }
  if (v >= 1e3) {
    const k = Math.round(v / 1e3);
    return k >= 1000 ? "нэг сая" : `${numberWords(k)} мянга`;
  }
  return numberWords(Math.round(v));
}

/** Three options: the share and ÷3 / ×3 of it at the same precision, the true one moving with the story. */
export function shareOptions(share: number, position: number): QuizOption[] {
  const wrong = [roundShare(share / 3), roundShare(share * 3)];
  const values = [...wrong];
  values.splice(position % 3, 0, share);
  return values.map((v) => ({ text: shareLabel(v), value: v, correct: v === share }));
}

/**
 * Goods tried for "энэ мөнгөөр", most vivid first: the first that gives 3–99 units wins ("гурав
 * гаруй порц хоол" reads better than "нэг гаруй кило мах"), else the first with at least 1.5.
 */
const RELATE_GOODS = ["beef", "canteen", "petrol", "bread", "egg"] as const;

export function relateTo(share: number, prices: PricesSnapshot | null): { goodKey: string; count: number } | null {
  if (!prices) return null;
  const counts = RELATE_GOODS.map((key) => {
    const good = prices.goods.find((g) => g.key === key);
    const price = good ? valueAt(prices.months, good.ub, prices.latestMonth) : null;
    return { goodKey: key, count: price && price > 0 ? share / price : 0 };
  });
  const pick = counts.find((c) => c.count >= 3 && c.count < 100) ?? counts.find((c) => c.count >= 1.5 && c.count < 100);
  return pick ? { goodKey: pick.goodKey, count: Math.round(pick.count * 10) / 10 } : null;
}

/** "бараг 4 кг" / "3 гаруй порц" / "6 ш": the caption and the spoken words for a count. */
function aboutCount(count: number, unitSay: string, unit: string): { say: string; caption: string } {
  const whole = Math.floor(count);
  const frac = count - whole;
  if (frac >= 0.75) return { say: `бараг ${numberWords(whole + 1)} ${unitSay}`, caption: `бараг${NBSP}${whole + 1}${NBSP}${unit}` };
  if (frac < 0.25) return { say: `${numberWords(whole)} ${unitSay}`, caption: `${whole}${NBSP}${unit}` };
  return { say: `${numberWords(whole, "nominative")} гаруй ${unitSay}`, caption: `${whole}${NBSP}гаруй${NBSP}${unit}` };
}

/**
 * A headline that weighs or contrasts instead of reporting: the particles "ч" / "л" ("өссөн ч …
 * 62% л өссөн"), "ердөө", "гэвч", "харин", "хэдий ч", "зөвхөн", or a charge ("хулгай", "авлига",
 * "шүүмж", "буруутга", "үрэн таран", "дэмий"). Oct 31 2026 the first money video carried "Төсвийн
 * зарлага 9-ээс 43.5 их наяд ₮ болж өссөн ч иргэдийн орлого 62% л өссөн": an opposition MP's
 * argument in parliament, shown without his name as if it were the site's own finding. Such a
 * story stays on the site, where the article says who said it; it never becomes a video.
 */
/**
 * Words that name a charge, a crime or a judgement. A video never puts a person or a body next to
 * one (Nov 2026 audit: "…төгрөгийн хахууль авсан албан тушаалтныг шүүхэд шилжүүллээ" passed the
 * older list). Shared by the money and impact videos.
 */
export const CHARGE = /(хулгай|авлиг|хахуул|завш|мөнгө угаа|баривчл|яллагд|ял оноо|ял шийтг|шийтгүүл|хэрэгт холбогд|шалгагдаж|сэжигт|шүүмж|буруутга|үрэн таран|дэмий|луйвар|хууль бус)/i;

export function weighsOrAccuses(title: string): boolean {
  const t = ` ${title.toLowerCase().replace(/[.,!?;:«»"“”()]/g, " ")} `;
  return /\s(ч|л)\s/.test(t) || /(ердөө|гэвч|харин|хэдий ч|зөвхөн)/.test(t) || CHARGE.test(t);
}

/** The spec for one story, or null when its headline names no big ₮ amount the story also holds. */
export function moneyVideoSpec(story: MoneyStory, prices: PricesSnapshot | null): MoneySpec | null {
  if (weighsOrAccuses(story.title)) return null;
  const amount = headlineAmount(story.title, story.amounts);
  if (amount === null || amount < MONEY_VIDEO_MIN || amount >= 1e15) return null;
  const share = roundShare(amount / POPULATION.count);
  if (share < 100) return null;
  const amountLabel = formatMntShort(amount).replace(/ /g, NBSP);
  const found = relateTo(share, prices);
  let relate: MoneySpec["relate"] = null;

  const sentences: Sentence[] = [
    { scene: "hook", say: `За, шинэ мэдээнээс нэг тоо. ${cap(amountWords(amount))} төгрөг.`, caption: `Шинэ мэдээнд *${amountLabel}*` },
    {
      scene: "quiz",
      say: "Үүнийг Монголын бүх хүнд хуваавал нэг хүнд хэд ногдох бол? Таагаад үз дээ.",
      caption: `${POPULATION_LABEL.replace(" ", NBSP)} хүнд хуваавал 1 хүнд хэд вэ?`,
    },
    { scene: "reveal", say: `Ойролцоогоор ${numberWords(share)} төгрөг!`, caption: `Нэг хүнд *${shareLabel(share)}*` },
  ];
  if (found) {
    const names = SPOKEN[found.goodKey];
    const about = aboutCount(found.count, names.unitSay, names.unit);
    relate = { ...found, text: `${about.caption} ${names.short}` };
    sentences.push({
      scene: "relate",
      say: `Энэ мөнгөөр өнөөдөр ${about.say} ${names.short} авчихна.`,
      caption: `Энэ мөнгөөр *${about.caption}* ${names.short}`,
    });
  }
  sentences.push({ scene: "cta", say: "Энэ мөнгө юунд зарцуулагдах вэ?", caption: "Энэ мөнгө юунд зарцуулагдах вэ?" });

  return {
    key: `money:${story.id}`,
    articleId: story.id,
    series: "ХҮН БҮРТ ХУВААВАЛ",
    headline: story.title.replace(/\s+/g, " ").trim(),
    sub: `${story.sourceName} · ${story.day.replace(/-/g, ".")}`,
    amount,
    amountLabel,
    share,
    shareLabel: shareLabel(share),
    question: `${POPULATION_LABEL} хүнд хуваавал 1 хүнд хэд вэ?`,
    options: shareOptions(share, story.id),
    relate,
    sentences,
    source: `Хуваалт: дүн ÷ ${formatNumber(POPULATION.count)} хүн (ҮСХ, ${POPULATION.year}) · хүн бүр төлнө гэсэн үг биш · Дуу: AI`,
    link: `iltodmedee.mn/article/${story.slug}`,
    topic: story.topic,
  };
}

/** The narration as one text for the voice. */
export function moneyNarration(spec: MoneySpec): string {
  return spec.sentences.map((s) => s.say).join(" ");
}

/**
 * Refuses a spec that could put a wrong number on screen or in the voice: no digits in the
 * narration, every caption number is the amount, the share, the population or the unit count,
 * exactly one option is the share.
 */
export function verifyMoneySpec(spec: MoneySpec): string[] {
  const problems: string[] = [];
  for (const s of spec.sentences) if (/\d/.test(s.say)) problems.push(`digits in the narration: ${s.say}`);
  const allowed = new Set<string>([
    ...(spec.amountLabel.replace(/\u00a0/g, " ").match(/\d[\d.,]*/g) ?? []),
    formatNumber(spec.share),
    POPULATION_LABEL.split(" ")[0],
    "1",
  ]);
  if (spec.relate) for (const n of [Math.floor(spec.relate.count), Math.floor(spec.relate.count) + 1]) allowed.add(String(n));
  for (const s of spec.sentences) {
    for (const m of s.caption.replace(/\u00a0/g, " ").matchAll(/\d[\d.,]*(?: \d{3})*/g)) {
      const n = m[0].trim();
      if (!allowed.has(n)) problems.push(`caption number ${n} is not from the story: ${s.caption}`);
    }
  }
  const right = spec.options.filter((o) => o.correct);
  if (right.length !== 1 || right[0].value !== spec.share) problems.push("the quiz must have exactly one true answer, the share");
  if (new Set(spec.options.map((o) => o.text)).size !== spec.options.length) problems.push("two options read the same");
  if (Math.abs(spec.share - roundShare(spec.amount / POPULATION.count)) > 0) problems.push("share differs from amount / population");
  return problems;
}
