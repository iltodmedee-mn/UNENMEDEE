import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it, mock as nodeMock } from "node:test";

import { analyzeArticle, formatDeepAnalysis, shouldResynthesize } from "@/lib/ai/analyze";
import { CLUSTER_THRESHOLD, findBestMatch, similarity, stems, type ClusterDoc } from "@/lib/ai/clustering";
import { estimateCostUsd, getPrice, isTextModel } from "@/lib/ai/pricing";
import { AIUnavailableError, callAIWithFallback, isRequestSpecific, PROVIDER_TRIP, resetProviderTrips, TruncatedError, type UsageRecord } from "@/lib/ai/router";
import { shouldPark } from "@/lib/ai/fallback";
import { GeminiError } from "@/lib/ai/gemini";
import { parseJsonLoose, Tier1Schema, Tier2Schema } from "@/lib/ai/schemas";

import { type Reply, startMockLLM, TIER1_OK, TIER2_OK } from "./helpers/mock-llm";

describe("pricing", () => {
  it("computes exact USD cost per 1M tokens (spec defaults)", () => {
    assert.equal(estimateCostUsd("deepseek", 1_000_000, 0), 0.15);
    assert.equal(estimateCostUsd("deepseek", 1000, 500), 0.00045);
    assert.equal(estimateCostUsd("grok", 1000, 500), 0.005);
    assert.equal(estimateCostUsd("ollama", 50_000, 50_000), 0);
  });

  it("charges a billed Gemini key at its list price, Flash above Flash-Lite, and nothing when free", () => {
    assert.equal(estimateCostUsd("gemini", 1_000_000, 1_000_000, "gemini-2.5-flash-lite"), 0.5);
    assert.equal(estimateCostUsd("gemini", 1_000_000, 1_000_000, "gemini-flash-lite-latest"), 2.8);
    assert.equal(estimateCostUsd("gemini", 1_000_000, 1_000_000, "gemini-flash-latest"), 4.5);
    assert.equal(isTextModel("gemini-2.5-flash-lite"), true);
    assert.equal(isTextModel("gemini-3.1-flash-image"), false);
    assert.equal(isTextModel("gemini-2.5-flash-preview-tts"), false);
    process.env.GEMINI_FREE_TIER = "true";
    assert.equal(estimateCostUsd("gemini", 1_000_000, 1_000_000, "gemini-flash-latest"), 0);
    delete process.env.GEMINI_FREE_TIER;
  });

  it("honours env price overrides", () => {
    process.env.GROK_PRICE_IN = "0.2";
    process.env.GROK_PRICE_OUT = "0.5";
    assert.deepEqual(getPrice("grok"), { input: 0.2, output: 0.5 });
    delete process.env.GROK_PRICE_IN;
    delete process.env.GROK_PRICE_OUT;
  });
});

describe("Tier1Schema", () => {
  it("coerces, clamps, dedupes and derives risk_flag itself", () => {
    const r = Tier1Schema.parse(JSON.parse(TIER1_OK));
    assert.equal(r.risk_score, 100, "clamped from 140");
    assert.equal(r.risk_flag, true, "derived from score, model's false ignored");
    assert.equal(r.neutrality_score, 35, "string coerced");
    assert.equal(r.tldr_summary.split("\n").length, 3, "array joined into lines");
    assert.deepEqual(r.facts, ["48.5 тэрбум төгрөг", "Түргэн Зам ХХК"], "deduplicated");
  });

  it("rejects empty summaries", () => {
    assert.equal(Tier1Schema.safeParse({ tldr_summary: "" }).success, false);
  });

  it("parses JSON wrapped in fences or chatter", () => {
    assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(parseJsonLoose('Here you go: {"a":2} hope it helps'), { a: 2 });
    assert.throws(() => parseJsonLoose("no json"));
  });
});

describe("router with a mock OpenAI-compatible server", () => {
  let mock: Awaited<ReturnType<typeof startMockLLM>>;
  let script: (model: string, i: number) => Reply;
  const logs: UsageRecord[] = [];
  const log = async (r: UsageRecord) => void logs.push(r);

  before(async () => {
    mock = await startMockLLM((model, i) => script(model, i));
    process.env.DEEPSEEK_API_KEY = "test";
    process.env.DEEPSEEK_BASE_URL = mock.baseURL;
    process.env.DEEPSEEK_MODEL = "mock-deepseek";
    process.env.GROK_API_KEY = "test";
    process.env.GROK_BASE_URL = mock.baseURL;
    process.env.GROK_MODEL = "mock-grok";
    delete process.env.OLLAMA_BASE_URL;
  });
  after(async () => {
    await mock.close();
    for (const k of ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "GROK_API_KEY", "GROK_BASE_URL", "GROK_MODEL"]) delete process.env[k];
  });
  beforeEach(() => {
    logs.length = 0;
    mock.calls.length = 0;
    resetProviderTrips();
  });

  it("skips a provider for the rest of the run after it fails twice, and forgets it once it answers", async () => {
    script = (model) => (model === "mock-grok" ? { status: 503 } : { content: TIER2_OK });
    const call = () => callAIWithFallback({ tier: "tier2", purpose: "tier2", messages: [{ role: "user", content: "x" }], schema: Tier2Schema, log });
    for (let i = 0; i < PROVIDER_TRIP + 1; i++) assert.equal((await call()).provider, "deepseek");
    // Two tries at Grok, then DeepSeek alone.
    assert.deepEqual(mock.calls.map((c) => c.model), ["mock-grok", "mock-deepseek", "mock-grok", "mock-deepseek", "mock-deepseek"]);
    const err = await callAIWithFallback({ tier: "tier2", purpose: "tier2", messages: [], schema: Tier2Schema, chain: ["grok"], log }).catch((e) => e);
    assert.ok(err instanceof AIUnavailableError && /skipped \(2 failures this run\)/.test(err.attempts[0]));
    resetProviderTrips();
    script = (model) => ({ content: model === "mock-grok" ? TIER2_OK : TIER2_OK });
    assert.equal((await call()).provider, "grok");
  });

  it("a request-specific 413 never trips the provider (one big prompt is not an outage)", async () => {
    script = (model) => (model === "mock-grok" ? { status: 413 } : { content: TIER2_OK });
    const call = () => callAIWithFallback({ tier: "tier2", purpose: "tier2", messages: [{ role: "user", content: "x" }], schema: Tier2Schema, log });
    for (let i = 0; i < PROVIDER_TRIP + 1; i++) await call();
    // Grok is still tried every time.
    assert.deepEqual(mock.calls.map((c) => c.model).filter((m) => m === "mock-grok").length, PROVIDER_TRIP + 1);
  });

  it("a retired model's 400 trips the provider like an outage; a plain 400 does not", () => {
    assert.equal(isRequestSpecific(new GeminiError("Invalid JSON payload received", 400)), true);
    assert.equal(isRequestSpecific(new GeminiError("Request too large for model", 413)), true);
    for (const msg of [
      "The model `qwen/qwen3-32b` has been decommissioned and is no longer supported.",
      "models/gemini-2.5-flash-lite is no longer available to new users",
      "No endpoints found for nvidia/nemotron:free",
      "The model `glm-4.7-flash` does not exist",
      "Invalid model: gemma-4-31b-it",
    ])
      assert.equal(isRequestSpecific(new GeminiError(msg, 400)), false, msg);
  });

  it("repairs invalid JSON once on the same provider and logs both calls", async () => {
    script = (_m, i) => ({ content: i === 0 ? "not json at all" : TIER1_OK });
    const res = await callAIWithFallback({ tier: "tier1", purpose: "tier1", messages: [{ role: "user", content: "x" }], schema: Tier1Schema, log });
    assert.equal(res.provider, "deepseek");
    assert.equal(mock.calls.length, 2);
    assert.deepEqual(logs.map((l) => l.success), [false, true]);
    assert.equal(logs[1].estimatedCostUsd, 0.00045);
  });

  it("names a reply cut off at the token limit, repairs it with twice the room, and parks it when it never fits", async () => {
    const cut = TIER1_OK.slice(0, 80);
    script = (_m, i) => (i === 0 ? { content: cut, truncated: true } : { content: TIER1_OK });
    const warn = nodeMock.method(console, "warn", () => {});
    try {
      const res = await callAIWithFallback({ tier: "tier1", purpose: "tier1", messages: [{ role: "user", content: "x" }], schema: Tier1Schema, log, maxTokens: 500 });
      assert.equal(res.provider, "deepseek");
      const sent = mock.calls.map((c) => (c.body as { max_tokens: number }).max_tokens);
      assert.deepEqual(sent, [500, 1000], "the repair doubles the output room");
      const line = String(warn.mock.calls[0]?.arguments[0]);
      assert.match(line, /deepseek\/mock-deepseek TruncatedError: Invalid JSON: reply cut off at the output token limit/);
      assert.match(line, /\| reply: \{"tldr_summary"/, "the log shows what the model sent");
    } finally {
      warn.mock.restore();
    }
    // Still cut off after the repair: the article is parked like any unusable reply, no provider trips.
    script = () => ({ content: cut, truncated: true });
    const err = await callAIWithFallback({ tier: "tier1", purpose: "tier1", messages: [], schema: Tier1Schema, chain: ["deepseek"], log }).catch((e) => e);
    assert.ok(err instanceof AIUnavailableError);
    assert.match(err.attempts[0], /cut off at the output token limit/);
    assert.equal(shouldPark(err.attempts), true);
    assert.equal(new TruncatedError("{").name, "TruncatedError");
  });

  it("a 400 names the provider in the log even when the next provider answers", async () => {
    script = (model) => (model === "mock-grok" ? { status: 400 } : { content: TIER2_OK });
    const warn = nodeMock.method(console, "warn", () => {});
    try {
      await callAIWithFallback({ tier: "tier2", purpose: "tier2", messages: [{ role: "user", content: "x" }], schema: Tier2Schema, log });
      assert.ok(warn.mock.calls.some((c) => /\[ai\] grok\/mock-grok \w*Error: 400/.test(String(c.arguments[0]))), warn.mock.calls.map((c) => c.arguments[0]).join("\n"));
    } finally {
      warn.mock.restore();
    }
  });

  it("a 429 or a timeout with no tokens still counts against the provider's daily cap", async () => {
    script = (model) => (model === "mock-grok" ? { status: 429 } : { content: TIER2_OK });
    const recorded: [string, number][] = [];
    const budget = { check: async () => ({ ok: true as const }), record: (p: string, c: number) => void recorded.push([p, c]) };
    process.env.AI_RATE_LIMIT_WAIT_MS = "5";
    try {
      const res = await callAIWithFallback({ tier: "tier2", purpose: "tier2", messages: [{ role: "user", content: "x" }], schema: Tier2Schema, log, budget });
      assert.equal(res.provider, "deepseek");
      // Two Grok attempts (one wait, one retry), each a request against its quota; DeepSeek's success costs tokens.
      assert.deepEqual(recorded.filter(([p]) => p === "grok"), [["grok", 0], ["grok", 0]]);
      assert.equal(recorded.filter(([p]) => p === "deepseek").length, 1);
    } finally {
      delete process.env.AI_RATE_LIMIT_WAIT_MS;
    }
  });

  it("falls back from Grok to DeepSeek when Grok errors", async () => {
    script = (model) => (model === "mock-grok" ? { status: 400 } : { content: TIER2_OK });
    const res = await callAIWithFallback({ tier: "tier2", purpose: "tier2", messages: [{ role: "user", content: "x" }], schema: Tier2Schema, log });
    assert.equal(res.provider, "deepseek");
    assert.equal(res.data.citizen_questions.length, 2);
    assert.deepEqual(mock.calls.map((c) => c.model), ["mock-grok", "mock-deepseek"]);
    assert.deepEqual(logs.map((l) => `${l.provider}:${l.success}`), ["deepseek:true"], "failed call without tokens is not billed");
  });

  it("throws with every attempt listed when the whole chain fails", async () => {
    script = () => ({ status: 400 });
    const err = await callAIWithFallback({ tier: "tier2", purpose: "tier2", messages: [], schema: Tier2Schema, log }).catch((e) => e);
    assert.ok(err instanceof AIUnavailableError);
    assert.deepEqual(err.attempts.map((a: string) => a.split("/")[0]), ["grok", "deepseek"]);
  });

  it("runs Tier 1 then escalates high-risk items to Grok (analyzeArticle)", async () => {
    script = (model) => ({ content: model === "mock-grok" ? TIER2_OK : TIER1_OK });
    const out = await analyzeArticle(
      { title: "Шууд гэрээ", sourceName: "Жишээ", sourceDomain: "example.gov.mn", url: "https://example.gov.mn/1", publishedAt: null, text: "48.5 тэрбум төгрөгийг 350 сая ₮ ..." },
      { log },
    );
    assert.equal(out.tier1.risk_flag, true);
    assert.ok(out.tier1.entities.amounts_mnt.includes("350 сая ₮"), "regex amounts merged in");
    assert.equal(out.tier2Provider, "grok/mock-grok");
    assert.match(formatDeepAnalysis(out.tier2!), /## Иргэд асуух ёстой асуултууд\n- Яагаад тендер/);
    assert.deepEqual(logs.map((l) => `${l.provider}:${l.purpose}`), ["deepseek:tier1", "grok:tier2"]);
    assert.equal(out.costUsd, 0.00045 + 0.005);
  });

  it("reports unconfigured providers clearly", async () => {
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    await assert.rejects(
      callAIWithFallback({ tier: "tier1", purpose: "tier1", messages: [], schema: Tier1Schema }),
      (e: unknown) => e instanceof AIUnavailableError && e.attempts.length === 0 && /DEEPSEEK_API_KEY/.test(e.message),
    );
    process.env.DEEPSEEK_API_KEY = saved;
  });
});

describe("clustering", () => {
  const doc = (id: number, title: string, summary: string, orgs: string[] = [], amounts: string[] = []): ClusterDoc => ({
    id,
    title,
    summary,
    entities: { people: [], orgs, amounts_mnt: amounts },
    clusterId: null,
  });

  const a = doc(1, "Засгийн газар 2026 оны төсвийн тодотголыг УИХ-д өргөн барилаа", "Сангийн яам төсвийн тодотголоор 1.2 их наяд төгрөгийн зардал бууруулна.", ["Сангийн яам", "УИХ"], ["1.2 их наяд ₮"]);
  const b = doc(2, "УИХ төсвийн тодотголын төслийг хэлэлцэж эхэллээ", "Засгийн газраас өргөн барьсан 2026 оны төсвийн тодотгол 1.2 их наяд төгрөгөөр зардлыг бууруулна. Сангийн яамны сайд танилцуулав.", ["УИХ", "Сангийн яам"], ["1.2 их наяд ₮"]);
  const c = doc(3, "Хөвсгөл аймагт мод тарих өдөрлөг боллоо", "Аймгийн иргэд 5000 мод тарьж, байгаль хамгаалах аян өрнүүлэв.", ["Хөвсгөл аймаг"]);

  it("stems agglutinative Mongolian words to shared prefixes", () => {
    assert.deepEqual(stems("тодотгол тодотголын тодотголоор"), ["тодотг", "тодотг", "тодотг"]);
    assert.ok(!stems("ба болон нь юм").length, "stopwords removed");
  });

  it("does not join unrelated stories just because they share a big institution", () => {
    const d = doc(4, "УИХ-ын гишүүн ажлын тайлангаа тойрогтоо танилцууллаа", "Гишүүн сонгогчидтойгоо уулзаж, жилийн ажлаа тайлагнав.", ["УИХ"]);
    const e = doc(5, "УИХ Ойн тухай хуулийн шинэчилсэн найруулгыг баталлаа", "Ойн нөөцийг хамгаалах шинэ зохицуулалт хүчин төгөлдөр болно.", ["УИХ"]);
    assert.ok(similarity(d, e) < CLUSTER_THRESHOLD, `shared-entity only: ${similarity(d, e)}`);
  });

  it("re-synthesizes clusters only at growth milestones", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15].map((n) => shouldResynthesize(n - 1, n)), [false, true, true, false, true, false, false, true, false, true, true]);
    assert.equal(shouldResynthesize(3, 3), false);
    // A jump over a milestone counts (a cluster born with 4 members in one --recluster run).
    assert.equal(shouldResynthesize(0, 4), true);
    assert.equal(shouldResynthesize(3, 6), true);
    assert.equal(shouldResynthesize(3, 4), false);
    assert.equal(shouldResynthesize(8, 9), false);
    // Two members and no synthesis yet: always.
    assert.equal(shouldResynthesize(4, 6, false), true);
    assert.equal(shouldResynthesize(1, 1, false), false);
  });

  it("groups the same story from different outlets and separates unrelated news", () => {
    assert.ok(similarity(a, b) >= CLUSTER_THRESHOLD, `related: ${similarity(a, b)}`);
    assert.ok(similarity(a, c) < CLUSTER_THRESHOLD, `unrelated: ${similarity(a, c)}`);
    assert.equal(findBestMatch(a, [b, c])?.doc.id, 2);
    assert.equal(findBestMatch(c, [a, b]), null);
  });
});

describe("clustering on real same-story and different-story pairs (Oct 2026)", () => {
  type Doc = Omit<ClusterDoc, "clusterId" | "at"> & { at?: string };
  const pairs = JSON.parse(readFileSync(new URL("./fixtures/cluster-pairs.json", import.meta.url), "utf8")) as { same: [Doc, Doc][]; different: [Doc, Doc][] };
  const doc = (d: Doc): ClusterDoc => ({ ...d, clusterId: null, at: d.at ? new Date(d.at) : null });

  it("joins the same story posted by two sites with the AI wording each summary differently", () => {
    for (const [a, b] of pairs.same) assert.ok(similarity(doc(a), doc(b)) >= CLUSTER_THRESHOLD, `#${a.id}/#${b.id}: ${similarity(doc(a), doc(b))}`);
  });

  it("keeps identical generic headlines about different events apart", () => {
    for (const [a, b] of pairs.different) {
      // Kept apart by the score, or (#91/#1372: two agencies' job notices 14 days apart) by time.
      const joined = findBestMatch(doc(a), [doc(b)]) !== null;
      assert.ok(!joined, `#${a.id}/#${b.id}: ${similarity(doc(a), doc(b))}`);
    }
  });

  it("needs a shared person or organisation and similar summaries for the same-headline channel", () => {
    const [a, b] = pairs.different.find(([x]) => x.id === 91)!;
    // Same headline, same window: still apart, because the agencies and the summaries differ.
    assert.ok(similarity(doc(a), { ...doc(b), at: doc(a).at }) < CLUSTER_THRESHOLD);
  });

  it("never joins stories further apart than the cluster window", () => {
    const [a, b] = pairs.same[0];
    const far = new Date(Date.UTC(2026, 9, 1));
    assert.ok(findBestMatch({ ...doc(a), at: far }, [{ ...doc(b), at: new Date(far.getTime() + 8 * 86_400_000) }]) === null);
    assert.ok(findBestMatch({ ...doc(a), at: far }, [{ ...doc(b), at: new Date(far.getTime() + 6 * 86_400_000) }]) !== null);
  });
});
