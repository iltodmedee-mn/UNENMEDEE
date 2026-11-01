import OpenAI from "openai";
import type { z } from "zod";

import type { AIProvider } from "@/lib/types";

import { geminiGenerate, GeminiError, type ChatMessage } from "./gemini";
import { throttleProvider, unlimitedGuard, type BudgetGuard } from "./limits";
import { estimateCostUsd, GEMINI_BILLED_MODEL, geminiIsFree, getPrice, isTextModel } from "./pricing";
import { parseJsonLoose } from "./schemas";

export type Tier = "tier1" | "tier2";
/**
 * What a call was for, stored in ai_usage_logs.purpose. Admin re-analysis logs its two calls as
 * "admin_tier1" / "admin_tier2" (it used to log both as "admin", so the article page showed the
 * old summary model, or the admin's Tier-1 model as the deep analysis). "admin" stays for the
 * admin's URL/filter tools.
 */
export type Purpose = "tier1" | "tier2" | "cluster" | "admin" | "admin_tier1" | "admin_tier2" | "digest" | "topic" | "reader" | "video";

export interface UsageRecord {
  provider: AIProvider;
  model: string;
  purpose: Purpose;
  articleId?: number | null;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  success: boolean;
}

/** Where usage records go. The default writes to `ai_usage_logs` (see usage-log.ts). */
export type UsageLogger = (record: UsageRecord) => Promise<void>;

interface CompletionArgs {
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
}

interface CompletionResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  /** Exact billed cost when the provider reports it (Requesty does). */
  costUsd?: number;
}

interface ProviderConfig {
  provider: AIProvider;
  model: string;
  complete(args: CompletionArgs): Promise<CompletionResult>;
}

/** Thrown when no provider in the chain is configured or all of them failed. */
export class AIUnavailableError extends Error {
  constructor(
    message: string,
    readonly attempts: string[],
  ) {
    super(message);
    this.name = "AIUnavailableError";
  }

  /** True when every provider was skipped because a spending/quota limit was reached. */
  get budgetExhausted(): boolean {
    return this.attempts.length > 0 && this.attempts.every((a) => a.includes("skipped (limit"));
  }
}

const clients = new Map<string, OpenAI>();

function openaiClient(baseURL: string, apiKey: string, timeoutMs: number): OpenAI {
  const key = `${baseURL}|${apiKey.slice(-6)}`;
  let c = clients.get(key);
  if (!c) {
    // The router owns retries (one repair, one 429 wait, then the next provider): with the SDK's
    // default of 2 a single attempt could mean three requests and three timeouts per provider.
    c = new OpenAI({ baseURL, apiKey, timeout: timeoutMs, maxRetries: 0 });
    clients.set(key, c);
  }
  return c;
}

interface OpenAIProviderOptions {
  timeoutMs?: number;
  /** Extra output tokens for models that reason before answering (reasoning shares the limit). */
  reasoningHeadroom?: number;
}

function openaiProvider(provider: AIProvider, model: string, baseURL: string, apiKey: string, opts: OpenAIProviderOptions = {}): ProviderConfig {
  const client = openaiClient(baseURL, apiKey, opts.timeoutMs ?? 120_000);
  return {
    provider,
    model,
    async complete({ messages, temperature, maxTokens }) {
      const res = await client.chat.completions.create({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature,
        max_tokens: maxTokens + (opts.reasoningHeadroom ?? 0),
      });
      const reportedCost = (res.usage as { cost?: unknown } | undefined)?.cost;
      // OpenRouter answers some upstream failures with HTTP 200 and an `error` body, no `choices`
      // (Oct 29 2026: "Cannot read properties of undefined (reading '0')").
      if (!Array.isArray(res.choices) || res.choices.length === 0) {
        const upstream = (res as unknown as { error?: { message?: string; code?: unknown } }).error;
        throw new Error(`no answer in the response${upstream?.message ? `: ${upstream.message}` : ""}`);
      }
      return {
        content: res.choices[0]?.message?.content ?? "",
        promptTokens: res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
        costUsd: typeof reportedCost === "number" && Number.isFinite(reportedCost) && reportedCost >= 0 ? reportedCost : undefined,
      };
    },
  };
}

/**
 * The Gemini model for a tier. A billed key (no GEMINI_FREE_TIER=true) only ever uses a Flash-Lite
 * model: a GEMINI_MODEL / GEMINI_DEEP_MODEL override naming anything else (Flash, Pro) is ignored,
 * so a repository variable cannot quietly multiply the bill.
 */
export function geminiModel(env: Record<string, string | undefined>, deep: boolean): string {
  const override = (deep ? env.GEMINI_DEEP_MODEL : env.GEMINI_MODEL)?.trim();
  if (geminiIsFree(env)) return override || (deep ? "gemini-flash-latest" : "gemini-flash-lite-latest");
  if (override && /flash-lite/i.test(override)) return override;
  if (override) console.warn(`[ai] billed Gemini key: "${override}" ignored, only Flash-Lite is used (${GEMINI_BILLED_MODEL})`);
  return GEMINI_BILLED_MODEL;
}

/**
 * OpenRouter model: only ids ending in ":free" (no charge, 50 requests a day per account). Any
 * other OPENROUTER_MODEL would bill the account's credit, so it is ignored like a Gemini override.
 */
export function openRouterModel(env: Record<string, string | undefined>): string {
  const override = env.OPENROUTER_MODEL?.trim();
  if (override && override.endsWith(":free")) return override;
  if (override) console.warn(`[ai] OpenRouter: "${override}" ignored, only ":free" models are used`);
  return "nvidia/nemotron-3-ultra-550b-a55b:free";
}

/** Z.ai model: only the free "-flash" GLM models; "-flashx" and the larger GLM models bill. */
export function zaiModel(env: Record<string, string | undefined>): string {
  const override = env.ZAI_MODEL?.trim();
  if (override && /-flash$/i.test(override)) return override;
  if (override) console.warn(`[ai] Z.ai: "${override}" ignored, only the free "-flash" models are used`);
  return "glm-4.7-flash";
}

/** Providers that are configured in this environment (keys present). */
export function configuredProvider(provider: AIProvider, tier: Tier = "tier1"): ProviderConfig | null {
  const env = process.env;
  switch (provider) {
    case "deepseek":
      return env.DEEPSEEK_API_KEY
        ? openaiProvider(provider, env.DEEPSEEK_MODEL || "deepseek-chat", env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1", env.DEEPSEEK_API_KEY)
        : null;
    case "grok":
      return env.GROK_API_KEY ? openaiProvider(provider, env.GROK_MODEL || "grok-4-fast", env.GROK_BASE_URL || "https://api.x.ai/v1", env.GROK_API_KEY) : null;
    case "gemini": {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) return null;
      // Bulk tier: Flash-Lite (no "thinking" by default: fast, generous free quota).
      // Deep tier: Flash, which reasons before answering; its thinking tokens share the
      // output limit, so it gets generous headroom (free tier: tokens cost nothing).
      const deep = tier === "tier2";
      // A billed key uses the cheapest text model for everything (Flash-Lite 2.5, $0.10/$0.40);
      // a free (no-billing) key keeps the better "-latest" models, which cost nothing there.
      const model = geminiModel(env, deep);
      if (!isTextModel(model)) {
        console.warn(`[ai] GEMINI model "${model}" is not a text model (image/video/speech are never used): Gemini skipped`);
        return null;
      }
      return {
        provider,
        model,
        complete: ({ messages, temperature, maxTokens }) =>
          geminiGenerate({
            apiKey,
            model,
            messages,
            temperature,
            // Flash "thinks" before answering and its thinking shares the output limit; Lite does not.
            maxTokens: deep && !/lite/i.test(model) ? Math.max(maxTokens * 4, 8_192) : maxTokens,
          }),
      };
    }
    case "groq":
      // Groq free tier (OpenAI-compatible). Qwen 3.8 27B: valid JSON, good Mongolian, 2-3 s.
      return env.GROQ_API_KEY
        ? openaiProvider(provider, env.GROQ_MODEL || "qwen/qwen3.8-27b", env.GROQ_BASE_URL || "https://api.groq.com/openai/v1", env.GROQ_API_KEY)
        : null;
    case "nvidia":
      // NVIDIA NIM free API (OpenAI-compatible). Gemma 4 31B: valid JSON and good Mongolian
      // in tests, but slow on the free queue (15-40 s). 60 s, not 180: on Oct 28-29 2026 every
      // call timed out and each one held an article for three minutes before the next provider.
      return env.NVIDIA_API_KEY
        ? openaiProvider(provider, env.NVIDIA_MODEL || "google/gemma-4-31b-it", env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1", env.NVIDIA_API_KEY, { timeoutMs: 60_000 })
        : null;
    case "requesty":
      // Requesty gateway (OpenAI-compatible). The default Gemma 4 31B is free there and
      // faster than on NVIDIA's queue (~7 s); it reasons first, hence the output headroom.
      return env.REQUESTY_API_KEY
        ? openaiProvider(provider, env.REQUESTY_MODEL || "google/gemma-4-31b-it", env.REQUESTY_BASE_URL || "https://router.requesty.ai/v1", env.REQUESTY_API_KEY, {
            timeoutMs: 150_000,
            reasoningHeadroom: 3_000,
          })
        : null;
    case "mistral":
      // Opt-in only (not in DEFAULT_CHAINS): the free Experiment plan has answered 429 since Aug 2026.
      return env.MISTRAL_API_KEY
        ? openaiProvider(provider, env.MISTRAL_MODEL || "mistral-medium-latest", env.MISTRAL_BASE_URL || "https://api.mistral.ai/v1", env.MISTRAL_API_KEY)
        : null;
    case "openrouter":
      // OpenRouter's free models (one key, 50 calls a day): Nemotron 3 Ultra. On the Mongolian sample
      // (Oct 2026) it answered in ~25 s with sound facts and risk; the free Gemma endpoints were
      // saturated (429). Free endpoints need the account's "free endpoints that may train" setting
      // on and Zero Data Retention off. It reasons first, hence the output headroom.
      return env.OPENROUTER_API_KEY
        ? openaiProvider(provider, openRouterModel(env), env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1", env.OPENROUTER_API_KEY, {
            timeoutMs: 150_000,
            reasoningHeadroom: 3_000,
          })
        : null;
    case "zai":
      // Z.ai GLM-4.7-Flash: free, one request at a time. It thinks before answering, so the
      // thinking gets output headroom (GLM counts it in max_tokens).
      return env.ZAI_API_KEY
        ? openaiProvider(provider, zaiModel(env), env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4", env.ZAI_API_KEY, {
            timeoutMs: 150_000,
            reasoningHeadroom: 4_000,
          })
        : null;
    case "ollama":
      // Only when explicitly configured (dev machines). CI has no local Ollama.
      return env.OLLAMA_BASE_URL ? openaiProvider(provider, env.OLLAMA_MODEL || "qwen3.5:4b", env.OLLAMA_BASE_URL, "ollama") : null;
    case "elevenlabs":
      // A speech service for the video narration only (src/lib/video/elevenlabs.ts), never a text model.
      return null;
  }
}

const PROVIDERS: AIProvider[] = ["deepseek", "grok", "gemini", "nvidia", "groq", "requesty", "mistral", "openrouter", "zai", "ollama"];

/**
 * Fallback order per tier. Free providers go first for bulk work (Groq, NVIDIA NIM, Requesty and
 * OpenRouter take turns, then Z.ai; Gemini joins them when its key is free). Mistral is not in the
 * default chains: its free API answers every request with 429 (paused since Aug 2026, paying
 * accounts only), and a paid Mistral key would be billed while the price table says $0; name it in
 * AI_TIER1_CHAIN with MISTRAL_PRICE_IN/OUT set to use it; each has its
 * own daily quota, so together they cover far more articles than any one (with only Groq, NVIDIA
 * and Requesty, 38 % of the bulk calls overflowed to the billed Gemini key in Oct 2026). Deep
 * analysis: Grok (paid, capped), then Gemini. A key from a billed Google project (GEMINI_FREE_TIER unset) is charged
 * for every call, so it moves behind the free providers, uses only the cheapest text model and
 * counts against the USD budget; a free (no-billing) key keeps its place and the better models.
 * Override with AI_TIER1_CHAIN / AI_TIER2_CHAIN, e.g. "deepseek,gemini" (comma separated).
 * Providers without an API key are skipped.
 */
export const DEFAULT_CHAINS: Record<Tier, AIProvider[]> = {
  tier1: ["groq", "gemini", "nvidia", "requesty", "openrouter", "zai", "deepseek", "ollama"],
  tier2: ["grok", "gemini", "groq", "nvidia", "requesty", "openrouter", "zai", "deepseek", "ollama"],
};

/**
 * Free providers that share the bulk work in turn (see spreadFree). Z.ai stays out: on the
 * Mongolian sample (Oct 2026) GLM Flash misspelt words and rated an untendered 48.5 bn ₮ contract
 * risk 55 where the others gave 85, so it only takes what the others cannot (free overflow before
 * the billed Gemini).
 */
const SPREAD: AIProvider[] = ["groq", "nvidia", "requesty", "openrouter"];

/**
 * A billed Gemini key goes after the free providers (it is the paid overflow, inside the USD
 * budget); a free one keeps its place near the front.
 */
function placeGemini(chain: AIProvider[], env: Record<string, string | undefined>): AIProvider[] {
  if (geminiIsFree(env) || !chain.includes("gemini")) return chain;
  const rest = chain.filter((p) => p !== "gemini");
  const at = rest.findIndex((p) => p === "deepseek" || p === "ollama");
  return at === -1 ? [...rest, "gemini"] : [...rest.slice(0, at), "gemini", ...rest.slice(at)];
}

let spreadTurn = 0;

/**
 * Rotates the free providers at the head of a chain, one step per call. With a fixed order
 * every call went to Groq first and NVIDIA NIM only answered when both Groq and Requesty failed,
 * so its 1,000 free calls a day sat unused while articles waited behind Groq's rate limit.
 */
export function spreadFree(chain: AIProvider[], turn = spreadTurn++): AIProvider[] {
  const head: AIProvider[] = [];
  let i = 0;
  while (i < chain.length && SPREAD.includes(chain[i])) head.push(chain[i++]);
  if (head.length < 2) return chain;
  const k = turn % head.length;
  return [...head.slice(k), ...head.slice(0, k), ...chain.slice(i)];
}

export function chainFor(tier: Tier, env: Record<string, string | undefined> = process.env): AIProvider[] {
  const raw = env[tier === "tier1" ? "AI_TIER1_CHAIN" : "AI_TIER2_CHAIN"];
  if (!raw?.trim()) return placeGemini(DEFAULT_CHAINS[tier], env);
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is AIProvider => (PROVIDERS as string[]).includes(s));
  return parsed.length ? [...new Set(parsed)] : placeGemini(DEFAULT_CHAINS[tier], env);
}

export interface CallOptions<S extends z.ZodTypeAny> {
  tier: Tier;
  purpose: Purpose;
  messages: ChatMessage[];
  schema: S;
  articleId?: number | null;
  maxTokens?: number;
  temperature?: number;
  log?: UsageLogger;
  /** Spending / quota guard. Defaults to unlimited (tests, --sample). */
  budget?: BudgetGuard;
  /** Override the provider chain (tests, admin "force Grok"). */
  chain?: AIProvider[];
}

export interface CallResult<T> {
  data: T;
  provider: AIProvider;
  model: string;
  costUsd: number;
}

const noopLogger: UsageLogger = async () => {};

/**
 * Transport failures (timeouts, 5xx, auth, network) per provider in this process. After
 * PROVIDER_TRIP of them in a row the provider is skipped for the rest of the run: on Oct 29 2026
 * NVIDIA NIM timed out on every call (180 s each, nothing logged because no tokens came back),
 * so every third article waited 4 minutes before Groq or Requesty answered in 5 s. Rate limits
 * (429) and invalid JSON do not count: they are the next provider's or the repair retry's job.
 */
export const PROVIDER_TRIP = 2;
/**
 * A trip lasts this long: a long run (a recluster, a backfill, the admin server) gets a provider
 * back after its outage instead of leaving it skipped for hours.
 */
export const TRIP_RESET_MS = 30 * 60_000;
const tripped = new Map<AIProvider, { n: number; at: number }>();
export const resetProviderTrips = () => tripped.clear();
function tripCount(provider: AIProvider): number {
  const t = tripped.get(provider);
  if (!t) return 0;
  if (Date.now() - t.at > TRIP_RESET_MS) {
    tripped.delete(provider);
    return 0;
  }
  return t.n;
}
const isTransportFailure = (err: unknown, message: string) =>
  !(err instanceof SchemaError || err instanceof SyntaxError || /no JSON object/.test(message)) && !isRetryableRateLimit(err) && !isRequestSpecific(err);

/**
 * 400 / 413 / 422 are about this request (Groq's 413 "Request too large" for one big digest
 * prompt on Oct 29 2026), not about the provider: the next call can work, so they never trip it.
 * Except a retired or unknown model: free model ids are retired every few months and providers
 * answer that with a 400 / 404 ("model_decommissioned", "does not exist", "no endpoints"), which
 * would otherwise fail every call silently (no tokens, no log line) while the load moved to the
 * billed key. That one trips the provider and prints the warning like any outage.
 */
export function isRequestSpecific(err: unknown): boolean {
  const status = err instanceof GeminiError || err instanceof OpenAI.APIError ? err.status : undefined;
  if (status !== 400 && status !== 413 && status !== 422) return false;
  return !isRetiredModel(err) && !isBadKey(err);
}

/**
 * Gemini answers a wrong or expired key with 400 "API key not valid" (not 401): counted as a
 * request-specific 400 it never tripped, and every call tried the dead key first.
 */
const BAD_KEY = /api[ _-]?key[ _-]?(not valid|invalid|expired)|API_KEY_INVALID|invalid api[ _-]?key|key expired/i;
export function isBadKey(err: unknown): boolean {
  return err instanceof Error && BAD_KEY.test(err.message);
}

const RETIRED_MODEL = /decommission|deprecat|no longer (available|supported)|model.{0,40}(not found|does not exist|not exist|unknown|invalid)|(unknown|invalid) model|no endpoints/i;

export function isRetiredModel(err: unknown): boolean {
  return err instanceof Error && RETIRED_MODEL.test(err.message);
}

function isRetryableRateLimit(err: unknown): boolean {
  return (err instanceof GeminiError && err.status === 429) || (err instanceof OpenAI.APIError && err.status === 429);
}

/**
 * Calls the tier's provider chain until one returns JSON that passes the schema.
 * Before each provider: budget/quota check, then requests-per-minute throttle.
 * Each provider gets one repair retry for invalid JSON. Every request with token usage,
 * successful or not, is logged with its USD cost and counted against the budget.
 */
export async function callAIWithFallback<S extends z.ZodTypeAny>(opts: CallOptions<S>): Promise<CallResult<z.output<S>>> {
  const log = opts.log ?? noopLogger;
  const budget = opts.budget ?? unlimitedGuard;
  const chain = (opts.chain ?? (opts.tier === "tier1" ? spreadFree(chainFor(opts.tier)) : chainFor(opts.tier)))
    .map((p) => configuredProvider(p, opts.tier))
    .filter((p): p is ProviderConfig => p !== null);
  if (chain.length === 0) {
    throw new AIUnavailableError(
      `No AI provider configured for ${opts.tier}. Set GROQ_API_KEY, MISTRAL_API_KEY, NVIDIA_API_KEY, REQUESTY_API_KEY, OPENROUTER_API_KEY, ZAI_API_KEY or GEMINI_API_KEY (free), or DEEPSEEK_API_KEY${opts.tier === "tier2" ? " / GROK_API_KEY" : ""} (or OLLAMA_BASE_URL for local runs).`,
      [],
    );
  }

  const attempts: string[] = [];
  for (const [index, p] of chain.entries()) {
    const trips = tripCount(p.provider);
    if (trips >= PROVIDER_TRIP) {
      attempts.push(`${p.provider}/${p.model}: skipped (${trips} failures this run)`);
      continue;
    }
    const allowance = await budget.check(p.provider);
    if (!allowance.ok) {
      attempts.push(`${p.provider}/${p.model}: skipped (limit: ${allowance.reason})`);
      continue;
    }
    let messages = opts.messages;
    for (let attempt = 0; attempt < 2; attempt++) {
      // The repair / rate-limit retry is a second paid call: it passes the guard again.
      if (attempt > 0) {
        const again = await budget.check(p.provider);
        if (!again.ok) {
          attempts.push(`${p.provider}/${p.model}: retry skipped (limit: ${again.reason})`);
          break;
        }
      }
      let promptTokens = 0;
      let completionTokens = 0;
      let reportedCost: number | undefined;
      try {
        await throttleProvider(p.provider);
        // The repair attempt gets more room: a reply cut off mid-JSON is the most common invalid one.
        const res = await p.complete({ messages, temperature: opts.temperature ?? 0.2, maxTokens: (opts.maxTokens ?? 1_500) * (attempt ? 2 : 1) });
        promptTokens = res.promptTokens;
        completionTokens = res.completionTokens;
        reportedCost = res.costUsd;
        const parsed = opts.schema.safeParse(parseJsonLoose(res.content));
        if (!parsed.success) throw new SchemaError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), res.content);
        const costUsd = reportedCost ?? estimateCostUsd(p.provider, promptTokens, completionTokens, p.model);
        await log({ provider: p.provider, model: p.model, purpose: opts.purpose, articleId: opts.articleId, promptTokens, completionTokens, estimatedCostUsd: costUsd, success: true });
        budget.record(p.provider, costUsd);
        tripped.delete(p.provider);
        return { data: parsed.data, provider: p.provider, model: p.model, costUsd };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        attempts.push(`${p.provider}/${p.model}: ${message.slice(0, 200)}`);
        if (isTransportFailure(err, message)) {
          const n = tripCount(p.provider) + 1;
          tripped.set(p.provider, { n, at: Date.now() });
          // Visible in the workflow log: a call that returns no tokens is not in ai_usage_logs.
          // Calls already in flight can push n past the limit: print it capped.
          console.warn(`[ai] ${p.provider}/${p.model} failed (${Math.min(n, PROVIDER_TRIP)}/${PROVIDER_TRIP}${n >= PROVIDER_TRIP ? ", skipped for the rest of this run" : ""}): ${message.slice(0, 160)}`);
        }
        if (promptTokens || completionTokens) {
          const costUsd = reportedCost ?? estimateCostUsd(p.provider, promptTokens, completionTokens, p.model);
          await log({ provider: p.provider, model: p.model, purpose: opts.purpose, articleId: opts.articleId, promptTokens, completionTokens, estimatedCostUsd: costUsd, success: false });
          budget.record(p.provider, costUsd);
        }
        if (err instanceof SchemaError || err instanceof SyntaxError || /no JSON object/.test(message)) {
          // One repair attempt on the same provider, then move on.
          messages = [
            ...opts.messages,
            { role: "assistant", content: err instanceof SchemaError ? err.reply.slice(0, 4_000) : "" },
            { role: "user", content: `Хариулт буруу байна (${message.slice(0, 200)}). Зөвхөн заасан бүтэцтэй, хүчинтэй JSON буцаа.` },
          ];
          continue;
        }
        if (isRetryableRateLimit(err) && attempt === 0) {
          // Free-tier per-minute quota. Another $0 provider next in line: switch now.
          // Only paid ones left: wait once and retry this free one instead of paying.
          // A tripped provider later in the chain is not "another free one": it would be skipped,
          // and the call would fall through to the paid providers without waiting for this one.
          if (chain.slice(index + 1).some((next) => getPrice(next.provider).input === 0 && getPrice(next.provider).output === 0 && tripCount(next.provider) < PROVIDER_TRIP)) break;
          await new Promise((r) => setTimeout(r, Number(process.env.AI_RATE_LIMIT_WAIT_MS ?? 20_000)));
          continue;
        }
        break; // network / auth / quota: next provider
      }
    }
  }
  throw new AIUnavailableError(`All AI providers failed for ${opts.tier}`, attempts);
}

class SchemaError extends Error {
  constructor(
    message: string,
    readonly reply: string,
  ) {
    super(`Invalid JSON shape: ${message}`);
    this.name = "SchemaError";
  }
}
