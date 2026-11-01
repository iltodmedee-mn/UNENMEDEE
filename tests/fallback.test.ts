import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractiveSummary, shouldPark } from "@/lib/ai/fallback";

describe("summary fallback (no AI)", () => {
  it("takes the first sentences, one per line", () => {
    const text = "Засгийн газрын ээлжит хуралдаан өнөөдөр болов. Хуралдаанаар 12 асуудал хэлэлцэв. Гурав дахь өгүүлбэр энд байна.";
    assert.equal(extractiveSummary(text), "Засгийн газрын ээлжит хуралдаан өнөөдөр болов.\nХуралдаанаар 12 асуудал хэлэлцэв.");
  });

  it("cuts a very long first sentence at a word boundary", () => {
    const long = `${"маш урт өгүүлбэр ".repeat(40)}төгсгөл.`;
    const s = extractiveSummary(long, 2, 120);
    assert.ok(s.length <= 120 && s.endsWith("…"), s);
    assert.ok(!/\s…$/.test(s));
  });

  it("returns empty text for empty input", () => {
    assert.equal(extractiveSummary("   "), "");
  });
});

describe("parking unprocessable articles", () => {
  it("parks when the replies themselves were unusable, even if other providers were rate-limited", () => {
    assert.ok(shouldPark(["groq/x: Invalid JSON: Unexpected token } in JSON at position 523", "gemini/y: Invalid JSON: Unterminated string in JSON at position 2048"]));
    assert.ok(shouldPark(["groq/x: 429 rate limit", "gemini/y: tldr_summary: Required; facts: invalid_type", "nvidia/z: Unexpected end of JSON input"]));
    assert.ok(shouldPark(["requesty/a: skipped (limit: daily budget)", "gemini/y: no JSON object in reply"]), "the only provider that answered gave junk");
  });

  it("does not park on network, auth or quota failures", () => {
    assert.ok(!shouldPark(["groq/x: 429 rate limit", "gemini/y: 503 Service Unavailable", "nvidia/z: ECONNRESET"]));
    assert.ok(!shouldPark(["groq/x: 429 rate limit", "gemini/y: Unexpected end of JSON input", "nvidia/z: timeout"]), "one bad reply among outages is retried");
    assert.ok(!shouldPark([]));
    // The repair was stopped by the budget: one cut-off reply is not enough to give up.
    assert.ok(!shouldPark(["groq/x: Unexpected end of JSON input", "groq/x: retry skipped (limit: daily budget)", "gemini/y: 503 Service Unavailable"]));
  });
});
