/**
 * Video narration with ElevenLabs (the owner's paid Starter plan, Oct 31 2026): model `eleven_v4`
 * (the first ElevenLabs model that speaks Mongolian; v3 does not), voice "Sarah" (the owner's pick)
 * unless `ELEVENLABS_VOICE_ID` says otherwise. The plan is a monthly credit allowance, so every
 * call is paced to last until the allowance resets (`creditPlan`):
 *
 * - `ELEVENLABS_RESERVE_CHARS` (10 000) stay untouched for the owner's own use;
 * - what is left is shared over the days until the reset, `VIDEOS_PER_DAY` videos a day;
 * - a narration longer than its share (counted as 1 credit per character, the worst case) goes to
 *   Gemini instead, so a video is never skipped because the month's credits ran low.
 *
 * The answer carries the time of every character (`/with-timestamps`), so the captions start
 * exactly where each sentence starts (`alignmentStarts`) instead of at the nearest pause. Every
 * call is logged to ai_usage_logs (provider "elevenlabs", purpose "video", the credits it cost as
 * prompt tokens, USD = credits × plan price ÷ monthly credits, CLAUDE.md rule #4).
 */
import type { BudgetGuard } from "@/lib/ai/limits";
import type { UsageLogger } from "@/lib/ai/router";

import { pcmToWav, SpeechError } from "./tts";

export const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL?.trim() || "eleven_v4";
/** "Sarah": the owner chose her among the Mongolian samples (Oct 2026). */
export const ELEVENLABS_VOICE = "EXAVITQu4vr4xnSDxMaL";

const isApiKey = (v: string) => /^sk_[A-Za-z0-9]{20,}$/.test(v);
const isVoiceId = (v: string) => /^[A-Za-z0-9]{16,32}$/.test(v);

/**
 * The key and the voice from the environment. The key is ELEVENLABS_API_KEY, or the secret
 * ELEVENLABS_VOICE_ID when that holds a key ("sk_…"): the owner saved the key under that name
 * (Nov 1 2026) and every video fell back to Gemini without a word. A voice id comes from the
 * repository variable ELEVENLABS_VOICE_ID or that secret; anything else keeps Sarah.
 */
export function elevenLabsFromEnv(env: Record<string, string | undefined>): { key: string; voice: string } {
  const candidates = [env.ELEVENLABS_API_KEY, env.ELEVENLABS_SECRET_VOICE_ID, env.ELEVENLABS_VOICE_ID].map((v) => v?.trim() ?? "");
  const key = env.ELEVENLABS_API_KEY?.trim() || candidates.find(isApiKey) || "";
  const voice = [env.ELEVENLABS_VOICE_ID, env.ELEVENLABS_SECRET_VOICE_ID].map((v) => v?.trim() ?? "").find(isVoiceId) || ELEVENLABS_VOICE;
  return { key, voice };
}
/** One money video and one price video a day (`VIDEO_SLOTS`). */
export const VIDEOS_PER_DAY = 2;

const API = "https://api.elevenlabs.io";

export interface Subscription {
  tier?: string;
  status?: string;
  character_count: number;
  character_limit: number;
  next_character_count_reset_unix?: number;
}

export interface CreditPlan {
  ok: boolean;
  reason: string;
  /** Credits this narration may use at most. */
  perVideo: number;
  available: number;
  daysLeft: number;
}

function envNumber(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * May a narration of `chars` characters use ElevenLabs now? Pure: the subscription as the API
 * reports it, the clock and the env. Spends evenly to the reset day, keeping the reserve.
 */
export function creditPlan(sub: Subscription, chars: number, now: Date = new Date(), env: Record<string, string | undefined> = process.env): CreditPlan {
  const reserve = envNumber(env, "ELEVENLABS_RESERVE_CHARS", 10_000);
  const resetMs = (sub.next_character_count_reset_unix ?? 0) * 1000;
  const untilReset = (resetMs - now.getTime()) / 86_400_000;
  // No reset date, one in the past or more than a month away (a lapsed plan, an API change): the
  // pace cannot be computed, and a guess of "1 day left" would spend half the rest on one video.
  if (!(untilReset > 0 && untilReset <= 32)) return { ok: false, reason: `no usable reset date (${sub.next_character_count_reset_unix ?? "none"})`, perVideo: 0, available: 0, daysLeft: 0 };
  const daysLeft = Math.max(1, Math.ceil(untilReset));
  const available = Math.max(0, sub.character_limit - sub.character_count - reserve);
  const perVideo = Math.floor(available / (daysLeft * VIDEOS_PER_DAY));
  const head = `${sub.character_count.toLocaleString("en")}/${sub.character_limit.toLocaleString("en")} used, ${daysLeft} d to reset, ≤ ${perVideo} a video`;
  if (sub.status && !["active", "trialing"].includes(sub.status)) return { ok: false, reason: `subscription ${sub.status}`, perVideo, available, daysLeft };
  if (chars > available) return { ok: false, reason: `${head}: only ${available} left above the ${reserve} reserve`, perVideo, available, daysLeft };
  if (chars > perVideo) return { ok: false, reason: `${head}: ${chars} would outrun the month`, perVideo, available, daysLeft };
  return { ok: true, reason: head, perVideo, available, daysLeft };
}

/** USD for `credits`: the plan's price spread over its monthly credits. */
export function creditUsd(credits: number, limit: number, env: Record<string, string | undefined> = process.env): number {
  const planUsd = envNumber(env, "ELEVENLABS_PLAN_USD", 6);
  if (!limit) return 0;
  return Math.round(((credits * planUsd) / limit) * 1e6) / 1e6;
}

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
}

/**
 * Start of each sentence (seconds) from the character times of `says.join(" ")`: the first at 0,
 * the others at their first letter. Null when the alignment does not cover the text as sent.
 */
export function alignmentStarts(says: string[], alignment: Alignment | undefined): number[] | null {
  const text = says.join(" ");
  if (!alignment || alignment.characters.join("") !== text || alignment.character_start_times_seconds.length !== text.length) return null;
  const starts = [0];
  let offset = 0;
  for (let i = 1; i < says.length; i++) {
    offset += says[i - 1].length + 1;
    starts.push(Math.round(alignment.character_start_times_seconds[offset] * 1000) / 1000);
  }
  return starts.every((s, i) => i === 0 || s > starts[i - 1]) ? starts : null;
}

export class CreditsRefused extends SpeechError {}

/**
 * Speaks the sentences with ElevenLabs and returns a WAV plus the sentence starts. Throws
 * `CreditsRefused` when the month's pace says no (nothing is spent), `SpeechError` otherwise.
 */
export async function speakElevenLabs(opts: {
  says: string[];
  apiKey: string;
  guard: BudgetGuard;
  log: UsageLogger;
  voice?: string;
  model?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<{ wav: Buffer; starts: number[] | null; plan: CreditPlan }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = { "xi-api-key": opts.apiKey, "content-type": "application/json" };
  const text = opts.says.join(" ");
  const model = opts.model ?? ELEVENLABS_MODEL;

  const subRes = await doFetch(`${API}/v1/user/subscription`, { headers, signal: AbortSignal.timeout(30_000) });
  // 401/403 here usually means the key was made without the "User: Read" permission.
  if (!subRes.ok) throw new SpeechError(`ElevenLabs subscription ${subRes.status}${subRes.status === 401 || subRes.status === 403 ? " (give the API key the User: Read permission)" : ""}`);
  const sub = (await subRes.json()) as Subscription;
  const plan = creditPlan(sub, text.length, opts.now);
  if (!plan.ok) throw new CreditsRefused(`ElevenLabs credits: ${plan.reason}`);
  const allowed = await opts.guard.check("elevenlabs");
  if (!allowed.ok) throw new CreditsRefused(`ElevenLabs skipped: ${allowed.reason}`);

  const res = await doFetch(`${API}/v1/text-to-speech/${encodeURIComponent(opts.voice ?? ELEVENLABS_VOICE)}/with-timestamps?output_format=pcm_24000`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text,
      model_id: model,
      language_code: "mn",
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = (await res.json().catch(() => ({}))) as { audio_base64?: string; alignment?: Alignment; detail?: { message?: string } | string };
  const charged = Number(res.headers.get("character-cost"));
  const credits = Number.isFinite(charged) && charged > 0 ? charged : res.ok ? text.length : 0;
  if (credits) {
    const cost = creditUsd(credits, sub.character_limit);
    await opts.log({ provider: "elevenlabs", model, purpose: "video", promptTokens: credits, completionTokens: 0, estimatedCostUsd: cost, success: res.ok && !!body.audio_base64 });
    // A call, not USD: the plan is prepaid and paced by credits (loadUsageSnapshot leaves it out too).
    opts.guard.record("elevenlabs", 0);
  }
  if (!res.ok) {
    const detail = typeof body.detail === "string" ? body.detail : (body.detail?.message ?? res.statusText);
    throw new SpeechError(`ElevenLabs speech ${res.status}: ${String(detail).slice(0, 200)}`);
  }
  if (!body.audio_base64) throw new SpeechError("ElevenLabs answered without audio");
  return { wav: pcmToWav(Buffer.from(body.audio_base64, "base64"), 24_000), starts: alignmentStarts(opts.says, body.alignment), plan };
}
