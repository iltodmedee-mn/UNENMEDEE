import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { publishThreads, THREADS_MAX, threadsArticlePost, threadsDigestPost, threadsLength } from "@/lib/social/threads";
import { currentState, needsRefresh, seedOf } from "@/lib/social/token-state";

const digest = {
  id: 1,
  kind: "12h",
  title: "Төсөв, эрчим хүч",
  intro: "",
  periodEnd: "2026-10-24T23:05:00Z", // 07:05 Ulaanbaatar
  items: Array.from({ length: 6 }, (_, i) => ({ headline: `Гарчиг ${i + 1} ${"ү".repeat(100)}` })),
};

describe("threads posts", () => {
  it("counts emoji as their UTF-8 bytes and Cyrillic as one", () => {
    assert.equal(threadsLength("өгүүлбэр"), 8);
    assert.equal(threadsLength("🗞"), 4);
  });

  it("digest: hook within 500 characters, the link in the text, our card as the image", () => {
    const p = threadsDigestPost({ ...digest, items: digest.items.map((it) => ({ ...it, whyItMatters: "ү".repeat(400) })) });
    assert.ok(threadsLength(p.text) <= THREADS_MAX);
    assert.ok(p.text.startsWith("🗞 ӨГЛӨӨНИЙ ТОЙМ · 07:05\n\n⚡ Гарчиг 1"));
    assert.ok(p.text.endsWith("Бүх 6 мэдээ 👉 https://iltodmedee.mn/digest\n#мэдээ"));
    assert.equal(p.imageUrl, "https://iltodmedee.mn/ig-image?d=1");
  });

  it("article: headline hook, first summary sentence, amount, source, link", () => {
    const p = threadsArticlePost({ id: 1, slug: "s", title: "Т", tldr: "Нэг.\nХоёр.", sourceName: "Яам", amounts: ["2 тэрбум ₮", "5 сая ₮"], riskFlag: false, topic: "economy" });
    assert.equal(p.text, "⚡ Т\n\nНэг.\n\n💰 2 тэрбум ₮\n🏛 Яам\n\n👉 https://iltodmedee.mn/article/s\n#эдийнзасаг");
    assert.equal(p.imageUrl, "https://iltodmedee.mn/ig-image?a=s");
  });

  it("a new THREADS_TOKEN secret replaces the stored token; refresh after 7 days", () => {
    const now = new Date("2026-10-25T00:00:00Z");
    const stored = { token: "old", refreshedAt: "2026-10-20T00:00:00Z", seed: seedOf("seed1") };
    assert.equal(currentState(stored, "seed1", now), stored);
    assert.equal(currentState(stored, undefined, now), null); // secret removed: the platform is off
    assert.equal(currentState(stored, "seed2", now)?.token, "seed2");
    // A new secret's age is unknown: refreshed the next day, not in a week (a 55-day-old pasted
    // token used to expire before its first refresh).
    const fresh = currentState(stored, "seed2", now)!;
    assert.equal(needsRefresh(fresh, now), false);
    assert.equal(needsRefresh(fresh, new Date(now.getTime() + 1.5 * 86_400_000)), true);
    assert.equal(currentState(null, undefined, now), null);
    assert.ok(!needsRefresh(stored, now));
    assert.ok(needsRefresh(stored, new Date("2026-10-28T00:00:01Z")));
  });

  it("creates, waits for FINISHED, publishes; errors never carry the token", async () => {
    const calls: string[] = [];
    let polls = 0;
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
      if (url.endsWith("/me/threads")) {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("media_type"), "IMAGE");
        assert.equal(body.get("image_url"), "https://iltodmedee.mn/ig-image?d=1");
        return Response.json({ id: "c1" });
      }
      if (url.includes("/c1?")) return Response.json({ status: ++polls < 2 ? "IN_PROGRESS" : "FINISHED" });
      return Response.json({ id: "p1" });
    }) as unknown as typeof fetch;
    const id = await publishThreads({ token: "SECRET", post: { text: "x", link: "https://iltodmedee.mn/digest", imageUrl: "https://iltodmedee.mn/ig-image?d=1" }, fetchImpl: f, sleep: async () => {} });
    assert.equal(id, "p1");
    assert.deepEqual(calls, [
      "POST https://graph.threads.com/v1.0/me/threads",
      "GET https://graph.threads.com/v1.0/c1",
      "GET https://graph.threads.com/v1.0/c1",
      "POST https://graph.threads.com/v1.0/me/threads_publish",
    ]);
    const bad = (async () => Response.json({ error: { message: "Invalid OAuth access token", code: 190 } }, { status: 400 })) as unknown as typeof fetch;
    const err = await publishThreads({ token: "SECRET", post: { text: "x", link: "y" }, fetchImpl: bad }).catch((e: Error) => e);
    assert.ok(err instanceof Error && err.message.includes("code 190") && !err.message.includes("SECRET"));
  });
});
