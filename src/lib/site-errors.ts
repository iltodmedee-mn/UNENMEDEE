import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import type { DB } from "@/db";
import { siteErrors } from "@/db/schema";
import { errorLine, oneLine } from "@/lib/log-safe";

/**
 * Records a server error of the public site (src/instrumentation.ts) so the watchdog can report it
 * (Nov 2026: readers, not the system, found what was wrong). One row per route and first message
 * line, counted; no headers, body, query string or user data. Errors while recording are swallowed:
 * the error page must never fail because of the log.
 */
export function errorKey(route: string, message: string): string {
  return createHash("sha256").update(`${route}\n${message}`).digest("hex").slice(0, 64);
}

/** "GET /article/[slug]" (Next.js route pattern when known, else the path without its query), one line, ≤ 300. */
export function cleanRoute(method: string, path: string, routePath?: string): string {
  const p = (routePath || path.split("?")[0] || "/").slice(0, 280);
  return oneLine(`${method} ${p}`).slice(0, 300);
}

export async function recordSiteError(db: DB, input: { method: string; path: string; routePath?: string; err: unknown; digest?: string }): Promise<void> {
  const route = cleanRoute(input.method, input.path, input.routePath);
  const message = errorLine(input.err, 300).slice(0, 300);
  const key = errorKey(route, message);
  await db
    .insert(siteErrors)
    .values({ key, route, message, digest: input.digest?.slice(0, 40) || null })
    .onConflictDoUpdate({
      target: siteErrors.key,
      set: { count: sql`${siteErrors.count} + 1`, lastSeen: sql`now()`, digest: sql`coalesce(excluded.digest, ${siteErrors.digest})` },
    });
  // The table stays small: a route fixed a month ago is forgotten.
  await db.delete(siteErrors).where(sql`${siteErrors.lastSeen} < now() - interval '30 days'`);
}
