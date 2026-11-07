import { count, eq, gte } from "drizzle-orm";

import { getDb } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { type SubscriptionInput } from "@/lib/push/core";

// Abuse limits: a public endpoint could otherwise fill the 500 MB free database with fake rows.
// NEW_PER_HOUR and MAX_SUBSCRIPTIONS bound growth (the per-IP limit lives in core.ts).
const NEW_PER_HOUR = Number(process.env.PUSH_NEW_PER_HOUR ?? 500);
const MAX_SUBSCRIPTIONS = Number(process.env.PUSH_MAX_SUBSCRIPTIONS ?? 50_000);

/**
 * Stores (or refreshes) a validated subscription. Shared by the `subscribePush` action and
 * `POST /api/push`. Returns false when the global caps say "busy". With `oldEndpoint` (a browser
 * renewal) the old row's follows move to the new one and the old row is removed.
 */
export async function storeSubscription(sub: SubscriptionInput, oldEndpoint: string | null): Promise<boolean> {
  const { endpoint, keys } = sub;
  const db = getDb();
  const [existing] = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).limit(1);
  if (!existing) {
    const [[total], [lastHour]] = await Promise.all([
      db.select({ n: count() }).from(pushSubscriptions),
      db.select({ n: count() }).from(pushSubscriptions).where(gte(pushSubscriptions.createdAt, new Date(Date.now() - 3_600_000))),
    ]);
    if (total.n >= MAX_SUBSCRIPTIONS || lastHour.n >= NEW_PER_HOUR) return false;
  }
  let follows: number[] | null = null;
  if (oldEndpoint) {
    const [old] = await db.select({ f: pushSubscriptions.followPoliticians }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, oldEndpoint)).limit(1);
    follows = old?.f ?? null;
  }
  const moved = follows?.length ? { followPoliticians: follows } : {};
  await db
    .insert(pushSubscriptions)
    .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth, ...moved })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: keys.p256dh, auth: keys.auth, failures: 0, ...moved } });
  if (oldEndpoint) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, oldEndpoint));
  return true;
}
