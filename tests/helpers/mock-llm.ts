import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type Reply = { status?: number; content?: string; promptTokens?: number; completionTokens?: number; cost?: number; /** The reply stopped at the output limit (finish_reason "length" / MAX_TOKENS). */ truncated?: boolean };

/**
 * Minimal OpenAI-compatible /chat/completions server that also answers Gemini's native
 * /models/{model}:generateContent. `respond` decides the reply per request (by model name
 * and call index), so tests can script failures and fallbacks.
 */
export async function startMockLLM(respond: (model: string, callIndex: number, body: { messages: { content: string }[] }) => Reply) {
  const calls: { model: string; body: unknown }[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const gemini = req.url?.match(/\/models\/([^/:]+):generateContent/);
      if (gemini) {
        const model = decodeURIComponent(gemini[1]);
        const messages = (body.contents ?? []).map((c: { parts: { text: string }[] }) => ({ content: c.parts.map((p) => p.text).join("") }));
        calls.push({ model, body });
        const r = respond(model, calls.length - 1, { messages });
        res.writeHead(r.status ?? 200, { "content-type": "application/json" });
        if ((r.status ?? 200) >= 400) {
          res.end(JSON.stringify({ error: { code: r.status, message: `mock error ${r.status}` } }));
          return;
        }
        res.end(
          JSON.stringify({
            candidates: [{ content: { role: "model", parts: [{ text: r.content ?? "{}" }] }, finishReason: r.truncated ? "MAX_TOKENS" : "STOP" }],
            usageMetadata: { promptTokenCount: r.promptTokens ?? 1000, candidatesTokenCount: r.completionTokens ?? 500, thoughtsTokenCount: 0 },
          }),
        );
        return;
      }
      calls.push({ model: body.model, body });
      const r = respond(body.model, calls.length - 1, body);
      res.writeHead(r.status ?? 200, { "content-type": "application/json" });
      if ((r.status ?? 200) >= 400) {
        res.end(JSON.stringify({ error: { message: `mock error ${r.status}` } }));
        return;
      }
      res.end(
        JSON.stringify({
          id: "mock",
          object: "chat.completion",
          created: 0,
          model: body.model,
          choices: [{ index: 0, finish_reason: r.truncated ? "length" : "stop", message: { role: "assistant", content: r.content ?? "{}" } }],
          usage: { prompt_tokens: r.promptTokens ?? 1000, completion_tokens: r.completionTokens ?? 500, total_tokens: 1500, ...(r.cost !== undefined && { cost: r.cost }) },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    geminiBaseURL: `http://127.0.0.1:${port}/v1beta`,
    calls,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export const TIER1_OK = JSON.stringify({
  tldr_summary: ["Нийслэл 48.5 тэрбум төгрөгийг шууд гэрээгээр олгосон.", "Тендер зарлаагүй.", "Нэгж өртөг ил болоогүй."],
  facts: ["48.5 тэрбум төгрөг", "Түргэн Зам ХХК", "48.5 тэрбум төгрөг"],
  spin_detected: "\"Түүхэн\" гэх хэтрүүлсэн үг ашигласан.",
  neutrality_score: "35",
  entities: { people: [], orgs: ["Түргэн Зам ХХК"], amounts_mnt: ["48.5 тэрбум ₮"] },
  risk_score: 140,
  risk_reason: "Тендергүй шууд гэрээ",
  risk_flag: false,
});

export const TIER2_OK = JSON.stringify({
  analysis_markdown:
    "## Гол баримт\n48.5 тэрбум төгрөгийг тендергүйгээр олгосон.\n\n## Анхаарах эрсдэл\nНэгж өртгийн тооцоо ил болоогүй тул үнэ хэт өндөр эсэхийг тодруулах шаардлагатай.",
  citizen_questions: ["Яагаад тендер зарлаагүй вэ?", "Нэг км замын өртөг хэд вэ?"],
});
