import { randomBytes } from "node:crypto";

import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { NONCE_KEY, nonceValue } from "@/lib/cache-purge";
import { PRODUCTION_URL } from "@/lib/site";

/**
 * Asks the live site to purge cache tags (/api/revalidate, src/lib/cache-purge.ts): stores a
 * single-use nonce in app_settings and posts it with the tags. Returns false (and warns) on any
 * failure: the pages still refresh within their own cache life.
 */
export async function requestPurge(tags: string[]): Promise<boolean> {
  if (tags.length === 0) return true;
  const nonce = randomBytes(32).toString("hex");
  const value = nonceValue(nonce, new Date());
  await getDb()
    .insert(appSettings)
    .values({ key: NONCE_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  const res = await fetch(`${PRODUCTION_URL}/api/revalidate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce, tags }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    console.log(`::warning::cache purge answered ${res.status}: the pages refresh on their own.`);
    return false;
  }
  console.log(`✓ cache purged: ${tags.join(", ")}`);
  return true;
}
