/**
 * Threads posting (graph.threads.com): an IMAGE container with our hook card and the link in the
 * text (or a TEXT container with `link_attachment` when there is no card), then publish.
 * Long-lived tokens last 60 days and are refreshed by the pipeline (scripts/post-social.ts keeps
 * the current one in app_settings key THREADS_SETTINGS_KEY; THREADS_TOKEN only seeds it, see
 * token-state.ts). Texts are capped at 500 characters, emoji counting as their UTF-8 bytes. The
 * token travels as the documented `access_token` parameter and never appears in an error message.
 */
import { editionLabel, ruleBasedNote } from "@/lib/edition";
import { largestAmount, tldrSentences } from "@/lib/format";
import { PRODUCTION_URL } from "@/lib/site";

import type { ArticleForPost, DigestForPost } from "./facebook";
import { hashtags } from "./hashtags";
import { publishStep } from "./outcome";

export const THREADS_API = "https://graph.threads.com";
export const THREADS_SETTINGS_KEY = "threads";
export const THREADS_MAX = 500;

export interface ThreadsPost {
  text: string;
  link: string;
  /** Our JPEG hook card: an IMAGE post with the link in the text; without it a TEXT post with a link card. */
  imageUrl?: string;
  /** A generated video (src/lib/video): a VIDEO post with the link in the text. */
  videoUrl?: string;
}

/**
 * Threads counts emoji (and other astral symbols, and the U+FE0F that turns "⚖" into "⚖️") as
 * their UTF-8 byte length.
 */
export function threadsLength(text: string): number {
  let n = 0;
  for (const ch of text) n += /\p{Extended_Pictographic}/u.test(ch) || ch.codePointAt(0)! > 0xffff || ch === "\uFE0F" ? Buffer.byteLength(ch) : 1;
  return n;
}

/** Cuts at a whole grapheme (never half an emoji or a letter without its accent) and adds "…". */
export function cut(text: string, max: number): string {
  if (threadsLength(text) <= max) return text;
  let out = "";
  for (const { segment } of new Intl.Segmenter("mn", { granularity: "grapheme" }).segment(text)) {
    if (threadsLength(out + segment) > max - 1) break;
    out += segment;
  }
  return `${out.trimEnd()}…`;
}

/** Hook first: the top story and why it matters, the link, with the card as the image. */
export function threadsDigestPost(d: DigestForPost, site = PRODUCTION_URL): ThreadsPost {
  const link = `${site}/digest`;
  const top = d.items[0];
  const head = `🗞 ${editionLabel(d)}\n\n⚡ ${cut(top?.headline ?? d.title, 180)}`;
  // Threads counts bytes (500): the short form of the rule-based note.
  const tail = `${ruleBasedNote(d) ? "\n\nℹ️ AI редакторгүй, дүрмээр эрэмбэлсэн." : ""}\n\nБүх ${d.items.length} мэдээ 👉 ${link}\n${hashtags("threads")}`;
  const room = THREADS_MAX - threadsLength(head + tail + "\n👉 ");
  const why = top?.whyItMatters && room > 40 ? `\n👉 ${cut(top.whyItMatters, room)}` : "";
  return { text: cut(head + why + tail, THREADS_MAX), link, imageUrl: `${site}/ig-image?d=${d.id}` };
}

/** One important story: the headline as the hook, the first summary sentence, amount, source, link. */
export function threadsArticlePost(a: ArticleForPost, site = PRODUCTION_URL): ThreadsPost {
  const link = `${site}/article/${a.slug}`;
  const amount = largestAmount(a.amounts);
  const tail = `\n\n👉 ${link}\n${hashtags("threads", a.topic)}`;
  // "Танд хамаатай юу?" in one line when the text says who it changes things for, else the summary.
  const forYou = a.impact?.change ? `👤 ${a.impact.who ? `${a.impact.who}: ` : ""}${a.impact.change}` : null;
  const parts = [`${a.riskFlag ? "🚨" : "⚡"} ${cut(a.title, 200)}`, "", cut(forYou ?? tldrSentences(a.tldr, 1)[0] ?? "", 180), "", ...(amount ? [`💰 ${amount}`] : []), `🏛 ${a.sourceName}`];
  return { text: cut(parts.join("\n"), THREADS_MAX - threadsLength(tail)) + tail, link, imageUrl: `${site}/ig-image?a=${encodeURIComponent(a.slug)}` };
}

type Fetch = typeof fetch;

async function call(fetchImpl: Fetch, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } };
  if (!res.ok || json.error) throw new Error(`Threads ${res.status}: ${json.error?.message ?? "request failed"} (code ${json.error?.code ?? "?"})`.slice(0, 300));
  return json;
}

/** Refreshes a long-lived token (restarts its 60 days). */
export async function refreshToken(token: string, fetchImpl: Fetch = fetch): Promise<string> {
  const json = await call(fetchImpl, `${THREADS_API}/refresh_access_token?${new URLSearchParams({ grant_type: "th_refresh_token", access_token: token })}`);
  if (typeof json.access_token !== "string") throw new Error("Threads refresh returned no token");
  return json.access_token;
}

/** Creates the VIDEO, IMAGE or TEXT container, waits until it is FINISHED, publishes it and returns the post id. */
export async function publishThreads(opts: { token: string; post: ThreadsPost; fetchImpl?: Fetch; sleep?: (ms: number) => Promise<void> }): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const token = opts.token;
  const body = opts.post.videoUrl
    ? new URLSearchParams({ media_type: "VIDEO", video_url: opts.post.videoUrl, text: opts.post.text, access_token: token })
    : opts.post.imageUrl
      ? new URLSearchParams({ media_type: "IMAGE", image_url: opts.post.imageUrl, text: opts.post.text, access_token: token })
      : new URLSearchParams({ media_type: "TEXT", text: opts.post.text, link_attachment: opts.post.link, access_token: token });
  // A video is processed for longer: up to 3 minutes of checks instead of 30 seconds.
  const checks = opts.post.videoUrl ? 36 : 10;
  const wait = opts.post.videoUrl ? 5_000 : 3_000;
  const created = await call(f, `${THREADS_API}/v1.0/me/threads`, { method: "POST", body });
  const id = String(created.id ?? "");
  if (!id) throw new Error("Threads returned no container id");
  for (let i = 0; ; i++) {
    const s = await call(f, `${THREADS_API}/v1.0/${encodeURIComponent(id)}?${new URLSearchParams({ fields: "status,error_message", access_token: token })}`);
    if (s.status === "FINISHED") break;
    if (s.status === "ERROR" || s.status === "EXPIRED") throw new Error(`Threads container ${s.status}: ${String(s.error_message ?? "")}`);
    // Never publish a container that is not ready: the post would fail or go out without its card.
    if (i >= checks - 1) throw new Error(`Threads container not finished after ${i + 1} checks (${String(s.status ?? "?")})`);
    await sleep(wait);
  }
  const published = await publishStep(() => call(f, `${THREADS_API}/v1.0/me/threads_publish`, { method: "POST", body: new URLSearchParams({ creation_id: id, access_token: token }) }));
  return String(published.id ?? id);
}
