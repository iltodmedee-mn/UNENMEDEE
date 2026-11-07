import { oneLine } from "@/lib/log-safe";
import { isLatinText } from "@/lib/script";
import { newestYearMentioned, ubYear } from "@/lib/scraper/dates";

/**
 * What readers see, checked after every pipeline run (Nov 7 2026: a Latin-letter story and 14 old
 * khural.mn resolutions led the home page, and five code audits had not caught either, because
 * both came from outside data). The rules look at the outcome, not at a cause, so a new way of
 * going wrong is caught too. Each problem names the story and the rule; nothing is changed.
 */
export interface FeedCheckItem {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  source: string;
  publishedAt: Date | null;
  undated: boolean;
}

export interface FeedProblem {
  rule: "latin" | "broken" | "duplicate" | "flood" | "old-as-new" | "date";
  ids: number[];
  slugs: string[];
  text: string;
}

/** Stories of the top of the feed one site may hold before it counts as a flood. */
export const FLOOD_TOP = 20;
export const FLOOD_MAX = 4;

const BROKEN = /\bundefined\b|\[object Object\]|^\s*null\s*$|\bNaN\b/;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function feedProblems(items: FeedCheckItem[], now: Date): FeedProblem[] {
  const out: FeedProblem[] = [];
  // Scraped text goes into a GitHub issue: one line, and no "@name" that would notify someone.
  const safe = (t: string) => oneLine(t).replace(/@/g, "＠").replace(/`/g, "'");
  const label = (i: FeedCheckItem) => `#${i.id} «${safe(i.title.slice(0, 70))}» (${safe(i.source)})`;

  for (const i of items) {
    const text = `${i.title} ${i.summary ?? ""}`;
    if (isLatinText(text)) out.push({ rule: "latin", ids: [i.id], slugs: [i.slug], text: `${label(i)}: кирилл биш, латин үсгээр бичигдсэн` });
    if (!i.title.trim() || BROKEN.test(i.title) || (i.summary !== null && BROKEN.test(i.summary)))
      out.push({ rule: "broken", ids: [i.id], slugs: [i.slug], text: `${label(i)}: гарчиг эсвэл товчонд "undefined" / "null" / хоосон утга байна` });
    if (i.publishedAt && i.publishedAt.getTime() > now.getTime() + 3_600_000) out.push({ rule: "date", ids: [i.id], slugs: [i.slug], text: `${label(i)}: огноо ирээдүйд байна` });
    // An undated story is shown as found today; if every year it names is before this year it is
    // almost always an old page read as new (the khural.mn resolutions of 2025).
    const newest = i.undated ? newestYearMentioned(text, now) : null;
    if (newest !== null && newest < ubYear(now))
      out.push({ rule: "old-as-new", ids: [i.id], slugs: [i.slug], text: `${label(i)}: огноогүй, гэхдээ зөвхөн ${newest} он хүртэлх оныг дурдсан тул хуучин хуудас шинэ мэт харагдаж байж магадгүй` });
  }

  const byTitle = new Map<string, FeedCheckItem[]>();
  for (const i of items) {
    const k = norm(i.title);
    if (k) byTitle.set(k, [...(byTitle.get(k) ?? []), i]);
  }
  for (const group of byTitle.values())
    if (group.length > 1) out.push({ rule: "duplicate", ids: group.map((i) => i.id), slugs: group.map((i) => i.slug), text: `${group.length} мэдээ ижил гарчигтай: ${group.map(label).join("; ")}` });

  const bySource = new Map<string, FeedCheckItem[]>();
  for (const i of items.slice(0, FLOOD_TOP)) bySource.set(i.source, [...(bySource.get(i.source) ?? []), i]);
  for (const [source, group] of bySource)
    if (group.length > FLOOD_MAX)
      out.push({ rule: "flood", ids: group.map((i) => i.id), slugs: group.map((i) => i.slug), text: `Нүүрний эхний ${FLOOD_TOP} мэдээний ${group.length} нь нэг сайтынх (${source})` });

  return out;
}

/** The issue text: a marker line with the problem set (to update only when it changes), then one line each. */
export function feedReport(problems: FeedProblem[], siteUrl: string): string {
  if (!problems.length) return "";
  const key = problems.map((p) => `${p.rule}:${p.ids.join(",")}`).sort().join("|");
  const lines = problems.map((p) => `- ${p.text}\n  ${p.slugs.map((slug) => `${siteUrl}/article/${slug}`).join(" ")}`);
  return `<!-- feed-check: ${key} -->\nНүүр хуудасны мэдээнд дараах асуудал илэрлээ (30 минут тутам шалгадаг, юу ч өөрчлөөгүй):\n\n${lines.join("\n")}\n\nЗасах: мэдээг /admin-аас нийтлэлээс хасах эсвэл засах; шалтгааныг засуулах бол \`@gemini энэ issue-ийн асуудлыг засаад PR нээ\` гэж бичнэ. Асуудал арилмагц issue өөрөө хаагдана.\n`;
}
