import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { articlePayload, classifyPushFailure, clip, digestPayload, isAllowedPushEndpoint, ipAllowed, isSystemicFailure, MAX_PUSH_FAILURES, newsPayload, parseSubscribeRequest, PUSH_PER_IP_PER_HOUR, resetIpLimit, SubscriptionSchema } from "@/lib/push/core";

describe("push subscriptions", () => {
  it("accepts only browser push services over https", () => {
    assert.ok(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"));
    assert.ok(isAllowedPushEndpoint("https://web.push.apple.com/QGx..."));
    assert.ok(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x"));
    assert.ok(isAllowedPushEndpoint("https://wns2-db5p.notify.windows.com/w/?token=x"));
    assert.equal(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc"), false, "plain http");
    assert.equal(isAllowedPushEndpoint("https://evil.example.com/fcm.googleapis.com"), false, "other host");
    assert.equal(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.com/x"), false, "suffix trick");
    assert.equal(isAllowedPushEndpoint("not a url"), false);
  });

  it("validates the subscription JSON a browser sends", () => {
    const ok = SubscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } });
    assert.ok(ok.success);
    assert.equal(SubscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "short", auth: "x" } }).success, false);
    // Long enough but not a P-256 point / 16-byte secret: refused (web-push threw on every send).
    assert.equal(SubscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "A".repeat(87), auth: "a".repeat(22) } }).success, false);
    assert.equal(SubscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "B".repeat(87), auth: "a".repeat(40) } }).success, false);
    assert.equal(SubscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "B".repeat(86) + "!", auth: "a".repeat(22) } }).success, false);
  });
});

describe("shared subscribe validation (action and /api/push)", () => {
  const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc";

  it("accepts a renewal with an allowed old endpoint", () => {
    const r = parseSubscribeRequest({ endpoint, keys, oldEndpoint: "https://fcm.googleapis.com/fcm/send/old" });
    assert.equal(r?.oldEndpoint, "https://fcm.googleapis.com/fcm/send/old");
  });

  it("drops an old endpoint that is foreign, identical or not a string, but keeps the subscription", () => {
    assert.equal(parseSubscribeRequest({ endpoint, keys, oldEndpoint: "https://evil.example.com/x" })?.oldEndpoint, null);
    assert.equal(parseSubscribeRequest({ endpoint, keys, oldEndpoint: endpoint })?.oldEndpoint, null);
    assert.equal(parseSubscribeRequest({ endpoint, keys, oldEndpoint: 5 })?.oldEndpoint, null);
    assert.equal(parseSubscribeRequest({ endpoint, keys })?.oldEndpoint, null);
  });

  it("refuses what the schema refuses", () => {
    assert.equal(parseSubscribeRequest(null), null);
    assert.equal(parseSubscribeRequest({ endpoint: "https://evil.example.com/x", keys }), null);
    assert.equal(parseSubscribeRequest({ endpoint, keys: { p256dh: "A".repeat(87), auth: keys.auth } }), null);
  });

  it("limits one IP to PUSH_PER_IP_PER_HOUR an hour", () => {
    resetIpLimit();
    const t = 1_000_000;
    for (let i = 0; i < PUSH_PER_IP_PER_HOUR; i++) assert.ok(ipAllowed("1.2.3.4", t + i));
    assert.equal(ipAllowed("1.2.3.4", t + 100), false);
    assert.ok(ipAllowed("5.6.7.8", t + 100), "another IP is unaffected");
    assert.ok(ipAllowed("1.2.3.4", t + 3_600_001), "an hour later it is allowed again");
    resetIpLimit();
  });
});

describe("push payloads", () => {
  const article = { id: 7, slug: "tosov-2027", title: "УИХ 2027 оны төсвийг баталлаа", tldr: "Нийт зарлага 32.4 их наяд төгрөг.\nХоёр дахь өгүүлбэр.", sourceName: "УИХ", riskFlag: false };

  it("uses the first TL;DR sentence and links to the article", () => {
    const p = articlePayload(article);
    assert.equal(p.title, "📰 УИХ 2027 оны төсвийг баталлаа");
    assert.equal(p.body, "Нийт зарлага 32.4 их наяд төгрөг. · УИХ");
    assert.equal(p.url, "/article/tosov-2027");
    assert.equal(articlePayload({ ...article, riskFlag: true }).title.startsWith("🚨"), true);
  });

  it("keeps notifications short", () => {
    assert.equal(clip("а".repeat(200), 20).length, 20);
    assert.ok(clip("а".repeat(200), 20).endsWith("…"));
    assert.equal(clip("  богино   текст ", 20), "богино текст");
  });

  it("builds digest and overflow notifications", () => {
    assert.equal(digestPayload({ title: "Төсөв", intro: "Товч", kind: "12h" }).url, "/digest");
  });

  it("sends one notification per run: the top story plus a count", () => {
    assert.equal(newsPayload([]), null);
    assert.deepEqual(newsPayload([article]), articlePayload(article));
    const many = newsPayload([article, { ...article, id: 8 }, { ...article, id: 9 }])!;
    assert.equal(many.url, "/article/tosov-2027");
    assert.match(many.body, /\+2 чухал мэдээ$/);
  });
});

describe("push failure accounting", () => {
  it("deletes only subscriptions the browser dropped, counts only their own errors, ignores outages", () => {
    assert.equal(classifyPushFailure(404), "gone");
    // A malformed stored key is refused locally with no status (Nov 2026 audit): permanent.
    assert.equal(classifyPushFailure(undefined, "The subscription p256dh value should be 65 bytes long."), "permanent");
    assert.equal(classifyPushFailure(undefined, "socket hang up"), "transient");
    assert.equal(classifyPushFailure(410), "gone");
    assert.equal(classifyPushFailure(400), "permanent");
    assert.equal(classifyPushFailure(401), "permanent"); // VAPID mismatch
    assert.equal(classifyPushFailure(403), "permanent");
    assert.equal(classifyPushFailure(413), "permanent");
    assert.equal(classifyPushFailure(429), "transient");
    assert.equal(classifyPushFailure(500), "transient");
    assert.equal(classifyPushFailure(503), "transient");
    assert.equal(classifyPushFailure(undefined), "transient"); // network error
    assert.ok(MAX_PUSH_FAILURES >= 3);
  });
});

describe("push circuit breaker", () => {
  it("treats most subscriptions failing with a 4xx as our problem, not theirs", () => {
    assert.equal(isSystemicFailure(6, 6), true); // VAPID mismatch: every subscriber rejected
    assert.equal(isSystemicFailure(4, 7), true);
    assert.equal(isSystemicFailure(1, 6), false); // one dead browser
    assert.equal(isSystemicFailure(2, 2), false); // too few to tell
    assert.equal(isSystemicFailure(3, 6), false);
  });
});
