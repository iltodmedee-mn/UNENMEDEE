import { notFound } from "next/navigation";

import { formatMntShort } from "@/lib/format";
import { OG_SIZE, ogImage } from "@/lib/og";
import { suspectUnitYears } from "@/lib/officials/flags";
import { getPolitician } from "@/lib/queries";
import { parseRouteId } from "@/lib/site";

export const alt = "УИХ-ын гишүүний хөрөнгө, орлогын мэдүүлэг · ИЛ ТОД МЭДЭЭ";
export const size = OG_SIZE;
export const contentType = "image/png";

/**
 * The share card of an MP profile: name, party, and the total assets of the newest filing the page
 * itself shows (hidden years and a suspected unit error are left out, as on the page). Facts from
 * the IAAC filing only; no photo, no marker.
 */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = parseRouteId((await params).id);
  const data = id ? await getPolitician(id) : null;
  // An unknown id is a 404, not a fresh render: made-up ids must not cost a render each.
  if (!data) notFound();
  const p = data.politician;
  const hidden = new Set(data.hiddenYears);
  const suspect = new Set(suspectUnitYears(data.declarations));
  const latest = [...data.declarations].reverse().find((r) => !hidden.has(r.year) && !suspect.has(r.year) && typeof r.totalAssets === "number");
  return ogImage({
    eyebrow: `УИХ-ын гишүүн${p.isActive ? "" : " (асан)"}${p.party ? ` · ${p.party}` : ""}`,
    title: `${p.shortName} (${p.fullName}): хөрөнгө, орлого, ирц`,
    amount: latest?.totalAssets != null ? `Нийт хөрөнгө ${formatMntShort(latest.totalAssets)}` : undefined,
    footer: latest ? `${latest.year} оны мэдүүлэг` : "Хөрөнгө, орлогын мэдүүлэг",
    dot: "#047c78",
  });
}
