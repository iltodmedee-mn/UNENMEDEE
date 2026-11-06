/**
 * Video narration with Gemini's speech model (the only speech model the project calls; the text
 * router still refuses them, `isTextModel`). The whole narration goes in one call with a short
 * director's note, which sounds like a person talking; sentence by sentence and sped up sounded
 * robotic (Oct 2026 samples). Voice "Aoede" was the owner's pick. Every call passes the budget
 * guard first and is logged with its cost to ai_usage_logs (CLAUDE.md rule #4).
 */
import type { BudgetGuard } from "@/lib/ai/limits";
import { estimateCostUsd } from "@/lib/ai/pricing";
import type { UsageLogger } from "@/lib/ai/router";
import { readJsonBody } from "@/lib/read-json";

export const TTS_MODEL = process.env.GEMINI_TTS_MODEL?.trim() || "gemini-3.8-flash-tts";
export const TTS_VOICE = process.env.GEMINI_TTS_VOICE?.trim() || "Aoede";

/** The director's note: who speaks, where, how. Only the TRANSCRIPT is read aloud. */
export function narrationPrompt(text: string): string {
  return `# AUDIO PROFILE: A woman in her mid-twenties from Ulaanbaatar, Mongolian is her only language; she talks about prices and money with her friends every day.
## THE SCENE: She is recording a voice message on her phone for a close friend, sitting at home, telling her something surprising she just found out about prices. Nobody else is listening; it is not a broadcast.
### DIRECTOR'S NOTES
Style: completely natural everyday Ulaanbaatar speech, the way young people really talk: relaxed, warm, a little amused, with a real smile in the voice. Natural rhythm and breathing, small human pauses where a person would think, a curious rising tone on the questions, genuine surprise on the big number. Not a presenter, not an announcer, not a narrator, not acting, never theatrical, never sing-song.
Pacing: normal conversational speed, the way she would talk to a friend.
Accent: native Khalkha Mongolian from Ulaanbaatar, everyday pronunciation (not careful reading).
#### TRANSCRIPT
${text}`;
}

/** A WAV container around raw 16-bit mono PCM (the API may answer either). */
export function pcmToWav(pcm: Buffer, sampleRate = 24_000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class SpeechError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeechError";
  }
}

/** Speaks `text` and returns a WAV file. Throws when the guard says no or the answer has no audio. */
export async function speak(opts: {
  text: string;
  apiKey: string;
  guard: BudgetGuard;
  log: UsageLogger;
  model?: string;
  voice?: string;
  fetchImpl?: typeof fetch;
}): Promise<Buffer> {
  const model = opts.model ?? TTS_MODEL;
  const allowed = await opts.guard.check("gemini");
  if (!allowed.ok) throw new SpeechError(`narration skipped: ${allowed.reason}`);
  const res = await (opts.fetchImpl ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(opts.apiKey ? { "x-goog-api-key": opts.apiKey } : {}) },
    body: JSON.stringify({
      contents: [{ parts: [{ text: narrationPrompt(opts.text) }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice ?? TTS_VOICE } } } },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = (await readJsonBody(res)) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const promptTokens = body.usageMetadata?.promptTokenCount ?? 0;
  const audioTokens = body.usageMetadata?.candidatesTokenCount ?? 0;
  const cost = estimateCostUsd("gemini", promptTokens, audioTokens, model);
  const audio = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (promptTokens || audioTokens) {
    await opts.log({ provider: "gemini", model, purpose: "video", promptTokens, completionTokens: audioTokens, estimatedCostUsd: cost, success: res.ok && !!audio });
    opts.guard.record("gemini", cost);
  }
  if (!res.ok) throw new SpeechError(`Gemini speech ${res.status}: ${(body.error?.message ?? res.statusText).slice(0, 200)}`);
  if (!audio?.data) throw new SpeechError("Gemini speech answered without audio");
  const raw = Buffer.from(audio.data, "base64");
  if (raw.subarray(0, 4).toString("latin1") === "RIFF") return raw;
  const rate = Number(/rate=(\d+)/.exec(audio.mimeType ?? "")?.[1] ?? 24_000);
  return pcmToWav(raw, rate);
}
