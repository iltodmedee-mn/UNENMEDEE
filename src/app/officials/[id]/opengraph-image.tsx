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
 * the IAAC filing only, no marker. The portrait is parliament.mn's own official photo (the one the
 * profile page shows), fetched once per render; the card renders without it if that fails.
 */
const PHOTO_MAX_BYTES = 1_500_000;

/** parliament.mn's official portrait as a data URI, or null (other hosts, errors, odd answers). */
async function officialPhoto(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || (u.hostname !== "parliament.mn" && u.hostname !== "www.parliament.mn")) return null;
    const res = await fetch(u, { signal: AbortSignal.timeout(5_000), redirect: "error" });
    const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!res.ok || (type !== "image/jpeg" && type !== "image/png")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

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
    photo: await officialPhoto(p.photoUrl),
  });
}
