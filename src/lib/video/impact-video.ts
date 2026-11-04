/**
 * "ЧАМД ХАМААТАЙ ЮУ?" videos (Reels / Threads, 1080×1920, ~30 s), the evening slot since Oct 31
 * 2026 (the owner asked for fresh political and civic news instead of price quizzes, made for
 * Gen Z and young viewers; the price video only runs when no story qualifies). Built like the
 * other videos for people who scroll: a stop-the-scroll line and the headline on screen in the
 * first second, a new card every few seconds, the informal "чи" young people use with each other,
 * and an ending that asks for a comment and a send. One fresh decision (a law, a resolution, a budget
 * line, a tariff, a benefit) read the way the site's "Танд хамаатай юу?" block reads it: the
 * headline, who it touches, what changes, from when, what the reader can do.
 *
 * Facts only, the site's own rules: the texts are the story's grounded `reader_title` and
 * `reader_impact` (src/lib/ai/reader-view.ts: every number in them appears in the source), the
 * frame names the source and says the summary is AI-written, a headline that weighs, contrasts or
 * accuses (`weighsOrAccuses`) or any field naming a charge never becomes a video, and nothing is
 * added: no score, no verdict, no person singled out. The voice reads the same texts; the forms a
 * speech model misreads (a decimal before тэрбум, "2026-11-01", "11-р сар") are turned into words
 * first (`spokenText`), the rest it reads correctly (tested Oct 31 2026).
 */
import type { ReaderImpact } from "@/lib/types";

import { amountWords, CHARGE, weighsOrAccuses } from "./money-video";
import type { Sentence } from "./price-video";

/** Notices and ceremonies score lower; a decision people feel scores 65+. */
export const IMPACT_MIN_IMPORTANCE = 65;
/** A longer narration does not fit ~35 s, nor the month's ElevenLabs share. */
export const IMPACT_MAX_CHARS = 480;

export interface ImpactStory {
  id: number;
  slug: string;
  /** The headline readers see (reader_title or the source's). */
  title: string;
  impact: ReaderImpact | null;
  sourceName: string;
  /** Ulaanbaatar day, "2026-10-28". */
  day: string;
  topic: string | null;
}

export interface ImpactSpec {
  key: string;
  articleId: number;
  series: string;
  headline: string;
  /** "Засгийн газар · 2026.10.28" */
  sub: string;
  /** The info cards in order: label + text, as on the site. */
  cards: { scene: "who" | "change" | "when" | "action"; label: string; text: string }[];
  sentences: Sentence[];
  source: string;
  link: string;
  topic: string | null;
  impact: { who: string | null; change: string; when: string | null; action: string | null };
}

/** Words that charge someone: such a story stays on the site, where the article says who said it. */

const MONTHS = ["нэгдүгээр", "хоёрдугаар", "гуравдугаар", "дөрөвдүгээр", "тавдугаар", "зургаадугаар", "долоодугаар", "наймдугаар", "есдүгээр", "аравдугаар", "арван нэгдүгээр", "арван хоёрдугаар"];
const SCALE: Record<string, number> = { "их наяд": 1e12, тэрбум: 1e9, сая: 1e6 };

/** A field as written, one line, without the `*` the captions use for highlights. */
function clean(s: string | null | undefined): string | null {
  const t = (s ?? "").replace(/[*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= 3 ? t : null;
}

const sentence = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

/**
 * The text as the voice should get it: "2026-11-01" → "2026 оны 11-р сарын 1", "11-р сар" /
 * "11 дүгээр сар" → "арван нэгдүгээр сар", "170.1 тэрбум" → "зуун дал гаруй тэрбум", "100,000" →
 * "100000". Plain whole numbers, percents, years and day endings ("1-нээс") are left to the model,
 * which reads them right.
 */
export function spokenText(text: string): string {
  let t = text.replace(/(\d{4})-(\d{2})-(\d{2})/g, (_, y, m, d) => `${y} оны ${Number(m)}-р сарын ${Number(d)}`);
  t = t.replace(/(\d{1,2})(?:\s*-?\s*(?:р|p|дүгээр|дугаар))\s+сар/g, (all, m) => {
    const n = Number(m);
    return n >= 1 && n <= 12 ? `${MONTHS[n - 1]} сар` : all;
  });
  // Thousands separators ("1,250.5 сая" was read as "1," + "250.5 сая"): only a real group of
  // 1–3 digits, never a day after a date ("…сарын 1 100 айл" was said as "1100 айл", Nov 2026 audit).
  t = t.replace(/(?<![\d\-.:/]|сарын |оны |өдрийн )(\d{1,3})((?:[,\u00a0 ]\d{3})+)(?!\d)/g, (_, a: string, rest: string) => a + rest.replace(/[,\u00a0 ]/g, ""));
  // A decimal before a scale word is said in words, to the same amount (amountWords).
  t = t.replace(/(?<![\d.,])(\d+[.,]\d+)\s*(их наяд|тэрбум|сая)/g, (all, v, unit) => {
    const value = Number(v.replace(",", ".")) * SCALE[unit];
    return Number.isFinite(value) && value > 0 && value < 1e15 ? amountWords(value) : all;
  });
  // "сарын 01-нээс": a leading zero is read aloud as "тэг".
  t = t.replace(/(^|[^\d.,])0(\d)(?!\d)/g, "$1$2");
  return t.replace(/₮/g, " төгрөг").replace(/\s+/g, " ").trim();
}

/** Digits in a caption are highlighted ("*600*"), as in the other videos. */
const highlight = (s: string) => s.replace(/(\S*\d\S*)/g, "*$1*");

/** The spec for one story, or null when it has no usable impact or must not become a video. */
export function impactVideoSpec(story: ImpactStory): ImpactSpec | null {
  const headline = clean(story.title);
  const imp = story.impact;
  if (!headline || !imp || weighsOrAccuses(headline)) return null;
  const who = clean(imp.who);
  const change = clean(imp.change);
  const when = clean(imp.when);
  const action = clean(imp.action);
  if (!change || (!who && !when && !action)) return null;
  if ([headline, who, change, when, action].some((f) => f && CHARGE.test(f))) return null;

  const cards: ImpactSpec["cards"] = [];
  if (who) cards.push({ scene: "who", label: "ХЭНД", text: who });
  cards.push({ scene: "change", label: "ЮУ ӨӨРЧЛӨГДӨХ", text: change });
  if (when) cards.push({ scene: "when", label: "ХЭЗЭЭНЭЭС", text: when });
  if (action) cards.push({ scene: "action", label: "ЧИ ЮУ ХИЙХ ВЭ", text: action });

  const asks: Record<ImpactSpec["cards"][number]["scene"], string> = {
    who: "Хэнд хамаатай вэ?",
    change: "Юу өөрчлөгдөх вэ?",
    when: "Хэзээнээс?",
    action: "Тэгэхээр чи юу хийх вэ?",
  };
  const sentences: Sentence[] = [
    { scene: "hook", say: sentence(`Хүлээгээрэй, энэ чамд хамаатай байж магадгүй. ${spokenText(headline)}`), caption: `Энэ чамд хамаатай байж магадгүй: ${highlight(headline)}` },
    ...cards.map((c) => ({ scene: c.scene, say: `${asks[c.scene]} ${sentence(spokenText(c.text))}`, caption: `${asks[c.scene]} ${highlight(c.text)}` })),
    { scene: "cta", say: "Чамд хамаатай юу? Коммент дээр бичээд, найздаа илгээгээрэй.", caption: "Чамд хамаатай юу? Коммент бич, найздаа илгээ!" },
  ];
  if (sentences.reduce((n, s) => n + s.say.length + 1, 0) > IMPACT_MAX_CHARS) return null;

  return {
    key: `impact:${story.id}`,
    articleId: story.id,
    series: "30 СЕК МЭДЭЭ",
    headline,
    sub: `${story.sourceName} · ${story.day.replace(/-/g, ".")}`,
    cards,
    sentences,
    source: `Эх сурвалж: ${story.sourceName} · Товчлол: AI (эх мэдээнээс) · Дуу: AI`,
    link: `iltodmedee.mn/article/${story.slug}`,
    topic: story.topic,
    impact: { who, change, when, action },
  };
}

/** The narration as one text for the voice. */
export function impactNarration(spec: ImpactSpec): string {
  return spec.sentences.map((s) => s.say).join(" ");
}

/**
 * Refuses a spec that could say something the story does not: every card text is a field of the
 * story as stored, the narration has no form the voice misreads (ISO dates, decimals before a
 * scale word, "11-р сар"), the video carries its source and the AI labels.
 */
export function verifyImpactSpec(spec: ImpactSpec): string[] {
  const problems: string[] = [];
  const fields = new Set([spec.impact.who, spec.impact.change, spec.impact.when, spec.impact.action].filter(Boolean));
  for (const c of spec.cards) if (!fields.has(c.text)) problems.push(`card text not from the story: ${c.text}`);
  for (const s of spec.sentences) {
    if (/\d{4}-\d{2}-\d{2}|\d+[.,]\d+\s*(их наяд|тэрбум|сая)|\d+\s*-?\s*(р|дүгээр|дугаар)\s+сар/.test(s.say)) problems.push(`the voice would misread: ${s.say}`);
    if (s.say.includes("*")) problems.push(`markup in the narration: ${s.say}`);
    // "тэг" (zero) is only said when the caption itself shows a zero: a rounded "0.4 сая" once
    // became "тэг сая".
    if (/(^|\s)тэг(\s|$)/.test(s.say) && !/(^|[^\d.,])0([^\d.,]|$)/.test(s.caption)) problems.push(`zero said but not written: ${s.say}`);
  }
  if (!/Товчлол: AI/.test(spec.source) || !/Дуу: AI/.test(spec.source)) problems.push("the frame must say the summary and the voice are AI");
  if (impactNarration(spec).length > IMPACT_MAX_CHARS) problems.push("narration too long");
  return problems;
}
