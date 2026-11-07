import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";

import { analyzeArticle, ruleBasedAnalysis } from "@/lib/ai/analyze";
import { budgetConfig, checkAllowance, createBudgetGuard, isPaid, type BudgetGuard, type UsageSnapshot } from "@/lib/ai/limits";
import { AIUnavailableError, callAIWithFallback, chainFor, chainForCall, openRouterModel, spreadFree, zaiModel, type UsageRecord } from "@/lib/ai/router";
import { Tier1Schema, Tier2Schema } from "@/lib/ai/schemas";
import { opendataItemToScraped, parseOpendataResponse } from "@/lib/scraper/adapters/opendata";

import { startMockLLM, TIER1_OK, TIER2_OK } from "./helpers/mock-llm";

const cfg = budgetConfig({ AI_MONTHLY_BUDGET_USD: "3", AI_DAILY_BUDGET_USD: "0.3", GROK_DAILY_MAX_CALLS: "5", GEMINI_DAILY_MAX_CALLS: "800" });
const usage = (u: Partial<UsageSnapshot> = {}): UsageSnapshot => ({ monthUsd: 0, dayUsd: 0, dayCalls: {}, ...u });

describe("budget guard across reloads", () => {
  it("keeps unlogged calls (429, timeout) when the snapshot reloads, and resets on a new UTC day", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-07T10:00:00Z") });
    const c = budgetConfig({ GROK_DAILY_MAX_CALLS: "5" });
    const guard = createBudgetGuard(async () => usage(), c);
    for (let window = 0; window < 3; window++) {
      await guard.check("grok"); // loads (or reloads) the snapshot
      for (let i = 0; i < 4; i++) if ((await guard.check("grok")).ok) guard.record("grok", 0, true);
      t.mock.timers.tick(61_000);
    }
    assert.equal((await guard.check("grok")).ok, false, "5 unlogged calls in total close the provider");
    // A logged call is already in the database count: not added twice.
    const logged = createBudgetGuard(async () => usage({ dayCalls: { grok: 1 } }), c);
    await logged.check("grok");
    logged.record("grok", 0);
    t.mock.timers.tick(61_000);
    assert.equal((await logged.check("grok")).ok, true);
    // The next UTC day starts empty.
    t.mock.timers.tick(14 * 3600_000);
    assert.equal((await guard.check("grok")).ok, true);
  });
});

describe("budget limits", () => {
  it("uses safe defaults when env vars are missing", () => {
    const d = budgetConfig({});
    assert.equal(d.monthlyUsd, 3);
    assert.equal(d.dailyUsd, 0.3);
    assert.equal(d.dailyMaxCalls.grok, 5);
    assert.equal(d.requestsPerMinute.gemini, 10);
  });

  it("a written AI_TIER1_CHAIN is used exactly as written, the default one rotates", () => {
    const written = { AI_TIER1_CHAIN: "groq,nvidia,gemini" };
    const a = chainForCall("tier1", written);
    const b = chainForCall("tier1", written);
    assert.deepEqual(a, ["groq", "nvidia", "gemini"]);
    assert.deepEqual(b, a);
    const seen = new Set([chainForCall("tier1", {}).join(), chainForCall("tier1", {}).join()]);
    assert.equal(seen.size, 2, "the default chain rotates its free head");
  });

  it("blocks paid providers once the monthly or daily budget is spent", () => {
    assert.equal(checkAllowance("deepseek", usage({ monthUsd: 2.99 }), cfg).ok, true);
    assert.equal(checkAllowance("deepseek", usage({ monthUsd: 3 }), cfg).ok, false);
    assert.equal(checkAllowance("grok", usage({ dayUsd: 0.31 }), cfg).ok, false);
  });

  it("keeps a free Gemini key working after the money budget is gone, until its call quota", () => {
    process.env.GEMINI_FREE_TIER = "true";
    assert.equal(checkAllowance("gemini", usage({ monthUsd: 99, dayUsd: 99 }), cfg).ok, true);
    const r = checkAllowance("gemini", usage({ dayCalls: { gemini: 800 } }), cfg);
    assert.equal(r.ok, false);
    delete process.env.GEMINI_FREE_TIER;
  });

  it("treats a billed Gemini key as paid: the USD budget stops it", () => {
    assert.equal(checkAllowance("gemini", usage({ monthUsd: 0.1, dayUsd: 0.01 }), cfg).ok, true);
    assert.equal(checkAllowance("gemini", usage({ monthUsd: 99, dayUsd: 99 }), cfg).ok, false);
  });

  it("caps Grok calls per day even when money is left", () => {
    assert.equal(checkAllowance("grok", usage({ dayCalls: { grok: 4 } }), cfg).ok, true);
    assert.equal(checkAllowance("grok", usage({ dayCalls: { grok: 5 } }), cfg).ok, false);
  });

  it("tracks new calls in memory between DB refreshes", async () => {
    let loads = 0;
    const guard = createBudgetGuard(async () => {
      loads++;
      return usage({ monthUsd: 2.9 });
    }, cfg);
    assert.equal((await guard.check("deepseek")).ok, true);
    guard.record("deepseek", 0.15);
    assert.equal((await guard.check("deepseek")).ok, false, "2.9 + 0.15 crosses $3");
    assert.equal(loads, 1, "snapshot cached");
  });

  it("parses chain overrides and ignores unknown providers", () => {
    // A billed Gemini key goes behind the free providers; a free one (no billing) stays near the front.
    const free = ["nvidia", "requesty", "openrouter", "zai"];
    assert.deepEqual(chainFor("tier1", {}), ["groq", ...free, "gemini", "deepseek", "ollama"]);
    assert.deepEqual(chainFor("tier2", {}), ["grok", "groq", "nvidia", "requesty", "openrouter", "zai", "gemini", "deepseek", "ollama"]);
    assert.ok(!chainFor("tier1", {}).includes("mistral"), "Mistral's free API is paused: opt-in only");
    assert.deepEqual(chainFor("tier1", { AI_TIER1_CHAIN: "mistral,groq" }), ["mistral", "groq"]);
    assert.deepEqual(chainFor("tier1", { GEMINI_FREE_TIER: "true" }), ["groq", "gemini", ...free, "deepseek", "ollama"]);
    assert.deepEqual(chainFor("tier2", { AI_TIER2_CHAIN: "gemini, openai ,deepseek,gemini" }), ["gemini", "deepseek"]);
  });

  it("spreads bulk calls over the free providers in turn, paid ones stay last", () => {
    const chain = chainFor("tier1", {});
    const free = ["groq", "nvidia", "requesty", "openrouter"];
    assert.deepEqual(spreadFree(chain, 0).slice(0, 4), free);
    assert.deepEqual(spreadFree(chain, 1).slice(0, 4), [...free.slice(1), "groq"]);
    assert.deepEqual(spreadFree(chain, 3).slice(0, 4), ["openrouter", ...free.slice(0, 3)]);
    assert.deepEqual(spreadFree(chain, 1).slice(4), ["zai", "gemini", "deepseek", "ollama"], "Z.ai is the free overflow, not in the rotation");
    assert.deepEqual(spreadFree(["grok", "groq"], 1), ["grok", "groq"], "a paid head is not rotated");
  });
});

describe("free-only model locks", () => {
  it("OpenRouter calls only :free models", () => {
    assert.equal(openRouterModel({}), "nvidia/nemotron-3-ultra-550b-a55b:free");
    assert.equal(openRouterModel({ OPENROUTER_MODEL: "google/gemma-4-31b-it:free" }), "google/gemma-4-31b-it:free");
    assert.equal(openRouterModel({ OPENROUTER_MODEL: "anthropic/claude-x" }), "nvidia/nemotron-3-ultra-550b-a55b:free", "a billed model id is ignored");
  });

  it("Z.ai calls only the free -flash models", () => {
    assert.equal(zaiModel({}), "glm-4.7-flash");
    assert.equal(zaiModel({ ZAI_MODEL: "glm-4.6v-flash" }), "glm-4.6v-flash");
    assert.equal(zaiModel({ ZAI_MODEL: "glm-4.7-flashx" }), "glm-4.7-flash", "FlashX bills");
    assert.equal(zaiModel({ ZAI_MODEL: "glm-5.1" }), "glm-4.7-flash");
  });

  it("the new free providers are not paid and never count against the USD budget", () => {
    for (const p of ["openrouter", "zai"] as const) assert.equal(isPaid(p), false, p);
    // A working Mistral key is a paying one (its free API refuses every call): budget-guarded even at price 0.
    assert.equal(isPaid("mistral"), true);
  });
});

describe("router with Gemini + budget guard (mock server)", () => {
  let mock: Awaited<ReturnType<typeof startMockLLM>>;
  let script: (model: string, i: number) => { status?: number; content?: string };
  const logs: UsageRecord[] = [];
  const log = async (r: UsageRecord) => void logs.push(r);
  const KEYS = ["GROQ_API_KEY", "NVIDIA_API_KEY", "REQUESTY_API_KEY", "REQUESTY_BASE_URL", "REQUESTY_MODEL", "REQUESTY_RPM", "GEMINI_API_KEY", "GEMINI_BASE_URL", "GEMINI_MODEL", "GEMINI_DEEP_MODEL", "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "GROK_API_KEY", "GROK_BASE_URL", "GROK_MODEL", "GEMINI_RPM", "AI_RATE_LIMIT_WAIT_MS", "GEMINI_FREE_TIER"];

  before(async () => {
    mock = await startMockLLM((model, i) => script(model, i));
    Object.assign(process.env, {
      GEMINI_FREE_TIER: "true",
      GEMINI_API_KEY: "test",
      GEMINI_BASE_URL: mock.geminiBaseURL,
      GEMINI_MODEL: "mock-gemini-lite",
      GEMINI_DEEP_MODEL: "mock-gemini-flash",
      GEMINI_RPM: "0",
      AI_RATE_LIMIT_WAIT_MS: "10",
      DEEPSEEK_API_KEY: "test",
      DEEPSEEK_BASE_URL: mock.baseURL,
      DEEPSEEK_MODEL: "mock-deepseek",
      GROK_API_KEY: "test",
      GROK_BASE_URL: mock.baseURL,
      GROK_MODEL: "mock-grok",
    });
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.GROQ_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.REQUESTY_API_KEY;
  });
  after(async () => {
    await mock.close();
    for (const k of KEYS) delete process.env[k];
  });
  beforeEach(() => {
    logs.length = 0;
    mock.calls.length = 0;
  });

  const article = { title: "Шууд гэрээ", sourceName: "Жишээ", sourceDomain: "example.gov.mn", url: "https://example.gov.mn/1", publishedAt: null, text: "48.5 тэрбум төгрөг ..." };

  it("uses free Gemini first for Tier 1 and logs $0", async () => {
    script = (model) => ({ content: model.startsWith("mock-gemini") ? TIER1_OK : "{}" });
    const out = await analyzeArticle(article, { log, budget: undefined, forceDeep: false });
    assert.equal(out.tier1Provider, "gemini/mock-gemini-lite");
    assert.equal(logs[0].provider, "gemini");
    assert.equal(logs[0].estimatedCostUsd, 0);
    // TIER1_OK has risk 100 → deep tier: Grok first (mock returns "{}" → invalid twice), then Gemini Flash.
  });

  it("skips Grok when its daily cap is reached and uses Gemini for the deep analysis", async () => {
    script = (model) => ({ content: model === "mock-gemini-flash" ? TIER2_OK : TIER1_OK });
    const guard: BudgetGuard = createBudgetGuard(async () => usage({ dayCalls: { grok: 5 } }), cfg);
    const out = await analyzeArticle(article, { log, budget: guard });
    assert.equal(out.tier2Provider, "gemini/mock-gemini-flash");
    assert.ok(!mock.calls.some((c) => c.model === "mock-grok"), "Grok never called");
  });

  it("keeps the Tier-1 result when every deep provider fails", async () => {
    script = (model) => (model === "mock-gemini-lite" ? { content: TIER1_OK } : { status: 400 });
    const out = await analyzeArticle(article, { log });
    assert.equal(out.tier1.risk_flag, true);
    assert.equal(out.tier2, null);
    assert.match(out.tier2Error ?? "", /All AI providers failed/);
  });

  it("reports budgetExhausted when every provider is blocked by limits", async () => {
    const blocked: BudgetGuard = { check: async () => ({ ok: false, reason: "monthly AI budget $3 reached" }), record: () => {} };
    const err = await callAIWithFallback({ tier: "tier2", purpose: "tier2", messages: [{ role: "user", content: "x" }], schema: Tier2Schema, budget: blocked }).catch((e) => e);
    assert.ok(err instanceof AIUnavailableError);
    assert.equal(err.budgetExhausted, true);
    assert.equal(mock.calls.length, 0, "nothing was sent");
  });

  it("retries Gemini once after a 429 instead of jumping to a paid provider", async () => {
    const lowRisk = JSON.stringify({ ...JSON.parse(TIER1_OK), risk_score: 10 });
    script = (model, i) => (model === "mock-gemini-lite" && i === 0 ? { status: 429 } : { content: lowRisk });
    const out = await analyzeArticle({ ...article, text: "жижиг мэдээ" }, { log });
    assert.equal(out.tier1Provider, "gemini/mock-gemini-lite");
    assert.deepEqual(mock.calls.map((c) => c.model), ["mock-gemini-lite", "mock-gemini-lite"], "429 → same free provider again, no paid call");
  });

  it("moves straight to the next FREE provider on a 429 instead of waiting", async () => {
    Object.assign(process.env, { REQUESTY_API_KEY: "test", REQUESTY_BASE_URL: mock.baseURL, REQUESTY_MODEL: "mock-requesty", REQUESTY_RPM: "0" });
    try {
      const lowRisk = JSON.stringify({ ...JSON.parse(TIER1_OK), risk_score: 10 });
      script = (model) => (model === "mock-gemini-lite" ? { status: 429 } : { content: lowRisk });
      const out = await analyzeArticle({ ...article, text: "жижиг мэдээ" }, { log });
      assert.equal(out.tier1Provider, "requesty/mock-requesty");
      assert.deepEqual(mock.calls.map((c) => c.model), ["mock-gemini-lite", "mock-requesty"]);
    } finally {
      delete process.env.REQUESTY_API_KEY;
    }
  });
});

describe("Requesty gateway (mock server)", () => {
  let mock: Awaited<ReturnType<typeof startMockLLM>>;
  const logs: UsageRecord[] = [];
  const KEYS = ["REQUESTY_API_KEY", "REQUESTY_BASE_URL", "REQUESTY_MODEL", "REQUESTY_RPM"];
  before(async () => {
    mock = await startMockLLM(() => ({ content: JSON.stringify({ ...JSON.parse(TIER1_OK), risk_score: 10 }), cost: 0.000321 }));
    Object.assign(process.env, { REQUESTY_API_KEY: "test", REQUESTY_BASE_URL: mock.baseURL, REQUESTY_MODEL: "mock-requesty", REQUESTY_RPM: "0" });
  });
  after(async () => {
    await mock.close();
    for (const k of KEYS) delete process.env[k];
  });

  it("logs the cost Requesty reports and counts Requesty against the USD budget", async () => {
    const out = await callAIWithFallback({
      tier: "tier1",
      purpose: "tier1",
      chain: ["requesty"],
      messages: [{ role: "user", content: "x" }],
      schema: Tier1Schema,
      log: async (r) => void logs.push(r),
    });
    assert.equal(out.provider, "requesty");
    assert.equal(out.costUsd, 0.000321);
    assert.equal(logs[0].estimatedCostUsd, 0.000321);
    const body = mock.calls[0].body as { max_tokens: number };
    assert.equal(body.max_tokens, 1_500 + 3_000, "reasoning headroom added");
    assert.equal(checkAllowance("requesty", usage({ monthUsd: 3 }), cfg).ok, false);
  });
});

describe("token-free analysis", () => {
  it("summarizes opendata.gov.mn datasets by rules", async () => {
    const item = opendataItemToScraped(parseOpendataResponse(JSON.parse(readFileSync(new URL("./fixtures/opendata-search.json", import.meta.url), "utf8")))[0]);
    const input = { title: item.title, sourceName: "Нээлттэй өгөгдөл", sourceDomain: "opendata.gov.mn", url: item.url, publishedAt: item.publishedAt, text: item.text };
    const r = ruleBasedAnalysis(input);
    assert.ok(r);
    assert.match(r.tldr_summary, /нээлттэй өгөгдлийн багц нийтэллээ/);
    assert.ok(r.facts.some((f) => f.startsWith("Эзэмшигч: ")));
    assert.equal(r.risk_score, 0);
    const out = await analyzeArticle(input);
    assert.equal(out.tier1Provider, "rule-based");
    assert.equal(out.costUsd, 0);
    assert.equal(ruleBasedAnalysis({ ...input, sourceDomain: "mof.gov.mn" }), null);
  });
});
