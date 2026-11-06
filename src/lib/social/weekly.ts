/**
 * "7 хоногийн ТОП": a Monday-morning list of the past week in plain counts, for the younger
 * readers on Discord and the other channels. Every line is a count or a record with its link:
 * the biggest ₮ amount a story named (and its per-person share), the story the most sources
 * reported, the MP named in the most stories (a count, never a verdict; shared short names are
 * left out), new legal acts and the week's totals. Rule-based, no AI.
 */
import { amountValue, formatNumber, largestAmount } from "@/lib/format";
import { formatShare, perPersonShare, POPULATION_LABEL } from "@/lib/per-person";
import { PRODUCTION_URL } from "@/lib/site";

import { cut } from "./threads";

export interface WeeklyTop {
  /** ISO week as yyyyww (Ulaanbaatar), the social_posts ref id. */
  week: number;
  /** "10-р сарын 19–25". */
  label: string;
  biggest?: { title: string; slug: string; amount: string; amounts: string[] };
  hottest?: { title: string; clusterId: number; sources: number };
  mostNamed?: { name: string; politicianId: number; stories: number };
  legalActs: number;
  articles: number;
  sources: number;
  risky: number;
}

const UB_OFFSET_MS = 8 * 3_600_000;

/** The Ulaanbaatar calendar day of an instant, as a UTC date at midnight. */
export function ubDay(now: Date): Date {
  const d = new Date(now.getTime() + UB_OFFSET_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** ISO 8601 week number of a UTC-midnight date, as yyyyww. */
export function isoWeek(day: Date): number {
  const d = new Date(day);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return year * 100 + week;
}

/** The list goes out on Monday (Ulaanbaatar) and covers Monday–Sunday of the week before. */
export function isWeeklyDue(now: Date): boolean {
  return ubDay(now).getUTCDay() === 1;
}

/** The previous Monday–Sunday in Ulaanbaatar: its week number, label and UTC bounds. */
export function previousWeek(now: Date): { week: number; label: string; from: Date; to: Date } {
  const today = ubDay(now);
  const back = (today.getUTCDay() || 7) - 1 + 7;
  const monday = new Date(today.getTime() - back * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  const m = (d: Date) => `${d.getUTCMonth() + 1}-р сарын ${d.getUTCDate()}`;
  const label = monday.getUTCMonth() === sunday.getUTCMonth() ? `${m(monday)}–${sunday.getUTCDate()}` : `${m(monday)} – ${m(sunday)}`;
  return { week: isoWeek(monday), label, from: new Date(monday.getTime() - UB_OFFSET_MS), to: new Date(monday.getTime() + 7 * 86_400_000 - UB_OFFSET_MS) };
}

/** The story naming the largest ₮ amount. */
export function biggestAmount<T extends { amounts: string[] }>(rows: T[]): (T & { amount: string; value: number }) | undefined {
  let best: (T & { amount: string; value: number }) | undefined;
  for (const r of rows) {
    const amount = largestAmount(r.amounts);
    const value = amount ? amountValue(amount) : null;
    if (amount && value !== null && (!best || value > best.value)) best = { ...r, amount, value };
  }
  return best;
}

/** The active MP named in the most stories (exact short-name matches, shared names left out), at least 2. */
/** `politicians`: every member, inactive ones included; only active members can be named (`isActive`). */
export function mostNamed(people: string[][], politicians: { id: number; shortName: string; isActive?: boolean }[], shared: Set<string>): WeeklyTop["mostNamed"] {
  const byName = new Map(politicians.filter((p) => p.isActive !== false && !shared.has(p.shortName)).map((p) => [p.shortName, p.id]));
  const counts = new Map<string, number>();
  for (const names of people) for (const n of new Set(names)) if (byName.has(n)) counts.set(n, (counts.get(n) ?? 0) + 1);
  const [name, stories] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
  return name && stories >= 2 ? { name, politicianId: byName.get(name) as number, stories } : undefined;
}

type Style = "discord" | "plain";

/** One list for every channel: Discord gets bold and <links>, the others plain text. */
export function weeklyText(w: WeeklyTop, style: Style, site = PRODUCTION_URL): string {
  const b = (s: string) => (style === "discord" ? `**${s.replace(/\*/g, "")}**` : s);
  const link = (url: string) => (style === "discord" ? `<${url}>` : url);
  const lines = [`📊 ${b("7 хоногийн ТОП")} · ${w.label}`, ""];
  if (w.biggest) {
    const share = perPersonShare([w.biggest.amount]);
    lines.push(`💸 ${b("Хамгийн том дүн")}: ${w.biggest.amount}${share !== null ? ` (${POPULATION_LABEL} хүнд хуваавал ${formatShare(share)} / хүн)` : ""}`);
    lines.push(`${style === "discord" ? "> " : "   "}${w.biggest.title} ${link(`${site}/article/${w.biggest.slug}`)}`);
  }
  if (w.hottest) lines.push(`🔥 ${b("Хамгийн олон эх сурвалж мэдээлсэн")}: ${w.hottest.title} · ${w.hottest.sources} эх сурвалж ${link(`${site}/clusters/${w.hottest.clusterId}`)}`);
  if (w.mostNamed) lines.push(`🗣 ${b("Мэдээнд хамгийн олон нэр гарсан гишүүн")}: ${w.mostNamed.name} · ${w.mostNamed.stories} мэдээ (тоо, үнэлгээ биш) ${link(`${site}/officials/${w.mostNamed.politicianId}`)}`);
  if (w.legalActs > 0) lines.push(`📜 ${b("Шинэ хууль, тогтоол")}: ${w.legalActs} ${link(`${site}/laws`)}`);
  lines.push(`📰 ${formatNumber(w.articles)} мэдээ · ${w.sources} эх сурвалж${w.risky > 0 ? ` · ⚠️ ${w.risky} өндөр эрсдэлтэй (AI-ийн үнэлгээ)` : ""}`);
  lines.push("", `👉 Өдөр бүрийн тойм: ${link(`${site}/digest`)}`);
  return lines.join("\n");
}

/** Threads allows 500 characters: the title, the biggest amount, the hottest story and the link. */
export function weeklyShortText(w: WeeklyTop, site = PRODUCTION_URL): string {
  const lines = [`📊 7 хоногийн ТОП · ${w.label}`];
  if (w.biggest) lines.push(`💸 Хамгийн том дүн: ${w.biggest.amount}`);
  if (w.hottest) lines.push(`🔥 ${w.hottest.title} · ${w.hottest.sources} эх сурвалж`);
  if (w.legalActs > 0) lines.push(`📜 ${w.legalActs} шинэ хууль, тогтоол`);
  lines.push(`📰 ${formatNumber(w.articles)} мэдээ`, `👉 ${site}/digest`);
  return cut(lines.join("\n"), 500);
}
