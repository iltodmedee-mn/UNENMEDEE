import { timingSafeEqual } from "node:crypto";

/**
 * On-demand cache purge (Nov 2026: a story unpublished in the database stayed on the home page for
 * 30 minutes, the `news` cache life). The pipeline and maintenance tasks call /api/revalidate after
 * they write. No new secret is needed: both sides already reach the database, so the caller stores a
 * single-use nonce in `app_settings` and the route accepts it once, within `NONCE_TTL_MS`.
 *
 * Only the list pages are purged after a normal run ("feed": home, topics, places, archive, laws,
 * source hubs; digests; clusters). Purging "articles" re-renders every article page as crawlers
 * visit it (Vercel Hobby counts each as an ISR write), so only a maintenance repair asks for it.
 */
export const NONCE_KEY = "revalidate_nonce";
export const NONCE_TTL_MS = 5 * 60_000;
export const PURGE_TAGS = ["feed", "digests", "clusters", "articles"] as const;
export type PurgeTag = (typeof PURGE_TAGS)[number];
export const RUN_TAGS: PurgeTag[] = ["feed", "digests", "clusters"];

/** The stored value: `<nonce>|<ISO time>`. */
export const nonceValue = (nonce: string, at: Date) => `${nonce}|${at.toISOString()}`;

/** True when `given` equals the stored nonce and the nonce is younger than NONCE_TTL_MS. */
export function nonceValid(stored: string | null | undefined, given: unknown, now: Date): boolean {
  if (!stored || typeof given !== "string" || !/^[a-f0-9]{64}$/.test(given)) return false;
  const [nonce, iso] = stored.split("|");
  if (!nonce || nonce.length !== given.length) return false;
  const at = Date.parse(iso ?? "");
  if (!Number.isFinite(at) || now.getTime() - at > NONCE_TTL_MS || at - now.getTime() > 60_000) return false;
  return timingSafeEqual(Buffer.from(nonce), Buffer.from(given));
}

/** The requested tags that are allowed; unknown names are dropped. */
export function allowedTags(raw: unknown): PurgeTag[] {
  if (!Array.isArray(raw)) return [...RUN_TAGS];
  return [...new Set(raw.filter((t): t is PurgeTag => typeof t === "string" && (PURGE_TAGS as readonly string[]).includes(t)))];
}
