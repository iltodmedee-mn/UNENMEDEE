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

export function isLatinText(text: string): boolean {
  const latin = text.match(LATIN)?.length ?? 0;
  if (latin < LATIN_ALLOWANCE) return false;
  return latin > (text.match(CYRILLIC)?.length ?? 0);
}
