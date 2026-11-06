/**
 * "Таагаарай!" price videos (Reels / Threads, 1080×1920, ~22 s) for young viewers, built on what
 * short-video guidance agrees on: the hook is on screen in the first 2–3 seconds (many watch with
 * the sound off), a curiosity gap the viewer answers in their head (a 3-2-1 guess), a payoff every
 * few seconds, a relatable comparison instead of a statistic, and an ending that asks for a comment
 * and a share (Instagram ranks watch time and sends). One everyday good from the NSO price snapshot
 * (`prices_nso`): its Улаанбаатар price then (the oldest of 15/10/5 years back) and now, what
 * today's money bought then, the change in a year. Every number comes from the snapshot; the
 * narration gets them as words (mn-numbers.ts), the captions as digits, and `verifySpec` refuses a
 * spec that could show a number the snapshot does not hold. The two wrong answers of the guess are
 * marked as options, never shown as data.
 */
import { formatNumber } from "@/lib/format";
import { agoPoints, type GoodSeries, type PricesSnapshot, valueAt } from "@/lib/budget/prices";

import { numberWords } from "./mn-numbers";

/**
 * "hook" opens the money videos (money-video.ts) before their guess and the impact videos
 * (impact-video.ts); "who" / "when" / "action" (and "change") are the impact video's cards.
 */
export type Scene = "hook" | "quiz" | "reveal" | "now" | "relate" | "change" | "year" | "cta" | "who" | "when" | "action";

export interface Sentence {
  scene: Scene;
  /** What the voice says: words only, no digits. */
  say: string;
  /** The caption on screen, word by word; `*…*` marks a highlighted number (no HTML). */
  caption: string;
}

export interface QuizOption {
  text: string;
  value: number;
  correct: boolean;
}

export interface VideoSpec {
  /** Unique per good and data month: one video each time NSO publishes a month. */
  key: string;
  goodKey: string;
  /** Short sticker over the question: "ҮНЭ ТААГААРАЙ". */
  series: string;
  title: string;
  /** "Улаанбаатар · сарын дундаж үнэ" */
  sub: string;
  question: string;
  options: QuizOption[];
  months: string[];
  series_: (number | null)[];
  /** Index of the old point and of the latest month in `months`. */
  from: number;
  to: number;
  /** What today's price of one unit bought then (now / then), e.g. 6.6, and its unit. */
  units: { count: number; unit: string } | null;
  sentences: Sentence[];
  source: string;
  /** The page with the whole series, shown at the end and linked in the posts. */
  link: string;
  then: { month: string; value: number; years: number };
  now: { month: string; value: number };
  yearPct: number | null;
}

interface Names {
  /** "1 кг үхрийн мах" */
  caption: string;
  /** "нэг кило үхрийн мах" */
  say: string;
  title: string;
  /** Short spoken noun: "мах", "бензин" ("Энэ мөнгөөр тэр үед … кило мах авах байсан"). */
  short: string;
  /** Spoken unit ("кило") and the caption unit ("кг"). */
  unitSay: string;
  unit: string;
  note: string;
}

/** How each good is named on screen and aloud. */
export const SPOKEN: Record<string, Names> = {
  beef: { caption: "1 кг үхрийн мах", say: "нэг кило үхрийн мах", title: "Үхрийн мах", short: "мах", unitSay: "кило", unit: "кг", note: "ястай" },
  mutton: { caption: "1 кг хонины мах", say: "нэг кило хонины мах", title: "Хонины мах", short: "мах", unitSay: "кило", unit: "кг", note: "ястай" },
  flour: { caption: "1 кг гурил", say: "нэг кило гурил", title: "Гурил", short: "гурил", unitSay: "кило", unit: "кг", note: "1-р зэрэг" },
  bread: { caption: "1 талх", say: "нэг талх", title: "Талх", short: "талх", unitSay: "ширхэг", unit: "ш", note: "" },
  rice: { caption: "1 кг цагаан будаа", say: "нэг кило цагаан будаа", title: "Цагаан будаа", short: "будаа", unitSay: "кило", unit: "кг", note: "" },
  milk: { caption: "1 л сүү", say: "нэг литр сүү", title: "Сүү", short: "сүү", unitSay: "литр", unit: "л", note: "задгай" },
  egg: { caption: "1 өндөг", say: "нэг өндөг", title: "Өндөг", short: "өндөг", unitSay: "ширхэг", unit: "ш", note: "" },
  potato: { caption: "1 кг төмс", say: "нэг кило төмс", title: "Төмс", short: "төмс", unitSay: "кило", unit: "кг", note: "" },
  sugar: { caption: "1 кг элсэн чихэр", say: "нэг кило элсэн чихэр", title: "Элсэн чихэр", short: "чихэр", unitSay: "кило", unit: "кг", note: "" },
  petrol: { caption: "1 л А-92 бензин", say: "нэг литр А ерэн хоёр бензин", title: "Бензин А-92", short: "бензин", unitSay: "литр", unit: "л", note: "" },
  diesel: { caption: "1 л дизель", say: "нэг литр дизель түлш", title: "Дизель түлш", short: "түлш", unitSay: "литр", unit: "л", note: "" },
  canteen: { caption: "гуанзны 1 порц хоол", say: "гуанзны нэг порц хоол", title: "Гуанзны хоол", short: "хоол", unitSay: "порц", unit: "порц", note: "" },
  firewood: { caption: "1 шуудай мод", say: "нэг шуудай түлшний мод", title: "Түлшний мод", short: "мод", unitSay: "шуудай", unit: "шуудай", note: "" },
};

const NBSP = "\u00a0";
/** "31 210₮" with a no-break space, so the word-by-word captions never split a number. */
const money = (n: number) => `${formatNumber(n).replace(/ /g, NBSP)}₮`;

export function cap(s: string): string {
  return s.charAt(0).toLocaleUpperCase("mn") + s.slice(1);
}

/** A round wrong answer: a step that reads like a price (100 ₮ steps for thousands). */
function niceRound(n: number): number {
  const step = n >= 10_000 ? 500 : n >= 1_000 ? 100 : n >= 100 ? 10 : 1;
  return Math.max(step, Math.round(n / step) * step);
}

/** Three options, the true price at a position that moves with the good. */
export function quizOptions(then: number, position: number): QuizOption[] {
  let low = niceRound(then * 0.55);
  let high = niceRound(then * 1.8);
  if (low === then) low = niceRound(then * 0.45);
  if (high === then) high = niceRound(then * 2.2);
  const wrong = [low, high];
  const values = [...wrong];
  values.splice(position % 3, 0, then);
  return values.map((v) => ({ text: money(v), value: v, correct: v === then }));
}

/** "бараг долоон кило" / "6 гаруй кг": how many units today's price bought then. */
function aboutUnits(ratio: number, unitSay: string, unit: string): { say: string; caption: string } {
  const whole = Math.floor(ratio);
  const frac = ratio - whole;
  if (frac >= 0.75) return { say: `бараг ${numberWords(whole + 1)} ${unitSay}`, caption: `бараг *${whole + 1}${NBSP}${unit}*` };
  if (frac < 0.25) return { say: `${numberWords(whole)} ${unitSay}`, caption: `*${whole}${NBSP}${unit}*` };
  return { say: `${numberWords(whole, "nominative")} гаруй ${unitSay}`, caption: `*${whole}${NBSP}гаруй${NBSP}${unit}*` };
}

/**
 * The spec for one good, or null when its series cannot carry a video (no latest price or no
 * price 5+ years back).
 */
export function priceVideoSpec(snap: PricesSnapshot, goodKey: string): VideoSpec | null {
  const good: GoodSeries | undefined = snap.goods.find((g) => g.key === goodKey);
  const names = SPOKEN[goodKey];
  if (!good || !names) return null;
  const latest = snap.latestMonth;
  const nowValue = valueAt(snap.months, good.ub, latest);
  if (nowValue === null || nowValue <= 0) return null;
  const points = agoPoints(snap.months, good.ub, latest);
  const thenPoint = [...points].reverse().find((p) => p.years >= 5 && p.value !== null && p.value > 0);
  if (!thenPoint || thenPoint.value === null) return null;
  const then = thenPoint.value;
  const from = snap.months.indexOf(thenPoint.month);
  const to = snap.months.indexOf(latest);
  if (from < 0 || to <= from) return null;
  const yearRaw = points.find((p) => p.years === 1)?.pct ?? null;
  const yearPct = yearRaw === null ? null : Math.round(yearRaw);
  const ratio = nowValue / then;
  const years = thenPoint.years;
  // Where the true answer sits moves with the good and the month, so it is not always "A".
  const position = Math.max(0, Object.keys(SPOKEN).indexOf(goodKey)) + Number(latest.slice(5, 7));

  const sentences: Sentence[] = [
    {
      scene: "quiz",
      // Spoken the way people talk ("за", "шүү", "-чих-"), not the way a bulletin reads: the
      // written-style script sounded like an announcer even with a natural voice (Oct 2026).
      say: `За, таагаад үз дээ. ${cap(numberWords(years))} жилийн өмнө ${names.say} хэд байсан гэж бодож байна?`,
      caption: `${years} жилийн өмнө ${names.caption} хэд байсан бэ?`,
    },
    { scene: "reveal", say: `${cap(numberWords(then))} төгрөг байсан!`, caption: `*${money(then)}*` },
    { scene: "now", say: `Харин одоо? ${cap(numberWords(nowValue))} төгрөг шүү.`, caption: `Харин одоо? *${money(nowValue)}*` },
  ];
  if (ratio >= 1.5) {
    const about = aboutUnits(ratio, names.unitSay, names.unit);
    sentences.push({
      scene: "relate",
      say: `Өөрөөр хэлбэл, энэ мөнгөөр тэр үед ${about.say} ${names.short} авчих байсан гэсэн үг.`,
      caption: `Энэ мөнгөөр тэр үед ${about.caption} авна`,
    });
  } else {
    const pct = Math.round((ratio - 1) * 100);
    sentences.push(
      pct >= 0
        ? { scene: "change", say: `Тэгэхээр ${numberWords(pct)} хувиар өссөн гэсэн үг.`, caption: `*+${pct}%* өссөн` }
        : { scene: "change", say: `Тэгэхээр ${numberWords(-pct)} хувиар буурсан гэсэн үг.`, caption: `*−${-pct}%* буурсан` },
    );
  }
  if (yearPct !== null && Math.abs(yearPct) >= 1) {
    sentences.push(
      yearPct > 0
        ? { scene: "year", say: `Ганцхан жилийн дотор л ${numberWords(yearPct)} хувиар нэмэгдчихлээ.`, caption: `Ганцхан жилд *+${yearPct}%*` }
        : { scene: "year", say: `Сүүлийн нэг жилд ${numberWords(-yearPct)} хувиар хямдарчээ.`, caption: `Сүүлийн 1 жилд *−${-yearPct}%*` },
    );
  }
  sentences.push({ scene: "cta", say: "Танайд одоо хэд байна вэ?", caption: "Танайд одоо хэд байна?" });

  return {
    key: `prices:${goodKey}:${latest}`,
    goodKey,
    series: "ҮНЭ ТААГААРАЙ",
    title: names.title,
    sub: ["Улаанбаатар", names.note, "сарын дундаж үнэ"].filter(Boolean).join(" · "),
    question: `${years} жилийн өмнө ${names.caption} хэд байсан бэ?`,
    options: quizOptions(then, position),
    months: snap.months,
    series_: good.ub,
    from,
    to,
    units: ratio >= 1.5 ? { count: Math.round(ratio * 10) / 10, unit: names.unit } : null,
    sentences,
    source: "Эх сурвалж: ҮСХ (1212.mn) · нэрлэсэн үнэ · Дуу: AI",
    link: `iltodmedee.mn/prices#${goodKey}`,
    then: { month: thenPoint.month, value: then, years },
    now: { month: latest, value: nowValue },
    yearPct,
  };
}

/** The narration as one text for the voice (sentences in order). */
export function narration(spec: VideoSpec): string {
  return spec.sentences.map((s) => s.say).join(" ");
}

/**
 * Refuses a spec that could put a wrong number on screen or in the voice: the narration must hold
 * no digit; every number in the captions and the unit count must be one computed from the
 * snapshot; exactly one option is the true price. Returns the problems (empty = fine).
 */
export function verifySpec(spec: VideoSpec): string[] {
  const problems: string[] = [];
  for (const s of spec.sentences) if (/\d/.test(s.say)) problems.push(`digits in the narration: ${s.say}`);
  const ratio = spec.now.value / spec.then.value;
  const allowed = new Set<string>([
    String(spec.then.years),
    formatNumber(spec.then.value),
    formatNumber(spec.now.value),
    "1",
    String(Math.floor(ratio)),
    String(Math.floor(ratio) + 1),
    String(Math.abs(Math.round((ratio - 1) * 100))),
    ...(spec.yearPct !== null ? [String(Math.abs(spec.yearPct))] : []),
  ]);
  for (const s of spec.sentences) {
    for (const m of s.caption.replace(/\u00a0/g, " ").matchAll(/\d[\d ]*\d|\d/g)) {
      const n = m[0].trim();
      if (n === "92") continue; // "А-92": the grade, not a price.
      if (!allowed.has(n)) problems.push(`caption number ${n} is not from the snapshot: ${s.caption}`);
    }
  }
  const right = spec.options.filter((o) => o.correct);
  if (right.length !== 1 || right[0].value !== spec.then.value) problems.push("the quiz must have exactly one true answer, the old price");
  if (spec.options.some((o) => !o.correct && o.value === spec.then.value)) problems.push("a wrong option equals the true price");
  if (spec.units && Math.abs(spec.units.count - Math.round(ratio * 10) / 10) > 1e-9) problems.push("unit count differs from now / then");
  if (spec.series_[spec.from] !== spec.then.value || spec.series_[spec.to] !== spec.now.value) problems.push("chart end points differ from the captions");
  return problems;
}
