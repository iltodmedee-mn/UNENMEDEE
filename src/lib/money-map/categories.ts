/**
 * What a tender buys, from its title (the map's legend and icons, Nov 2026). Keyword rules, first
 * match wins, so the specific ones come first ("цэвэрлэх байгууламж" is water, "сургуулийн барилга"
 * is a school). The icon paths are the site's own topic icons (src/components/iltod/topic-icon.tsx,
 * Lucide, ISC) as SVG markup: the map draws them as images, without React.
 */
export const CATEGORIES = ["infrastructure", "education", "health", "economy", "environment", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  infrastructure: "Зам, барилга, дэд бүтэц",
  education: "Сургууль, цэцэрлэг",
  health: "Эмнэлэг",
  economy: "Бараа, хүнс, түлш",
  environment: "Ус, байгаль",
  other: "Бусад",
};

/** Fill colours on the map: the topic colours' 400 shades, readable on both map styles. */
export const CATEGORY_COLOR: Record<Category, string> = {
  infrastructure: "#38bdf8",
  education: "#e879f9",
  health: "#34d399",
  economy: "#fbbf24",
  environment: "#a3e635",
  other: "#94a3b8",
};

/** The topic icon each category borrows (TOPIC_ICONS keys). */
export const CATEGORY_TOPIC: Record<Category, string> = {
  infrastructure: "infrastructure",
  education: "education",
  health: "health",
  economy: "economy",
  environment: "environment",
  other: "other",
};

export const CATEGORY_SVG: Record<Category, string> = {
  infrastructure: "<path d=\"M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5\"></path><path d=\"M14 6a6 6 0 0 1 6 6v3\"></path><path d=\"M4 15v-3a6 6 0 0 1 6-6\"></path><rect x=\"2\" y=\"15\" width=\"20\" height=\"4\" rx=\"1\"></rect>",
  education: "<path d=\"M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z\"></path><path d=\"M22 10v6\"></path><path d=\"M6 12.5V16a6 3 0 0 0 12 0v-3.5\"></path>",
  health: "<path d=\"M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z\"></path><path d=\"M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27\"></path>",
  economy: "<polyline points=\"22 7 13.5 15.5 8.5 10.5 2 17\"></polyline><polyline points=\"16 7 22 7 22 13\"></polyline>",
  environment: "<path d=\"M7 20h10\"></path><path d=\"M10 20c5.5-2.5.8-6.4 3-10\"></path><path d=\"M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z\"></path><path d=\"M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z\"></path>",
  other: "<path d=\"m3 11 18-5v12L3 14v-3z\"></path><path d=\"M11.6 16.8a3 3 0 1 1-5.8-1.6\"></path>",
};

const RULES: [Category, RegExp][] = [
  ["health", /эмнэлэг|эрүүл мэнд|эмийн|эм тариа|оношил|мэс засал|(^|[^а-яёөү])ЭМТ([^а-яёөү]|$)|амбулатори|рентген/i],
  ["education", /сургууль|сургуулийн|цэцэрлэг|дотуур байр|сургалт|номын сан|спорт|соёлын төв|биеийн тамир/i],
  ["environment", /цэвэрлэх байгууламж|ус хангамж|худаг|булаг|усалгаа|услалт|хог хаягдал|мод тарих|ногоон байгууламж|байгаль орчин|ойжуулалт|цөөрөм|сэргээгдэх эрчим/i],
  ["infrastructure", /зам|гүүр|барилга|засвар|орон сууц|шугам|дулаан|цахилгаан|уурын зуух|гэрэлтүүлэг|тохижилт|байгууламж|сүлжээ|дата төв|камер|өргөтгөл/i],
  ["economy", /түлш|шатахуун|хүнс|хоол|бараа|нийлүүл|материал|тоног|автомашин|тавилга|хангамж|худалдан авах/i],
];

export function categoryOf(title: string): Category {
  for (const [c, re] of RULES) if (re.test(title)) return c;
  return "other";
}
