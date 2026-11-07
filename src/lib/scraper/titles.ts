import { normalizeText } from "@/lib/text";

/**
 * Headline helpers shared by the extractors, the DB sink and the title backfill (no jsdom here).
 *
 * Some government sites put the same page title on every article ("Мэдээ | ТТХГ", "Нүүр хуудас",
 * the agency name), so a headline is only trusted when it is not one of those.
 */

/** Words a site uses for a section or its homepage, never for one story. */
const SECTION_WORDS = new Set(
  [
    "мэдээ",
    "мэдээ мэдээлэл",
    "мэдээлэл",
    "шинэ мэдээ",
    "сүүлийн мэдээ",
    "цаг үеийн мэдээ",
    "үйл явдал",
    "нүүр",
    "нүүр хуудас",
    "эхлэл",
    "дэлгэрэнгүй",
    // Headings sites reuse for every post of a kind: the first sentence says which one it is.
    "цахим уулзалт",
    "тендерийн урилга",
    "тендер шалгаруулалтын урилга",
    "home",
    "news",
    "read",
  ].map((w) => w.toLowerCase()),
);

const SEPARATOR = /\s*[|–—]\s*|\s+-\s+/;

function norm(s: string): string {
  return normalizeText(s).replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * True when `title` names the site or a section rather than one article: section words,
 * the site's own name (alone or combined with a section word), or fewer than 8 characters.
 */
export function isGenericTitle(title: string, siteNames: (string | null | undefined)[] = []): boolean {
  const clean = normalizeText(title).replace(/\s+/g, " ").trim();
  if (clean.length < 8) return true;
  const names = siteNames.map((n) => (n ? norm(n) : "")).filter((n) => n.length >= 2);
  return clean
    .split(SEPARATOR)
    .filter(Boolean)
    .every((part) => {
      const p = part.toLowerCase();
      return (
        SECTION_WORDS.has(p) ||
        names.some((n) => p === n || (p.length >= 8 && n.startsWith(p))) ||
        // An agency abbreviation on its own: "ТТХГ", "ЭМЯ", "IAAC".
        /^[A-ZА-ЯЁӨҮ]{2,6}$/u.test(part) ||
        p.length < 3
      );
    });
}

const CYRILLIC = /[А-яЁёӨөҮү]/g;

/**
 * A headline with no Cyrillic letter over a Mongolian text that never mentions it is a
 * transliterated URL slug ("Heregzhizh Bajgaa T Sl Dijn Talaarh Medeelel | MECC", mecc.gov.mn's
 * og:title), not the title. A real Latin name the text repeats stays ("Youth for Water Festival").
 */
export function isTransliteratedTitle(title: string, text: string): boolean {
  if (/[А-яЁёӨөҮү]/.test(title) || (text.match(CYRILLIC)?.length ?? 0) < 100) return false;
  // Letters and digits only: "YOUTH FOR WATER FESTIVAL 2026" is in "Youth for Water Festival – 2026".
  const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const head = squash(title.split(SEPARATOR)[0]);
  return head.length > 0 && !squash(text).includes(head);
}

/** A line that is only a date ("2026 оны 10 -р сарын 21, Лхагва", "2026-10-21 10:30"). */
export function isDateLine(line: string): boolean {
  const rest = line
    .replace(/20\d{2}\s*оны\s*\d{1,2}\s*(?:-р|дугаар|дүгээр)?\s*сарын\s*\d{1,2}/g, "")
    .replace(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?/g, "")
    .replace(/[,.\s]*(Даваа|Мягмар|Лхагва|Пүрэв|Баасан|Бямба|Ням)?[,.\s]*/g, "");
  return rest.length < 6;
}

/**
 * Menu or link text glued together by the extractor ("ХолбоосуудТөрийн байгууллагаСалбаруудын…"):
 * the page is a homepage or a menu, not an article.
 */
export function looksLikeNavigation(text: string): boolean {
  const head = normalizeText(text).slice(0, 300);
  return (
    (head.match(/[а-яөүёa-z][А-ЯӨҮЁA-Z]/gu)?.length ?? 0) >= 3 ||
    (head.match(/>/g)?.length ?? 0) >= 2 ||
    // A news listing with view counters ("2023-06-08 1932 уншсан") or a menu that opens the page.
    (head.match(/\d\s*уншсан/g)?.length ?? 0) >= 2 ||
    /^(Бидний тухай|Нүүр хуудас|Нүүр|Home|ENG)\s/u.test(head) ||
    // Nothing that reads like a headline at all (login pages: "Нэвтрэх").
    isGenericTitle(firstSentenceTitle(text))
  );
}

const UNIT_TITLE = /(хэлтэс|тасаг|алба|газар|хороо|төв|нэгж)\s*$/iu;
// "… холбоотой асуулт хариулт" (crc.gov.mn's FAQ pages reached the feed in Oct 2026) is a help
// page, not news; only a headline ENDING in it, so "асуулт хариултын уулзалт" stays news.
const UNIT_TOPIC_TITLE = /^(үндсэн\s+)?чиг үүрэг|бүтэц,?\s+зохион байгуулалт|хүний нөөцийн ил тод байдал|асуулт[\s,-]*хариулт\s*$|^түгээмэл\s+асуулт/iu;
const UNIT_BODY = /ЭРХЭМ ЗОРИЛГО|ЗОРИЛГО|ЗОРИЛТ|ТАНИЛЦУУЛГА|чиг үүрэг|бүтэц,?\s+зохион байгуулалт/u;

/**
 * An "about this department" page from a district or agency CMS ("Санхүү, төрийн сангийн хэлтэс"
 * opening with "ЗОРИЛГО" / "ТАНИЛЦУУЛГА" / "чиг үүрэг"): reached through the same /v/<id> links as
 * news, stored as today's undated story (Oct 2026, shd.ub.gov.mn and chingeltei.gov.mn). A unit
 * name as headline AND an about-page opening, or an about-page headline: not news.
 */
export function looksLikeUnitPage(title: string, text: string): boolean {
  const t = normalizeText(title).trim();
  if (UNIT_TOPIC_TITLE.test(t)) return true;
  return UNIT_TITLE.test(t) && UNIT_BODY.test(normalizeText(text).slice(0, 300));
}

/**
 * A news page whose body block is empty. gov.mn prints "Мэдээлэл байхгүй байна" in the article
 * area of image-only posts, so the extracted text is the headline, byline, category chips and
 * comment rules: 249–479 characters, 88 of its 367 posts in Oct 2026, 72 of them published with
 * an AI summary of the page chrome ("…онцлох мэдээ хоосон байна" on the home page).
 */
const EMPTY_BODY = /Мэдээлэл\s+байхгүй\s+байна\.?\s*$/u;
export const EMPTY_BODY_MAX_CHARS = 800;

export function looksEmptyBody(text: string): boolean {
  const t = normalizeText(text).trim();
  return t.length < EMPTY_BODY_MAX_CHARS && EMPTY_BODY.test(t);
}

/** Lines we add ourselves when storing (legalinfo.ts's issuer line): never on the source page, never a headline. */
export const OUR_PREFIX = /^Батлагдсан байгууллага:[^\n]*\n+/;
const OUR_LINE = /^Батлагдсан байгууллага:/;

/** The first sentence of the text as a headline (≤ 110 characters, cut at a word). */
export function firstSentenceTitle(text: string, max = 110): string {
  const lines = normalizeText(text)
    .split(/\n+|(?<=[.!?])\s+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !isDateLine(l) && !OUR_LINE.test(l));
  let pick = lines.find((l) => l.length >= 20 && !isGenericTitle(l)) ?? lines[0] ?? "";
  // A listing line glued to its date and view counter: "Гарчиг 2023-06-081932 уншсан…".
  const beforeDate = pick.split(/\s+(?=20\d{2}[./-]\d{1,2}[./-]\d{1,2})/)[0];
  if (beforeDate.length >= 20) pick = beforeDate;
  if (pick.length <= max) return pick.replace(/[.\s]+$/, "");
  const cut = pick.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > 60 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, "")}…`;
}

/** First candidate that is a real headline, else the text's first sentence. */
export function chooseTitle(candidates: (string | null | undefined)[], text: string, siteNames: (string | null | undefined)[] = []): string {
  for (const c of candidates) {
    const t = c ? normalizeText(c).replace(/\s+/g, " ").trim() : "";
    if (t && !isGenericTitle(t, siteNames) && !isTransliteratedTitle(t, text)) return t;
  }
  return firstSentenceTitle(text);
}

/** Abbreviations that stay in capitals when a shouting headline is lowered. */
const ACRONYMS = new Set(
  "АНУ ОХУ БНХАУ БНСУ ХБНГУ ИБУИНВУ ИБУИНХУ НҮБ НҮБХХ ЕХ ОУВС ДБ АХБ ДЭМБ ГАВИ ШХАБ ЮНЕСКО ЮНИСЕФ НАТО УИХ ЗГ ЗГХЭГ ТӨК ТӨХК ХХК ХК ТББ ХХОАТ НӨАТ НДШ ААНОАТ ДНБ ГВУН ЕБС ИТХ АТГ ЦЕГ ТЕГ ГЕГ ШШГЕГ ҮАГ ҮСХ ХАСХОМ ХҮН МАН АН ИЗНН МҮЭ МУ УБ ХУД СХД БЗД СБД ЧД БГД НХД БНД ЭМЯ БШУЯ ГХЯ СЯ ЗТХЯ ХЗДХЯ БОАЖЯ ЭБЯ УУХҮЯ ХНХЯ ЭЗХЯ ХХААХҮЯ БХЯ ЗЗЯ АҮЭБЯ АҮЭБ ТНБД ЗДТГ АМГТГ ЭМДЕГ ЭМДҮЗ ХӨСҮТ УБЦТС ШТС ҮОМШӨ ЦДС ДЦС АЦС МСҮТ ЖДҮ ТУЗ".split(" "),
);

/** A Mongolian case ending after a hyphen marks the word before it as an abbreviation ("АҮЭБЯ-НЫ", "ШТС-УУДЫН"). */
const CASE_SUFFIX = /^-(?:НЫ|ЫН|ИЙН|Н|НД|Д|Т|ЫГ|ИЙГ|Г|ТАЙ|ТЭЙ|ТОЙ|ААС|ЭЭС|ООС|ӨӨС|ЫНХ|ИЙНХ|УУД|ҮҮД|УУДЫН|ҮҮДИЙН|ЫХ|ИЙХ)(?!\p{L})/u;

/** Proper-noun stems that keep a capital first letter ("МОНГОЛЫН" → "Монголын"). */
const PROPER = [
  "МОНГОЛ", "УЛААНБААТАР", "ЧИНГИС", "ЭРДЭНЭТ", "ДАРХАН", "АРХАНГАЙ", "БАЯНХОНГОР", "БУЛГАН", "ДОРНОГОВЬ", "ДОРНОД", "ДУНДГОВЬ",
  "ЗАВХАН", "ОРХОН", "ӨВӨРХАНГАЙ", "ӨМНӨГОВЬ", "СҮХБААТАР", "СЭЛЭНГЭ", "УВС", "ХОВД", "ХӨВСГӨЛ", "ХЭНТИЙ", "АЛТАЙ", "ХЯТАД",
  "ОРОС", "ЯПОН", "СОЛОНГОС", "АМЕРИК", "ЕВРОП", "ЕВРАЗИ", "АЗИ", "ГЕРМАН", "ФРАНЦ", "ЭНЭТХЭГ", "КАЗАХСТАН", "КАНАД",
  "АВСТРАЛИ", "ТУРК", "АНГЛИ", "БРИТАНИ", "ТАЙВАН", "БЕЛАРУСЬ", "ФИЛИППИН", "ИНДОНЕЗ", "МЕКСИК", "БУРИАД", "МОСКВА",
];
const PROPER_PAIRS = ["ОЮУ ТОЛГОЙ", "ТАВАН ТОЛГОЙ"];

const UPPER = /\p{Lu}/gu;
const LETTER = /\p{L}/gu;
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * Headlines some sites publish in capitals ("“1072 ХУВЬЦАА” НЭЭЛТТЭЙ ӨДӨРЛӨГ…") become sentence
 * case. Abbreviations (a list, plus any short word followed by a hyphenated case ending), Latin
 * words, numbers, initials ("Б.ДАШПҮРЭВ" → "Б.Дашпүрэв") and common proper nouns keep their
 * capitals; a hashtag keeps its "#" and underscores ("#Хамтын_сэтгэл"). Mixed-case titles are
 * returned unchanged.
 */
export function unshoutTitle(title: string): string {
  const letters = title.match(LETTER)?.length ?? 0;
  const upper = title.match(UPPER)?.length ?? 0;
  // "_" separates the words of a hashtag ("#ХАМТЫН_СЭТГЭЛ_ХАЛУУН"): one shouted tag is several words.
  const words = title.split(/[\s_]+/).filter((w) => (w.match(LETTER)?.length ?? 0) >= 2).length;
  // Two shouted words are a shouted headline too ("ХУРАЛ БОЛНО" stayed in capitals on the feed);
  // one word alone is usually an abbreviation or a name.
  if (letters < 8 || words < 2 || upper / letters < 0.7) return title;

  let out = title.replace(/[\p{L}\d]+/gu, (w: string, at: number, s: string) => {
    if (ACRONYMS.has(w) || /\d/.test(w) || /^[A-Z]+$/.test(w)) return w;
    if (w.length === 1 && s[at + 1] === ".") return w; // an initial: "Б."
    const lower = w.toLowerCase();
    if (s[at - 1] === "." && /\p{Lu}/u.test(s[at - 2] ?? "")) return cap(lower); // the name after "Б." ("С.К.Шойгу-тай")
    // The second half of a hyphenated given name after an initial: "Л.Оюун-Эрдэнэ", "Б.Бат-Эрдэнэ".
    if (s[at - 1] === "-" && !CASE_SUFFIX.test(s.slice(at - 1)) && /\p{Lu}\.\p{L}+-$/u.test(s.slice(Math.max(0, at - 40), at))) return cap(lower);
    if (w.length <= 6 && CASE_SUFFIX.test(s.slice(at + w.length))) return w;
    return PROPER.some((p) => w.startsWith(p)) ? cap(lower) : lower;
  });
  for (const p of PROPER_PAIRS) out = out.replaceAll(p.toLowerCase(), p.toLowerCase().split(" ").map(cap).join(" "));
  // Capital at the start of the title and of every sentence (skipping quotes and emoji).
  return out.replace(/(^|[.!?]\s+)([^\p{L}\d]*)(\p{Ll})/gu, (_, a: string, b: string, c: string) => a + b + c.toUpperCase());
}
