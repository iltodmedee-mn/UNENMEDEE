/**
 * "Hook" wording for social cards and posts: the strongest fact of a headline (its first number
 * with its unit and the next word, e.g. "61.8 сая мал") is shown in yellow. Rule-based, no AI:
 * the hook can only repeat what the fact-based headline already says, never add a claim.
 */
export interface HookWord {
  word: string;
  hot: boolean;
}

const NUMBER = /^[\d][\d.,]*%?$/;
/** "2026 оны", "2025 онд": a year is a date, not the fact worth highlighting. */
const YEAR = /^(19|20)\d{2}$/;
const YEAR_WORD = /^(он|оны|онд|оноос|оныг|онтой|оны,)$/i;
/** Punctuation and a leading currency sign around a number: "(250", "«61.8", "40%)", "₮600,000" (plain headlines put ₮ first). */
const strip = (w: string) => w.replace(/^[("«“'[₮$]+/, "").replace(/[,.:;)»”'\]]+$/, "");
const UNIT = /^(хувь|хувиар|хувьтай|%|их|наяд|тэрбум|сая|мянга|мянган|₮|төгрөг|төгрөгийн|ам\.доллар|ам\.долларын|доллар|км|га|тонн|хүн|өрх|өрхийн)[,.:;]?$/i;

/** Splits a headline into words and marks the first number, its units and the word after them. */
export function hookWords(text: string): HookWord[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const start = words.findIndex((w, i) => {
    const n = strip(w);
    // "2026 он:" is a year too: the punctuation after the year word does not make it a fact.
    return NUMBER.test(n) && !(YEAR.test(n) && YEAR_WORD.test((words[i + 1] ?? "").replace(/[.:;]+$/, "")));
  });
  if (start < 0) return words.map((word) => ({ word, hot: false }));
  let end = start;
  // "792 000 ₮", "1 000 000 төгрөг": thousands typed with spaces are one number, not "792" next to a plain "000".
  while (end + 1 < words.length && /^\d{1,3}$/.test(strip(words[end])) && !/[,.:;)]$/.test(words[end]) && /^\d{3}$/.test(strip(words[end + 1])) && !/^[("«“'[₮$]/.test(words[end + 1])) end++;
  const numberEnd = end;
  while (end + 1 < words.length && UNIT.test(words[end + 1]) && !/[,.:;]$/.test(words[end])) end++;
  // One more word ("мал", "сургууль") makes the number read as a fact, unless a clause ended.
  if (end + 1 < words.length && !/[,.:;]$/.test(words[end]) && end - numberEnd < 3 && /^[а-яөүёa-z]/i.test(words[end + 1])) end++;
  return words.map((word, i) => ({ word, hot: i >= start && i <= end }));
}

