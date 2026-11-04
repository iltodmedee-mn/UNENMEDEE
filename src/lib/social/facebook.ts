/**
 * Facebook page posting (Graph API). Posts are photo posts with our "hook" card (/ig-image,
 * `POST /{page-id}/photos` with `url` + `caption`, the link inside the text), falling back to a
 * link post (`/feed`) when there is no image. Pure message builders plus one small client, so the
 * wording is unit-tested and the token never leaves here. Hooks are facts only: the editor's
 * headline, "why it matters" and the official source, never a verdict.
 */
import { editionLabel, ruleBasedNote } from "@/lib/edition";
import { largestAmount, tldrSentences } from "@/lib/format";
import { perPersonLine } from "@/lib/per-person";
import { PRODUCTION_URL } from "@/lib/site";
import type { ReaderImpact } from "@/lib/types";

import { hashtags } from "./hashtags";
import { maybePublished, UnknownOutcomeError, publishStep } from "./outcome";
import { factShareLine, impactLines, keyFacts } from "./story-lines";

export const GRAPH_VERSION = process.env.FB_GRAPH_VERSION || "v26.0";

export interface FacebookPost {
  message: string;
  link: string;
  /** Our JPEG hook card; without it the post is a plain link post. */
  imageUrl?: string;
}

export interface DigestForPost {
  id: number;
  kind: string;
  title: string;
  intro: string;
  periodEnd: Date | string;
  items: { headline: string; whyItMatters?: string }[];
  /** "provider/model" or "rule-based" (`ruleBasedNote`). */
  generatedBy?: string;
}

export interface ArticleForPost {
  id: number;
  slug: string;
  title: string;
  tldr: string;
  sourceName: string;
  amounts: string[];
  riskFlag: boolean;
  /** The article's topic key (src/lib/topics.ts) for hashtags. */
  topic?: string | null;
  /** AI risk estimate 0–100 (Discord's meter). */
  riskScore?: number | null;
  /** fact_vs_spin.neutrality_score: 0 = pure PR, 100 = facts only (Discord's meter). */
  neutrality?: number | null;
  /** "Танд хамаатай юу?" (reader_impact, grounded in the text). */
  impact?: ReaderImpact | null;
  /** fact_vs_spin.facts: checkable facts for the "📌" lines. */
  facts?: string[] | null;
}

/** Hook first: the top story and why it matters, then the next four headlines and the link. */
export function digestPost(d: DigestForPost, site = PRODUCTION_URL): FacebookPost {
  const link = `${site}/digest`;
  const [top, ...rest] = d.items;
  const lines = [`🗞 ${editionLabel(d)}`, ""];
  if (top) lines.push(`⚡ ${top.headline}`, ...(top.whyItMatters ? [`👉 ${top.whyItMatters}`] : []), "");
  if (rest.length) lines.push("Мөн өнөөдөр:", ...rest.slice(0, 4).map((it) => `• ${it.headline}`), "");
  const note = ruleBasedNote(d);
  if (note) lines.push(note, "");
  lines.push(`Бүх ${d.items.length} мэдээ, эх сурвалжтай нь 👉 ${link}`, "", hashtags("facebook"));
  return { message: lines.join("\n"), link, imageUrl: `${site}/ig-image?d=${d.id}` };
}

/**
 * One important story, told in full inside the post (most readers never tap the link): the plain
 * headline, "Танд хамаатай юу?", two summary sentences, up to two facts, the largest ₮ amount and
 * its per-person share, the AI's fact/PR estimate (labelled), the source and our link.
 */
export function articlePost(a: ArticleForPost, site = PRODUCTION_URL): FacebookPost {
  const link = `${site}/article/${a.slug}`;
  const amount = largestAmount(a.amounts);
  const perPerson = perPersonLine(a.amounts);
  const summary = tldrSentences(a.tldr, 2).join(" ");
  const impact = impactLines(a.impact);
  const facts = keyFacts(a.facts, summary);
  const meter = factShareLine(a.neutrality);
  const lines = [
    `${a.riskFlag ? "🚨" : "⚡"} ${a.title}`,
    "",
    ...(impact.length ? [...impact, ""] : []),
    `👉 ${summary}`,
    ...facts.map((f) => `📌 ${f}`),
    ...(amount ? [`💰 Дүн: ${amount}`] : []),
    ...(perPerson ? [perPerson] : []),
    ...(meter ? [meter] : []),
    ...(a.riskFlag ? ["⚠️ AI-ийн эрсдэлийн үнэлгээ өндөр (буруутгал биш)"] : []),
    `🏛 Эх сурвалж: ${a.sourceName}`,
    "",
    `Дэлгэрэнгүй, эх баримтын холбоос 👉 ${link}`,
    "",
    hashtags("facebook", a.topic),
  ];
  return { message: lines.join("\n"), link, imageUrl: `${site}/ig-image?a=${encodeURIComponent(a.slug)}` };
}

export class FacebookError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "FacebookError";
  }

  /** 190 = the token expired or was revoked; 200/10 = a permission is missing. */
  get hint(): string {
    if (this.code === 190) return "FB_PAGE_TOKEN expired or revoked: make a new never-expiring Page token (docs/FACEBOOK.md).";
    if (this.code === 200 || this.code === 10) return "The token lacks pages_manage_posts for this Page, or it is a user token (docs/FACEBOOK.md step 4).";
    if (this.code === 368) return "Facebook temporarily blocked posting from this Page (spam limit): wait and post less often.";
    return "";
  }
}

export interface FacebookPage {
  pageId: string;
  /** The Page's own access token (posts need it; a user token posts nowhere). */
  token: string;
  /** True when FB_PAGE_TOKEN was a user token and the Page token came from /me/accounts. */
  fromUserToken: boolean;
}

/**
 * Finds the Page to post as. A Page token's `/me` is the Page itself. A user token's `/me` is the
 * person: posting there fails with "(#200) … publish_actions is deprecated"
 * (Oct 2026: FB_PAGE_TOKEN held the user token from step 3 of docs/FACEBOOK.md), so its Page
 * token is taken from `/me/accounts`: the Page named by FB_PAGE_ID, or the only one it manages.
 * Tokens travel in headers only and are never logged.
 */
export async function resolveFacebookPage(opts: { token: string; pageId?: string; fetchImpl?: typeof fetch; version?: string }): Promise<FacebookPage | { error: string }> {
  const f = opts.fetchImpl ?? fetch;
  const base = `https://graph.facebook.com/${opts.version ?? GRAPH_VERSION}`;
  const get = async <T>(path: string): Promise<T & { error?: { message?: string } }> => {
    const res = await f(`${base}${path}`, { headers: { authorization: `Bearer ${opts.token}` }, signal: AbortSignal.timeout(15_000) });
    return (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  };
  // Only a user has the "accounts" edge (the Pages it manages); a Page token gets an error here.
  const accounts = await get<{ data?: { id: string; access_token?: string }[] }>("/me/accounts?fields=id,access_token&limit=100");
  if (!Array.isArray(accounts.data)) {
    const me = await get<{ id?: string }>("/me?fields=id");
    if (!me.id) return { error: `Facebook token check failed: ${me.error?.message ?? "no id"}` };
    return { pageId: opts.pageId || me.id, token: opts.token, fromUserToken: false };
  }
  const pages = accounts.data.filter((p) => p.access_token);
  const page = opts.pageId ? pages.find((p) => p.id === opts.pageId) : pages.length === 1 ? pages[0] : undefined;
  if (!page?.access_token) {
    const why = opts.pageId ? `it does not manage page ${opts.pageId}` : `it manages ${pages.length} pages: set FB_PAGE_ID`;
    return { error: `FB_PAGE_TOKEN is a user token and no Page token was found (${why}). Use the Page token (docs/FACEBOOK.md step 4).` };
  }
  return { pageId: page.id, token: page.access_token, fromUserToken: true };
}

/** Publishes one post and returns its id. The token goes in the POST body, never in a URL or a log. */
export async function publishToPage(opts: { pageId: string; token: string; post: FacebookPost; fetchImpl?: typeof fetch; version?: string }): Promise<string> {
  const { post } = opts;
  const body = post.imageUrl
    ? new URLSearchParams({ url: post.imageUrl, caption: post.message, access_token: opts.token })
    : new URLSearchParams({ message: post.message, link: post.link, access_token: opts.token });
  const edge = post.imageUrl ? "photos" : "feed";
  const res = await (opts.fetchImpl ?? fetch)(`https://graph.facebook.com/${opts.version ?? GRAPH_VERSION}/${encodeURIComponent(opts.pageId)}/${edge}`, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; post_id?: string; error?: { message?: string; code?: number } };
  if (!res.ok) {
    const err = new FacebookError(`Facebook ${res.status}: ${json.error?.message ?? "request failed"}`.slice(0, 300), res.status, json.error?.code);
    // One call both creates and publishes: a 5xx or a transient error may have posted it.
    if (maybePublished(err)) throw new UnknownOutcomeError(`publish answer lost: ${err.message}`);
    throw err;
  }
  if (!json.id) throw new UnknownOutcomeError(`Facebook ${res.status}: accepted, but no post id could be read`);
  return json.post_id ?? json.id;
}

/**
 * Publishes a Reel on the Page from a public video URL (the video generated by
 * scripts/make-video.ts, served by /reel): Reels API start → hosted-file upload → finish with
 * PUBLISHED, then a short wait for Facebook's processing. Returns the video id. Tokens travel in
 * the POST body or the Authorization header, never in a URL.
 */
export async function publishReel(opts: {
  pageId: string;
  token: string;
  videoUrl: string;
  description: string;
  fetchImpl?: typeof fetch;
  version?: string;
  sleep?: (ms: number) => Promise<void>;
}): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const version = opts.version ?? GRAPH_VERSION;
  const edge = `https://graph.facebook.com/${version}/${encodeURIComponent(opts.pageId)}/video_reels`;
  const read = async (res: Response, what: string) => {
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } };
    if (!res.ok || json.error) throw new FacebookError(`Facebook ${what} ${res.status}: ${json.error?.message ?? "request failed"}`.slice(0, 300), res.status, json.error?.code);
    return json;
  };
  const start = await read(await f(edge, { method: "POST", body: new URLSearchParams({ upload_phase: "start", access_token: opts.token }), signal: AbortSignal.timeout(30_000) }), "reel start");
  const videoId = String(start.video_id ?? "");
  if (!videoId) throw new FacebookError("Facebook reel start returned no video id", 200);
  const upload = await read(
    await f(`https://rupload.facebook.com/video-upload/${version}/${encodeURIComponent(videoId)}`, {
      method: "POST",
      headers: { authorization: `OAuth ${opts.token}`, file_url: opts.videoUrl },
      signal: AbortSignal.timeout(120_000),
    }),
    "reel upload",
  );
  if (upload.success !== true) throw new FacebookError("Facebook reel upload was not accepted", 200);
  // "finish" is the call that makes the reel public: a 5xx or transient error here may have
  // published it, so it is an unknown outcome, never a refusal to retry (Nov 2026 audit).
  await publishStep(async () =>
    read(
      await f(edge, {
        method: "POST",
        body: new URLSearchParams({ upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description: opts.description, access_token: opts.token }),
        signal: AbortSignal.timeout(60_000),
      }),
      "reel finish",
    ),
  );
  // Published asynchronously: report a processing error, otherwise the reel is on its way.
  for (let i = 0; i < 12; i++) {
    await sleep(5_000);
    const res = await f(`https://graph.facebook.com/${version}/${encodeURIComponent(videoId)}?fields=status`, { headers: { authorization: `Bearer ${opts.token}` }, signal: AbortSignal.timeout(15_000) });
    const json = (await res.json().catch(() => ({}))) as { status?: { video_status?: string; processing_phase?: { status?: string; error?: { message?: string } } } };
    const st = json.status;
    if (st?.video_status === "error" || st?.processing_phase?.status === "error") throw new FacebookError(`Facebook reel processing failed: ${st.processing_phase?.error?.message ?? "error"}`.slice(0, 300), 200);
    if (st?.video_status === "ready" || st?.video_status === "published") break;
  }
  return videoId;
}
