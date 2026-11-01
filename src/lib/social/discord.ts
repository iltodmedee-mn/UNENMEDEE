/**
 * Discord announcement channel (free, no bot hosting): our bot posts the digests and stories (a
 * shorter card than Facebook's, see below) to the ИЛ ТОД МЭДЭЭ server's announcement channel
 * through the REST API, then publishes ("crossposts") the message, so every server that pressed "Follow" on the channel gets
 * it too. Only REST calls from GitHub Actions: the bot never connects to the gateway, so nothing
 * has to stay online. The token goes in the Authorization header only and errors never echo it.
 */
import { editionLabel, ruleBasedNote } from "@/lib/edition";
import { largestAmount, tldrSentences } from "@/lib/format";
import { formatShare, perPersonShare, POPULATION_LABEL } from "@/lib/per-person";
import { PRODUCTION_URL } from "@/lib/site";

import type { ArticleForPost, DigestForPost } from "./facebook";
import type { Quiz } from "./quiz";
import { publishStep, UnknownOutcomeError } from "./outcome";
import { cut } from "./threads";

export const DISCORD_API = "https://discord.com/api/v10";
/** Discord's limit for a message's text. */
export const CONTENT_MAX = 2000;
/** Our brand blue as the embed's side colour. */
const EMBED_COLOR = 0x1570ef;

export interface DiscordPost {
  text: string;
  link: string;
  imageUrl?: string;
  /** A native Discord poll (the daily quiz), open for `hours`. */
  poll?: { question: string; answers: string[]; hours: number };
}

/**
 * The channel id from DISCORD_CHANNEL_ID: the bare id, or the channel's whole URL
 * ("https://discord.com/channels/<server>/<channel>"), whose last number is the channel.
 */
export function discordChannelId(value: string | undefined): string | undefined {
  const ids = value?.match(/\d{17,20}/g);
  return ids?.[ids.length - 1];
}

/** Five blocks for a 0–100 score: "🟩🟩🟩⬜⬜". */
export function meter(score: number, full: string): string {
  const n = Math.max(0, Math.min(5, Math.round(score / 20)));
  return full.repeat(n) + "⬜".repeat(5 - n);
}

/** Discord bold without letting scraped text break out of it. */
const bold = (s: string) => `**${s.replace(/\*/g, "")}**`;

/**
 * A short card for Discord's younger readers: bold headline, two summary lines as a quote, the
 * amount and its per-person share in bold, the AI's fact and risk estimates as meters (labelled as
 * AI estimates), the source and our link in <…> so only the card embed shows. No hashtags.
 */
export function discordArticlePost(a: ArticleForPost, site = PRODUCTION_URL): DiscordPost {
  const link = `${site}/article/${a.slug}`;
  const amount = largestAmount(a.amounts);
  const share = perPersonShare(a.amounts);
  const meters = [
    ...(typeof a.neutrality === "number" ? [`📊 Баримт ${meter(a.neutrality, "🟩")}`] : []),
    ...(typeof a.riskScore === "number" ? [`⚠️ Эрсдэл ${meter(a.riskScore, "🟧")}`] : []),
  ];
  const lines = [
    `${a.riskFlag ? "🚨" : "⚡"} ${bold(a.title)}`,
    ...(a.impact?.change ? [`👤 ${a.impact.who ? `${bold(a.impact.who)}: ` : ""}${a.impact.change}${a.impact.when ? ` (${a.impact.when})` : ""}`] : []),
    ...tldrSentences(a.tldr, 2).map((t) => `> ${t}`),
    ...(amount ? [`💰 ${bold(amount)}${share !== null ? ` · 👤 ${POPULATION_LABEL} хүнд хуваавал ${bold(formatShare(share))} / хүн` : ""}`] : []),
    ...(meters.length ? [`${meters.join("  ·  ")}  _(AI-ийн үнэлгээ, буруутгал биш)_`] : []),
    `🏛 ${a.sourceName} · 👉 <${link}>`,
  ];
  return { text: lines.join("\n"), link, imageUrl: `${site}/ig-image?a=${encodeURIComponent(a.slug)}` };
}

/** The edition: the top story and why it matters, then numbered headlines and the link. */
export function discordDigestPost(d: DigestForPost, site = PRODUCTION_URL): DiscordPost {
  const link = `${site}/digest`;
  const [top, ...rest] = d.items;
  const lines = [`🗞 ${bold(editionLabel(d))}`];
  if (top) lines.push(`⚡ ${bold(top.headline)}`, ...(top.whyItMatters ? [`> ${top.whyItMatters}`] : []));
  if (rest.length) lines.push("", ...rest.slice(0, 6).map((it, i) => `\`${i + 2}\` ${it.headline}`));
  const note = ruleBasedNote(d);
  if (note) lines.push("", `-# ${note}`);
  lines.push("", `👉 Бүх ${d.items.length} мэдээ, эх сурвалжтай нь: <${link}>`);
  return { text: lines.join("\n"), link, imageUrl: `${site}/ig-image?d=${d.id}` };
}

/** Letter emojis for the poll options (🅰️ 🅱️ 🇨 🇩). */
export const OPTION_EMOJI = ["🅰️", "🅱️", "🇨", "🇩"];

/**
 * The daily quiz as a poll for younger readers: a guess-the-number game, the answer under it as
 * a spoiler with its per-person share and the story's link. Playful wording, real numbers only.
 */
export function discordQuizPost(q: Quiz): DiscordPost {
  const share = perPersonShare([q.answers[q.correct]]);
  const answer = `${q.answers[q.correct]}${share !== null ? `, ${POPULATION_LABEL} хүнд хуваавал ${formatShare(share)} / хүн` : ""}`;
  const text = [
    `🧠 ${bold("Өдрийн асуулт")} · таагаад үз 👀`,
    "Санал өгөөд, дараа нь хариултаа нээгээрэй 👇",
    `🔓 Хариулт: ||${answer}||`,
    `📰 Эх мэдээ: <${q.link}>`,
  ].join("\n");
  return { text, link: q.link, poll: { question: `${q.question} 🤔`, answers: q.answers, hours: 24 } };
}

/** The message body: scraped text can contain "@everyone", so no mention is ever resolved. */
export function discordMessage(post: DiscordPost) {
  return {
    content: cut(post.text, CONTENT_MAX),
    embeds: post.imageUrl ? [{ url: post.link, image: { url: post.imageUrl }, color: EMBED_COLOR }] : [],
    ...(post.poll
      ? {
          poll: {
            question: { text: post.poll.question },
            answers: post.poll.answers.map((text, i) => ({ poll_media: { text, ...(OPTION_EMOJI[i] ? { emoji: { name: OPTION_EMOJI[i] } } : {}) } })),
            duration: post.poll.hours,
            allow_multiselect: false,
          },
        }
      : {}),
    allowed_mentions: { parse: [] as string[] },
  };
}

export class DiscordError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DiscordError";
  }
}

/**
 * Posts one message to the channel and returns its id. When `crosspost` is on (an announcement
 * channel), the message is then published to the following servers; a failed publish is reported
 * through `onWarning` and does not fail the post, since the message is already in our channel.
 */
export async function publishDiscord(opts: {
  token: string;
  channelId: string;
  post: DiscordPost;
  crosspost?: boolean;
  fetchImpl?: typeof fetch;
  onWarning?: (message: string) => void;
}): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  const headers = { authorization: `Bot ${opts.token}`, "content-type": "application/json" };
  const call = async (path: string, body?: unknown) => {
    const res = await f(`${DISCORD_API}${path}`, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; code?: number };
    if (!res.ok) throw new DiscordError(`Discord ${res.status}: ${(json.message ?? "request failed").replaceAll(opts.token, "***")}`.slice(0, 300), res.status);
    return json;
  };
  const channel = encodeURIComponent(opts.channelId);
  const sent = await publishStep(() => call(`/channels/${channel}/messages`, discordMessage(opts.post)));
  if (!sent.id) throw new UnknownOutcomeError("Discord: accepted, but no message id could be read");
  if (opts.crosspost !== false) {
    try {
      await call(`/channels/${channel}/messages/${encodeURIComponent(sent.id)}/crosspost`);
    } catch (err) {
      opts.onWarning?.(`Discord message ${sent.id} was posted but not published to following servers: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return sent.id;
}
