import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unlimitedGuard } from "@/lib/ai/limits";
import type { UsageRecord } from "@/lib/ai/router";
import { alignmentStarts, creditPlan, creditUsd, CreditsRefused, elevenLabsFromEnv, speakElevenLabs, type Subscription } from "@/lib/video/elevenlabs";

const NOW = new Date("2026-10-31T12:00:00Z");
const reset = (days: number) => Math.round(NOW.getTime() / 1000 + days * 86_400);
const sub = (used: number, days = 30, limit = 40_000): Subscription => ({ status: "active", character_count: used, character_limit: limit, next_character_count_reset_unix: reset(days) });

describe("creditPlan: the month's credits last until the reset", () => {
  it("allows a video inside its even share", () => {
    const p = creditPlan(sub(2_329), 230, NOW, {});
    assert.equal(p.ok, true);
    assert.equal(p.daysLeft, 30);
    assert.equal(p.available, 40_000 - 2_329 - 10_000);
    assert.equal(p.perVideo, Math.floor(p.available / 60));
  });
  it("keeps the reserve for the owner's own use", () => {
    assert.equal(creditPlan(sub(29_900, 1), 230, NOW, {}).ok, false);
    assert.equal(creditPlan(sub(29_900, 1), 230, NOW, { ELEVENLABS_RESERVE_CHARS: "0" }).ok, true);
  });
  it("refuses a narration that would outrun the month", () => {
    // 3 000 left above the reserve over 20 days × 2 videos = 75 a video.
    const p = creditPlan(sub(27_000, 20), 230, NOW, {});
    assert.equal(p.ok, false);
    assert.match(p.reason, /outrun the month/);
  });
  it("refuses when the reset date is missing, past or too far away", () => {
    assert.equal(creditPlan({ ...sub(0), next_character_count_reset_unix: undefined }, 10, NOW, {}).ok, false);
    assert.equal(creditPlan(sub(0, -1), 10, NOW, {}).ok, false);
    assert.equal(creditPlan(sub(0, 60), 10, NOW, {}).ok, false);
  });
  it("on the last day the rest may be used", () => {
    assert.equal(creditPlan(sub(29_400, 0.2), 230, NOW, {}).ok, true);
  });
  it("refuses a paused subscription", () => {
    assert.equal(creditPlan({ ...sub(0), status: "past_due" }, 10, NOW, {}).ok, false);
  });
});

describe("creditUsd", () => {
  it("spreads the plan's price over its credits", () => {
    assert.equal(creditUsd(100, 40_000, {}), 0.015);
    assert.equal(creditUsd(100, 40_000, { ELEVENLABS_PLAN_USD: "5" }), 0.0125);
    assert.equal(creditUsd(100, 0, {}), 0);
  });
});

describe("alignmentStarts", () => {
  const says = ["За, нэг тоо.", "Таагаад үз."];
  const text = says.join(" ");
  const times = [...text].map((_, i) => i * 0.1);
  it("starts each sentence at its first letter", () => {
    assert.deepEqual(alignmentStarts(says, { characters: [...text], character_start_times_seconds: times }), [0, 1.3]);
  });
  it("is null when the alignment is for another text", () => {
    assert.equal(alignmentStarts(says, { characters: [..."other"], character_start_times_seconds: [0, 1, 2, 3, 4] }), null);
    assert.equal(alignmentStarts(says, undefined), null);
  });
});

describe("speakElevenLabs", () => {
  const says = ["За, нэг тоо.", "Таагаад үз."];
  const text = says.join(" ");

  function fake(used: number) {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/v1/user/subscription")) return new Response(JSON.stringify(sub(used)));
      const body = { audio_base64: Buffer.alloc(4800).toString("base64"), alignment: { characters: [...text], character_start_times_seconds: [...text].map((_, i) => i * 0.1) } };
      return new Response(JSON.stringify(body), { headers: { "character-cost": "9" } });
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  it("speaks, logs the credits it cost and returns exact sentence starts", async () => {
    const { calls, fetchImpl } = fake(1_000);
    const logged: UsageRecord[] = [];
    const out = await speakElevenLabs({ says, apiKey: "k", guard: unlimitedGuard, log: async (r) => void logged.push(r), fetchImpl, now: NOW });
    assert.equal(calls.length, 2);
    assert.match(calls[1], /with-timestamps\?output_format=pcm_24000$/);
    assert.equal(out.wav.subarray(0, 4).toString("latin1"), "RIFF");
    assert.deepEqual(out.starts, [0, 1.3]);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].provider, "elevenlabs");
    assert.equal(logged[0].purpose, "video");
    assert.equal(logged[0].promptTokens, 9);
  });

  it("spends nothing when the month's pace says no", async () => {
    const { calls, fetchImpl } = fake(39_990);
    await assert.rejects(speakElevenLabs({ says, apiKey: "k", guard: unlimitedGuard, log: async () => {}, fetchImpl, now: NOW }), CreditsRefused);
    assert.equal(calls.length, 1);
  });
});

describe("elevenLabsFromEnv", () => {
  const KEY = "sk_" + "a1b2c3d4".repeat(6);
  it("reads the key from ELEVENLABS_API_KEY", () => {
    assert.deepEqual(elevenLabsFromEnv({ ELEVENLABS_API_KEY: KEY }), { key: KEY, voice: "EXAVITQu4vr4xnSDxMaL" });
  });
  it("finds a key saved under the voice-id secret, and never uses it as the voice", () => {
    assert.deepEqual(elevenLabsFromEnv({ ELEVENLABS_SECRET_VOICE_ID: KEY }), { key: KEY, voice: "EXAVITQu4vr4xnSDxMaL" });
  });
  it("uses a real voice id from the variable or the secret", () => {
    assert.equal(elevenLabsFromEnv({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_VOICE_ID: "cgSgspJ2msm6clMCkdW9" }).voice, "cgSgspJ2msm6clMCkdW9");
    assert.equal(elevenLabsFromEnv({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_SECRET_VOICE_ID: "TX3LPaxmHKxFdv7VOQHJ" }).voice, "TX3LPaxmHKxFdv7VOQHJ");
  });
  it("no key at all: empty, so Gemini voices the video", () => {
    assert.equal(elevenLabsFromEnv({}).key, "");
  });
});
