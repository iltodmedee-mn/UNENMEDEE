/**
 * Pure half of scripts/check-layout.ts (unit-tested): which pages to open, and the shape of an
 * overflow report that `npm run health` reads.
 */
export interface LayoutOverflow {
  path: string;
  /** The phone width the page was opened at. */
  viewport: number;
  /** The page's real width there. */
  width: number;
  /** The outermost element past the right edge, for the issue text. */
  culprit: string;
}

/** Pages every scan opens: each kind of layout, including the cards that broke in Nov 2026. */
export const LAYOUT_BASE_PAGES = ["/", "/digest", "/risk", "/clusters", "/officials", "/budget", "/prices", "/tax", "/laws", "/tenders", "/documents", "/search?q=төсөв"];

/**
 * The sitemap's pages, at most `perSection` per first path segment (every /article/… shares one
 * layout), plus the base pages and any extra ones, each path once.
 */
export function layoutPages(sitemapUrls: string[], extra: string[] = [], perSection = 2): string[] {
  const seen = new Map<string, number>();
  const out = new Set<string>([...LAYOUT_BASE_PAGES, ...extra]);
  for (const url of sitemapUrls) {
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      continue;
    }
    const section = path.split("/")[1] ?? "";
    const n = seen.get(section) ?? 0;
    if (n >= perSection) continue;
    seen.set(section, n + 1);
    out.add(path);
  }
  return [...out];
}

/** Reads a report file's JSON; anything malformed is "no report" (the scan did not run). */
export function parseLayoutReport(json: string | null | undefined): LayoutOverflow[] | undefined {
  if (!json) return undefined;
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return undefined;
    return v.filter(
      (o): o is LayoutOverflow => !!o && typeof o === "object" && typeof (o as LayoutOverflow).path === "string" && Number.isFinite((o as LayoutOverflow).width) && Number.isFinite((o as LayoutOverflow).viewport),
    );
  } catch {
    return undefined;
  }
}
