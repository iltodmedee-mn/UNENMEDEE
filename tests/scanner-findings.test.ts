import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

import { createToken, isValidToken } from "@/lib/admin-auth";
import { oneLine } from "@/lib/log-safe";
import { isAllowedPushEndpoint } from "@/lib/push/core";
import { extractMntAmounts } from "@/lib/scraper/adapters/tender";
import { parseLegalinfoList } from "@/lib/scraper/adapters/legalinfo";
import { extractWithCheerio } from "@/lib/scraper/extract-safe";
import { MAX_STRIP_PASSES, stripHeavyTags } from "@/lib/scraper/extractor";
import { readTextLimited, ResponseTooLargeError } from "@/lib/scraper/http";
import { parseFeed, wordPressPostUrl } from "@/lib/scraper/links";
import { isBlockedHostLiteral, isPublicHost, publicFetch } from "@/lib/scraper/net-guard";
import { splitSentences } from "@/lib/scraper/recheck";
import { matchesRobotsPattern, parseRobots } from "@/lib/scraper/robots";
import { publishToPage } from "@/lib/social/facebook";
import { outcomeUnknown } from "@/lib/social/outcome";
import { publishTelegram } from "@/lib/social/telegram";

/** Findings of an external security scan (Oct 29 2026), each pinned with the input it named. */

const fast = (ms: number, fn: () => unknown, label: string) => {
  const t = performance.now();
  fn();
  const took = performance.now() - t;
  assert.ok(took < ms, `${label}: ${took.toFixed(0)} ms`);
};

describe("scraper requests stay on the public internet", () => {
  it("refuses private IP literals and localhost names without asking DNS", () => {
    for (const h of ["127.0.0.1", "[::1]", "169.254.169.254", "10.0.0.5", "localhost", "metadata.localhost", "[::ffff:127.0.0.1]"]) assert.equal(isBlockedHostLiteral(h), true, h);
    for (const h of ["8.8.8.8", "mof.gov.mn", "[2606:4700:4700::1111]"]) assert.equal(isBlockedHostLiteral(h), false, h);
  });

  it("publicFetch cannot reach a loopback server, directly or by name", async () => {
    const server = createServer((_, res) => res.end("internal"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      await assert.rejects(publicFetch(`http://127.0.0.1:${port}/`), "IP literal");
      await assert.rejects(publicFetch(`http://localhost:${port}/`), "a name that resolves to loopback");
    } finally {
      server.close();
    }
  });

  it("the browser pass asks the same question per host", async () => {
    assert.equal(await isPublicHost("127.0.0.1"), false);
    assert.equal(await isPublicHost("localhost"), false);
    assert.equal(await isPublicHost("8.8.8.8"), true);
  });

  it("keeps a WordPress post link on its own site", () => {
    assert.equal(wordPressPostUrl({ id: 7, link: "https://news.example.gov.mn/a/1" }, "https://example.gov.mn"), "https://news.example.gov.mn/a/1");
    assert.equal(wordPressPostUrl({ id: 7, link: "http://169.254.169.254/latest/meta-data/" }, "https://example.gov.mn"), "https://example.gov.mn/?p=7");
    assert.equal(wordPressPostUrl({ id: 7, link: "file:///etc/passwd" }, "https://example.gov.mn"), "https://example.gov.mn/?p=7");
  });

  it("follows only legalinfo.mn's own detail pages", () => {
    const html = `<a class="act-name" href="https://legalinfo.mn/mn/detail?lawId=1">Тогтоол</a><a class="act-name" href="http://10.0.0.1/x?lawId=2">Х</a>`;
    assert.deepEqual(
      parseLegalinfoList(html).map((a) => a.url),
      ["https://legalinfo.mn/mn/detail?lawId=1"],
    );
  });
});

describe("publisher input cannot stall the pipeline", () => {
  it("robots.txt wildcards never backtrack exponentially and keep Google's semantics", () => {
    assert.equal(matchesRobotsPattern("/wp-admin/", "/wp-admin/x"), true);
    assert.equal(matchesRobotsPattern("/*.php$", "/index.php"), true);
    assert.equal(matchesRobotsPattern("/*.php$", "/index.php?x=1"), false);
    assert.equal(matchesRobotsPattern("/a*b*c", "/aXXbYYcZZ"), true);
    assert.equal(matchesRobotsPattern("/a*b*c", "/aXXcYYb"), false);
    const evil = parseRobots(`User-agent: *\nDisallow: /${"*a".repeat(30)}b\n`);
    fast(200, () => assert.equal(evil.isAllowed(`/${"a".repeat(5_000)}`), true), "robots");
  });

  it("strips heavy blocks in a bounded number of passes", () => {
    // Each pass reveals one more script block: unbounded, this was quadratic.
    const n = 4_000;
    const html = `${"<scr".repeat(n)}${"ipt>x</script>".repeat(n)}<p>body</p>`;
    fast(1_000, () => stripHeavyTags(html), "strip");
    assert.ok(MAX_STRIP_PASSES <= 3);
    assert.equal(stripHeavyTags("<p>a</p><script>x</script><style>y</style><p>b</p>"), "<p>a</p><p>b</p>");
  });

  it("reads feed items from their own children only", () => {
    const nested = `<rss><channel>${"<item><title>t</title><link>https://a.mn/1</link>".repeat(2_000)}${"</item>".repeat(2_000)}</channel></rss>`;
    fast(1_500, () => parseFeed(nested), "feed");
    const items = parseFeed(`<rss><channel><item><title>A</title><link>https://a.mn/1</link><pubDate>Wed, 28 Oct 2026 10:00:00 +0800</pubDate></item></channel></rss>`);
    assert.deepEqual(items.map((i) => [i.title, i.url]), [["A", "https://a.mn/1"]]);
    assert.ok(items[0].publishedAt);
  });

  it("the cheerio fallback reads a nested list's text once", () => {
    const depth = 200;
    const html = `<html><body><article>${"<ul><li>".repeat(depth)}${"нэг өгүүлбэр бичвэр ".repeat(20)}${"</li></ul>".repeat(depth)}<p>${"дараагийн догол мөр ".repeat(15)}</p></article></body></html>`;
    const a = extractWithCheerio(html);
    assert.ok(a);
    assert.ok(a.text.length < 1_000, `text grew to ${a.text.length}`);
  });

  it("amount and sentence filters stay linear on long runs", () => {
    fast(300, () => extractMntAmounts(`${"1".repeat(50_000)} x`), "amounts");
    assert.deepEqual(extractMntAmounts("Төсөв 4,500,000 төгрөг, 2.5 тэрбум ₮"), ["4,500,000 ₮", "2.5 тэрбум ₮"]);
    fast(300, () => splitSentences(`${"1 ".repeat(20_000)}.`), "counter regex");
    fast(300, () => splitSentences(`${"a".repeat(30_000)}_${"b".repeat(30_000)}.`), "attachment regex");
    assert.deepEqual(splitSentences("Энэ мэдээг 1 234 уншсан байна, маш олон хүн."), []);
    assert.deepEqual(splitSentences("Тушаал_2026_04 гэсэн хавсралт файлыг энд дарж үзнэ үү."), []);
  });

  it("refuses a response body past its size budget", async () => {
    const big = new Response("x".repeat(2_000));
    await assert.rejects(readTextLimited(big, 1_000), ResponseTooLargeError);
    assert.equal(await readTextLimited(new Response("ok"), 1_000), "ok");
  });
});

describe("admin sessions end on logout", () => {
  it("a token issued at or before the sign-out second is refused", async () => {
    process.env.ADMIN_SECRET_PASSWORD ??= "test-password-123";
    const now = Date.UTC(2026, 9, 29, 8);
    const token = (await createToken(now))!;
    const issued = Math.floor(now / 1000);
    assert.equal(await isValidToken(token, now + 1000, 0), true);
    assert.equal(await isValidToken(token, now + 1000, issued), false, "signed out");
    assert.equal(await isValidToken(token, now + 1000, issued - 1), true, "signed out before it was issued");
  });
});

describe("social posts are never published twice", () => {
  const fakeFetch = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;
  const post = { message: "m", link: "https://iltodmedee.mn/a", imageUrl: undefined } as unknown as Parameters<typeof publishToPage>[0]["post"];

  it("a 2xx answer without a readable id is an unknown outcome, not a refusal", async () => {
    const fb = await publishToPage({ pageId: "1", token: "t", post, fetchImpl: fakeFetch(200, "<html>oops") }).catch((e) => e);
    assert.equal(outcomeUnknown(fb), true);
    const tg = await publishTelegram({ token: "t", chatId: "@c", post: { text: "x", link: "https://iltodmedee.mn" } as never, fetchImpl: fakeFetch(200, "") }).catch((e) => e);
    assert.equal(outcomeUnknown(tg), true);
    const refused = await publishToPage({ pageId: "1", token: "t", post, fetchImpl: fakeFetch(400, `{"error":{"message":"bad"}}`) }).catch((e) => e);
    assert.equal(outcomeUnknown(refused), false);
  });
});

describe("push endpoints and logs", () => {
  it("stores only canonical push endpoints", () => {
    assert.equal(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc:APA91b"), true);
    assert.equal(isAllowedPushEndpoint("https://web.push.apple.com/QHx"), true);
    for (const e of ["https://FCM.googleapis.com/fcm/send/x", "https://fcm.googleapis.com:8443/x", "https://user@fcm.googleapis.com/x", "https://fcm.googleapis.com\\@evil.example/x", "https://fcm.googleapis.com/a b"]) {
      assert.equal(isAllowedPushEndpoint(e), false, e);
    }
  });

  it("prints outside text on one line, so it cannot start a workflow command", () => {
    assert.equal(oneLine("Гарчиг\n::error::fake\r\n##[warning]x"), "Гарчиг ::error::fake ##[warning]x");
    assert.equal(oneLine("a b\u0085c"), "a b c");
    assert.equal(oneLine("x".repeat(500), 10), "x".repeat(10));
  });
});

describe("Audit 6: publisher-controlled bodies are read with a size limit", () => {
  it("recheck, repair-dates and discover-sources never buffer res.text() / res.json()", () => {
    for (const f of ["scripts/recheck-sources.ts", "scripts/repair-dates.ts", "scripts/discover-sources.ts"]) {
      const src = readFileSync(f, "utf8");
      assert.doesNotMatch(src, /\bres\.(text|json)\(\)/, f);
      assert.match(src, /readTextLimited|readJsonLimited/, f);
    }
  });
});
