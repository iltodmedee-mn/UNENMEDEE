import { z } from "zod";

import { tldrSentences } from "@/lib/format";

/**
 * Pure Web Push helpers (no DB, no network) so they can be unit tested.
 */

/**
 * Push services of the browsers we support. Anyone can call the subscribe action, so only
 * endpoints on these hosts are stored: it cannot be abused to make us POST to arbitrary URLs.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^android\.googleapis\.com$/];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  // Real endpoints are < 500 characters; every public action checks this, so a megabyte-long
  // "endpoint" never reaches a map or a query.
  if (endpoint.length > 1_000) return false;
  try {
    const u = new URL(endpoint);
    // Canonical only: the sender (web-push) parses the stored string again, and a spelling the
    // two parsers read differently ("https://fcm.googleapis.com\\@evil…") must not pass here and
    // post somewhere else there. Browsers hand out canonical endpoints.
    return u.href === endpoint && u.protocol === "https:" && !u.username && !u.password && !u.port && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}

/** Bytes of a base64url (or base64) string, or null when it is not one. */
export function base64UrlBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_\-+/]+={0,2}$/.test(value)) return null;
  try {
    return new Uint8Array(Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  } catch {
    return null;
  }
}

/**
 * The keys a browser hands out: p256dh is an uncompressed P-256 point (65 bytes, 0x04 first) and
 * auth a 16-byte secret. Only the lengths were checked, so a stored junk key made web-push throw
 * on every send, and that subscription was retried on every run.
 */
export const isP256dh = (v: string) => {
  const b = base64UrlBytes(v);
  return b !== null && b.length === 65 && b[0] === 0x04;
};
export const isAuthSecret = (v: string) => base64UrlBytes(v)?.length === 16;

export const SubscriptionSchema = z.object({
  endpoint: z.string().max(1_000).refine(isAllowedPushEndpoint, "unsupported push service"),
  keys: z.object({
    p256dh: z.string().min(20).max(200).refine(isP256dh, "invalid p256dh key"),
    auth: z.string().min(8).max(100).refine(isAuthSecret, "invalid auth secret"),
  }),
});

export type SubscriptionInput = z.infer<typeof SubscriptionSchema>;

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** Same tag replaces an older notification instead of stacking. */
  tag?: string;
}

/** Notifications are short: Android shows ~2 lines, iOS ~4. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export interface NotifiableArticle {
  id: number;
  slug: string;
  title: string;
  tldr: string | null;
  sourceName: string;
  riskFlag: boolean;
}

export function articlePayload(a: NotifiableArticle): PushPayload {
  const firstLine = tldrSentences(a.tldr ?? "", 1)[0] ?? "";
  return {
    title: clip(`${a.riskFlag ? "🚨 " : "📰 "}${a.title}`, 90),
    body: clip(firstLine ? `${firstLine} · ${a.sourceName}` : a.sourceName, 160),
    url: `/article/${a.slug}`,
    tag: `article-${a.id}`,
  };
}

/**
 * One notification per run: the most important story, with the rest counted in the body.
 * Several pushes in a burst were partly rejected by Apple and are noisy on any phone.
 */
export function newsPayload(stories: NotifiableArticle[]): PushPayload | null {
  const [top, ...rest] = stories;
  if (!top) return null;
  const p = articlePayload(top);
  if (rest.length === 0) return p;
  const firstLine = tldrSentences(top.tldr ?? "", 1)[0] ?? "";
  return { ...p, body: clip(`${firstLine ? `${firstLine} ` : ""}+${rest.length} чухал мэдээ`, 160), tag: "news" };
}

export const TEST_PAYLOAD: PushPayload = {
  title: "🔔 ИЛ ТОД мэдэгдэл ажиллаж байна",
  body: "Чухал шинэ мэдээ гарахад ингэж мэдэгдэнэ.",
  url: "/",
  tag: "test",
};

export function digestPayload(d: { title: string; intro: string; kind: string; generatedBy?: string }): PushPayload {
  return {
    title: clip(`🗞 ${d.kind === "30d" ? "30 хоногийн тойм" : "Онцлох тойм"}: ${d.title}`, 90),
    // A rule-based edition says so first: the body is clipped, the note must survive.
    body: clip(d.generatedBy === "rule-based" ? `AI редакторгүй, дүрмээр эрэмбэлсэн. ${d.intro}` : d.intro, 160),
    url: "/digest",
    tag: "digest",
  };
}

/**
 * What a push service's answer means for the stored subscription. 404/410 = the browser dropped it
 * (delete). Another 4xx (a VAPID mismatch, a bad key) is this subscription's own problem and counts
 * towards its removal. 429, 5xx and network errors are the service's problem: never count them, or
 * a few hours of outage would delete every subscriber.
 */
export function classifyPushFailure(status: number | undefined): "gone" | "permanent" | "transient" {
  if (status === 404 || status === 410) return "gone";
  if (status !== undefined && status >= 400 && status < 500 && status !== 429 && status !== 408) return "permanent";
  return "transient";
}

/** Consecutive permanent failures after which a subscription is dropped. */
export const MAX_PUSH_FAILURES = 5;

/**
 * True when most subscriptions failed "permanently" in one run: that is our side (a restored or
 * wrong VAPID pair, a bad payload), not each subscriber's, so nobody's counter goes up. Without
 * this, 5 runs of a VAPID mismatch (under a day) would delete every subscriber.
 */
export function isSystemicFailure(permanent: number, attempted: number): boolean {
  return permanent >= 3 && permanent * 2 > attempted;
}
