import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { articlePost, digestPost, FacebookError, publishToPage, resolveFacebookPage } from "@/lib/social/facebook";
import { fitTelegram, publishTelegram, telegramArticlePost } from "@/lib/social/telegram";
import { discordArticlePost, discordChannelId, discordDigestPost, discordMessage, discordQuizPost, meter, publishDiscord } from "@/lib/social/discord";
import { makeQuiz, maskAmounts } from "@/lib/social/quiz";
import { formatShare, perPersonLine, perPersonShare } from "@/lib/per-person";

const digest = {
  id: 9,
  kind: "12h",
  title: "Төсөв, эрчим хүч, хууль",
  intro: "Өнөөдрийн гол мэдээ.",
  periodEnd: "2026-10-24T14:48:00Z", // 22:48 Ulaanbaatar
  items: Array.from({ length: 7 }, (_, i) => ({ headline: `Мэдээ ${i + 1}` })),
};

describe("facebook posts", () => {
  it("digest: hook first (top story + why it matters), four more, the link, our card", () => {
    const p = digestPost({ ...digest, items: digest.items.map((it, i) => ({ ...it, whyItMatters: i === 0 ? "Учир нь чухал." : undefined })) });
    const lines = p.message.split("\n");
    assert.equal(lines[0], "🗞 ОРОЙН ТОЙМ · 22:48");
    assert.equal(lines[2], "⚡ Мэдээ 1");
    assert.equal(lines[3], "👉 Учир нь чухал.");
    assert.ok(lines.includes("• Мэдээ 5"));
    assert.ok(!lines.includes("• Мэдээ 6"));
    assert.ok(lines.includes("Бүх 7 мэдээ, эх сурвалжтай нь 👉 https://iltodmedee.mn/digest"));
    assert.equal(p.imageUrl, "https://iltodmedee.mn/ig-image?d=9");
  });

  it("article: headline hook, two summary sentences, amount, per-person share, source, link, card", () => {
    const p = articlePost({
      id: 1,
      slug: "tusuv-123",
      title: "Төсвийн тодотгол",
      tldr: "Нэгдүгээр өгүүлбэр.\nХоёрдугаар өгүүлбэр.\nГуравдугаар өгүүлбэр.",
      sourceName: "Сангийн яам",
      amounts: ["5 сая ₮", "1.2 их наяд ₮"],
      riskFlag: false,
    });
    const lines = p.message.split("\n");
    assert.equal(lines[0], "⚡ Төсвийн тодотгол");
    assert.equal(lines[2], "👉 Нэгдүгээр өгүүлбэр. Хоёрдугаар өгүүлбэр.");
    assert.equal(lines[3], "💰 Дүн: 1.2 их наяд ₮");
    assert.equal(lines[4], "👤 3.43 сая хүнд хуваавал ≈ 350 300₮ / хүн");
    assert.equal(lines[5], "🏛 Эх сурвалж: Сангийн яам");
    assert.ok(lines.includes("Дэлгэрэнгүй, эх баримтын холбоос 👉 https://iltodmedee.mn/article/tusuv-123"));
    assert.equal(p.imageUrl, "https://iltodmedee.mn/ig-image?a=tusuv-123");
  });

  it("article: tells the whole story when we know who it touches, facts and the labelled fact/PR estimate", () => {
    const p = articlePost({
      id: 2,
      slug: "tetgever-1",
      title: "Хөгжлийн бэрхшээлтэй хүний тэтгэвэр 11-р сарын 1-нээс ₮600,000 болно",
      tldr: "Тэтгэвэр нэмэгдэнэ.\nЗасгийн газар шийдвэрлэсэн.\nГурав.",
      sourceName: "ХНХЯ",
      amounts: [],
      riskFlag: false,
      neutrality: 72,
      impact: { who: "Хөгжлийн бэрхшээлтэй иргэд", change: "Сарын тэтгэвэр 600,000 төгрөг болно", when: "2026 оны 11-р сарын 1-нээс", action: null },
      facts: ["Тэтгэвэр нэмэгдэнэ", "112 мянган иргэн уг тэтгэврийг авдаг", "Дүн: 600,000 ₮", "Засгийн газрын 10-р сарын 22-ны хуралдаанаар шийдвэрлэсэн"],
    });
    const lines = p.message.split("\n");
    assert.deepEqual(lines.slice(0, 7), [
      "⚡ Хөгжлийн бэрхшээлтэй хүний тэтгэвэр 11-р сарын 1-нээс ₮600,000 болно",
      "",
      "👤 Хэнд: Хөгжлийн бэрхшээлтэй иргэд",
      "↻ Юу өөрчлөгдөх: Сарын тэтгэвэр 600,000 төгрөг болно",
      "📅 Хэзээнээс: 2026 оны 11-р сарын 1-нээс",
      "",
      "👉 Тэтгэвэр нэмэгдэнэ. Засгийн газар шийдвэрлэсэн.",
    ]);
    // The summary's own sentence and a bare amount are not repeated as facts.
    assert.deepEqual(
      lines.filter((l) => l.startsWith("📌")),
      ["📌 112 мянган иргэн уг тэтгэврийг авдаг", "📌 Засгийн газрын 10-р сарын 22-ны хуралдаанаар шийдвэрлэсэн"],
    );
    assert.ok(lines.includes("📊 Баримт 72% · Пи-ар 28% (AI-ийн үнэлгээ, буруутгал биш)"));
    assert.ok(!lines.some((l) => l.startsWith("✓ Юу хийх")));
  });

  it("publish: token only in the POST body; Graph errors keep their code", async () => {
    let seen: { url: string; body: string } | undefined;
    const ok = (async (url: string, init: RequestInit) => {
      seen = { url, body: String(init.body) };
      return new Response(JSON.stringify({ id: "123_456" }), { status: 200 });
    }) as unknown as typeof fetch;
    const id = await publishToPage({ pageId: "123", token: "SECRET", post: { message: "x", link: "https://iltodmedee.mn/" }, fetchImpl: ok, version: "v26.0" });
    assert.equal(id, "123_456");
    assert.equal(seen?.url, "https://graph.facebook.com/v26.0/123/feed");
    await publishToPage({ pageId: "123", token: "SECRET", post: { message: "x", link: "l", imageUrl: "https://iltodmedee.mn/ig-image?d=1" }, fetchImpl: ok, version: "v26.0" });
    const photo = seen as { url: string; body: string } | undefined;
    assert.equal(photo?.url, "https://graph.facebook.com/v26.0/123/photos");
    assert.equal(new URLSearchParams(photo?.body).get("caption"), "x");
    assert.ok(!photo?.url.includes("SECRET"));
    assert.ok(photo?.body.includes("access_token=SECRET"));

    const expired = (async () => new Response(JSON.stringify({ error: { message: "Session has expired", code: 190 } }), { status: 400 })) as unknown as typeof fetch;
    const err = await publishToPage({ pageId: "123", token: "SECRET", post: { message: "x", link: "y" }, fetchImpl: expired }).catch((e) => e);
    assert.ok(err instanceof FacebookError);
    assert.equal(err.code, 190);
    assert.ok(err.hint.includes("expired"));
    assert.ok(!err.message.includes("SECRET"));
  });
});

describe("facebook page token", () => {
  const graph = (routes: Record<string, unknown>, seen: string[] = []) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      seen.push(`${u} ${JSON.stringify(init?.headers ?? {})}`);
      const key = Object.keys(routes).find((k) => u.includes(k));
      return new Response(JSON.stringify(key ? routes[key] : { error: { message: "unknown" } }), { status: 200 });
    }) as typeof fetch;

  it("a Page token is used as is (no accounts edge on a Page)", async () => {
    const f = graph({ "/me/accounts": { error: { message: "(#100) Tried accessing nonexisting field (accounts)" } }, "/me?fields=id": { id: "PAGE1" } });
    assert.deepEqual(await resolveFacebookPage({ token: "PT", fetchImpl: f }), { pageId: "PAGE1", token: "PT", fromUserToken: false });
  });

  it("a user token is swapped for the Page token of its only Page, or the one FB_PAGE_ID names", async () => {
    const seen: string[] = [];
    const one = graph({ "/me/accounts": { data: [{ id: "P9", access_token: "PAGE-TOKEN" }] } }, seen);
    assert.deepEqual(await resolveFacebookPage({ token: "USER", fetchImpl: one }), { pageId: "P9", token: "PAGE-TOKEN", fromUserToken: true });
    assert.ok(seen.every((s) => !s.split(" ")[0].includes("USER")), "the token never goes in a URL");
    const two = graph({ "/me/accounts": { data: [{ id: "A", access_token: "TA" }, { id: "B", access_token: "TB" }] } });
    assert.deepEqual(await resolveFacebookPage({ token: "USER", pageId: "B", fetchImpl: two }), { pageId: "B", token: "TB", fromUserToken: true });
    const r = await resolveFacebookPage({ token: "USER", fetchImpl: two });
    assert.ok("error" in r && r.error.includes("set FB_PAGE_ID"));
  });

  it("a user token without Pages is an error, not a post to the person's profile", async () => {
    const r = await resolveFacebookPage({ token: "USER", fetchImpl: graph({ "/me/accounts": { data: [] } }) });
    assert.ok("error" in r && r.error.includes("user token"));
  });
});

describe("telegram channel", () => {
  const story = { id: 1, slug: "a-b", title: "Гарчиг", tldr: "Нэг. Хоёр.", sourceName: "Сангийн яам", amounts: ["48.5 тэрбум ₮"], riskFlag: false, topic: "economy" };

  it("posts our card with the Facebook text as caption, cut to Telegram's 1024", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }));
    }) as typeof fetch;
    const post = telegramArticlePost(story);
    const id = await publishTelegram({ token: "123:SECRET", chatId: "@iltodmedee", post: { ...post, text: "ж".repeat(3000) }, fetchImpl: f });
    assert.equal(id, "42");
    assert.ok(calls[0].url.endsWith("/sendPhoto"));
    assert.equal(calls[0].body.photo, "https://iltodmedee.mn/ig-image?a=a-b");
    assert.ok(String(calls[0].body.caption).length <= 1024);
  });

  it("keeps the link and hashtags when a long caption is cut, counting characters", () => {
    const text = `⚡ Гарчиг\n\n${"Урт хураангуй өгүүлбэр. ".repeat(80)}\n\n🔗 https://iltodmedee.mn/article/a-b\n#ИлТодМэдээ #Монгол`;
    const out = fitTelegram(text, 1024);
    assert.ok(out.length <= 1024, String(out.length));
    assert.ok(out.endsWith("🔗 https://iltodmedee.mn/article/a-b\n#ИлТодМэдээ #Монгол"));
    assert.ok(out.length > 900, "characters, not UTF-8 bytes");
  });

  it("a 5xx from Telegram after sending is an unknown outcome, never a refusal", async () => {
    const f = (async () => new Response(JSON.stringify({ ok: false, description: "Internal Server Error" }), { status: 502 })) as unknown as typeof fetch;
    await assert.rejects(publishTelegram({ token: "123:SECRET", chatId: "@x", post: { text: "t", link: "l" }, fetchImpl: f }), (e: Error) => e.name === "UnknownOutcomeError");
  });

  it("never echoes the token in an error", async () => {
    const f = (async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized: bot123:SECRET" }), { status: 401 })) as unknown as typeof fetch;
    await assert.rejects(publishTelegram({ token: "123:SECRET", chatId: "@x", post: { text: "t", link: "l" }, fetchImpl: f }), (e: Error) => !e.message.includes("SECRET") && e.message.includes("401"));
  });
});

describe("discord announcement channel", () => {
  const story = { id: 1, slug: "a-b", title: "Гарчиг @everyone", tldr: "Нэг. Хоёр.", sourceName: "Сангийн яам", amounts: ["48.5 тэрбум ₮"], riskFlag: false, topic: "economy" };

  it("drops the hashtag line, wraps our link so Discord adds no second preview, never pings anyone", () => {
    const post = discordArticlePost(story);
    assert.ok(!/#ИлТодМэдээ/.test(post.text));
    assert.ok(post.text.includes("<https://iltodmedee.mn/article/a-b>"));
    const body = discordMessage({ ...post, text: "ж".repeat(3000) });
    assert.ok(body.content.length <= 2000);
    assert.deepEqual(body.allowed_mentions, { parse: [] });
    assert.equal(body.embeds[0].image.url, "https://iltodmedee.mn/ig-image?a=a-b");
    assert.ok(discordDigestPost(digest).text.includes("<https://iltodmedee.mn/digest>"));
  });

  it("short card: bold headline, quoted summary, amount with per-person share, AI meters", () => {
    const lines = discordArticlePost({ ...story, riskScore: 70, neutrality: 40 }).text.split("\n");
    assert.equal(lines[0], "⚡ **Гарчиг @everyone**");
    assert.deepEqual(lines.slice(1, 3), ["> Нэг.", "> Хоёр."]);
    assert.equal(lines[3], "💰 **48.5 тэрбум ₮** · 👤 3.43 сая хүнд хуваавал **≈ 14 200₮** / хүн");
    assert.equal(lines[4], "📊 Баримт 🟩🟩⬜⬜⬜  ·  ⚠️ Эрсдэл 🟧🟧🟧🟧⬜  _(AI-ийн үнэлгээ, буруутгал биш)_");
    assert.ok(!discordArticlePost({ ...story, title: "**оргосон** гарчиг" }).text.startsWith("⚡ ****"));
    const digestLines = discordDigestPost({ ...digest, items: digest.items.map((it, i) => ({ ...it, whyItMatters: i === 0 ? "Учир нь." : undefined })) }).text.split("\n");
    assert.equal(digestLines[0], "🗞 **ОРОЙН ТОЙМ · 22:48**");
    assert.equal(digestLines[2], "> Учир нь.");
    assert.ok(digestLines.includes("`7` Мэдээ 7"));
  });

  it("posts with the bot token in the header, then crossposts to following servers", async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ id: "777" }));
    }) as typeof fetch;
    const id = await publishDiscord({ token: "SECRET", channelId: "123", post: discordArticlePost(story), fetchImpl: f });
    assert.equal(id, "777");
    assert.equal(calls[0].url, "https://discord.com/api/v10/channels/123/messages");
    assert.equal(calls[1].url, "https://discord.com/api/v10/channels/123/messages/777/crosspost");
    assert.equal(calls[0].auth, "Bot SECRET");
    assert.ok(calls.every((c) => !c.url.includes("SECRET")));
  });

  it("a failed crosspost is a warning, a failed post an error without the token", async () => {
    const warnings: string[] = [];
    let n = 0;
    const f = (async () => (n++ === 0 ? new Response(JSON.stringify({ id: "9" })) : new Response(JSON.stringify({ message: "Cannot crosspost SECRET" }), { status: 400 }))) as unknown as typeof fetch;
    assert.equal(await publishDiscord({ token: "SECRET", channelId: "1", post: { text: "t", link: "l" }, fetchImpl: f, onWarning: (m) => warnings.push(m) }), "9");
    assert.equal(warnings.length, 1);
    assert.ok(!warnings[0].includes("SECRET"));
    const bad = (async () => new Response(JSON.stringify({ message: "401: Unauthorized" }), { status: 401 })) as unknown as typeof fetch;
    await assert.rejects(publishDiscord({ token: "SECRET", channelId: "1", post: { text: "t", link: "l" }, fetchImpl: bad }), (e: Error) => e.message.includes("401") && !e.message.includes("SECRET"));
  });
});

describe("per-person share", () => {
  it("divides the largest ₮ amount (≥ 1 тэрбум) by the population and rounds it plainly", () => {
    assert.equal(perPersonShare(["5 сая ₮"]), null);
    assert.equal(perPersonShare(["1,000 ам.доллар"]), null);
    assert.equal(formatShare(perPersonShare(["48.5 тэрбум ₮", "5 сая ₮"]) ?? 0), "≈ 14 200₮");
    assert.equal(formatShare(perPersonShare(["1 тэрбум ₮"]) ?? 0), "≈ 290₮");
    assert.equal(formatShare(perPersonShare(["5 их наяд ₮"]) ?? 0), "≈ 1.5 сая ₮");
    assert.equal(perPersonLine(["48.5 тэрбум ₮"]), "👤 3.43 сая хүнд хуваавал ≈ 14 200₮ / хүн");
  });
  it("meters clamp a score to 0–5 blocks", () => {
    assert.equal(meter(0, "🟩"), "⬜⬜⬜⬜⬜");
    assert.equal(meter(100, "🟩"), "🟩🟩🟩🟩🟩");
    assert.equal(meter(140, "🟩"), "🟩🟩🟩🟩🟩");
  });
});

describe("daily quiz", () => {
  const energy = { id: 932, slug: "erchim", title: "Эрчим хүчний салбарт 186.2 тэрбум төгрөгийн төсөв баталлаа.", amounts: ["186.2 тэрбум ₮", "107 тэрбум ₮"] };

  it("masks the headline's amount and offers four options of equal precision", () => {
    const q = makeQuiz(energy);
    assert.ok(q);
    assert.equal(q.question, "Эрчим хүчний салбарт ❓ төсөв баталлаа. ❓ хэд вэ?");
    assert.deepEqual(q.answers, ["18.62 тэрбум ₮", "62.07 тэрбум ₮", "186.2 тэрбум ₮", "558.6 тэрбум ₮"]);
    assert.equal(q.answers[q.correct], "186.2 тэрбум ₮");
    assert.equal(makeQuiz({ ...energy, id: 933 })?.answers[0], "62.07 тэрбум ₮", "the right answer moves with the story");
  });

  it("needs a ₮ amount in the headline that the story itself names", () => {
    assert.equal(makeQuiz({ ...energy, title: "Татварын реформыг дэмжиж байна" }), null);
    assert.equal(makeQuiz({ ...energy, title: "1 тэрбум мод тарих аян", amounts: ["48 сая ₮"] }), null);
    assert.equal(makeQuiz({ ...energy, title: "225 сая ам.доллараар эмнэлэг барина", amounts: ["5 сая ₮"] }), null);
    assert.equal(makeQuiz({ ...energy, title: "Сургуульд 50 сая төгрөг өглөө", amounts: ["50 сая ₮"] }), null, "below 100 сая");
    assert.equal(maskAmounts("3 их наяд төгрөгийн зээл, 500 сая ₮-ийн тусламж"), "❓ зээл, ❓ тусламж");
    // Only the asked amount is hidden: with two amounts, every "❓" used to read as the question.
    const two = makeQuiz({ ...energy, title: "1.2 тэрбум ₮-ийн төсөвтэй төсөлд 300 сая ₮ нэмэв", amounts: ["1.2 тэрбум ₮", "300 сая ₮"] });
    assert.equal(two?.question, "❓ төсөвтэй төсөлд 300 сая ₮ нэмэв. ❓ хэд вэ?");
    // Room for the poll's " 🤔" suffix: a 290-character headline made a 302-character question and Discord refused it.
    const long = makeQuiz({ ...energy, title: `${"Эрчим хүчний салбарт 186.2 тэрбум ₮ төсөв баталлаа "}${"ү".repeat(280)}` });
    assert.ok(long && `${long.question} 🤔`.length <= 300, String(long?.question.length));
  });

  it("Discord: a poll with letter options, the answer as a spoiler with its per-person share", () => {
    const m = discordMessage(discordQuizPost(makeQuiz(energy)!));
    assert.equal(m.poll?.answers.length, 4);
    assert.equal(m.poll?.answers[0].poll_media.emoji?.name, "🅰️");
    assert.equal(m.poll?.duration, 24);
    assert.ok(m.content.includes("||186.2 тэрбум ₮, 3.43 сая хүнд хуваавал ≈ 54 400₮ / хүн||"));
    assert.deepEqual(m.embeds, []);
    assert.deepEqual(m.allowed_mentions, { parse: [] });
  });
});

describe("discord channel id", () => {
  it("takes the bare id or the channel URL's last number", () => {
    assert.equal(discordChannelId("1563925741400236156"), "1563925741400236156");
    assert.equal(discordChannelId(" https://discord.com/channels/1563925739798138952/1563925741400236156 \n"), "1563925741400236156");
    assert.equal(discordChannelId(""), undefined);
    assert.equal(discordChannelId(undefined), undefined);
    assert.equal(discordChannelId("мэдээ"), undefined);
  });
});

describe("token refresh severity", () => {
  it("warns while the stored token has weeks left, errors once the 60-day expiry is close", async () => {
    const { refreshSeverity } = await import("@/lib/social/token-state");
    const now = new Date("2026-10-27T00:00:00Z");
    const daysAgo = (d: number) => ({ token: "t", seed: "s", refreshedAt: new Date(now.getTime() - d * 86_400_000).toISOString() });
    assert.equal(refreshSeverity(daysAgo(8), now), "warning");
    assert.equal(refreshSeverity(daysAgo(44), now), "warning");
    assert.equal(refreshSeverity(daysAgo(46), now), "error");
  });
});

describe("publish outcome", () => {
  it("treats a 5xx or a transient Graph error on the publish call as maybe published", async () => {
    const { maybePublished, publishStep } = await import("@/lib/social/outcome");
    assert.ok(maybePublished(new Error("Threads 500: An unexpected error has occurred (code 2)")));
    assert.ok(maybePublished(new Error("Instagram 400: Please retry your request later (code 1)")));
    assert.ok(maybePublished(Object.assign(new Error("x"), { status: 503 })));
    assert.ok(!maybePublished(new Error("Instagram 400: Invalid parameter (code 100)")));
    assert.ok(!maybePublished(Object.assign(new Error("x"), { status: 403, code: 200 })));
    await assert.rejects(publishStep(async () => { throw new Error("Threads 502: Bad Gateway (code ?)"); }), (e: Error) => e.name === "UnknownOutcomeError");
    await assert.rejects(publishStep(async () => { throw new Error("Threads 400: bad (code 100)"); }), (e: Error) => e.name === "Error");
  });
});
