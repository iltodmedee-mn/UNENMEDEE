/**
 * Instagram posting (Instagram API with Instagram Login, graph.instagram.com): an image container
 * from our own JPEG card (/ig-image, Instagram accepts only JPEG fetched from a public URL), wait
 * until it is FINISHED, then publish. Captions are plain text (links are not clickable there, so
 * they point to the link in the bio). The 60-day token is seeded by INSTAGRAM_TOKEN and kept and
 * refreshed in app_settings key INSTAGRAM_SETTINGS_KEY, exactly like Threads.
 */
import { editionLabel, ruleBasedNote } from "@/lib/edition";
import { largestAmount, tldrSentences } from "@/lib/format";
import { perPersonLine } from "@/lib/per-person";
import { PRODUCTION_URL } from "@/lib/site";

import type { ArticleForPost, DigestForPost } from "./facebook";
import { hashtags } from "./hashtags";
import { factShareLine, impactLines, keyFacts } from "./story-lines";
import { publishStep } from "./outcome";

export const INSTAGRAM_API = "https://graph.instagram.com";
export const INSTAGRAM_VERSION = process.env.IG_GRAPH_VERSION || "v26.0";
export const INSTAGRAM_SETTINGS_KEY = "instagram";
export const CAPTION_MAX = 2200;

export interface InstagramPost {
  /** Our JPEG card (an image post), or */
  imageUrl?: string;
  /** a generated video (a Reel, also shown in the feed). */
  videoUrl?: string;
  caption: string;
}

function fit(text: string): string {
  return text.length <= CAPTION_MAX ? text : `${text.slice(0, CAPTION_MAX - 1)}…`;
}

export function instagramDigestPost(d: DigestForPost, site = PRODUCTION_URL): InstagramPost {
  const [top, ...rest] = d.items;
  const lines = [`🗞 ${editionLabel(d)}`, ""];
  if (top) lines.push(`⚡ ${top.headline}`, ...(top.whyItMatters ? [`👉 ${top.whyItMatters}`] : []), "");
  if (rest.length) lines.push("Мөн өнөөдөр:", ...rest.slice(0, 9).map((it) => `• ${it.headline}`), "");
  const note = ruleBasedNote(d);
  if (note) lines.push(note, "");
  lines.push("Бүгдийг эх сурвалжийн холбоостой нь: iltodmedee.mn (холбоос bio-д)", "", hashtags("instagram"));
  return { imageUrl: `${site}/ig-image?d=${d.id}`, caption: fit(lines.join("\n")) };
}

export function instagramArticlePost(a: ArticleForPost, site = PRODUCTION_URL): InstagramPost {
  const amount = largestAmount(a.amounts);
  const perPerson = perPersonLine(a.amounts);
  const summary = tldrSentences(a.tldr, 3).join(" ");
  const impact = impactLines(a.impact);
  const meter = factShareLine(a.neutrality);
  const caption = [
    `${a.riskFlag ? "🚨" : "⚡"} ${a.title}`,
    "",
    ...(impact.length ? [...impact, ""] : []),
    `👉 ${summary}`,
    ...keyFacts(a.facts, summary).map((f) => `📌 ${f}`),
    ...(amount ? [`💰 Дүн: ${amount}`] : []),
    ...(perPerson ? [perPerson] : []),
    ...(meter ? [meter] : []),
    ...(a.riskFlag ? ["⚠️ AI-ийн эрсдэлийн үнэлгээ өндөр (буруутгал биш)"] : []),
    `🏛 Эх сурвалж: ${a.sourceName}`,
    "",
    "Дэлгэрэнгүй, эх баримтын холбоос: iltodmedee.mn (холбоос bio-д)",
    "",
    hashtags("instagram", a.topic),
  ].join("\n");
  return { imageUrl: `${site}/ig-image?a=${encodeURIComponent(a.slug)}`, caption: fit(caption) };
}

type Fetch = typeof fetch;

/**
 * "Media ID is not available": the container exists but Instagram's read replicas have not seen it
 * yet. Seen on Oct 28 2026 right after a successful create (a 1965 article went to Facebook,
 * Threads and Discord but not Instagram); waiting and asking again is what Meta recommends.
 */
export const MEDIA_NOT_READY = 9007;
const PUBLISH_RETRIES = 3;

class InstagramError extends Error {
  constructor(
    message: string,
    readonly code: number | undefined,
  ) {
    super(message);
  }
}

const notReady = (err: unknown) => err instanceof InstagramError && err.code === MEDIA_NOT_READY;

async function call(fetchImpl: Fetch, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } };
  if (!res.ok || json.error) throw new InstagramError(`Instagram ${res.status}: ${json.error?.message ?? "request failed"} (code ${json.error?.code ?? "?"})`.slice(0, 300), json.error?.code);
  return json;
}

/** Refreshes a long-lived Instagram Login token (restarts its 60 days; it must be 24 h old). */
export async function refreshInstagramToken(token: string, fetchImpl: Fetch = fetch): Promise<string> {
  const json = await call(fetchImpl, `${INSTAGRAM_API}/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`);
  if (typeof json.access_token !== "string") throw new Error("Instagram refresh returned no token");
  return json.access_token;
}

/**
 * Creates the image (or Reel) container, waits until Instagram has fetched the file, publishes,
 * returns the media id. A video takes longer to process: up to 3 minutes of checks.
 */
export async function publishInstagram(opts: { token: string; post: InstagramPost; fetchImpl?: Fetch; sleep?: (ms: number) => Promise<void> }): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const base = `${INSTAGRAM_API}/${INSTAGRAM_VERSION}`;
  const token = opts.token;
  const media: Record<string, string> = opts.post.videoUrl
    ? { media_type: "REELS", video_url: opts.post.videoUrl, share_to_feed: "true" }
    : { image_url: opts.post.imageUrl ?? "" };
  const created = await call(f, `${base}/me/media`, {
    method: "POST",
    body: new URLSearchParams({ ...media, caption: opts.post.caption, access_token: token }),
  });
  const id = String(created.id ?? "");
  if (!id) throw new Error("Instagram returned no container id");
  await waitFinished(f, base, id, token, opts.post.videoUrl ? 36 : 12, sleep);
  return publishCreation(f, base, id, token, sleep);
}

/** Polls a container until FINISHED; a 9007 on the status read counts as still processing. */
async function waitFinished(f: Fetch, base: string, id: string, token: string, checks: number, sleep: (ms: number) => Promise<void>): Promise<void> {
  for (let i = 0; ; i++) {
    const s = await call(f, `${base}/${encodeURIComponent(id)}?${new URLSearchParams({ fields: "status_code,status", access_token: token })}`).catch((err: unknown) => {
      if (notReady(err)) return { status_code: "NOT_AVAILABLE_YET" } as Record<string, unknown>;
      throw err;
    });
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram container ${String(s.status_code)}: ${String(s.status ?? "")}`);
    // Never publish a container that is not ready (media_publish would fail or post without the image).
    if (i >= checks - 1) throw new Error(`Instagram container not finished after ${i + 1} checks (${String(s.status_code ?? "?")})`);
    await sleep(5_000);
  }
}

/** media_publish; a 9007 right after FINISHED is a few more seconds, not a failure. */
async function publishCreation(f: Fetch, base: string, id: string, token: string, sleep: (ms: number) => Promise<void>): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const published = await publishStep(() => call(f, `${base}/me/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: id, access_token: token }) }));
      return String(published.id ?? id);
    } catch (err) {
      if (!notReady(err) || attempt >= PUBLISH_RETRIES) throw err;
      await sleep(5_000);
    }
  }
}

/** Instagram's limit for one carousel. */
export const CAROUSEL_MAX = 10;

/**
 * A carousel of our JPEG cards (the weekly quiz): one item container per image, each waited for,
 * then the CAROUSEL container with the caption, waited for and published. Returns the media id.
 */
export async function publishInstagramCarousel(opts: { token: string; imageUrls: string[]; caption: string; fetchImpl?: Fetch; sleep?: (ms: number) => Promise<void> }): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const base = `${INSTAGRAM_API}/${INSTAGRAM_VERSION}`;
  const token = opts.token;
  if (opts.imageUrls.length < 2 || opts.imageUrls.length > CAROUSEL_MAX) throw new Error(`Instagram carousel needs 2–${CAROUSEL_MAX} images, got ${opts.imageUrls.length}`);
  const children: string[] = [];
  for (const imageUrl of opts.imageUrls) {
    const item = await call(f, `${base}/me/media`, { method: "POST", body: new URLSearchParams({ image_url: imageUrl, is_carousel_item: "true", access_token: token }) });
    const id = String(item.id ?? "");
    if (!id) throw new Error("Instagram returned no carousel item id");
    children.push(id);
  }
  for (const id of children) await waitFinished(f, base, id, token, 12, sleep);
  const parent = await call(f, `${base}/me/media`, { method: "POST", body: new URLSearchParams({ media_type: "CAROUSEL", children: children.join(","), caption: opts.caption, access_token: token }) });
  const id = String(parent.id ?? "");
  if (!id) throw new Error("Instagram returned no carousel container id");
  await waitFinished(f, base, id, token, 12, sleep);
  return publishCreation(f, base, id, token, sleep);
}
