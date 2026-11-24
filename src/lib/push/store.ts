import { count, eq, gte } from "drizzle-orm";

import { getDb } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { type OldSubscription, type SubscriptionInput } from "@/lib/push/core";

// Abuse limits: a public endpoint could otherwise fill the 500 MB free database with fake rows.
// NEW_PER_HOUR and MAX_SUBSCRIPTIONS bound growth (the per-IP limit lives in core.ts).
const NEW_PER_HOUR = Number(process.env.PUSH_NEW_PER_HOUR ?? 500);
const MAX_SUBSCRIPTIONS = Number(process.env.PUSH_MAX_SUBSCRIPTIONS ?? 50_000);

/**
 * Stores (or refreshes) a validated subscription. Shared by the `subscribePush` action and
 * `POST /api/push`. Returns false when the global caps say "busy". With `old` (a browser renewal)
 * the old row's follows move to the new one and the old row is removed, but only when the old
 * row's auth secret matches: knowing an endpoint URL is not proof of owning it (audit S-6).
 */
export async function storeSubscription(sub: SubscriptionInput, old: OldSubscription | null): Promise<boolean> {
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
  let oldProven = false;
  if (old) {
    const [row] = await db.select({ f: pushSubscriptions.followPoliticians, auth: pushSubscriptions.auth }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, old.endpoint)).limit(1);
    oldProven = !!row && row.auth.replace(/=+$/, "") === old.auth;
    follows = oldProven ? (row?.f ?? null) : null;
  }
  const moved = follows?.length ? { followPoliticians: follows } : {};
  await db
    .insert(pushSubscriptions)
    .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth, ...moved })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: keys.p256dh, auth: keys.auth, failures: 0, ...moved } });
  if (old && oldProven) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, old.endpoint));
  return true;
}
