import { notFound } from "next/navigation";

import { formatDateMn, largestAmount } from "@/lib/format";
import { OG_SIZE, ogImage } from "@/lib/og";
import { formatShare, perPersonShare } from "@/lib/per-person";
import { getArticleCard } from "@/lib/queries";
import { topicFor } from "@/lib/topics";

export const alt = "ИЛ ТОД МЭДЭЭ";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const article = await getArticleCard((await params).slug);
  // An unknown slug is a 404, not a fresh render: made-up slugs must not cost a render each.
  if (!article) notFound();
  const topic = topicFor(article.sourceDomain, article.sourceCategory, article.topic);
  const label = topic.key === "local" || topic.key === "other" ? article.sourceName : topic.label;
  const share = perPersonShare(article.amounts);
  return ogImage({
    // A risk-flagged story gets the dark card and says so (an AI estimate, like the page's badge).
    eyebrow: article.riskFlag ? `${label} · Өндөр эрсдэл · ${article.riskScore}` : label,
    title: article.title,
    // Undated stories: publishedAt is when we found them, never shown as a publication date.
    footer: article.dateUnknown ? "Огноо тодорхойгүй" : article.publishedAt ? formatDateMn(article.publishedAt) : article.sourceName,
    amount: largestAmount(article.amounts),
    share: share === null ? null : formatShare(share),
    tone: article.riskFlag ? "dark" : "light",
    dot: article.riskFlag ? "#f97066" : topic.hex,
  });
}
