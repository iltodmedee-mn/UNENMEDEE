import type { MetadataRoute } from "next";

import { FEED_FILTERS, getArchiveDays, getPoliticianIds, getSitemapSlugs, getSourceHubDomains } from "@/lib/queries";
import { absoluteUrl } from "@/lib/site";
import { PLACES } from "@/lib/places";
import { ALL_DIRECTIONS } from "@/lib/promises";
import { PROJECTS } from "@/lib/projects/data";
import { directionSlug } from "@/lib/promises/programme";
import { TOPICS } from "@/lib/topics";

/** Every public page and article. Builds without a database (static pages only). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [articles, officials, days, hubs] = await Promise.all([
    getSitemapSlugs(45_000) /* a sitemap holds 50k URLs: every published article is listed */,
    getPoliticianIds(),
    getArchiveDays(180),
    getSourceHubDomains(),
  ]);
  const newest = articles[0]?.lastModified;
  const pages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: newest, changeFrequency: "hourly", priority: 1 },
    { url: absoluteUrl("/digest"), lastModified: newest, changeFrequency: "hourly", priority: 0.9 },
    { url: absoluteUrl("/risk"), changeFrequency: "hourly", priority: 0.8 },
    { url: absoluteUrl("/clusters"), changeFrequency: "hourly", priority: 0.7 },
    { url: absoluteUrl("/data"), changeFrequency: "daily", priority: 0.6 },
    { url: absoluteUrl("/officials"), changeFrequency: "weekly", priority: 0.8 },
    { url: absoluteUrl("/officials/companies"), changeFrequency: "weekly", priority: 0.7 },
    { url: absoluteUrl("/budget"), changeFrequency: "weekly", priority: 0.8 },
    { url: absoluteUrl("/prices"), changeFrequency: "weekly", priority: 0.7 },
    { url: absoluteUrl("/projects"), changeFrequency: "weekly", priority: 0.7 },
    ...PROJECTS.map((p) => ({ url: absoluteUrl(`/projects/${p.slug}`), lastModified: p.verifiedThrough, changeFrequency: "monthly" as const, priority: 0.6 })),
    { url: absoluteUrl("/tax"), changeFrequency: "monthly", priority: 0.7 },
    { url: absoluteUrl("/laws"), changeFrequency: "daily", priority: 0.8 },
    { url: absoluteUrl("/promises"), changeFrequency: "monthly", priority: 0.7 },
    { url: absoluteUrl("/discord"), changeFrequency: "monthly", priority: 0.5 },
    ...ALL_DIRECTIONS.map(({ direction }) => ({ url: absoluteUrl(`/promises/${directionSlug(direction.id)}`), changeFrequency: "monthly" as const, priority: 0.5 })),
    { url: absoluteUrl("/support"), changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/privacy"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/sources"), changeFrequency: "daily", priority: 0.4 },
    { url: absoluteUrl("/archive"), lastModified: newest, changeFrequency: "daily", priority: 0.5 },
    { url: absoluteUrl("/transparency"), changeFrequency: "daily", priority: 0.4 },
    { url: absoluteUrl("/changes"), changeFrequency: "weekly", priority: 0.5 },
    { url: absoluteUrl("/tenders"), changeFrequency: "daily", priority: 0.7 },
    { url: absoluteUrl("/documents"), changeFrequency: "daily", priority: 0.6 },
    { url: absoluteUrl("/request"), changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/glossary"), changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/participate"), changeFrequency: "daily", priority: 0.5 },
    { url: absoluteUrl("/method"), changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/about"), changeFrequency: "monthly", priority: 0.5 },
    // Every prerendered feed page except "all" (= "/"): the topics plus risk, budget, ministry.
    ...[...new Set(FEED_FILTERS)]
      .filter((f) => f !== "all")
      .map((f) => ({ url: absoluteUrl(`/topic/${f}`), changeFrequency: "hourly" as const, priority: TOPICS.some((t) => t.key === f) ? 0.8 : 0.7 })),
    ...PLACES.map((p) => ({ url: absoluteUrl(`/place/${p.slug}`), changeFrequency: "daily" as const, priority: 0.7 })),
  ];
  return [
    ...pages,
    ...days.map((d) => ({ url: absoluteUrl(`/archive/${d.date}`), lastModified: d.lastModified, changeFrequency: "daily" as const, priority: 0.5 })),
    ...hubs.map((h) => ({ url: absoluteUrl(`/source/${h.domain}`), lastModified: h.lastModified, changeFrequency: "daily" as const, priority: 0.6 })),
    ...officials.map((id) => ({ url: absoluteUrl(`/officials/${id}`), changeFrequency: "weekly" as const, priority: 0.6 })),
    ...articles.map((a) => ({ url: absoluteUrl(`/article/${a.slug}`), lastModified: a.lastModified, changeFrequency: "weekly" as const, priority: 0.7 })),
  ];
}
