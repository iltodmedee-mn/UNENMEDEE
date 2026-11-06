/**
 * Minimal client for Google's native Gemini API (generateContent).
 * Native (not the OpenAI-compatible endpoint) because it exposes JSON mode,
 * system instructions, thinking control and exact token usage in one call.
 */

import { oneLine } from "@/lib/log-safe";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GeminiResult {
  content: string;
  promptTokens: number;
  /** Visible output + "thinking" tokens (both are billed as output on paid tiers). */
  completionTokens: number;
  /** finishReason MAX_TOKENS: the reply stopped at the output limit. */
  truncated?: boolean;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export async function geminiGenerate(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<GeminiResult> {
  const base = (opts.baseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const system = opts.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

  const res = await fetch(`${base}/models/${encodeURIComponent(opts.model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: opts.temperature,
        // No thinkingConfig on purpose: accepted values differ per model and the "-latest"
        // aliases move. Flash-Lite does not think by default; Flash gets output headroom instead.
        maxOutputTokens: opts.maxTokens,
      },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });

  // Read the text first: a gateway's HTML 502 used to become "{}" and an error naming only the status.
  const raw = await res.text();
  let body: {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    body = {};
  }
  if (!res.ok) throw new GeminiError(`${res.status} ${body.error?.message ?? (oneLine(raw, 200) || res.statusText)}`, res.status);

  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const content = parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  const u = body.usageMetadata ?? {};
  return {
    content,
    promptTokens: u.promptTokenCount ?? 0,
    completionTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    truncated: body.candidates?.[0]?.finishReason === "MAX_TOKENS",
  };
}
