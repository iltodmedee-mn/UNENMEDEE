import { and, eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";

import { getDb, hasDatabase } from "@/db";
import { appSettings } from "@/db/schema";
import { allowedTags, NONCE_KEY, nonceValid } from "@/lib/cache-purge";

/**
 * POST {nonce, tags?}: marks the named cache tags stale (src/lib/cache-purge.ts). The nonce is
 * single-use: it is deleted with a conditional delete, so two requests cannot both use it.
 */
export async function POST(request: Request) {
  if (!hasDatabase()) return new Response(null, { status: 404 });
  const text = await request.text();
  if (text.length > 2_000) return new Response(null, { status: 413 });
  let body: { nonce?: unknown; tags?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return new Response(null, { status: 400 });
  }
  const db = getDb();
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, NONCE_KEY)).limit(1);
  if (!nonceValid(row?.value, body.nonce, new Date())) return new Response(null, { status: 403 });
  const used = await db.delete(appSettings).where(and(eq(appSettings.key, NONCE_KEY), eq(appSettings.value, row!.value))).returning({ key: appSettings.key });
  if (!used.length) return new Response(null, { status: 403 });
  const tags = allowedTags(body.tags);
  // Expired, not just stale: the owner reloads right after a run and must see the new list at once
  // ("max" would serve the old page to that first request). The render count is the same.
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
  return Response.json({ ok: true, tags });
}
