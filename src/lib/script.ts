/**
 * Mongolian on the site is written in Cyrillic. A free model once answered a whole analysis in a
 * Latin transliteration ("Ömnögovi aimagt 'Irgenii tankhim' neegdlee", article 3637, Nov 7 2026),
 * and it reached the headline, the summary and "Танд хамаатай юу?". A text whose Latin letters
 * outnumber its Cyrillic ones is refused; short Latin names inside Cyrillic text ("e-Mongolia",
 * "COVID-19", "IMF") stay.
 */
const LATIN = /\p{Script=Latin}/gu;
const CYRILLIC = /\p{Script=Cyrillic}/gu;

/** Latin letters a text may hold before it can count as written in Latin. */
export const LATIN_ALLOWANCE = 12;

/** Chinese, Japanese and Korean letters: a model drifting into one of these (audit B-8) is never Mongolian. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/** Any run of Chinese, Japanese or Korean letters. */
export const hasCjk = (text: string): boolean => (text.match(CJK)?.length ?? 0) >= 2;

/**
 * One item of a list (a fact, a question, a summary line) that is not Mongolian: CJK, or Latin
 * letters (12+) more than twice the Cyrillic ones. A company's Latin name inside a Mongolian
 * sentence ("Wagner Asia Equipment LLC-тэй … гэрээ байгуулсан") stays; English prose with one
 * Cyrillic name in it ("… awarded the contract to Бат without a tender.") does not.
 */
export function isForeignItem(text: string): boolean {
  if (hasCjk(text)) return true;
  const latin = text.match(LATIN)?.length ?? 0;
  const cyrillic = text.match(CYRILLIC)?.length ?? 0;
  return latin >= LATIN_ALLOWANCE && latin > 2 * cyrillic;
}

/** True when the text is not Mongolian Cyrillic: mostly Latin letters, or any run of CJK script. */
export function isLatinText(text: string): boolean {
  if ((text.match(CJK)?.length ?? 0) >= 2) return true;
  const latin = text.match(LATIN)?.length ?? 0;
  if (latin < LATIN_ALLOWANCE) return false;
  return latin > (text.match(CYRILLIC)?.length ?? 0);
}
