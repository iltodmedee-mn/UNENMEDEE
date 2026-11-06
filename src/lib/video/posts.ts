/**
 * The text that goes with a video on Facebook, Instagram and Threads. Client-safe and pure: the
 * numbers are the ones the video shows (stored with it as `VideoMeta`), worded as plain nominal ₮
 * or plain division with the source, never a verdict.
 */
import { formatNumber } from "@/lib/format";
import { hashtags } from "@/lib/social/hashtags";
import { cut, THREADS_MAX, threadsLength } from "@/lib/social/threads";
import { POPULATION_LABEL } from "@/lib/per-person";
import { PRODUCTION_URL } from "@/lib/site";

export type VideoMeta = PriceVideoMeta | MoneyVideoMeta | ImpactVideoMeta;

export interface PriceVideoMeta {
  kind: "prices";
  goodKey: string;
  title: string;
  then: { month: string; value: number; years: number };
  now: { month: string; value: number };
  yearPct: number | null;
  /** "iltodmedee.mn/prices#beef" */
  link: string;
}

/** "ХҮН БҮРТ ХУВААВАЛ" (money-video.ts): one story's ₮ amount divided by the population. */
export interface MoneyVideoMeta {
  kind: "money";
  articleId: number;
  headline: string;
  /** "170.1 тэрбум ₮", "≈ 49 700₮" */
  amountLabel: string;
  shareLabel: string;
  sourceName: string;
  topic: string | null;
  /** "iltodmedee.mn/article/<slug>" */
  link: string;
}

/** "30 СЕК МЭДЭЭ" (impact-video.ts): one story told the way a news creator tells it. */
export interface ImpactVideoMeta {
  kind: "impact";
  articleId: number;
  headline: string;
  /** "What happened": the AI summary's first sentence or two (videos made before Nov 6 2026 have none). */
  what?: string | null;
  who: string | null;
  change: string | null;
  when: string | null;
  action: string | null;
  sourceName: string;
  topic: string | null;
  /** "iltodmedee.mn/article/<slug>" */
  link: string;
}

const monthLabel = (m: string) => `${m.slice(0, 4)} оны ${Number(m.slice(5, 7))}-р сар`;

function core(v: VideoMeta): string[] {
  if (v.kind === "impact")
    return [
      `📌 ${v.headline}`,
      "",
      ...(v.what ? [`📝 Юу болсон бэ: ${v.what}`] : []),
      ...(v.who ? [`👥 Хэнд: ${v.who}`] : []),
      ...(v.change ? [`🔄 Юу өөрчлөгдөх: ${v.change}`] : []),
      ...(v.when ? [`📅 Хэзээнээс: ${v.when}`] : []),
      ...(v.action ? [`✅ Юу хийх: ${v.action}`] : []),
      "",
      `Эх сурвалж: ${v.sourceName}. Товчлолыг AI эх мэдээнээс хийсэн.`,
    ];
  if (v.kind === "money")
    return [
      `💸 ${v.headline}`,
      `${v.amountLabel} ÷ ${POPULATION_LABEL} хүн = нэг хүнд ${v.shareLabel}`,
      `Энгийн хуваалт (хүн ам: ҮСХ), хүн бүр төлнө гэсэн үг биш. Эх сурвалж: ${v.sourceName}.`,
      "Энэ мөнгө юунд зарцуулагдах вэ?",
    ];
  const year =
    v.yearPct === null ? [] : v.yearPct >= 1 ? [`📈 Сүүлийн 1 жилд ▲ ${v.yearPct}%`] : v.yearPct <= -1 ? [`📉 Сүүлийн 1 жилд ▼ ${-v.yearPct}%`] : ["Сүүлийн 1 жилд бараг өөрчлөгдөөгүй"];
  return [
    `🛒 ${v.title}: ${v.then.years} жилийн өмнө ${formatNumber(v.then.value)}₮ → одоо ${formatNumber(v.now.value)}₮`,
    ...year,
    `Улаанбаатарын сарын дундаж үнэ (${monthLabel(v.then.month)} ба ${monthLabel(v.now.month)}), нэрлэсэн ₮. Эх сурвалж: Үндэсний статистикийн хороо.`,
  ];
}

const topicOf = (v: VideoMeta) => (v.kind === "prices" ? "prices" : v.topic);
const more = (v: VideoMeta) => (v.kind === "prices" ? "13 барааны 15 жилийн үнэ" : "Дэлгэрэнгүй");

const url = (v: VideoMeta, site: string) => `${site}/${v.link.replace(/^iltodmedee\.mn\//, "")}`;

export function facebookVideoText(v: VideoMeta, site = PRODUCTION_URL): string {
  return [...core(v), "", `👉 ${more(v)}: ${url(v, site)}`, "", hashtags("facebook", topicOf(v))].join("\n");
}

export function instagramVideoCaption(v: VideoMeta): string {
  const tail = v.kind !== "prices" ? "Мэдээний дэлгэрэнгүй: iltodmedee.mn (холбоос bio-д)" : "13 барааны 15 жилийн үнэ, аймаг бүрээр: iltodmedee.mn (холбоос bio-д)";
  return [...core(v), "", tail, "", hashtags("instagram", topicOf(v))].join("\n");
}

export function threadsVideoText(v: VideoMeta, site = PRODUCTION_URL): string {
  const tail = `\n\n👉 ${url(v, site)}\n${hashtags("threads", topicOf(v))}`;
  return cut(core(v).join("\n"), THREADS_MAX - threadsLength(tail)) + tail;
}
