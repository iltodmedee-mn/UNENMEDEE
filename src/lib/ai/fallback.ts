/**
 * When no AI provider could process an article for a day (or its output was unusable), the
 * article would never appear: the site only lists articles that have a summary. The fallback
 * uses the article's own first sentences instead, labelled on the page as "AI ажиллаагүй".
 */
export const FALLBACK_AFTER_HOURS = 24;
/** Low but visible: above the feed's importance floor, below anything the AI rated as news. */
export const FALLBACK_IMPORTANCE = 30;

/** The first sentences of the text, at most `maxChars`, one per line (how tldr is stored). */
export function extractiveSummary(text: string, maxSentences = 2, maxChars = 320): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentences = clean.split(/(?<=[.!?])\s+(?=[А-ЯӨҮЁA-Z0-9"“«])/u).filter((s) => s.length > 15);
  const picked: string[] = [];
  for (const s of sentences.length ? sentences : [clean]) {
    if (picked.length >= maxSentences) break;
    const room = maxChars - picked.join(" ").length;
    if (room < 40) break;
    picked.push(s.length > room ? `${s.slice(0, room - 1).replace(/\s+\S*$/, "")}…` : s);
  }
  return picked.join("\n");
}

/** An attempt that got a reply from the model but could not use it (bad or cut-off JSON, schema). */
const BAD_OUTPUT = /Invalid JSON|no JSON object|Unexpected (token|end|non-whitespace)|Unterminated|in JSON at position|Expected|Required|invalid_type|too_small|too_big/i;
const SKIPPED = /skipped \(/;

/**
 * Whether an article should be parked (ai_error) after a failed run instead of being retried every
 * two hours: at least two replies were unusable, or every provider that answered gave an unusable
 * reply. Network, auth and quota failures of other providers do not hide that. Before this only the
 * exact "Invalid JSON" wording parked, so a reply cut off at "position 523" blocked the queue.
 */
export function shouldPark(attempts: string[]): boolean {
  // A bad reply whose repair never ran (the budget stopped the retry) says little about the
  // article: one cut-off reply and a spent daily cap parked it for good.
  const provider = (a: string) => a.slice(0, a.indexOf(":"));
  const unrepaired = new Set(attempts.filter((a) => /retry skipped \(/.test(a)).map(provider));
  const answered = attempts.filter((a) => !SKIPPED.test(a) && !unrepaired.has(provider(a)));
  const bad = answered.filter((a) => BAD_OUTPUT.test(a)).length;
  return bad >= 2 || (bad >= 1 && bad === answered.length);
}

/** Articles still carrying the extractive fallback are offered to the AI again, at most this many per run. */
export const RETRY_FALLBACK_PER_RUN = 10;
export const RETRY_FALLBACK_DAYS = 3;
