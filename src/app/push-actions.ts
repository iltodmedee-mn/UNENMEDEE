"use server";

import { count, eq, gte } from "drizzle-orm";
import { headers } from "next/headers";

import { getDb, hasDatabase } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { MAX_FOLLOWS } from "@/lib/officials/follow";
import { isAllowedPushEndpoint, SubscriptionSchema, TEST_PAYLOAD } from "@/lib/push/core";
import { clientIp } from "@/lib/rate-limit";
import { sendToEndpoint } from "@/lib/push/server";

/**
 * Public server actions (no login: anyone may subscribe). Input is validated and only
 * endpoints on known browser push services are stored; nothing personal is kept.
 */

// Abuse limits: a public action could otherwise fill the 500 MB free database with fake rows.
// Mongolian mobile carriers put many readers behind one shared IP (carrier-grade NAT): 10 an hour
// turned real readers away (Nov 2026 audit). NEW_PER_HOUR and MAX_SUBSCRIPTIONS still bound growth.
const PER_IP_PER_HOUR = 60;
const NEW_PER_HOUR = Number(process.env.PUSH_NEW_PER_HOUR ?? 500);
const MAX_SUBSCRIPTIONS = Number(process.env.PUSH_MAX_SUBSCRIPTIONS ?? 50_000);
const recentByIp = new Map<string, number[]>();

function ipAllowed(ip: string, now: number): boolean {
  const recent = (recentByIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_IP_PER_HOUR) return false;
  recentByIp.set(ip, [...recent, now]);
  if (recentByIp.size > 10_000) recentByIp.clear(); // bounded memory per server instance
  return true;
}

export async function subscribePush(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = SubscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Энэ хөтчийн мэдэгдлийг дэмжихгүй байна." };
  if (!hasDatabase()) return { ok: false, error: "Сервер тохируулагдаагүй байна." };
  const busy = { ok: false, error: "Түр завгүй байна. Хэдэн минутын дараа дахин оролдоно уу." };
  const h = await headers();
  const ip = clientIp(h);
  if (!ipAllowed(ip, Date.now())) return busy;
  const { endpoint, keys } = parsed.data;
  const db = getDb();
  const [existing] = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).limit(1);
  if (!existing) {
    const [[total], [lastHour]] = await Promise.all([
      db.select({ n: count() }).from(pushSubscriptions),
      db.select({ n: count() }).from(pushSubscriptions).where(gte(pushSubscriptions.createdAt, new Date(Date.now() - 3_600_000))),
    ]);
    if (total.n >= MAX_SUBSCRIPTIONS || lastHour.n >= NEW_PER_HOUR) return busy;
  }
  await db
    .insert(pushSubscriptions)
    .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: keys.p256dh, auth: keys.auth, failures: 0 } });
  return { ok: true };
}

export async function unsubscribePush(endpoint: unknown): Promise<{ ok: boolean }> {
  if (typeof endpoint !== "string" || !isAllowedPushEndpoint(endpoint) || !hasDatabase()) return { ok: false };
  await getDb().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  return { ok: true };
}

// One test per endpoint per minute (per server instance): enough to stop button mashing.
const lastTest = new Map<string, number>();

/** Sends a test notification to the caller's own, already stored subscription. */
export async function sendTestPush(endpoint: unknown): Promise<{ ok: boolean; error?: string }> {
  if (typeof endpoint !== "string" || !isAllowedPushEndpoint(endpoint) || !hasDatabase()) return { ok: false, error: "Мэдэгдэл бүртгэгдээгүй байна." };
  const now = Date.now();
  if (now - (lastTest.get(endpoint) ?? 0) < 60_000) return { ok: false, error: "1 минутын дараа дахин оролдоно уу." };
  lastTest.set(endpoint, now);
  // Per instance and only for rate limiting: keep it small.
  if (lastTest.size > 1_000) for (const [k, t] of lastTest) if (now - t > 60_000) lastTest.delete(k);
  const res = await sendToEndpoint(getDb(), endpoint, TEST_PAYLOAD);
  if (res.ok) return { ok: true };
  // The push service's own words reach the log, not the browser (they can name the VAPID key).
  if (res.message) console.warn(`[push] test to ${new URL(endpoint).host} failed: ${res.message}`);
  return { ok: false, error: res.status === 404 || res.status === 410 ? "Бүртгэл хүчингүй болсон. Мэдэгдлээ дахин асаана уу." : `Илгээж чадсангүй (${res.status ?? "алдаа"}).` };
}

/** "Миний гишүүн": stores which MPs this (already subscribed) browser follows. */
export async function setFollows(endpoint: unknown, ids: unknown): Promise<{ ok: boolean }> {
  if (typeof endpoint !== "string" || !isAllowedPushEndpoint(endpoint) || !hasDatabase() || !Array.isArray(ids)) return { ok: false };
  const follows = [...new Set(ids.filter((x): x is number => Number.isInteger(x) && x > 0 && x < 1_000_000))].slice(0, MAX_FOLLOWS);
  const updated = await getDb().update(pushSubscriptions).set({ followPoliticians: follows }).where(eq(pushSubscriptions.endpoint, endpoint)).returning({ id: pushSubscriptions.id });
  return { ok: updated.length > 0 };
}
