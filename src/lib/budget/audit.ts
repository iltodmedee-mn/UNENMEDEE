import * as cheerio from "cheerio";

import { politeFetch } from "@/lib/scraper/http";

/**
 * National Audit Office (audit.mn) report register: the latest reports with a qualified,
 * adverse or disclaimer opinion. audit.mn omits its RapidSSL intermediate certificate; the
 * public intermediate is shipped in certs/ and passed with NODE_EXTRA_CA_CERTS (verification
 * stays on). No robots.txt (404).
 */
export const AUDIT_URL = "https://audit.mn/audit";
export const OPINIONS = ["Сөрөг дүгнэлт", "Татгалзсан дүгнэлт", "Хязгаарлалтай дүгнэлт"] as const;
export type Opinion = (typeof OPINIONS)[number];

export interface AuditReport {
  id: string;
  title: string;
  office: string | null;
  auditType: string | null;
  opinion: Opinion;
  url: string;
}

export function parseAuditList(html: string, opinion: Opinion): { total: number | null; reports: AuditReport[] } {
  const $ = cheerio.load(html);
  const total = Number($("p:contains('илэрц')").first().find("b").first().text().replace(/,/g, ""));
  const reports: AuditReport[] = [];
  $("table#example tbody tr").each((_, tr) => {
    const cells = $(tr).children("td");
    const link = $(tr).find("a[href*='report_detail/']").first();
    const id = link.attr("href")?.match(/report_detail\/(\d+)/)?.[1];
    if (!id) return;
    const text = (i: number) => cells.eq(i).text().replace(/\s+/g, " ").trim() || null;
    reports.push({ id, title: link.text().replace(/\s+/g, " ").trim(), office: text(4), auditType: text(6), opinion, url: `https://audit.mn/audit/report_detail/${id}` });
  });
  return { total: Number.isFinite(total) && total > 0 ? total : null, reports };
}

export interface AuditSnapshot {
  totals: Record<Opinion, number | null>;
  reports: AuditReport[];
}

export async function fetchAuditOpinions(perOpinion = 10): Promise<AuditSnapshot> {
  const totals = {} as Record<Opinion, number | null>;
  const reports: AuditReport[] = [];
  for (const opinion of OPINIONS) {
    const res = await politeFetch(`${AUDIT_URL}?audit_opinion_type=${encodeURIComponent(opinion)}`);
    if (!res.ok) throw new Error(`audit.mn returned HTTP ${res.status}`);
    const parsed = parseAuditList(await res.text(), opinion);
    totals[opinion] = parsed.total;
    reports.push(...parsed.reports.slice(0, perOpinion));
  }
  // A changed page reads as "no reports": throw, so the previous snapshot stays instead of a page
  // saying audit.mn has no adverse opinions.
  if (reports.length === 0 && Object.values(totals).every((t) => t === null)) throw new Error("audit.mn: no reports or totals parsed (page layout changed?)");
  return { totals, reports };
}
