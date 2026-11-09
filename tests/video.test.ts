import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { geminiModelPrice } from "@/lib/ai/pricing";
import type { JsonStat2 } from "@/lib/budget/jsonstat";
import { GOODS, parsePrices } from "@/lib/budget/prices";
import { publishReel } from "@/lib/social/facebook";
import { publishInstagram } from "@/lib/social/instagram";
import { publishThreads, THREADS_MAX, threadsLength } from "@/lib/social/threads";
import { numberWords, timesPhrase } from "@/lib/video/mn-numbers";
import { facebookVideoText, instagramVideoCaption, threadsVideoText, type VideoMeta } from "@/lib/video/posts";
import { moneyHtml } from "@/lib/video/money-html";
import { amountWords, moneyNarration, moneyVideoSpec, roundShare, shareOptions, verifyMoneySpec, weighsOrAccuses } from "@/lib/video/money-video";
import { dueSlot, slotStart, VIDEO_SLOTS } from "@/lib/video/schedule";
import { narration, priceVideoSpec, quizOptions, SPOKEN, verifySpec } from "@/lib/video/price-video";
import { sceneHtml } from "@/lib/video/scene-html";
import { audioFilter } from "@/lib/video/render";
import { buildTimeline, captionWords, PAUSE_S, parseSilences, plausibleTake, sentenceStarts } from "@/lib/video/timing";
import { pcmToWav, speak } from "@/lib/video/tts";
import { pinClock } from "./helpers/fixed-clock";

// Fixtures are 2026 pages and prices: the suite must not depend on the day it runs.
pinClock();

const snap = parsePrices(JSON.parse(readFileSync("tests/fixtures/budget/nso-prices.json", "utf8")) as JsonStat2, GOODS.filter((g) => ["beef", "petrol", "canteen"].includes(g.key)));

describe("numbers as spoken Mongolian", () => {
  it("reads prices, percentages and years the way a person says them before a unit", () => {
    assert.equal(numberWords(31210), "гучин нэгэн мянга хоёр зуун арван");
    assert.equal(numberWords(4760), "дөрвөн мянга долоон зуун жаран");
    assert.equal(numberWords(50), "тавин");
    assert.equal(numberWords(15), "арван таван");
    assert.equal(numberWords(105), "зуун таван");
    assert.equal(numberWords(1000), "мянган");
    assert.equal(numberWords(4000), "дөрвөн мянган");
    assert.equal(numberWords(1), "нэг");
    assert.equal(numberWords(21), "хорин нэгэн");
    assert.equal(numberWords(3_040), "гурван мянга дөчин");
    assert.equal(numberWords(2_500_000), "хоёр сая таван зуун мянган");
    assert.equal(numberWords(7, "nominative"), "долоо");
    assert.equal(numberWords(20, "nominative"), "хорь");
    assert.throws(() => numberWords(-1));
  });

  it("says a multiple as a person rounds it", () => {
    assert.deepEqual(timesPhrase(6.56), { say: "зургаа гаруй дахин", caption: "6 гаруй дахин" });
    assert.deepEqual(timesPhrase(6.8), { say: "бараг долоо дахин", caption: "бараг 7 дахин" });
    assert.deepEqual(timesPhrase(3.1), { say: "гурав дахин", caption: "3 дахин" });
  });
});

describe("price video spec", () => {
  it("beef: a guess, the reveal, now, what the money bought then, the year, a comment ask", () => {
    const spec = priceVideoSpec(snap, "beef")!;
    assert.equal(spec.key, "prices:beef:2026-09");
    assert.deepEqual(spec.then, { month: "2011-09", value: 4760, years: 15 });
    assert.deepEqual(spec.now, { month: "2026-09", value: 31210 });
    assert.equal(spec.yearPct, 50);
    assert.deepEqual(spec.units, { count: 6.6, unit: "кг" });
    assert.deepEqual(
      spec.sentences.map((x) => x.scene),
      ["quiz", "reveal", "now", "relate", "year", "cta"],
    );
    assert.deepEqual(verifySpec(spec), []);
    const text = narration(spec);
    assert.ok(!/\d/.test(text));
    assert.ok(text.startsWith("За, таагаад үз дээ. Арван таван жилийн өмнө нэг кило үхрийн мах хэд байсан гэж бодож байна?"));
    assert.ok(text.includes("Дөрвөн мянга долоон зуун жаран төгрөг байсан!"));
    assert.ok(text.includes("Гучин нэгэн мянга хоёр зуун арван төгрөг"));
    assert.ok(text.includes("зургаа гаруй кило мах"));
    assert.ok(text.includes("тавин хувиар нэмэгдчихлээ"));
    assert.equal(spec.sentences[1].caption, "*4\u00a0760₮*");
    assert.equal(spec.options.filter((o) => o.correct).length, 1);
  });

  it("the guess has one true answer and two round wrong ones, never equal to it", () => {
    for (const then of [4760, 1560, 350, 31210]) {
      for (let pos = 0; pos < 3; pos++) {
        const o = quizOptions(then, pos);
        assert.equal(o.length, 3);
        assert.equal(o[pos].value, then);
        assert.ok(o[pos].correct);
        assert.ok(o.filter((x) => !x.correct).every((x) => x.value !== then && x.value > 0));
      }
    }
  });

  it("a word-by-word caption keeps a number with its unit as one highlighted word", () => {
    assert.deepEqual(
      captionWords("Энэ мөнгөөр тэр үед *6\u00a0гаруй\u00a0кг* авна").map((w) => [w.text, w.hl]),
      [["Энэ", false], ["мөнгөөр", false], ["тэр", false], ["үед", false], ["6\u00a0гаруй\u00a0кг", true], ["авна", false]],
    );
  });

  it("every good has its spoken name; unknown goods make no video", () => {
    for (const g of GOODS) assert.ok(SPOKEN[g.key], g.key);
    assert.equal(priceVideoSpec(snap, "gold"), null);
  });

  it("refuses a caption with a number that is not from the snapshot", () => {
    const spec = priceVideoSpec(snap, "beef")!;
    spec.sentences[2] = { ...spec.sentences[2], caption: "Харин одоо? *32\u00a0000₮*" };
    assert.match(verifySpec(spec).join(), /32 000/);
    spec.sentences[0] = { ...spec.sentences[0], say: "Одоо 32000 төгрөг" };
    assert.match(verifySpec(spec).join(), /digits in the narration/);
  });

  it("the scene page cannot be broken out of by its data", () => {
    const spec = priceVideoSpec(snap, "beef")!;
    spec.sentences[0] = { ...spec.sentences[0], caption: "</script><script>alert(1)</script>" };
    const tl = buildTimeline(spec.sentences.map((x) => x.scene), [0, 5, 7, 10, 13, 15], { duration: 17, tail: 16.8 }, 6.6);
    const html = sceneHtml(spec, tl, { fontsDir: "/f", logo: "/l.png" });
    assert.equal(html.match(/<\/script>/g)?.length, 1);
  });
});

describe("timing", () => {
  const log = [
    "silence_start: 0", "silence_end: 0.2",
    "silence_start: 0.7", "silence_end: 1.12",
    "silence_start: 6.77", "silence_end: 7.25",
    "silence_start: 7.6", "silence_end: 7.98",
    "silence_start: 10.52", "silence_end: 10.86",
    "silence_start: 12.71", "silence_end: 13.5",
    "silence_start: 22.76",
  ].join("\n");

  it("reads ffmpeg's pauses, a trailing one running to the end", () => {
    const s = parseSilences(log, 23.04);
    assert.equal(s.length, 7);
    assert.deepEqual(s.at(-1), { start: 22.76, end: 23.04 });
  });

  it("starts each sentence at the pause nearest its share of the letters", () => {
    const sentences = ["Та мэдэх үү?", "Арван таван жилийн өмнө Улаанбаатарт нэг кило үхрийн мах дөрвөн мянга долоон зуун жаран төгрөг байсан.", "Одоо?", "Гучин нэгэн мянга хоёр зуун арван төгрөг."];
    const starts = sentenceStarts(sentences, parseSilences(log, 23.04), 23.04);
    assert.equal(starts[0], 0);
    assert.equal(starts[1], 1.12);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] > starts[i - 1]);
  });

  it("inserts the 3-2-1 pause after the question and puts the sounds on the same clock", () => {
    const tl = buildTimeline(["quiz", "reveal", "now", "relate", "year", "cta"], [0, 5, 7, 10, 13, 15], { duration: 17, tail: 16.8 }, 6.6);
    assert.equal(tl.pause, PAUSE_S);
    assert.deepEqual(tl.starts, [0, 5 + PAUSE_S, 7 + PAUSE_S, 10 + PAUSE_S, 13 + PAUSE_S, 15 + PAUSE_S]);
    assert.equal(tl.sfx.filter((e) => e.kind === "tick").length, 3);
    assert.equal(tl.sfx.find((e) => e.kind === "pop")?.at, 5 + PAUSE_S);
    assert.equal(tl.sfx.filter((e) => e.kind === "block").length, 7);
    assert.ok(tl.total > 17 + PAUSE_S);
    const graph = audioFilter(tl, true);
    assert.ok(graph.includes(`atrim=0:${tl.pauseAt}`) && graph.includes("sidechaincompress") && graph.endsWith("[a]"));
    assert.ok(!audioFilter(tl, false).includes("[beat]"));
  });

  it("refuses a take that is far too fast or slow for its text", () => {
    assert.ok(plausibleTake("а".repeat(270), 22));
    assert.ok(!plausibleTake("а".repeat(270), 5));
    assert.ok(!plausibleTake("а".repeat(270), 60));
  });
});

describe("narration voice", () => {
  const guard = (ok: boolean) => ({ check: async () => (ok ? { ok: true as const } : { ok: false as const, reason: "daily AI budget $0.3 reached" }), record: () => {} });

  it("passes the budget guard first and logs the call with its cost", async () => {
    const logged: { purpose: string; estimatedCostUsd: number; success: boolean }[] = [];
    const pcm = Buffer.alloc(4800);
    const wav = await speak({
      text: "Та мэдэх үү?",
      apiKey: "k",
      guard: guard(true),
      log: async (r) => void logged.push(r),
      fetchImpl: (async () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm.toString("base64") } }] } }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 500 } }))) as typeof fetch,
    });
    assert.equal(wav.subarray(0, 4).toString(), "RIFF");
    assert.equal(logged.length, 1);
    assert.equal(logged[0].purpose, "video");
    assert.ok(logged[0].success);
    // $0.50 in + $9.00 out per 1M tokens through 2026.
    assert.ok(Math.abs(logged[0].estimatedCostUsd - (300 * 0.5 + 500 * 9) / 1e6) < 1e-9 || logged[0].estimatedCostUsd === 0);
  });

  it("never calls the API when the budget is spent", async () => {
    let called = false;
    await assert.rejects(
      speak({ text: "x", apiKey: "k", guard: guard(false), log: async () => {}, fetchImpl: (async () => ((called = true), new Response("{}"))) as typeof fetch }),
      /budget/,
    );
    assert.equal(called, false);
  });

  it("prices the speech model by date", () => {
    assert.deepEqual(geminiModelPrice("gemini-3.8-flash-tts", new Date("2026-10-30")), { input: 0.5, output: 9 });
    assert.deepEqual(geminiModelPrice("gemini-3.8-flash-tts", new Date("2027-01-02")), { input: 1, output: 18 });
    assert.equal(pcmToWav(Buffer.alloc(10)).length, 54);
  });
});

const meta: VideoMeta = { kind: "prices", goodKey: "beef", title: "Үхрийн мах, 1 кг", then: { month: "2011-09", value: 4760, years: 15 }, now: { month: "2026-09", value: 31210 }, yearPct: 50, link: "iltodmedee.mn/prices#beef" };

describe("video posts", () => {
  it("say the same numbers as the video, with the source and the link", () => {
    const fb = facebookVideoText(meta);
    assert.ok(fb.startsWith("🛒 Үхрийн мах, 1 кг: 15 жилийн өмнө 4 760₮ → одоо 31 210₮\n📈 Сүүлийн 1 жилд ▲ 50%"));
    assert.ok(fb.includes("https://iltodmedee.mn/prices#beef"));
    assert.ok(fb.includes("Үндэсний статистикийн хороо"));
    assert.ok(instagramVideoCaption(meta).includes("холбоос bio-д"));
    const th = threadsVideoText(meta);
    assert.ok(threadsLength(th) <= THREADS_MAX);
    assert.ok(th.endsWith("#үнэ"));
  });
});

type Call = { url: string; init?: RequestInit };
const recorder = (answers: ((url: string) => unknown)[]) => {
  const calls: Call[] = [];
  let i = 0;
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = answers[Math.min(i++, answers.length - 1)](url);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, f };
};
const noSleep = async () => {};

describe("publishing a video", () => {
  it("Facebook: Reels start → hosted upload → finish, token never in a URL", async () => {
    const { calls, f } = recorder([() => ({ video_id: "77" }), () => ({ success: true }), () => ({ success: true }), () => ({ status: { video_status: "ready" } })]);
    const id = await publishReel({ pageId: "p1", token: "SECRET", videoUrl: "https://iltodmedee.mn/reel?v=3", description: "d", fetchImpl: f, sleep: noSleep });
    assert.equal(id, "77");
    assert.match(calls[1].url, /^https:\/\/rupload\.facebook\.com\/video-upload\/v\d+\.\d\/77$/);
    assert.equal((calls[1].init?.headers as Record<string, string>).file_url, "https://iltodmedee.mn/reel?v=3");
    assert.equal(new URLSearchParams(String(calls[2].init?.body)).get("video_state"), "PUBLISHED");
    assert.ok(calls.every((c) => !c.url.includes("SECRET")));
  });

  it("Instagram: a REELS container with the video URL, shared to the feed", async () => {
    // The first call looks for a post with the same caption (none here).
    const { calls, f } = recorder([() => ({ data: [] }), () => ({ id: "c1" }), () => ({ status_code: "IN_PROGRESS" }), () => ({ status_code: "FINISHED" }), () => ({ id: "m1" })]);
    const id = await publishInstagram({ token: "t", post: { videoUrl: "https://iltodmedee.mn/reel?v=3", caption: "c" }, fetchImpl: f, sleep: noSleep });
    assert.equal(id, "m1");
    const body = new URLSearchParams(String(calls[1].init?.body));
    assert.equal(body.get("media_type"), "REELS");
    assert.equal(body.get("video_url"), "https://iltodmedee.mn/reel?v=3");
    assert.equal(body.get("share_to_feed"), "true");
    assert.equal(body.get("image_url"), null);
  });

  it("Threads: a VIDEO container with the text", async () => {
    const { calls, f } = recorder([() => ({ id: "c1" }), () => ({ status: "FINISHED" }), () => ({ id: "t1" })]);
    const id = await publishThreads({ token: "t", post: { text: "x", link: "l", videoUrl: "https://iltodmedee.mn/reel?v=3" }, fetchImpl: f, sleep: noSleep });
    assert.equal(id, "t1");
    const body = new URLSearchParams(String(calls[0].init?.body));
    assert.equal(body.get("media_type"), "VIDEO");
    assert.equal(body.get("video_url"), "https://iltodmedee.mn/reel?v=3");
  });
});

describe("«ХҮН БҮРТ ХУВААВАЛ» money video", () => {
  const story = {
    id: 1940,
    slug: "toriin-alban-khaagch",
    title: "52 мянган төрийн албан хаагчийн цалин нэмэгдэж, 170.1 тэрбум ₮ зарцуулна",
    amounts: ["170.1 тэрбум ₮", "120.0 тэрбум ₮"],
    sourceName: "Засгийн газар",
    day: "2026-10-28",
    topic: "economy",
  };

  it("divides the headline's amount by the population, guesses it and compares it with a price", () => {
    const spec = moneyVideoSpec(story, snap)!;
    assert.equal(spec.key, "money:1940");
    assert.equal(spec.amount, 170.1e9);
    assert.equal(spec.share, 49_700);
    assert.deepEqual(
      spec.sentences.map((s) => s.scene),
      ["hook", "quiz", "reveal", "relate", "cta"],
    );
    // 49 700 ₮ is 1.6 kg of beef but 3.4 canteen meals: the comparison with 3+ units wins.
    assert.equal(spec.relate?.goodKey, "canteen");
    assert.deepEqual(verifyMoneySpec(spec), []);
    const text = moneyNarration(spec);
    assert.ok(!/\d/.test(text));
    assert.match(text, /Зуун дал гаруй тэрбум төгрөг/);
    assert.match(text, /дөчин есөн мянга долоон зуун төгрөг/);
    assert.match(spec.source, /хүн бүр төлнө гэсэн үг биш/);
    assert.match(spec.source, /Дуу: AI/);
  });

  it("never uses an amount the story does not hold, foreign money or a small sum", () => {
    // The AI headline said "тэрбум" where the story's amount is "их наяд".
    assert.equal(moneyVideoSpec({ ...story, title: "Сан 8.1 тэрбум ₮ орлого тодотголоо", amounts: ["8.1 их наяд ₮"] }, snap), null);
    assert.equal(moneyVideoSpec({ ...story, title: "230 сая ам.долларын хөрөнгө татна", amounts: ["230 сая ам.доллар"] }, snap), null);
    assert.equal(moneyVideoSpec({ ...story, title: "Сургуульд 860 сая төгрөг зарцуулав", amounts: ["860 сая төгрөг"] }, snap), null);
  });

  it("has exactly one true option, at a place that moves with the story", () => {
    const options = shareOptions(49_700, 1940);
    assert.equal(options.filter((o) => o.correct).length, 1);
    assert.deepEqual(
      options.map((o) => o.value),
      [16_600, 149_000, 49_700],
    );
    assert.equal(shareOptions(49_700, 1941).findIndex((o) => o.correct), 0);
  });

  it("says amounts the way a person does", () => {
    assert.equal(amountWords(9.1e9), "есөн тэрбум зуун сая");
    assert.equal(amountWords(170.1e9), "зуун дал гаруй тэрбум");
    assert.equal(amountWords(120e9), "зуун хорин тэрбум");
    assert.equal(amountWords(3e12), "гурван их наяд");
    assert.equal(amountWords(1.1e12), "нэг их наяд зуун тэрбум");
    assert.equal(roundShare(876_102), 876_000);
    assert.equal(roundShare(2_656.8), 2_660);
  });

  it("refuses a caption number that is not from the story", () => {
    const spec = moneyVideoSpec(story, snap)!;
    spec.sentences[2].caption = "Нэг хүнд *≈ 59 700₮*";
    assert.ok(verifyMoneySpec(spec).some((p) => p.includes("59 700")));
  });

  it("puts the guess pause after the question, not after the hook", () => {
    const tl = buildTimeline(["hook", "quiz", "reveal", "relate", "cta"], [0, 5, 8.7, 11.15, 13.65], { duration: 19.16, tail: 18.9 }, 3.4);
    assert.equal(tl.pauseAt, 8.65);
    assert.deepEqual(tl.starts, [0, 5, 10.8, 13.25, 15.75]);
    assert.equal(tl.sfx.find((e) => e.kind === "pop")?.at, 10.8);
  });

  it("starts each sentence at its sentence-end pause even when a number is said fast", () => {
    const log = [
      "silence_start: 0", "silence_end: 0.185",
      "silence_start: 1.58", "silence_end: 2.174",
      "silence_start: 4.41", "silence_end: 5.028",
      "silence_start: 6.755", "silence_end: 7.135",
      "silence_start: 8.313", "silence_end: 8.704",
      "silence_start: 9.255", "silence_end: 9.562",
      "silence_start: 9.793", "silence_end: 9.985",
      "silence_start: 10.758", "silence_end: 11.147",
      "silence_start: 13.245", "silence_end: 13.647",
      "silence_start: 16.495", "silence_end: 16.697",
      "silence_start: 17.811", "silence_end: 18.282",
      "silence_start: 18.931",
    ].join("\n");
    const spec = moneyVideoSpec(story, snap)!;
    // The log is from a take recorded with the earlier closing line (two sentence ends in it).
    const says = spec.sentences.map((s) => s.say);
    says[says.length - 1] = "Чи юу гэж бодож байна? Коммент дээр бичээрэй.";
    const starts = sentenceStarts(says, parseSilences(log, 19.16), 19.16);
    assert.deepEqual(starts, [0, 5.03, 8.7, 11.15, 13.65]);
  });

  it("writes posts with the plain-division wording and the story's link", () => {
    const meta: VideoMeta = { kind: "money", articleId: 1940, headline: story.title, amountLabel: "170.1 тэрбум ₮", shareLabel: "≈ 49 700₮", sourceName: "Засгийн газар", topic: "economy", link: "iltodmedee.mn/article/toriin-alban-khaagch" };
    const fb = facebookVideoText(meta, "https://iltodmedee.mn");
    assert.match(fb, /хүн бүр төлнө гэсэн үг биш/);
    assert.match(fb, /https:\/\/iltodmedee\.mn\/article\/toriin-alban-khaagch/);
    assert.match(fb, /#эдийнзасаг/);
    assert.ok(threadsLength(threadsVideoText(meta, "https://iltodmedee.mn")) <= THREADS_MAX);
    assert.match(instagramVideoCaption(meta), /bio-д/);
  });

  it("renders a page with the headline as data, never as markup", () => {
    const spec = moneyVideoSpec({ ...story, title: "<img src=x onerror=alert(1)> 170.1 тэрбум ₮ зарцуулна" }, snap)!;
    const tl = buildTimeline(spec.sentences.map((s) => s.scene), [0, 5, 8.7, 11.15, 13.65], { duration: 19.16, tail: 18.9 }, 3.4);
    const html = moneyHtml(spec, tl, { fontsDir: "/f", logo: "/l.png" });
    assert.ok(!html.includes("<img src=x"));
    assert.match(html, /\\u003cimg src=x/);
  });
});

describe("video slots", () => {
  // Ulaanbaatar = UTC+8.
  const ub = (iso: string) => new Date(`${iso}+08:00`);

  it("makes the midday video once and the evening one once, both a news story first (no money video)", () => {
    assert.equal(dueSlot(ub("2026-10-31T12:10:00"), ub("2026-10-31T01:12:00"))?.prefer, "impact");
    assert.equal(dueSlot(ub("2026-10-31T13:40:00"), ub("2026-10-31T12:17:00")), null);
    assert.equal(dueSlot(ub("2026-10-31T19:05:00"), ub("2026-10-31T12:17:00"))?.prefer, "impact");
    assert.equal(dueSlot(ub("2026-10-31T22:59:00"), ub("2026-10-31T19:20:00")), null);
    assert.equal(dueSlot(ub("2026-11-01T12:00:00"), null)?.prefer, "impact");
  });

  it("a slot starts at its Ulaanbaatar hour", () => {
    const now = ub("2026-10-31T12:41:00");
    assert.equal(slotStart(now, VIDEO_SLOTS[0]).toISOString(), ub("2026-10-31T12:00:00").toISOString());
  });

  it("never makes one outside the slots, however late GitHub starts the run", () => {
    assert.equal(dueSlot(ub("2026-10-31T01:12:00"), ub("2026-10-30T18:07:00")), null);
    assert.equal(dueSlot(ub("2026-10-31T16:00:00"), ub("2026-10-30T19:30:00")), null);
    assert.equal(dueSlot(ub("2026-10-31T23:00:00"), null), null);
    assert.equal(dueSlot(ub("2026-10-31T09:00:00"), null), null);
  });

  it("keeps numbers whole with a real no-break space", () => {
    const spec = moneyVideoSpec(
      { id: 1940, slug: "x", title: "Ажилтнуудад 170.1 тэрбум ₮ зарцуулна", amounts: ["170.1 тэрбум ₮"], sourceName: "x", day: "2026-10-28", topic: null },
      snap,
    )!;
    assert.equal(spec.shareLabel, "≈ 49 700₮");
    assert.ok(!spec.shareLabel.includes(" "));
    assert.deepEqual(verifyMoneySpec(spec), []);
  });
});

describe("money video headlines", () => {
  it("never turns a headline that weighs, contrasts or accuses into a video", () => {
    const real = "Төсвийн зарлага 9-ээс 43.5 их наяд ₮ болж өссөн ч иргэдийн орлого 62% л өссөн";
    assert.ok(weighsOrAccuses(real));
    assert.equal(
      moneyVideoSpec({ id: 2254, slug: "x", title: real, amounts: ["9.0 их наяд ₮", "43.5 их наяд ₮"], sourceName: "x", day: "2026-10-30", topic: null }, snap),
      null,
    );
    assert.ok(weighsOrAccuses("Ердөө 3 тэрбум ₮ зарцуулжээ"));
    assert.ok(weighsOrAccuses("Авлигын хэрэгт 5 тэрбум ₮"));
  });

  it("keeps plain decisions and figures", () => {
    for (const t of [
      "52 мянган төрийн албан хаагчийн цалин нэмэгдэж, 170.1 тэрбум ₮ зарцуулна",
      "Оюу Толгойн 3 тэрбум ₮ ногдол ашгийг дэд бүтэцэд зарцуулах",
      "Тоёота сэйлс Монголиа-д 9.1 тэрбум төгрөгийн торгууль оногдууллаа",
      "Цахим залилантаас 28 тэрбум ₮ хохирол учирсан",
      "Хөдөө аж ахуйн урамшуулалд 54.7 тэрбум, цөлжилттэй тэмцэхэд 2 тэрбум төгрөг хуваана",
    ])
      assert.equal(weighsOrAccuses(t), false, t);
  });
  it("refuses bribery, embezzlement and arrests (Nov 2026 audit)", () => {
    for (const t of [
      "Б.Бат 12 тэрбум төгрөг завшсан хэргээр баривчлагдлаа",
      "Хээл хахуулийн хэрэгт 3 тэрбум₮",
      "46.8 сая төгрөгийн хахууль авсан албан тушаалтныг шүүхэд шилжүүллээ",
      "5 тэрбум төгрөгийн мөнгө угаасан хэрэгт яллагдагчаар татлаа",
    ])
      assert.equal(weighsOrAccuses(t), true, t);
  });
});
