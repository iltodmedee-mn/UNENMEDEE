/**
 * "30 СЕК МЭДЭЭ" videos (Reels / Threads, 1080×1920, ~30 s), both daily slots since Nov 6 2026:
 * one fresh story told the way a news creator or a journalist tells it on Facebook (the owner's
 * ask): "Сайн байна уу, Ил тод мэдээ" and the headline in the first second, what happened in one
 * or two sentences, who it touches and what changes, the source, and a sign-off ("Энэ бол Ил тод
 * мэдээ"). A new card every few seconds, read with the sound off from the first frame.
 *
 * Facts only, the site's own rules: the texts are the story's grounded `reader_title`, the AI
 * summary (`tldr_summary`, written from the source) and `reader_impact` (src/lib/ai/reader-view.ts:
 * every number in them appears in the source); the frame names the source and says the summary is
 * AI-written; a headline that weighs, contrasts or accuses (`weighsOrAccuses`) or any text naming
 * a charge never becomes a video, and nothing is added: no score, no verdict, no person singled
 * out. The voice reads the same texts; the forms a speech model misreads (a decimal before
 * тэрбум, "2026-11-01", "11-р сар") are turned into words first (`spokenText`, tested Oct 31 2026).
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
  /** The AI summary's sentences (tldrSentences), the "what happened" card. */
  summary?: string[];
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
  cards: { scene: "what" | "who" | "change" | "when" | "action"; label: string; text: string }[];
  /** The opening sticker's lines and its small line. */
  sticker: { lines: string[]; small: string };
  /** The closing card's text. */
  outro: string;
  sentences: Sentence[];
  source: string;
  link: string;
  topic: string | null;
  impact: { who: string | null; change: string | null; when: string | null; action: string | null };
  /** The summary sentences the "what happened" card may use, as stored. */
  summary: string[];
  /** The "what happened" text (the first one or two summary sentences), or null. */
  what: string | null;
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
  t = sayParliament(t);
  return t.replace(/₮/g, " төгрөг").replace(/\s+/g, " ").trim();
}

/** Front-vowel spellings of a case ending, as the back-vowel "Хурал" takes them. */
const BACK_VOWEL: Record<string, string> = { ийн: "ын", ийг: "ыг", ээс: "аас", ээр: "аар", тэй: "тай", нд: "д" };

/**
 * "УИХ" with its case ending said in full (the owner's ask, Nov 2026: the voice spelled the
 * letters): "УИХ" → "Улсын Их Хурал", "УИХ-ын" → "Улсын Их Хурлын", "УИХ-д" → "Улсын Их Хуралд".
 * "Хурал" drops its second vowel before a vowel ending (Хурлын, Хурлаас, Хурлыг).
 */
function sayParliament(t: string): string {
  return t.replace(/(?<!\p{L})УИХ(?:\s*-\s*(\p{L}+))?(?!\p{L})/gu, (_, suffix?: string) => {
    if (!suffix) return "Улсын Их Хурал";
    const s = BACK_VOWEL[suffix.toLowerCase()] ?? suffix.toLowerCase();
    return /^[аэиоуөүыяеё]/.test(s) ? `Улсын Их Хурл${s}` : `Улсын Их Хурал${s}`;
  });
}

/** Digits in a caption are highlighted ("*600*"), as in the other videos. */
const highlight = (s: string) => s.replace(/(\S*\d\S*)/g, "*$1*");

/** At most this much summary on the "what happened" card. */
const WHAT_MAX = 210;

/** The first summary sentence, and the second when both fit WHAT_MAX. */
function whatHappened(summary: string[], headline: string): string | null {
  const usable = summary.map((x) => clean(x)).filter((x): x is string => x !== null && x.length >= 25 && x !== headline);
  if (!usable.length || usable[0].length > WHAT_MAX) return null;
  const two = usable[1] ? `${sentence(usable[0])} ${sentence(usable[1])}` : null;
  return two && two.length <= WHAT_MAX ? two : sentence(usable[0]);
}

/** A source name as said and shown: no "(gov.mn)", no domain. */
const sourceLabel = (name: string) => name.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();

/** The spec for one story, or null when it has too little to tell or must not become a video. */
export function impactVideoSpec(story: ImpactStory): ImpactSpec | null {
  const headline = clean(story.title);
  if (!headline || weighsOrAccuses(headline)) return null;
  const imp = story.impact;
  const who = clean(imp?.who);
  const change = clean(imp?.change);
  const when = clean(imp?.when);
  const action = clean(imp?.action);
  const summary = (story.summary ?? []).map((x) => x.trim()).filter(Boolean);
  const what = whatHappened(summary, headline);
  // Something to tell beyond the headline: what happened, or what changes and for whom / when.
  if (!what && !(change && (who || when || action))) return null;
  if ([headline, who, change, when, action, what].some((f) => f && CHARGE.test(f))) return null;

  const source = sourceLabel(story.sourceName);
  const asks: Record<ImpactSpec["cards"][number]["scene"], string> = {
    what: "Юу болсон бэ?",
    who: "Хэнд хамаатай вэ?",
    change: "Юу өөрчлөгдөх вэ?",
    when: "Хэзээнээс?",
    action: "Тэгэхээр юу хийх вэ?",
  };
  const labels: Record<ImpactSpec["cards"][number]["scene"], string> = {
    what: "ЮУ БОЛСОН БЭ",
    who: "ХЭНД",
    change: "ЮУ ӨӨРЧЛӨГДӨХ",
    when: "ХЭЗЭЭНЭЭС",
    action: "ЮУ ХИЙХ ВЭ",
  };
  const hook: Sentence = { scene: "hook", say: sentence(`Сайн байна уу, Ил тод мэдээ. ${spokenText(headline)}`), caption: highlight(headline) };
  const outro: Sentence = { scene: "cta", say: `Эх сурвалж нь ${spokenText(source)}. Энэ бол Ил тод мэдээ.`, caption: `Эх сурвалж: ${source}` };
  const candidates: ImpactSpec["cards"] = [];
  if (what) candidates.push({ scene: "what", label: labels.what, text: what });
  if (who && change) candidates.push({ scene: "who", label: labels.who, text: who });
  if (change && (who || when || action || !what)) candidates.push({ scene: "change", label: labels.change, text: change });
  if (when && change) candidates.push({ scene: "when", label: labels.when, text: when });
  if (action && change) candidates.push({ scene: "action", label: labels.action, text: action });
  // Cards in order while the narration stays inside IMPACT_MAX_CHARS (ElevenLabs' daily share).
  const say = (c: ImpactSpec["cards"][number]) => `${asks[c.scene]} ${sentence(spokenText(c.text))}`;
  let total = hook.say.length + outro.say.length + 2;
  const cards: ImpactSpec["cards"] = [];
  for (const c of candidates) {
    const n = say(c).length + 1;
    // "who" alone says nothing: it only goes in with the change after it.
    if (c.scene === "who" && total + n + say({ ...c, scene: "change", text: change ?? "" }).length + 1 > IMPACT_MAX_CHARS) continue;
    if (total + n > IMPACT_MAX_CHARS) continue;
    cards.push(c);
    total += n;
  }
  if (!cards.some((c) => c.scene === "what" || c.scene === "change")) return null;
  const sentences: Sentence[] = [hook, ...cards.map((c) => ({ scene: c.scene, say: say(c), caption: `${asks[c.scene]} ${highlight(c.text)}` })), outro];

  return {
    key: `impact:${story.id}`,
    articleId: story.id,
    series: "30 СЕК МЭДЭЭ",
    headline,
    sub: `${source} · ${story.day.replace(/-/g, ".")}`,
    cards,
    sticker: { lines: ["ГОЛ", "МЭДЭЭ"], small: "30 секундэд" },
    outro: "Баримтаар, эх сурвалжтай",
    sentences,
    source: `Эх сурвалж: ${source} · Товчлол: AI (эх мэдээнээс) · Дуу: AI`,
    link: `iltodmedee.mn/article/${story.slug}`,
    topic: story.topic,
    impact: { who, change, when, action },
    summary,
    what,
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
  // The "what happened" card is the stored summary's first sentence or two, word for word.
  const fromSummary = (t: string) => spec.what === t && whatHappened(spec.summary, spec.headline) === t;
  for (const c of spec.cards) if (c.scene === "what" ? !fromSummary(c.text) : !fields.has(c.text)) problems.push(`card text not from the story: ${c.text}`);
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
