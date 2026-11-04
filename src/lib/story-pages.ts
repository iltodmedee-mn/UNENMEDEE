/**
 * Pages /story-image can draw (src/app/story-image/route.tsx): these fixed pages and every
 * article. The share menu offers "Story" only here (Nov 2026 audit: on /tenders, /documents and
 * other pages the image answered 404 and the button silently reset). Client-safe: no imports.
 */
export const STORY_PAGE_PATHS = ["/", "/budget", "/tax", "/laws", "/officials/companies", "/officials", "/digest"] as const;

export function hasStoryImage(path: string): boolean {
  return (STORY_PAGE_PATHS as readonly string[]).includes(path) || /^\/article\/[\w-]{1,200}$/.test(path);
}
