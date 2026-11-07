"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";

import { getDb, hasDatabase } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { MAX_FOLLOWS } from "@/lib/officials/follow";
import { ipAllowed, isAllowedPushEndpoint, parseSubscribeRequest, TEST_PAYLOAD } from "@/lib/push/core";
import { storeSubscription } from "@/lib/push/store";
import { clientIp } from "@/lib/rate-limit";
import { sendToEndpoint } from "@/lib/push/server";

/**
 * Public server actions (no login: anyone may subscribe). Input is validated and only
 * endpoints on known browser push services are stored; nothing personal is kept.
 */

const BUSY = { ok: false, error: "Түр завгүй байна. Хэдэн минутын дараа дахин оролдоно уу." };

export async function subscribePush(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const req = parseSubscribeRequest(input);
  if (!req) return { ok: false, error: "Энэ хөтчийн мэдэгдлийг дэмжихгүй байна." };
  if (!hasDatabase()) return { ok: false, error: "Сервер тохируулагдаагүй байна." };
  const h = await headers();
  if (!ipAllowed(clientIp(h), Date.now())) return BUSY;
  // oldEndpoint is a service-worker renewal detail: the action stores the subscription alone.
  return (await storeSubscription(req.sub, null)) ? { ok: true } : BUSY;
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
