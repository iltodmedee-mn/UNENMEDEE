/**
 * "Миний аймаг / дүүрэг": the 21 aimags, the capital and its 9 districts. Each place lists the
 * official sites we scrape for it (SOURCE_SEEDS domains) and the parliament constituency its MPs
 * were elected in, as parliament.mn named it in the 2024 election ("Архангай, Өвөрхангай,
 * Баянхонгор"). Pages match MPs by the areas a constituency lists (`placeMatchesConstituency`), so
 * a map redrawn after an election still finds them; "Сүхбаатар" is both an aimag and a district
 * and is told apart by the other areas listed with it.
 */
export type PlaceKind = "aimag" | "capital" | "district";

export interface Place {
  slug: string;
  /** "Архангай", "Улаанбаатар", "Хан-Уул". */
  name: string;
  kind: PlaceKind;
  /** Scraped official sites for this place (Баянзүрх's own site is down; its news comes from gov.mn). */
  domains: string[];
  /** The parliament.mn constituency the place's MPs are elected in. */
  constituency: string | null;
}

const C = {
  west: "Говь-Алтай, Завхан, Ховд, Увс",
  khangai: "Архангай, Өвөрхангай, Баянхонгор",
  north: "Булган, Хөвсгөл, Орхон",
  central: "Дархан-Уул, Сэлэнгэ, Төв",
  east: "Дорнод, Сүхбаатар, Хэнтий",
  gobi: "Говьсүмбэр, Дорноговь, Дундговь, Өмнөговь",
};

const aimag = (slug: string, name: string, domain: string, constituency: string): Place => ({ slug, name, kind: "aimag", domains: [domain], constituency });
const district = (slug: string, name: string, domains: string[], constituency: string): Place => ({ slug, name, kind: "district", domains, constituency });

export const DISTRICTS: Place[] = [
  district("baganuur", "Багануур", ["bnd.ub.gov.mn"], "Багануур, Багахангай, Налайх"),
  district("bagakhangai", "Багахангай", ["bagakhangai.ub.gov.mn"], "Багануур, Багахангай, Налайх"),
  district("bayangol", "Баянгол", ["bgd.mn"], "Баянгол"),
  district("bayanzurkh", "Баянзүрх", ["bzd.ub.gov.mn"], "Баянзүрх"),
  district("nalaikh", "Налайх", ["nad.ub.gov.mn"], "Багануур, Багахангай, Налайх"),
  district("songinokhairkhan", "Сонгинохайрхан", ["shd.ub.gov.mn"], "Сонгинохайрхан"),
  district("sukhbaatar-duureg", "Сүхбаатар", ["sbd.gov.mn"], "Сүхбаатар, Чингэлтэй"),
  district("khan-uul", "Хан-Уул", ["khanuul.mn"], "Хан-Уул"),
  district("chingeltei", "Чингэлтэй", ["chingeltei.gov.mn"], "Сүхбаатар, Чингэлтэй"),
];

export const PLACES: Place[] = [
  {
    slug: "ulaanbaatar",
    name: "Улаанбаатар",
    kind: "capital",
    // The city's own sites plus every district's: the capital page is the whole city.
    domains: ["ulaanbaatar.mn", "niislel.khural.mn", ...DISTRICTS.flatMap((d) => d.domains)],
    constituency: null,
  },
  ...DISTRICTS,
  aimag("arkhangai", "Архангай", "arkhangai.gov.mn", C.khangai),
  aimag("bayan-olgii", "Баян-Өлгий", "bayan-olgii.gov.mn", "Баян-Өлгий"),
  aimag("bayankhongor", "Баянхонгор", "bayankhongor.gov.mn", C.khangai),
  aimag("bulgan", "Булган", "bulgan.gov.mn", C.north),
  aimag("govi-altai", "Говь-Алтай", "govi-altai.gov.mn", C.west),
  aimag("govisumber", "Говьсүмбэр", "govisumber.gov.mn", C.gobi),
  aimag("darkhan-uul", "Дархан-Уул", "darkhan.gov.mn", C.central),
  aimag("dornogovi", "Дорноговь", "dornogovi.gov.mn", C.gobi),
  aimag("dornod", "Дорнод", "dornod.gov.mn", C.east),
  aimag("dundgovi", "Дундговь", "dundgovi.gov.mn", C.gobi),
  aimag("zavkhan", "Завхан", "zavkhan.gov.mn", C.west),
  aimag("orkhon", "Орхон", "orkhon.gov.mn", C.north),
  aimag("uvurkhangai", "Өвөрхангай", "uvurkhangai.gov.mn", C.khangai),
  aimag("umnugovi", "Өмнөговь", "omnogovi.gov.mn", C.gobi),
  aimag("sukhbaatar", "Сүхбаатар", "sukhbaatar.gov.mn", C.east),
  aimag("selenge", "Сэлэнгэ", "selenge.gov.mn", C.central),
  aimag("tuv", "Төв", "tov.gov.mn", C.central),
  aimag("uvs", "Увс", "uvs.gov.mn", C.west),
  aimag("khovd", "Ховд", "khovd.gov.mn", C.west),
  aimag("khuvsgul", "Хөвсгөл", "khovsgol.gov.mn", C.north),
  aimag("khentii", "Хэнтий", "khentii.mn", C.east),
];

export function findPlace(slug: string): Place | undefined {
  return PLACES.find((p) => p.slug === slug);
}

/** "Ховд аймаг", "Хан-Уул дүүрэг", "Улаанбаатар хот". */
export function placeLabel(p: Place): string {
  return `${p.name} ${p.kind === "aimag" ? "аймаг" : p.kind === "district" ? "дүүрэг" : "хот"}`;
}

/** "Ховд аймгийн", "Хан-Уул дүүргийн", "Улаанбаатар хотын" (for "… мэдээ"). */
export function placeGenitive(p: Place): string {
  return `${p.name} ${p.kind === "aimag" ? "аймгийн" : p.kind === "district" ? "дүүргийн" : "хотын"}`;
}

/** The place a scraped local source belongs to (the capital's own sites map to the capital). */
export function placeOfDomain(domain: string): Place | undefined {
  return PLACES.find((p) => p.kind !== "capital" && p.domains.includes(domain)) ?? PLACES.find((p) => p.domains.includes(domain));
}

/** Area names in a constituency string, without "аймаг" / "дүүрэг" / "тойрог" words or numbers. */
function areas(constituency: string): { name: string; hint: PlaceKind | null }[] {
  return constituency
    .split(/[,;]|\s+ба\s+|\s+болон\s+/)
    .map((raw) => {
      // "3-р тойрог: Ховд" → "Ховд"; "1 Ховд" → "Ховд".
      const t = raw.replace(/^[^:]*:/u, "").trim().replace(/^\d+[-\s]*(р|дугаар)?\s*/u, "");
      const hint: PlaceKind | null = /\sдүүрэг$/iu.test(t) ? "district" : /\sаймаг$/iu.test(t) ? "aimag" : null;
      return { name: t.replace(/\s+(аймаг|дүүрэг|тойрог|нийслэл)$/iu, "").trim(), hint };
    })
    .filter((a) => a.name);
}

const DISTRICT_NAMES = new Set(DISTRICTS.map((d) => d.name));
const AIMAG_NAMES = new Set(PLACES.filter((p) => p.kind === "aimag").map((p) => p.name));
const CAPITAL_NAMES = new Set(["Улаанбаатар", "Нийслэл"]);

/**
 * Whether a constituency (as parliament.mn names it) covers this place, by the areas it lists
 * rather than the exact string, so a constituency map redrawn or re-ordered after an election
 * still finds its MPs. "Сүхбаатар" is both an aimag and a district: the "дүүрэг"/"аймаг" word or
 * the other areas in the same constituency decide; alone and unmarked it matches neither. The
 * capital's page covers every district's constituency and a city-wide one.
 */
export function placeMatchesConstituency(place: Place, constituency: string | null): boolean {
  if (!constituency) return false;
  const list = areas(constituency);
  if (place.kind === "capital") return list.some((a) => CAPITAL_NAMES.has(a.name) || (DISTRICT_NAMES.has(a.name) && !AIMAG_NAMES.has(a.name)) || (a.hint === "district" && DISTRICT_NAMES.has(a.name)));
  const hit = list.find((a) => a.name === place.name);
  if (!hit) return false;
  const ambiguous = DISTRICT_NAMES.has(place.name) && AIMAG_NAMES.has(place.name);
  if (!ambiguous) return true;
  if (hit.hint) return hit.hint === place.kind;
  const others = list.filter((a) => a !== hit);
  if (others.some((a) => DISTRICT_NAMES.has(a.name) && !AIMAG_NAMES.has(a.name))) return place.kind === "district";
  if (others.some((a) => AIMAG_NAMES.has(a.name) && !DISTRICT_NAMES.has(a.name))) return place.kind === "aimag";
  return false;
}
