import { sql } from "drizzle-orm";

import type { DB } from "@/db";
import { siteErrors } from "@/db/schema";
import { oneLine } from "@/lib/log-safe";
import { errorKey } from "@/lib/site-errors";

/**
 * JavaScript errors on readers' phones (Nov 2026: most readers are on phones, and a broken button
 * there reached nobody). The root layout's inline handler (client-error-script.ts, ~400 bytes, no
 * library) sends the first error of a page view once with `navigator.sendBeacon`; /api/client-error
 * counts it in `site_errors` next to the server errors, and the watchdog names it.
 *
 * Anyone can POST there, so what is stored is narrow: the first path segment only ("/article/*"),
 * the message cut to 200 characters, and at most CLIENT_ROW_CAP client rows (beyond it only
 * existing rows are counted up). Errors from other origins (extensions, "Script error.") are dropped.
 */
export const CLIENT_PREFIX = "CLIENT ";
export const CLIENT_ROW_CAP = 200;
export const CLIENT_MAX_BODY = 1_000;

/** "/article/abc-123" → "CLIENT /article/*"; "/" → "CLIENT /"; anything odd → null. */
export function clientRoute(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 2_000) return null;
  const segs = path.split("?")[0].split("/").filter(Boolean);
  if (!segs.length) return `${CLIENT_PREFIX}/`;
  if (!/^[a-z0-9-]{1,40}$/.test(segs[0])) return null;
  return `${CLIENT_PREFIX}/${segs[0]}${segs.length > 1 ? "/*" : ""}`;
}

export function parseClientError(raw: string): { route: string; message: string } | null {
  if (!raw || raw.length > CLIENT_MAX_BODY) return null;
  let body: { m?: unknown; p?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return null;
  }
  const route = clientRoute(body?.p);
  if (!route || typeof body.m !== "string") return null;
  const message = oneLine(body.m).trim().slice(0, 200);
  if (!message || /^script error\.?$/i.test(message)) return null;
  return { route, message };
}

/** Counts the error; a new row only while fewer than CLIENT_ROW_CAP client rows exist. */
export async function recordClientError(db: DB, e: { route: string; message: string }): Promise<void> {
  const key = errorKey(e.route, e.message);
  const bumped = await db
    .update(siteErrors)
    .set({ count: sql`${siteErrors.count} + 1`, lastSeen: sql`now()` })
    .where(sql`${siteErrors.key} = ${key}`)
    .returning({ key: siteErrors.key });
  if (bumped.length) return;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(siteErrors).where(sql`${siteErrors.route} like ${CLIENT_PREFIX + "%"}`);
  if (n >= CLIENT_ROW_CAP) return;
  await db.insert(siteErrors).values({ key, route: e.route, message: e.message }).onConflictDoNothing();
}
