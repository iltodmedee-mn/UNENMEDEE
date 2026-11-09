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
import { readJsonBody } from "@/lib/read-json";

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

/** Which call refused: the log must tell a refused create from a refused publish. */
function stepOf(url: string, method = "GET"): string {
  const path = url.split("?")[0];
  if (path.endsWith("/media_publish")) return "publish";
  if (path.endsWith("/media")) return method === "POST" ? "create" : "check";
  if (path.endsWith("/refresh_access_token")) return "refresh";
  return "status";
}

/** Graph throttling codes (app, user, page, per-action): the answer's usage headers say whose quota. */
const LIMIT_CODES = new Set([4, 17, 32, 613]);

/**
 * Meta's own usage report on a throttled answer (percentages of the app's and the account's quotas,
 * no ids that matter, never the token). Nov 7-9 2026: every image post answered "Application request
 * limit reached (code 4)" while Reels still went out, and nothing showed which quota it was.
 */
function usageNote(res: Response): string {
  const app = res.headers.get("x-app-usage");
  const business = res.headers.get("x-business-use-case-usage");
  const parts = [app && `app ${app}`, business && `business ${business}`].filter(Boolean);
  return parts.length ? ` [usage: ${parts.join("; ")}]`.slice(0, 400) : "";
}

async function call(fetchImpl: Fetch, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const json = (await readJsonBody(res)) as Record<string, unknown> & { error?: { message?: string; code?: number } };
  if (!res.ok || json.error) {
    const code = json.error?.code;
    const head = `Instagram ${res.status}: (${stepOf(url, init?.method)}) ${json.error?.message ?? "request failed"} (code ${code ?? "?"})`.slice(0, 300);
    throw new InstagramError(head + (code !== undefined && LIMIT_CODES.has(code) ? usageNote(res) : ""), code);
  }
  return json;
}

/** Refreshes a long-lived Instagram Login token (restarts its 60 days; it must be 24 h old). */
export async function refreshInstagramToken(token: string, fetchImpl: Fetch = fetch): Promise<string> {
  const json = await call(fetchImpl, `${INSTAGRAM_API}/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`);
  if (typeof json.access_token !== "string") throw new Error("Instagram refresh returned no token");
  return json.access_token;
}

const captionKey = (caption: string) => caption.replace(/\s+/g, " ").trim().slice(0, 300);

/**
 * The id of a recent post on the account with this caption, or null. Nov 7-9 2026: media_publish
 * answered "Application request limit reached (code 4)" AFTER publishing, the ledger read that as
 * "not posted", and each hourly run posted the same digest or story again. Asking first makes a
 * retry find the live post (its id goes to the ledger) instead of publishing a copy. A failed
 * check throws: no post without knowing it is not already there.
 */
export async function findPostedCaption(f: Fetch, base: string, token: string, caption: string): Promise<string | null> {
  const json = await call(f, `${base}/me/media?${new URLSearchParams({ fields: "id,caption", limit: "25", access_token: token })}`);
  const data = Array.isArray(json.data) ? (json.data as { id?: unknown; caption?: unknown }[]) : [];
  const key = captionKey(caption);
  const hit = data.find((m) => typeof m.id === "string" && typeof m.caption === "string" && captionKey(m.caption) === key);
  return hit ? String(hit.id) : null;
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
  const posted = await findPostedCaption(f, base, token, opts.post.caption);
  if (posted) return posted;
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
  const posted = await findPostedCaption(f, base, token, opts.caption);
  if (posted) return posted;
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
