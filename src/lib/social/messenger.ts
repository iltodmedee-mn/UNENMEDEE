/**
 * Messenger and Instagram DM bot for the ИЛ ТОД МЭДЭЭ page: answers with our own stories and links, never with
 * generated text (no AI here, so nothing can be invented). "тойм" → the latest digest; any other
 * text → the top search results; greetings and the Get Started button → what the bot can do.
 * Pure helpers (classification, reply text, signature check); the route lives in
 * src/app/api/messenger/route.ts and reads its secrets from the MESSENGER_SETTINGS env var or
 * app_settings (MESSENGER_SETTINGS_KEY).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { PRODUCTION_URL } from "@/lib/site";
import { readJsonBody } from "@/lib/read-json";

export const MESSENGER_SETTINGS_KEY = "messenger";
/** app_settings key of the Instagram app secret (Instagram-Login DM webhooks are signed with it). */
export const IG_APP_SECRET_KEY = "instagram_app_secret";
/** Messenger rejects texts over 2000 characters. */
export const MAX_TEXT = 2000;

export interface MessengerSettings {
  pageId: string;
  pageToken: string;
  appSecret: string;
  verifyToken: string;
  /** Instagram app secret: Instagram-Login webhooks (DMs) are signed with it, not with appSecret. */
  igAppSecret?: string;
}

export function parseSettings(value: string | null | undefined): MessengerSettings | null {
  if (!value) return null;
  try {
    const s = JSON.parse(value) as Partial<MessengerSettings>;
    return s.pageId && s.pageToken && s.appSecret && s.verifyToken ? (s as MessengerSettings) : null;
  } catch {
    return null;
  }
}

/** `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256 of the raw body with the app secret. */
export function validSignature(rawBody: string | Buffer, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  // HMAC over the exact bytes Meta sent (a Buffer); a string is hashed as UTF-8.
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type Intent = { kind: "help" } | { kind: "digest" } | { kind: "search"; q: string };

const DIGEST = /^(тойм|toim|digest|өнөөдөр|unuudur|onoodor|шинэ мэдээ|shine medee|мэдээ|medee|news)[\s!?.]*$/i;
const HELP = /^(сайн( байна)? уу|sain( baina)? uu|sn uu|сн уу|hi|hello|hey|тусламж|tuslamj|help|start|эхлэх|get_started)[\s!?.]*$/i;

export function classify(text: string | undefined | null): Intent {
  const t = (text ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
  if (t.length < 2 || HELP.test(t)) return { kind: "help" };
  if (DIGEST.test(t)) return { kind: "digest" };
  return { kind: "search", q: t };
}

export function helpReply(site = PRODUCTION_URL): string {
  return [
    "Сайн байна уу! Би ИЛ ТОД МЭДЭЭ-ийн туслах 🤖",
    "",
    "• \"тойм\" гэж бичвэл хамгийн сүүлийн онцлох мэдээний тоймыг илгээнэ.",
    "• Сонирхсон зүйлээ кириллээр бичээрэй (ж: төсөв, тендер, Х.Баттулга): холбогдох мэдээг эх сурвалжийн холбоостой нь олж өгнө.",
    "",
    "Бид зөвхөн төрийн албан ёсны мэдээг дамжуулдаг, өөрсдөө дүгнэлт хийдэггүй.",
    `🌐 ${site}`,
  ].join("\n");
}

export function digestReply(d: { title: string; items: { headline: string; slug: string }[] } | null, site = PRODUCTION_URL): string {
  if (!d || d.items.length === 0) return `Одоогоор тойм алга байна. Шинэ мэдээг эндээс: ${site}`;
  const lines = d.items.slice(0, 5).map((it, i) => `${i + 1}. ${it.headline}\n${site}/article/${it.slug}`);
  return fit([`🗞 ${d.title}`, "", ...lines, "", `Бүтэн тойм: ${site}/digest`].join("\n"));
}

export function searchReply(q: string, results: { title: string; slug: string; sourceName: string }[], site = PRODUCTION_URL): string {
  const more = `${site}/search?q=${encodeURIComponent(q)}`;
  if (results.length === 0) {
    const latin = /^[\sa-z0-9.,!?'"-]+$/i.test(q) ? " Кириллээр бичээд үзээрэй." : "";
    return `"${q}" гэсэн мэдээ олдсонгүй.${latin}\n"тойм" гэж бичвэл сүүлийн онцлох мэдээг илгээнэ.\n${more}`;
  }
  const lines = results.slice(0, 3).map((r, i) => `${i + 1}. ${r.title} (${r.sourceName})\n${site}/article/${r.slug}`);
  return fit([`🔎 "${q}":`, "", ...lines, "", `Бүгдийг харах: ${more}`].join("\n"));
}

function fit(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}

export type Channel = "messenger" | "instagram";

/** Text messages and postbacks people sent to the page or its Instagram (echoes of our own replies skipped). */
/** Meta batches up to ~1,000 events per POST; we answer at most this many per delivery. */
export const MAX_REPLIES_PER_DELIVERY = 25;

export interface IncomingMessage {
  channel: Channel;
  senderId: string;
  text: string;
  /** Message id: Meta redelivers a webhook it thinks failed, and the same mid must not be answered twice. */
  mid?: string;
}

export function incoming(body: unknown): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  const entries = (body as { object?: string; entry?: unknown[] })?.entry;
  // "page" = Messenger (answered with the page token), "instagram" = Instagram DMs (Instagram token).
  const object = (body as { object?: string })?.object;
  if ((object !== "page" && object !== "instagram") || !Array.isArray(entries)) return out;
  const channel: Channel = object === "page" ? "messenger" : "instagram";
  for (const entry of entries) {
    for (const ev of ((entry as { messaging?: unknown[] }).messaging ?? []) as {
      sender?: { id?: string };
      message?: { text?: string; is_echo?: boolean; mid?: string };
      postback?: { payload?: string };
    }[]) {
      const senderId = ev.sender?.id;
      if (!senderId || ev.message?.is_echo) continue;
      const mid = ev.message?.mid ? { mid: ev.message.mid } : {};
      if (typeof ev.message?.text === "string") out.push({ channel, senderId, text: ev.message.text, ...mid });
      else if (ev.postback?.payload) out.push({ channel, senderId, text: ev.postback.payload });
      else if (ev.message) out.push({ channel, senderId, text: "", ...mid }); // a sticker or photo: answer with help
    }
  }
  return out.slice(0, MAX_REPLIES_PER_DELIVERY);
}

/** Message ids already answered by this instance (a small LRU: Meta's retries come within minutes). */
export function seenOnce(max = 500) {
  const seen = new Set<string>();
  return (mid: string | undefined): boolean => {
    if (!mid) return false;
    if (seen.has(mid)) return true;
    seen.add(mid);
    if (seen.size > max) seen.delete(seen.values().next().value as string);
    return false;
  };
}

/** Constant-time comparison for the subscription check's verify_token. */
export function sameSecret(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Sends one text reply (Send API, standard messaging inside the 24 h window): Messenger through
 * graph.facebook.com with the page token, Instagram through graph.instagram.com with its token.
 */
export async function sendText(opts: { pageToken: string; recipientId: string; text: string; channel?: Channel; fetchImpl?: typeof fetch; version?: string }): Promise<void> {
  const host = opts.channel === "instagram" ? "https://graph.instagram.com" : "https://graph.facebook.com";
  const res = await (opts.fetchImpl ?? fetch)(`${host}/${opts.version || process.env.FB_GRAPH_VERSION || "v26.0"}/me/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.pageToken}` },
    body: JSON.stringify({ recipient: { id: opts.recipientId }, messaging_type: "RESPONSE", message: { text: fit(opts.text) } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const err = (await readJsonBody(res)) as { error?: { message?: string; code?: number } };
    throw new Error(`Messenger ${res.status}: ${err.error?.message ?? "send failed"} (code ${err.error?.code ?? "?"})`.slice(0, 300));
  }
}
