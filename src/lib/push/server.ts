import { count, eq, inArray, sql } from "drizzle-orm";
import webpush from "web-push";

import type { DB } from "@/db";
import { appSettings, pushSubscriptions } from "@/db/schema";

import { classifyPushFailure, isSystemicFailure, MAX_PUSH_FAILURES, type PushPayload } from "./core";
import { errorLine, oneLine } from "@/lib/log-safe";

/**
 * Web Push sending (GitHub Actions) and key storage.
 *
 * The VAPID key pair lives in `app_settings`, which both Vercel and GitHub Actions can read
 * through DATABASE_URL, so no extra secret has to be configured anywhere. The public key is
 * also exposed to browsers (it is public by design). Never regenerate the pair: existing
 * subscriptions are bound to it.
 */

const PUBLIC_KEY = "vapid_public_key";
const PRIVATE_KEY = "vapid_private_key";
const SUBJECT = process.env.VAPID_SUBJECT || "https://iltodmedee.mn";

export async function getVapidPublicKey(db: DB): Promise<string | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, PUBLIC_KEY));
  return row?.value ?? null;
}

/** Returns the key pair, creating it once on first use. */
export async function ensureVapidKeys(db: DB): Promise<{ publicKey: string; privateKey: string }> {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, [PUBLIC_KEY, PRIVATE_KEY]));
  const pub = rows.find((r) => r.key === PUBLIC_KEY)?.value;
  const priv = rows.find((r) => r.key === PRIVATE_KEY)?.value;
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  // Subscriptions are bound to the pair they were created with: a new pair would make every one of
  // them fail (and get deleted). Missing rows with subscribers present means the settings were lost.
  const [{ n }] = await db.select({ n: count() }).from(pushSubscriptions);
  if (n > 0) throw new Error(`VAPID keys are missing from app_settings while ${n} push subscription(s) exist: restore the keys, never generate a new pair`);
  const keys = webpush.generateVAPIDKeys();
  // onConflictDoNothing: if two runs race, the first pair wins and both re-read it.
  try {
    await db
      .insert(appSettings)
      .values([
        { key: PUBLIC_KEY, value: keys.publicKey },
        { key: PRIVATE_KEY, value: keys.privateKey },
      ])
      .onConflictDoNothing();
  } catch (err) {
    // drizzle's message carries the written values (the private key); only the cause travels on.
    throw new Error(`app_settings write failed (${PRIVATE_KEY})`, { cause: (err as { cause?: unknown }).cause });
  }
  return ensureVapidKeys(db);
}

/** Sends one payload to one stored subscription (the "test" button). */
export async function sendToEndpoint(db: DB, endpoint: string, payload: PushPayload): Promise<{ ok: boolean; status?: number; message?: string }> {
  const [s] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).limit(1);
  if (!s) return { ok: false, status: 404 };
  const { publicKey, privateKey } = await ensureVapidKeys(db);
  webpush.setVapidDetails(SUBJECT, publicKey, privateKey);
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 600, urgency: "high" });
    await db.update(pushSubscriptions).set({ lastSuccessAt: new Date(), failures: 0 }).where(eq(pushSubscriptions.id, s.id));
    return { ok: true };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
    // The push service's answer (VAPID mismatch, bad key…) for the admin's test button, not only a number.
    return { ok: false, status, message: errorLine(err, 200) };
  }
}

export interface SendResult {
  sent: number;
  removed: number;
  failed: number;
}

/**
 * Sends every payload to every subscriber. Subscriptions the push service reports as gone
 * (404/410) are deleted; others are dropped after 5 consecutive failures.
 */
export async function sendToAll(db: DB, payloads: PushPayload[]): Promise<SendResult> {
  const result: SendResult = { sent: 0, removed: 0, failed: 0 };
  if (payloads.length === 0) return result;
  const { publicKey, privateKey } = await ensureVapidKeys(db);
  webpush.setVapidDetails(SUBJECT, publicKey, privateKey);
  const subs = await db.select().from(pushSubscriptions);
  const gone: number[] = [];
  const succeeded: number[] = [];
  const failedPermanently: number[] = [];

  // Small batches: push services rate limit, and a run has at most a few payloads.
  for (let i = 0; i < subs.length; i += 50) {
    await Promise.all(
      subs.slice(i, i + 50).map(async (s) => {
        let ok = true;
        let transient = false;
        for (const p of payloads) {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(p), {
              TTL: 6 * 3_600,
              urgency: "normal",
              topic: p.tag?.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, "-"),
            });
            result.sent++;
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            const kind = classifyPushFailure(status, (err as Error)?.message ?? "");
            if (kind === "gone") {
              gone.push(s.id);
              return;
            }
            ok = false;
            if (kind === "transient") transient = true;
            result.failed++;
            // Host only: the endpoint path identifies a device.
            const body = (err as { body?: string }).body ?? (err as Error).message;
            console.warn(`  ✗ push to ${new URL(s.endpoint).host} failed: ${status ?? "?"} ${oneLine(body, 200)}`);
          }
        }
        // A push-service outage (429/5xx/network) leaves the counter alone: only the subscription's
        // own permanent errors count towards its removal.
        if (ok) succeeded.push(s.id);
        else if (!transient) failedPermanently.push(s.id);
      }),
    );
  }
  if (succeeded.length) await db.update(pushSubscriptions).set({ lastSuccessAt: new Date(), failures: 0 }).where(inArray(pushSubscriptions.id, succeeded));
  if (isSystemicFailure(failedPermanently.length, subs.length - gone.length)) {
    console.error(`::error::${failedPermanently.length}/${subs.length - gone.length} push subscriptions were rejected (4xx): a VAPID or payload problem on our side, so no subscription is counted towards removal.`);
  } else if (failedPermanently.length) {
    await db
      .update(pushSubscriptions)
      .set({ failures: sql`${pushSubscriptions.failures} + 1` })
      .where(inArray(pushSubscriptions.id, failedPermanently));
  }
  if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  const stale = await db.delete(pushSubscriptions).where(sql`${pushSubscriptions.failures} >= ${MAX_PUSH_FAILURES}`).returning({ id: pushSubscriptions.id });
  result.removed = gone.length + stale.length;
  return result;
}
