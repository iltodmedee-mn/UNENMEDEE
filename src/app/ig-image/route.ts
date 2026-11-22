import { editionLabel } from "@/lib/edition";
import { largestAmount, tldrSentences } from "@/lib/format";
import { jpegResponse } from "@/lib/jpeg";
import { type FeedCard, hookCard } from "@/lib/og";
import { formatShare, perPersonShare } from "@/lib/per-person";
import { getArticleBySlug, getDigestById } from "@/lib/queries";
import { hookWords } from "@/lib/social/hook";
import { canonicalImageQuery } from "@/lib/site";
import { topicFor } from "@/lib/topics";

/** "11.06", the Ulaanbaatar day. */
const ubDay = (d: Date) => {
  const u = new Date(d.getTime() + 8 * 3_600_000);
  return `${String(u.getUTCMonth() + 1).padStart(2, "0")}.${String(u.getUTCDate()).padStart(2, "0")}`;
};

/**
 * The social feed card as JPEG (Facebook, Instagram, Threads, Telegram, Discord) (GET /ig-image?d=<digest id> or ?a=<article slug>): Instagram's
 * publishing API accepts only JPEG fetched from a public URL, while next/og renders PNG, so the PNG
 * is re-encoded here with pure-JS codecs (sharp is kept out of the functions, see next.config.ts).
 * Text comes from our own data, never from the query string.
 */
async function cardFor(params: URLSearchParams): Promise<FeedCard | null> {
  const d = params.get("d");
  if (d && /^\d{1,9}$/.test(d)) {
    const digest = await getDigestById(Number(d));
    const [top, ...rest] = digest?.items ?? [];
    if (!digest || !top) return null;
    return {
      series: editionLabel(digest),
      corner: `${digest.items.length} мэдээ`,
      kicker: "Гол мэдээ",
      words: hookWords(top.headline),
      sub: top.whyItMatters || undefined,
      list: rest.slice(0, 3).map((it) => it.headline),
      credit: [["Бүх мэдээ", "эх сурвалжтай"]],
      ghost: "mark",
    };
  }
  const slug = params.get("a");
  if (slug && /^[\w-]{1,200}$/.test(slug)) {
    const a = await getArticleBySlug(slug);
    if (!a) return null;
    const amount = largestAmount(a.amounts);
    const share = perPersonShare(a.amounts);
    return {
      series: a.riskFlag ? "Анхаарах мэдээ" : "Шинэ мэдээ",
      corner: a.dateUnknown || !a.publishedAt ? "" : ubDay(new Date(a.publishedAt)),
      kicker: topicFor(a.sourceDomain, a.sourceCategory, a.topic).label,
      words: hookWords(a.title),
      // "Танд хамаатай юу?" when the text says who it changes things for, else the first summary sentence.
      sub: a.impact?.change ? `${a.impact.who ? `${a.impact.who}: ` : ""}${a.impact.change}` : tldrSentences(a.tldr, 1)[0],
      amount,
      share: share !== null ? formatShare(share) : null,
      fact: a.summaryFallback ? null : a.neutralityScore,
      credit: [["Эх сурвалж", a.sourceName]],
      ghost: amount ? "₮" : "mark",
    };
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  // One card, one URL: with ?d= the slug is ignored, so "?d=1&a=<random>" was a new CDN key per
  // request and a fresh Satori + JPEG render each time; "d=01" likewise (Nov 2026 audit S-7).
  const d = url.searchParams.get("d");
  if (d !== null && !/^[1-9]\d{0,8}$/.test(d)) return new Response("Not found", { status: 404 });
  const canonical = canonicalImageQuery(url, d !== null ? ["d"] : ["a"]);
  if (canonical) return Response.redirect(new URL(canonical, url), 308);
  const card = await cardFor(url.searchParams);
  if (!card) return new Response("Not found", { status: 404 });
  return jpegResponse(await hookCard(card));
}
