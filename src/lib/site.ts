/**
 * One place for the public URL, name and search wording. Used by metadata, robots, sitemaps,
 * RSS and JSON-LD so Google sees the same canonical host everywhere.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/+$/, "");

export const SITE_NAME = "ИЛ ТОД МЭДЭЭ";
/** The production address, for links made outside Vercel (GitHub Actions posting to Facebook). */
export const PRODUCTION_URL = "https://iltodmedee.mn";
/** The public source code (MIT). Linked from the footer, /method and /transparency. */
export const REPO_URL = "https://github.com/iltodmedee-mn/UNENMEDEE";
/** Better Stack's public status page (checks the site and feed.xml every 3 minutes; docs/RUNBOOK.md). */
export const STATUS_URL = "https://status.iltodmedee.mn";
/**
 * The page background per mode (viewport theme-color, manifest) and the brand teal (manifest
 * theme_color, the logo). Must match --color-bg-primary / --color-brand-600 in src/styles/theme.css.
 */
export const THEME_COLOR = { light: "#fbfbf9", dark: "#0f1012", brand: "#047c78" } as const;
/** Contact for readers, partners and press (forwarded by Porkbun to the owner's inbox). */
export const CONTACT_EMAIL = "info@iltodmedee.mn";
/** The site's own social accounts (header, footer, mobile menu, JSON-LD sameAs). */
export const SOCIAL = {
  facebook: "https://www.facebook.com/profile.php?id=61595785044734",
  instagram: "https://www.instagram.com/iltodmedee.mn/",
  threads: "https://www.threads.com/@iltodmedee.mn",
  messenger: "https://m.me/61595785044734",
} as const;
/**
 * Discord (public links, src/app/discord/page.tsx): the server invite to our announcement channel
 * and the app's install link for the slash commands. null = not set yet; the page then says so.
 */
export const DISCORD: { invite: string | null; install: string | null } = {
  invite: "https://discord.gg/zSW5FbWRrZ",
  install: "https://discord.com/oauth2/authorize?client_id=1563927031438245888",
};
/** A file or folder in the repository on the main branch. */
export const repoFile = (path: string) => `${REPO_URL}/blob/main/${path}`;
// The Latin spelling is in the title: Google did not know "iltodmedee" yet (Oct 2026, it suggested "altamed").
export const SITE_TITLE = "ИЛ ТОД МЭДЭЭ (iltodmedee) — Монголын улс төр, эдийн засаг, төрийн шинэ мэдээ";
export const SITE_DESCRIPTION =
  "ИЛ ТОД МЭДЭЭ (iltodmedee.mn) — өнөөдрийн мэдээ: УИХ, Засгийн газар, яамд, тендер, төсөв, авлигын хэргийн шинэ мэдээг 130 гаруй төрийн эх сурвалжаас цаг тутам цуглуулж, AI-аар баримтыг пи-араас салгасан Монголын нээлттэй мэдээний сайт.";

/** Mongolian search phrases people actually type (Cyrillic and common Latin spellings). */
export const SITE_KEYWORDS = [
  "ИЛ ТОД МЭДЭЭ",
  "iltodmedee",
  "iltodmedee.mn",
  "il tod medee",
  "мэдээ",
  "шинэ мэдээ",
  "өнөөдрийн мэдээ",
  "Монголын мэдээ",
  "улс төр",
  "улс төрийн мэдээ",
  "эдийн засаг",
  "эдийн засгийн мэдээ",
  "УИХ",
  "Улсын Их Хурал",
  "Засгийн газар",
  "Засгийн газрын шийдвэр",
  "яам",
  "тендер",
  "худалдан авах ажиллагаа",
  "төсөв",
  "авлига",
  "Авлигатай тэмцэх газар",
  "хууль",
  "тогтоол",
  "уул уурхай",
  "эрүүл мэнд",
  "боловсрол",
  "орон нутаг",
  "нээлттэй өгөгдөл",
  "medee",
  "shine medee",
  "uls tur",
  "Mongolia news",
];

/** Every way people type the brand (Google "site name" + brand queries such as "iltodmedee"). */
export const SITE_ALTERNATE_NAMES = ["ИЛ ТОД", "iltodmedee", "iltodmedee.mn", "IL TOD MEDEE", "Il tod medee", "Ил тод мэдээ"];

export function absoluteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** JSON for a <script type="application/ld+json">: `<` escaped so text cannot close the tag. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** XML text/attribute escaping for sitemaps and RSS. */
export function xmlEscape(s: string): string {
  return (
    s
      // Characters XML 1.0 forbids: one in a scraped title made feed.xml and news-sitemap.xml unreadable.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
      .replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!)
  );
}

/** A numeric route id (`/clusters/12`, `/officials/46`) or null: "abc" or 3000000000 must 404, not 500. */
export function parseRouteId(raw: string): number | null {
  if (!/^\d{1,9}$/.test(raw)) return null;
  const id = Number(raw);
  return id > 0 ? id : null;
}

/** A link we render from scraped data: only http(s) URLs, never `javascript:` or `data:`. */
export function safeHttpUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The canonical form of a generated-image URL: only `keys`, each once, in that order. Any other
 * parameter (`?a=x&junk=123`) would make every request a CDN miss and a fresh 1080×1350 render, a
 * cheap way to burn the Hobby plan's CPU. Returns the canonical path + query when the URL differs,
 * or null when it is already canonical.
 */
export function canonicalImageQuery(url: URL, keys: string[]): string | null {
  const clean = new URLSearchParams();
  for (const k of keys) {
    const v = url.searchParams.get(k);
    if (v !== null) clean.set(k, v);
  }
  const query = clean.toString();
  return url.search.replace(/^\?/, "") === query ? null : `${url.pathname}${query ? `?${query}` : ""}`;
}
