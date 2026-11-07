/**
 * Open citizens' petitions to the State Great Khural (petition.parliament.mn, "Нийтийн өргөдлийн
 * систем"), for /participate. Pure half; the fetch is in scripts/sync-petitions.ts.
 *
 * Mongolia scored 35/100 on public participation in the Open Budget Survey 2025, its weakest
 * score, and nothing on our site said where a citizen can take part. The parliament's own system
 * lists each petition as a card: its number, title, type, "signatures / threshold" and an end
 * time written into an inline countdown script (`new Date(2026, 11 - 1, 8, 23, 2, 46)`, Ulaanbaatar
 * time). We keep only what is needed to point a reader to it: no author names (private people),
 * no images, no description. A petition whose title names a person ("Б.Бат") is left out: a
 * citizen's claim about a named person is not ours to repeat (`namesPerson`).
 */
import { load } from "cheerio";

export const PETITION_SITE = "https://petition.parliament.mn";

export interface Petition {
  id: string;
  /** "PN-202609-61758" */
  code: string;
  title: string;
  /** "3. Хуулийн төсөл санаачлах талаар санал гаргах" */
  kind: string | null;
  signatures: number;
  threshold: number;
  /** ISO, Ulaanbaatar time; null when the card had no countdown. */
  endsAt: string | null;
  url: string;
}

export interface PetitionsSnapshot {
  fetchedAt: string;
  items: Petition[];
  /** Open petitions left out because the title names a person. */
  skippedNamed: number;
}

const num = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;
const pad = (n: string | number) => String(n).padStart(2, "0");

/** A person's short name in a title: an initial and a capitalised name ("Б.Бат", "Х. Баттулга"). */
export function namesPerson(title: string): boolean {
  // Case-insensitive after the initial: "Б.БАТ" and "Б. Баттулга" (unshoutTitle lowercases a shouted one) name a person too.
  if (/(?<![\p{L}])[А-ЯӨҮЁ]\.\s?[А-ЯӨҮЁа-яөүё]{3,}/u.test(title)) return true;
  // A full name ("Хүрэлсүх Ухнаа огцрох"): two capitalised words next to a dismissal / blame / sentence word.
  const name = "[А-ЯӨҮЁ][а-яөүё]{2,}(?:-[А-ЯӨҮЁ][а-яөүё]+)?";
  const pair = `${name}\\s+${name}\\p{L}*`;
  const verb = "(?:огцр|хариуцлага|шалга|ял(?![а-яөүё]))";
  return new RegExp(`(?<![\\p{L}])${pair}(?:\\s+\\S+)?\\s+\\S*${verb}|${verb}\\S*\\s+(?:\\S+\\s+)?${pair}`, "u").test(title);
}

/** The end time of each card, by petition id, from the countdown scripts. */
function endTimes(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /new Date\((\d{4}),\s*(\d{1,2})\s*-\s*1,\s*(\d{1,2}),\s*(\d{1,2}),\s*(\d{1,2}),\s*(\d{1,2})\)[\s\S]{0,1200}?#tmr_([0-9a-f-]{36})/g;
  for (const m of html.matchAll(re)) {
    const [, y, mo, d, h, mi, s, id] = m;
    if (!out.has(id)) out.set(id, `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}+08:00`);
  }
  return out;
}

/** The petition cards on one listing page. */
export function parsePetitions(html: string, tidy: (title: string) => string = (t) => t): Petition[] {
  const $ = load(html);
  const ends = endTimes(html);
  const out: Petition[] = [];
  $("a.pet-item").each((_, el) => {
    const card = $(el);
    const id = card.attr("href")?.match(/Detail\?id=([0-9a-f-]{36})/)?.[1];
    const code = card.find(".pet-no").first().text().trim();
    const title = card.find(".item-body .fw-bold").first().text().replace(/\s+/g, " ").trim();
    if (!id || !code || !title) return;
    const kind = card.find(".item-body .fst-italic").first().text().replace(/\s+/g, " ").trim() || null;
    const counts = card.text().match(/([\d,]+)\s*\/\s*([\d,]+)/);
    out.push({
      id,
      code,
      title: tidy(title),
      kind,
      signatures: counts ? num(counts[1]) : 0,
      threshold: counts ? num(counts[2]) : 0,
      endsAt: ends.get(id) ?? null,
      url: `${PETITION_SITE}/Detail?id=${id}`,
    });
  });
  return out;
}

/** Still collecting signatures at `now`. */
export const isOpen = (p: Petition, now: Date): boolean => p.endsAt !== null && Date.parse(p.endsAt) > now.getTime();

/** The open petitions to show: no person named, most signatures first, each once. */
export function openPetitions(all: Petition[], now: Date): { items: Petition[]; skippedNamed: number } {
  const seen = new Set<string>();
  let skippedNamed = 0;
  const items: Petition[] = [];
  for (const p of all) {
    if (seen.has(p.id) || !isOpen(p, now)) continue;
    seen.add(p.id);
    if (namesPerson(p.title)) {
      skippedNamed++;
      continue;
    }
    items.push(p);
  }
  return { items: items.sort((a, b) => b.signatures - a.signatures), skippedNamed };
}
