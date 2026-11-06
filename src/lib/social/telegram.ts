/**
 * Telegram channel posting (Bot API, free): the bot is an admin of our public channel and posts
 * the same digests and stories as Facebook, as a photo with our hook card (/ig-image) and the
 * Facebook text as caption (≤ 1024 characters), or as a text message when there is no card.
 * The Bot API puts the token in the URL path, so URLs are never logged and errors never echo them.
 */
import { articlePost, digestPost, type ArticleForPost, type DigestForPost } from "./facebook";
import { maybePublished, UnknownOutcomeError } from "./outcome";
import { readJsonBody } from "@/lib/read-json";

export const TELEGRAM_API = "https://api.telegram.org";
/** Telegram's caption limit for photos. */
export const CAPTION_MAX = 1024;
/** Telegram's limit for a text message. */
export const TEXT_MAX = 4096;

export interface TelegramPost {
  text: string;
  link: string;
  imageUrl?: string;
}

/** Cut to `max` UTF-16 units (Telegram's count) at a whole grapheme, with "…". */
function cutChars(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const { segment } of new Intl.Segmenter("mn", { granularity: "grapheme" }).segment(text)) {
    if (out.length + segment.length > max - 1) break;
    out += segment;
  }
  return `${out.trimEnd()}…`;
}

/**
 * Fits a post into Telegram's limit and keeps its closing lines (our link and the hashtags):
 * the Threads `cut` counted UTF-8 bytes (Cyrillic captions were cut at about 500 characters) and
 * cut from the end, so long captions lost the link to the story.
 */
export function fitTelegram(text: string, max: number): string {
  if (text.length <= max) return text;
  const lines = text.split("\n");
  let k = lines.length;
  while (k > 0 && (!lines[k - 1].trim() || /https?:\/\//.test(lines[k - 1]) || /^#/.test(lines[k - 1].trim()))) k--;
  const tail = lines.slice(k).join("\n").trim();
  const room = max - tail.length - 2;
  if (!tail || room < 80) return cutChars(text, max);
  return `${cutChars(lines.slice(0, k).join("\n").trimEnd(), room)}\n\n${tail}`;
}

export function telegramDigestPost(d: DigestForPost): TelegramPost {
  const p = digestPost(d);
  return { text: p.message, link: p.link, imageUrl: p.imageUrl };
}

export function telegramArticlePost(a: ArticleForPost): TelegramPost {
  const p = articlePost(a);
  return { text: p.message, link: p.link, imageUrl: p.imageUrl };
}

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TelegramError";
  }
}

/** Publishes one post to the channel and returns the message id. */
export async function publishTelegram(opts: { token: string; chatId: string; post: TelegramPost; fetchImpl?: typeof fetch }): Promise<string> {
  const { post } = opts;
  const method = post.imageUrl ? "sendPhoto" : "sendMessage";
  const body = post.imageUrl
    ? { chat_id: opts.chatId, photo: post.imageUrl, caption: fitTelegram(post.text, CAPTION_MAX) }
    : { chat_id: opts.chatId, text: fitTelegram(post.text, TEXT_MAX), link_preview_options: { url: post.link } };
  const res = await (opts.fetchImpl ?? fetch)(`${TELEGRAM_API}/bot${opts.token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await readJsonBody(res)) as { ok?: boolean; result?: { message_id?: number }; description?: string };
  if (!res.ok || json.ok === false) {
    const why = (json.description ?? "request failed").replaceAll(opts.token, "***");
    const err = new TelegramError(`Telegram ${res.status}: ${why}`.slice(0, 300), res.status);
    // A 5xx after sending: the message may be in the channel already.
    if (maybePublished(err)) throw new UnknownOutcomeError(`publish answer lost: ${err.message}`);
    throw err;
  }
  if (json.result?.message_id === undefined) throw new UnknownOutcomeError(`Telegram ${res.status}: accepted, but no message id could be read`);
  return String(json.result.message_id);
}
