/**
 * Where a tender's money goes, from its own text (the owner, Nov 2026: «Миний ₮ хаашаа явсан бэ?»).
 * Form 1831 has no address: a local budget names its aimag as the budget governor ("Өмнөговь",
 * "Нийслэл"), and the buyer's name often names the sum or district ("Ханбогд сумын ЗДТГ"). Places
 * come from GeoNames (aimag centres, 299 sum centres; CC BY 4.0) and hand-placed Ulaanbaatar
 * districts: `places.json` rows are [name, aimag, lon, lat, kind] with kind 1 = aimag centre,
 * 2 = UB district, 0 = sum. Many sum names there are GeoNames' Latin spelling, so names are compared
 * through `placeKey`, a lossy spelling both scripts reduce to.
 */
import PLACES from "./places.json";

export const AIMAGS = [
  "Улаанбаатар", "Архангай", "Баян-Өлгий", "Баянхонгор", "Булган", "Говь-Алтай", "Говьсүмбэр", "Дархан-Уул", "Дорноговь", "Дорнод", "Дундговь",
  "Завхан", "Орхон", "Өвөрхангай", "Өмнөговь", "Сүхбаатар", "Сэлэнгэ", "Төв", "Увс", "Ховд", "Хөвсгөл", "Хэнтий",
] as const;
export type Aimag = (typeof AIMAGS)[number];

export interface Place {
  name: string;
  aimag: Aimag;
  lon: number;
  lat: number;
  kind: "centre" | "district" | "sum";
}

export const ALL_PLACES: Place[] = (PLACES as [string, Aimag, number, number, number][]).map(([name, aimag, lon, lat, k]) => ({
  name,
  aimag,
  lon,
  lat,
  kind: k === 1 ? "centre" : k === 2 ? "district" : "sum",
}));

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "j", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", ө: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ү: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
};

/** One spelling for "Ханбогд" and GeoNames' "Hanbogd" / "Khanbogd", "Завхан" and "Dzavhan". */
export function placeKey(name: string): string {
  let s = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  s = [...s].map((ch) => CYR[ch] ?? ch).join("");
  return s
    .replace(/[öő]/g, "o")
    .replace(/[üű]/g, "u")
    .replace(/kh/g, "h")
    .replace(/ts/g, "c")
    .replace(/dz/g, "z")
    .replace(/w/g, "v")
    .replace(/y/g, "i")
    .replace(/[^a-z]/g, "");
}

const AIMAG_BY_KEY = new Map<string, Aimag>(AIMAGS.map((a) => [placeKey(a), a]));
AIMAG_BY_KEY.set(placeKey("Нийслэл"), "Улаанбаатар");
AIMAG_BY_KEY.set(placeKey("Говь-Сүмбэр"), "Говьсүмбэр");

/** The genitive stems text uses: "Өмнөговь аймгийн", "Говь-Алтай аймгийн", "Баянзүрх дүүргийн". */
const AIMAG_IN_TEXT = new RegExp(`(${AIMAGS.map((a) => a.replace("-", "[- ]?")).join("|")}) (аймаг|аймгийн)`, "i");
const UB_IN_TEXT = /(нийслэл|улаанбаатар|баянзүрх|сүхбаатар дүүрг|чингэлтэй|баянгол|хан-уул|сонгинохайрхан|налайх|багануур|багахангай)/i;

/** The aimag a tender's money goes to, or null (a ministry buying for the whole country). */
export function aimagOf(t: { governor: string | null; orgName: string | null }): Aimag | null {
  const g = t.governor ? AIMAG_BY_KEY.get(placeKey(t.governor)) : undefined;
  if (g) return g;
  const org = t.orgName ?? "";
  const m = AIMAG_IN_TEXT.exec(org);
  if (m) return AIMAG_BY_KEY.get(placeKey(m[1])) ?? null;
  return UB_IN_TEXT.test(org) ? "Улаанбаатар" : null;
}

const BY_AIMAG = new Map<Aimag, Place[]>();
for (const p of ALL_PLACES) BY_AIMAG.set(p.aimag, [...(BY_AIMAG.get(p.aimag) ?? []), p]);

/** The aimag centre (Ulaanbaatar: Sükhbaatar Square). */
export function centreOf(aimag: Aimag): Place {
  if (aimag === "Улаанбаатар") return { name: "Улаанбаатар", aimag, lon: 106.917, lat: 47.918, kind: "centre" };
  return BY_AIMAG.get(aimag)?.find((p) => p.kind === "centre") ?? BY_AIMAG.get(aimag)![0];
}

/** A sum, town or district of this aimag the text names ("Ханбогд сумын", "Баянзүрх дүүргийн", "Даланзадгад хотын"), or null. */
export function placeIn(text: string, aimag: Aimag): Place | null {
  const places = BY_AIMAG.get(aimag) ?? [];
  for (const m of text.matchAll(/([А-ЯӨҮЁа-яөүё-]{3,})\s+(сум|сумын|дүүрэг|дүүргийн|хот|хотын)/g)) {
    const key = placeKey(m[1]);
    const hit = places.find((p) => placeKey(p.name) === key);
    if (hit) return hit;
  }
  return null;
}
