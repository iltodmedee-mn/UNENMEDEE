import { normalizeText } from "@/lib/text";

import { isDateLine, OUR_PREFIX } from "./titles";

/**
 * Re-checking stored articles against their source page ("Эх хуудасны өөрчлөлт", /changes).
 *
 * A re-extracted page never matches the stored text byte for byte (view counters, "related news"
 * widgets, REST vs HTML text), so hashes are never compared. Instead: how many SENTENCES of our
 * stored copy can still be found on the page, and did any number in them change? Pure functions;
 * scripts/recheck-sources.ts does the fetching.
 */

/** Below this share of our sentences still on the page, the text counts as changed. */
export const CHANGED_BELOW = 0.8;
/** Below this share of our sentences the fresh text is another block, not an edit (see decide). */
export const UNREADABLE_BELOW = 0.2;
/** A page must 404 (or redirect away) on this many checks, at least GONE_MIN_DAYS apart. */
export const GONE_CHECKS = 2;
export const GONE_MIN_DAYS = 6;
/** Fresh text shorter than this means extraction failed: the check is skipped. */
export const MIN_FRESH_CHARS = 200;
/** Diff entries kept per changed article (~4 KB). */
export const MAX_DIFF = 12;
/** Fewer comparable sentences than this in our copy: too little text to judge, the check is skipped. */
export const MIN_SENTENCES = 3;
/** Sentences longer than this (text glued together by the site) are compared in WINDOW-word pieces. */
const LONG_SENTENCE = 160;
const WINDOW = 12;

export type SourceStatus = "ok" | "changed" | "gone";

export interface SourceDiff {
  /** Our sentence and the most similar sentence on the page now. */
  pairs: { before: string; after: string }[];
  /** Our sentences with no similar sentence on the page any more. */
  removed: string[];
  /** Share of our sentences still found on the page (0-1). */
  containment: number;
}

// Bounded runs and no overlapping classes: these run on publisher text, so a long digit run or
// word must not make them backtrack quadratically.
const COUNTER = /\d[\d\s,.]{0,24}(уншсан|үзсэн|views?|сэтгэгдэл)|(санал\s{1,3}өгсөн|үзсэн|уншсан|хандалт|views?)\s{0,3}[:：]?\s{0,3}\d/iu;
/**
 * Page furniture, not article text: an e-mail line in the footer ("alternate_emailinfo@…") and a
 * line mostly in capitals (menus, the agency's name, a poll's question). Nov 2026: a poll widget
 * whose vote count changed and a footer read as "the government changed the article".
 */
const EMAIL = /[\p{L}\p{N}._-]{1,64}@[\p{L}\p{N}-]{1,63}\./u;
function isChrome(s: string): boolean {
  if (EMAIL.test(s) || /alternate_email/i.test(s)) return true;
  const letters = s.match(/\p{L}/gu)?.length ?? 0;
  const upper = s.match(/\p{Lu}/gu)?.length ?? 0;
  return letters >= 15 && upper / letters >= 0.8;
}
/**
 * A "related news" heading line ("Бусад мэдээлэл", "Шинэ мэдээ", "Холбоотой мэдээ"): what follows
 * is the site's sidebar, which changes with every new post. nema.gov.mn #2218 was stored with its
 * "Шинэ мэдээ" list and read as "changed" when the list moved on (Nov 2026).
 */
const RELATED_HEADING = /^\s{0,4}(бусад|холбоотой|шинэ|сүүлийн|сүүлд нэмэгдсэн|төстэй|ижил|онцлох)\s{1,3}(мэдээ|мэдээлэл|мэдээнүүд|нийтлэл)\s{0,4}$/imu;
function withoutRelated(text: string): string {
  const m = RELATED_HEADING.exec(text);
  return m && m.index > 0 ? text.slice(0, m.index) : text;
}
/** Attachment and link labels ("…төсөлDownload", "…_RFIТатах", "file.pdf"): sites rename them freely. */
const ATTACHMENT = /download|татах|татаж авах|\.(pdf|docx?|xlsx?|zip)\b|(?<![^\s_])[^\s_]+_[^\s_]+_[^\s_]/iu;

/**
 * Pieces of text worth comparing: sentences without dates, counters, attachment labels or short
 * menu-like lines; a very long "sentence" (a page's title, date and body glued together) becomes
 * WINDOW-word pieces so one glued counter does not hide the whole text.
 */
export function splitSentences(text: string): string[] {
  return normalizeText(withoutRelated(text))
    // A view counter glued after the date ("2026-10-19 33 Шүүх…") changes on every visit.
    .replace(/(20\d{2}[-./]\d{1,2}[-./]\d{1,2})\s+\d{1,6}(?=\s)/g, "$1")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 25 && !isDateLine(s) && !COUNTER.test(s) && !ATTACHMENT.test(s) && !isChrome(s))
    .flatMap((s) => {
      if (s.length <= LONG_SENTENCE) return [s];
      const w = s.split(" ");
      const pieces: string[] = [];
      for (let i = 0; i < w.length; i += WINDOW) pieces.push(w.slice(i, i + WINDOW).join(" "));
      return pieces.filter((p) => p.length >= 25 && !COUNTER.test(p) && !isChrome(p));
    });
}

/** For matching: lower case, unified quotes and dashes, letters/digits/spaces only. */
function key(s: string): string {
  return s
    .toLowerCase()
    .replace(/[«»“”„"'’`]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[^\p{L}\p{N}\s.,%-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: string) => new Set(key(s).split(" ").filter((w) => w.length > 1));
/** The key without spaces: "уу.ШҮҮГЧИЙН" and "уу. ШҮҮГЧИЙН" (or a new line break) are the same text. */
const compact = (s: string) => key(s).replace(/\s+/g, "");

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

const numbers = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).join("|");
const wordsOnly = (s: string) => new Set([...words(s)].filter((w) => !/\d/.test(w)));

/** The same sentence with a different number in it: the wording matches, the numbers do not. */
const numberEdited = (p: { before: string; after: string }) => numbers(p.before) !== numbers(p.after) && jaccard(wordsOnly(p.before), wordsOnly(p.after)) >= 0.8;

export interface Comparison extends SourceDiff {
  numbersChanged: boolean;
  /** How many pieces of our copy were compared (below MIN_SENTENCES the result is not trusted). */
  compared: number;
}

export function compareTexts(stored: string, fresh: string): Comparison {
  const ours = splitSentences(stored.replace(OUR_PREFIX, ""));
  const freshKey = compact(normalizeText(fresh));
  const theirs = splitSentences(fresh);
  const theirWords = theirs.map((s) => ({ s, w: words(s) }));
  const pairs: SourceDiff["pairs"] = [];
  const removed: string[] = [];
  let found = 0;
  for (const s of ours) {
    if (freshKey.includes(compact(s))) {
      found++;
      continue;
    }
    const w = words(s);
    let best: { s: string; score: number } | null = null;
    for (const t of theirWords) {
      const score = jaccard(w, t.w);
      if (score >= 0.5 && (!best || score > best.score)) best = { s: t.s, score };
    }
    // Only glued extras differ (a title, date or counter stuck to the sentence): still the same text.
    if (best && (key(s).includes(key(best.s)) || key(best.s).includes(key(s)))) found++;
    else if (best) pairs.push({ before: s, after: best.s });
    else removed.push(s);
  }
  return {
    compared: ours.length,
    containment: ours.length ? found / ours.length : 1,
    pairs,
    removed,
    numbersChanged: pairs.some(numberEdited),
  };
}

export interface CheckState {
  status: SourceStatus | null;
  missingCount: number;
  checkedAt: Date | null;
}

/** What one fetch found: the page's text, or that it is gone (404/410, redirected away), or an error to ignore. */
export type FetchResult = { kind: "text"; text: string } | { kind: "missing" } | { kind: "error" };

export interface Decision {
  /** null = leave the stored status alone (this check proves nothing). */
  status: SourceStatus | null;
  missingCount: number;
  diff?: SourceDiff;
}

export function decide(prev: CheckState, stored: string, result: FetchResult, now = new Date()): Decision {
  if (result.kind === "error") return { status: null, missingCount: prev.missingCount };
  if (result.kind === "missing") {
    // Count a miss only once per GONE_MIN_DAYS, so two misses are really days apart.
    const spaced = !prev.checkedAt || prev.missingCount === 0 || now.getTime() - prev.checkedAt.getTime() >= GONE_MIN_DAYS * 86_400_000;
    const missingCount = spaced ? prev.missingCount + 1 : prev.missingCount;
    return { status: missingCount >= GONE_CHECKS ? "gone" : null, missingCount };
  }
  if (result.text.length < MIN_FRESH_CHARS) return { status: null, missingCount: prev.missingCount };
  const c = compareTexts(stored, result.text);
  if (c.compared < MIN_SENTENCES) return { status: null, missingCount: prev.missingCount };
  // Almost none of our text on the page: the getter read another block (a listing, a JavaScript
  // shell), not an edited article. mongolbank.mn #2248 matched 0 of 12 sentences in Nov 2026.
  // Proves nothing, like a failed extraction.
  if (c.containment < UNREADABLE_BELOW) return { status: null, missingCount: prev.missingCount };
  if (c.containment < CHANGED_BELOW || c.numbersChanged) {
    return {
      status: "changed",
      missingCount: 0,
      diff: { containment: Math.round(c.containment * 100) / 100, pairs: c.pairs.slice(0, MAX_DIFF), removed: c.removed.slice(0, Math.max(0, MAX_DIFF - c.pairs.length)) },
    };
  }
  return { status: "ok", missingCount: 0 };
}
