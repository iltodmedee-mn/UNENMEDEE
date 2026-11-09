import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CAPTION_MAX, instagramArticlePost, instagramDigestPost, publishInstagram, publishInstagramCarousel } from "@/lib/social/instagram";
import { outcomeUnknown, publishStep } from "@/lib/social/outcome";
import { cut, publishThreads, threadsLength } from "@/lib/social/threads";

describe("instagram posts", () => {
  it("digest: our JPEG card, every headline and the bio hint in the caption", () => {
    const p = instagramDigestPost({ id: 10, kind: "12h", title: "Тойм", intro: "Оршил", periodEnd: "2026-10-24T23:05:00Z", items: [{ headline: "Нэг", whyItMatters: "Учир." }, { headline: "Хоёр" }] });
    assert.equal(p.imageUrl, "https://iltodmedee.mn/ig-image?d=10");
    assert.ok(p.caption.startsWith("🗞 ӨГЛӨӨНИЙ ТОЙМ · 07:05\n\n⚡ Нэг\n👉 Учир.\n\nМөн өнөөдөр:\n• Хоёр"));
    assert.ok(p.caption.includes("холбоос bio-д"));
    assert.ok(p.caption.endsWith("#ИлТодМэдээ #мэдээ #Монгол #Mongolia #mongolianews #Улаанбаатар #шинэмэдээ"));
  });

  it("article: card by slug, summary, amount, source; caption capped", () => {
    const p = instagramArticlePost({ id: 1, slug: "a-b", title: "Т", tldr: "Нэг.\nХоёр.", sourceName: "Яам", amounts: ["3 сая ₮"], riskFlag: true });
    assert.equal(p.imageUrl, "https://iltodmedee.mn/ig-image?a=a-b");
    assert.ok(p.caption.startsWith("🚨 Т\n\n👉 Нэг. Хоёр.\n💰 Дүн: 3 сая ₮\n⚠️"));
    assert.ok(p.caption.includes("🏛 Эх сурвалж: Яам"));
    const long = instagramArticlePost({ id: 1, slug: "s", title: "ү".repeat(3000), tldr: "", sourceName: "Я", amounts: [], riskFlag: false });
    assert.equal(long.caption.length, CAPTION_MAX);
  });

  it("creates, waits for FINISHED, publishes; the token stays out of errors", async () => {
    const calls: string[] = [];
    let polls = 0;
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
      if (url.endsWith("/me/media")) {
        assert.equal(new URLSearchParams(String(init?.body)).get("image_url"), "https://iltodmedee.mn/ig-image?d=1");
        return Response.json({ id: "c1" });
      }
      if (url.includes("/c1?")) return Response.json({ status_code: ++polls < 2 ? "IN_PROGRESS" : "FINISHED" });
      return Response.json({ id: "m1" });
    }) as unknown as typeof fetch;
    const id = await publishInstagram({ token: "SECRET", post: { imageUrl: "https://iltodmedee.mn/ig-image?d=1", caption: "x" }, fetchImpl: f, sleep: async () => {} });
    assert.equal(id, "m1");
    assert.deepEqual(calls, [
      "GET https://graph.instagram.com/v26.0/me/media",
      "POST https://graph.instagram.com/v26.0/me/media",
      "GET https://graph.instagram.com/v26.0/c1",
      "GET https://graph.instagram.com/v26.0/c1",
      "POST https://graph.instagram.com/v26.0/me/media_publish",
    ]);
    // Oct 28 2026: the status read answered 9007 "Media ID is not available" right after the create,
    // and later the publish endpoint can answer the same. Both mean "ask again", not "refused".
    const seen: string[] = [];
    let lag = 0;
    const flaky = (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? "GET"} ${url.split("?")[0].split("/").pop()}`);
      if (url.endsWith("/me/media")) return Response.json({ id: "c2" });
      if (url.includes("/c2?")) return ++lag === 1 ? Response.json({ error: { message: "Media ID is not available", code: 9007 } }, { status: 400 }) : Response.json({ status_code: "FINISHED" });
      if (url.endsWith("/me/media_publish")) return ++lag === 3 ? Response.json({ error: { message: "Media ID is not available", code: 9007 } }, { status: 400 }) : Response.json({ id: "m2" });
      return Response.json({});
    }) as unknown as typeof fetch;
    assert.equal(await publishInstagram({ token: "SECRET", post: { imageUrl: "u", caption: "c" }, fetchImpl: flaky, sleep: async () => {} }), "m2");
    assert.deepEqual(seen, ["GET media", "POST media", "GET c2", "GET c2", "POST media_publish", "POST media_publish"]);
    // The same 9007 on every publish attempt is still a failure, never an endless loop.
    const stuck = (async (url: string) => {
      if (url.includes("/me/media?")) return Response.json({ data: [] });
      if (url.endsWith("/me/media")) return Response.json({ id: "c3" });
      if (url.includes("/c3?")) return Response.json({ status_code: "FINISHED" });
      return Response.json({ error: { message: "Media ID is not available", code: 9007 } }, { status: 400 });
    }) as unknown as typeof fetch;
    const gaveUp = await publishInstagram({ token: "SECRET", post: { imageUrl: "u", caption: "c" }, fetchImpl: stuck, sleep: async () => {} }).catch((e: Error) => e);
    assert.ok(gaveUp instanceof Error && gaveUp.message.includes("(publish)") && gaveUp.message.includes("code 9007"));
    const bad = (async () => Response.json({ error: { message: "Invalid OAuth access token", code: 190 } }, { status: 400 })) as unknown as typeof fetch;
    const err = await publishInstagram({ token: "SECRET", post: { imageUrl: "u", caption: "c" }, fetchImpl: bad }).catch((e: Error) => e);
    assert.ok(err instanceof Error && err.message.includes("code 190") && !err.message.includes("SECRET"));
  });

  // Nov 7-9 2026: every image post answered "Application request limit reached (code 4)" while Reels
  // still went out, and the log could not say which call refused or how much of the quota was used.
  it("a refusal names its step and, for a request limit, Meta's usage headers", async () => {
    const usage = { "x-app-usage": '{"call_count":100,"total_time":3,"total_cputime":2}', "x-business-use-case-usage": '{"1789":[{"type":"instagram","call_count":12}]}' };
    const limited = (async (url: string, init?: RequestInit) => {
      if (url.includes("/me/media?")) return Response.json({ data: [] });
      if (url.endsWith("/me/media") && init?.method === "POST") return Response.json({ id: "c4" });
      if (url.includes("/c4?")) return Response.json({ status_code: "FINISHED" });
      return Response.json({ error: { message: "Application request limit reached", code: 4 } }, { status: 403, headers: usage });
    }) as unknown as typeof fetch;
    const err = await publishInstagram({ token: "SECRET", post: { imageUrl: "u", caption: "c" }, fetchImpl: limited, sleep: async () => {} }).catch((e: Error) => e);
    assert.ok(err instanceof Error);
    assert.match(err.message, /^Instagram 403: \(publish\) Application request limit reached \(code 4\)/);
    assert.ok(err.message.includes('app {"call_count":100'), err.message);
    assert.ok(err.message.includes("business"), err.message);
    assert.ok(!err.message.includes("SECRET"));
    // A create refusal says "create"; another error carries no usage.
    const noCreate = (async () => Response.json({ error: { message: "Invalid parameter", code: 100 } }, { status: 400, headers: usage })) as unknown as typeof fetch;
    const e2 = await publishInstagram({ token: "SECRET", post: { imageUrl: "u", caption: "c" }, fetchImpl: noCreate, sleep: async () => {} }).catch((e: Error) => e);
    assert.ok(e2 instanceof Error && e2.message.startsWith("Instagram 400: (check) Invalid parameter (code 100)") && !e2.message.includes("usage"), e2 instanceof Error ? e2.message : "");
  });

  // Nov 7-9 2026: media_publish answered code 4 after publishing, and every hourly retry posted the
  // same digest again. A retry now finds the live post by its caption and records it instead.
  it("a post already on the account is found by its caption, never published twice", async () => {
    const calls: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.split("?")[0].split("/").pop()}`);
      if (url.includes("/me/media?")) return Response.json({ data: [{ id: "old" }, { id: "live", caption: "🗞 ОРОЙН ТОЙМ · 17:19\n\n⚡ Экспорт  " }] });
      return Response.json({ id: "new" });
    }) as unknown as typeof fetch;
    const id = await publishInstagram({ token: "T", post: { imageUrl: "u", caption: "🗞 ОРОЙН ТОЙМ · 17:19\n\n⚡ Экспорт" }, fetchImpl: f, sleep: async () => {} });
    assert.equal(id, "live");
    assert.deepEqual(calls, ["GET media"]);
    const carousel = await publishInstagramCarousel({ token: "T", imageUrls: ["a", "b"], caption: "🗞 ОРОЙН ТОЙМ · 17:19 ⚡ Экспорт", fetchImpl: f, sleep: async () => {} });
    assert.equal(carousel, "live");
    assert.ok(!calls.some((c) => c.startsWith("POST")), calls.join("\n"));
  });
});

describe("social publishing safety", () => {
  it("never publishes a container that stays IN_PROGRESS", async () => {
    const calls: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
      if (url.endsWith("/me/media") || url.endsWith("/me/threads")) return Response.json({ id: "c1" });
      if (url.includes("/c1?")) return Response.json({ status_code: "IN_PROGRESS", status: "IN_PROGRESS" });
      return Response.json({ id: "m1" });
    }) as unknown as typeof fetch;
    const ig = await publishInstagram({ token: "T", post: { imageUrl: "u", caption: "c" }, fetchImpl: f, sleep: async () => {} }).catch((e: Error) => e);
    assert.ok(ig instanceof Error && /not finished/.test(ig.message));
    const th = await publishThreads({ token: "T", post: { text: "x", link: "l", imageUrl: "u" }, fetchImpl: f, sleep: async () => {} }).catch((e: Error) => e);
    assert.ok(th instanceof Error && /not finished/.test(th.message));
    assert.ok(!calls.some((c) => c.includes("publish")), calls.join("\n"));
  });

  it("treats timeouts and dropped connections as 'may have posted'", async () => {
    assert.equal(outcomeUnknown(new DOMException("t", "TimeoutError")), true);
    assert.equal(outcomeUnknown(Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } })), true);
    assert.equal(outcomeUnknown(new Error("Instagram 400: Invalid OAuth access token")), false);
    // Inside the publish call a timeout is an unknown outcome; outside it (a container step) it is
    // a plain failure the next run retries (one slow Threads status read used to park the story for good).
    await assert.rejects(publishStep(() => Promise.reject(new DOMException("t", "TimeoutError"))), (e: unknown) => (e as Error).name === "UnknownOutcomeError");
    await assert.rejects(publishStep(() => Promise.reject(new Error("Instagram 400: bad"))), (e: unknown) => (e as Error).name === "Error");
  });

  it("cuts Threads text at whole emoji and counts the emoji variation selector", () => {
    assert.equal(threadsLength("⚖️"), threadsLength("⚖") + 3);
    const out = cut("ab😀😀😀", 6);
    assert.ok(!/[\uD800-\uDBFF]…$/.test(out), JSON.stringify(out));
    assert.ok(threadsLength(out) <= 6);
  });
});
