import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanModelText, storedNeutrality, storedSpin } from "@/lib/ai/fact-spin";
import { Tier1Schema } from "@/lib/ai/schemas";
import { paidDailySpend } from "@/lib/queries";

describe("paid AI spend on /transparency comes from the logged cost, not a fixed list", () => {
  it("includes every provider with spend above zero (billed Gemini, ElevenLabs)", () => {
    const out = paidDailySpend([
      { day: "2026-10-31", provider: "gemini", usd: "0.014" },
      { day: "2026-10-31", provider: "groq", usd: "0" },
      { day: "2026-11-01", provider: "elevenlabs", usd: "0.02625" },
      { day: "2026-11-01", provider: "gemini", usd: "0.004" },
    ]);
    assert.deepEqual(out.paidProviders, ["elevenlabs", "gemini"]);
    assert.deepEqual(out.dailySpend, [
      { day: "2026-10-31", costs: { gemini: 0.014 } },
      { day: "2026-11-01", costs: { elevenlabs: 0.02625, gemini: 0.004 } },
    ]);
  });
  it("keeps days without paid calls as zero bars and groups a fifth provider (Nov 2026 audit)", () => {
    const out = paidDailySpend([
      { day: "2026-10-25", provider: "gemini", usd: "0.5" },
      { day: "2026-10-28", provider: "elevenlabs", usd: "0.4" },
      { day: "2026-10-28", provider: "deepseek", usd: "0.3" },
      { day: "2026-10-28", provider: "grok", usd: "0.2" },
      { day: "2026-10-28", provider: "requesty", usd: "0.1" },
    ]);
    assert.deepEqual(out.dailySpend.map((d) => d.day), ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"]);
    assert.deepEqual(out.paidProviders, ["gemini", "elevenlabs", "deepseek", "бусад"]);
    assert.deepEqual(out.dailySpend[3].costs, { elevenlabs: 0.4, deepseek: 0.3, бусад: 0.30000000000000004 });
  });
  it("is empty only when nothing cost money", () => {
    assert.deepEqual(paidDailySpend([{ day: "2026-11-01", provider: "groq", usd: 0 }]), { dailySpend: [], paidProviders: [] });
  });
});

describe("a missing fact/PR assessment is shown as none, never as 100 % PR", () => {
  const base = { tldr_summary: "Засгийн газар өвлийн бэлтгэлд төсөв баталлаа.", facts: [], entities: {}, risk_score: 10 };
  it("parses a reply without neutrality_score / spin_detected to null and empty text", () => {
    const r = Tier1Schema.parse(base);
    assert.equal(r.neutrality_score, null);
    assert.equal(r.spin_detected, "");
    assert.equal(r.risk_reason, "");
  });
  it("drops non-text list items instead of printing [object Object]", () => {
    const r = Tier1Schema.parse({ ...base, facts: ["Төсөв 5 тэрбум.", { x: 1 }, 12] });
    assert.deepEqual(r.facts, ["Төсөв 5 тэрбум.", "12"]);
  });
  it("hides the five stored rows written before the fix (spin 'undefined', score 0)", () => {
    const broken = { facts: [], spin_detected: "undefined", neutrality_score: 0 };
    assert.equal(storedNeutrality(broken), null);
    assert.equal(storedSpin(broken), "");
    assert.equal(storedNeutrality({ spin_detected: "Магтаал их.", neutrality_score: 40 }), 40);
    assert.equal(cleanModelText(" null "), "");
  });
});
