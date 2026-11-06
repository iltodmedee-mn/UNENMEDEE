import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { quizCard } from "@/lib/og";
import { publishAlbum } from "@/lib/social/facebook";
import { publishInstagramCarousel } from "@/lib/social/instagram";
import { outcomeUnknown } from "@/lib/social/outcome";
import { publishThreadsCarousel, threadsLength } from "@/lib/social/threads";
import {
  answersCaption,
  answersDue,
  answersImageUrl,
  answersThreadsText,
  buildWeeklyQuiz,
  isQuizTime,
  maskAnswer,
  maskedText,
  parseWeeklyQuiz,
  pickQuestions,
  type QuizCandidate,
  quizCaption,
  quizImageUrls,
  quizOptions,
  quizThreadsText,
  quizWeek,
} from "@/lib/social/weekly-quiz";

/** Real headlines of 30 Oct – 6 Nov 2026 (ids and amounts as stored). */
const d = (s: string) => new Date(s);
const STORIES: QuizCandidate[] = [
  { id: 2613, slug: "garaash", title: "Гэр бүлийн гараашийг татвараас чөлөөлж, 2027 оноос 1.3 их наяд ₮ хэмнэнэ", amounts: ["1.3 их наяд ₮"], importance: 85, clusterId: null, sourceName: "Монгол Улсын Засгийн газар", topic: "Эдийн засаг", publishedAt: d("2026-11-03T08:39:00Z") },
  // A contrast ("өссөн ч … л") weighs the facts: never a question.
  { id: 2254, slug: "budget", title: "Төсвийн зарлага 9-ээс 43.5 их наяд ₮ болж өссөн ч иргэдийн орлого 62% л өссөн", amounts: ["43.5 их наяд ₮"], importance: 85, clusterId: null, sourceName: "Монгол Улсын Их Хурал", topic: "Улс төр", publishedAt: d("2026-10-30T09:38:00Z") },
  // A charge: never a question.
  { id: 2271, slug: "zavshsan", title: "Байгууллагын ажилтан 457 сая төгрөг хувьдаа завшсан", amounts: ["457 сая төгрөг"], importance: 80, clusterId: null, sourceName: "Цагдаагийн ерөнхий газар", topic: "Хууль", publishedAt: d("2026-10-29T10:15:00Z") },
  { id: 2318, slug: "solar", title: "Дарханы 10 МВт нарны станц 9 жилд 164 сая кВт.ц үйлдвэрлэж, 19.5 тэрбум ₮ татвар өгсөн", amounts: ["19.5 тэрбум ₮"], importance: 65, clusterId: 7, sourceName: "Эрчим хүчний яам", topic: "Эрчим хүч", publishedAt: d("2026-11-01T00:00:00Z") },
  // Same cluster as 2318: one question per story.
  { id: 2319, slug: "solar-2", title: "Нарны станц 19.5 тэрбум ₮ татвар төлжээ", amounts: ["19.5 тэрбум ₮"], importance: 60, clusterId: 7, sourceName: "Дархан-Уул аймаг", topic: "Орон нутаг", publishedAt: d("2026-11-01T02:00:00Z") },
  { id: 3483, slug: "bonds", title: "Засгийн газар 11-12-р сард 480 тэрбум төгрөгийн үнэт цаас арилжаална", amounts: ["480.0 тэрбум төгрөг", "1 их наяд ₮"], importance: 40, clusterId: null, sourceName: "Монгол Улсын Засгийн газар (gov.mn)", topic: "Эдийн засаг", publishedAt: d("2026-11-06T01:56:00Z") },
  { id: 2291, slug: "station", title: "Өвлийн цахилгааны эрсдэл: 90 тэрбум ₮-ээр станц шинэчлэв", amounts: ["90 тэрбум төгрөг", "5.45 тэрбум ₮"], importance: 40, clusterId: null, sourceName: "Монгол Улсын Засгийн газар", topic: "Дэд бүтэц", publishedAt: d("2026-10-31T10:38:00Z") },
  { id: 2526, slug: "dental", title: "Шүдний рентген аппарат, автоклавыг 10 сая төгрөгөөр худалдаж авлаа", amounts: ["10 сая төгрөг"], importance: 30, clusterId: null, sourceName: "Монгол Улсын Засгийн газар (gov.mn)", topic: "Эрүүл мэнд", publishedAt: d("2026-11-03T01:03:00Z") },
  // Dollars are never a ₮ question.
  { id: 3431, slug: "reserve", title: "Улсын валютын нөөц 8.76 тэрбум ам.долларт хүрлээ", amounts: ["8.76 тэрбум ам.доллар"], importance: 80, clusterId: null, sourceName: "Монголбанк", topic: "Эдийн засаг", publishedAt: d("2026-11-05T09:40:00Z") },
];
/** Sunday 8 Nov 2026, 19:30 Ulaanbaatar. */
const SUNDAY = d("2026-11-08T11:30:00Z");

describe("weekly quiz questions", () => {
  it("hides the ₮ amount and keeps the ₮ word with its case ending", () => {
    assert.deepEqual(maskAnswer(STORIES[6].title, STORIES[6].amounts), { before: "Өвлийн цахилгааны эрсдэл:", after: "₮-ээр станц шинэчлэв", value: 90e9 });
    assert.deepEqual(maskAnswer(STORIES[5].title, STORIES[5].amounts), { before: "Засгийн газар 11-12-р сард", after: "төгрөгийн үнэт цаас арилжаална", value: 480e9 });
    // "164 сая кВт.ц" is not money: only the ₮ amount is hidden.
    assert.equal(maskAnswer(STORIES[3].title, STORIES[3].amounts)?.before, "Дарханы 10 МВт нарны станц 9 жилд 164 сая кВт.ц үйлдвэрлэж,");
    // The amount must be one the story's text names, and written as ₮.
    assert.equal(maskAnswer("Төсөвт 5 тэрбум ₮ тусгав", ["7 тэрбум ₮"]), null);
    assert.equal(maskAnswer("Төсөвт 5 тэрбум тусгав", ["5 тэрбум ₮"]), null);
    // The same amount twice would give the answer away.
    assert.equal(maskAnswer("5 тэрбум ₮ төлөвлөж, 5 тэрбум ₮ зарцуулав", ["5 тэрбум ₮"]), null);
  });

  it("offers four ascending options at the answer's precision, the answer where asked", () => {
    assert.deepEqual(quizOptions(1.3e12, 1), ["430 тэрбум", "1.3 их наяд", "3.9 их наяд", "13 их наяд"]);
    assert.deepEqual(quizOptions(19.5e9, 3), ["650 сая", "1.95 тэрбум", "6.5 тэрбум", "19.5 тэрбум"]);
    assert.deepEqual(quizOptions(10e6, 0), ["10 сая", "30 сая", "100 сая", "300 сая"]);
  });

  it("picks the most important stories, one per cluster, no charge or contrast, letters moving on", () => {
    const qs = pickQuestions(STORIES);
    assert.deepEqual(
      qs.map((q) => q.articleId),
      [2613, 2318, 3483, 2291, 2526],
    );
    assert.deepEqual(
      qs.map((q) => q.correct),
      [1, 2, 3, 0, 1],
    );
    for (const q of qs) {
      assert.equal(q.options[q.correct], q.answer.replace(/ ₮$/, ""));
      assert.ok(!maskedText(q).match(/\d+(\.\d+)? (их наяд|тэрбум|сая) ₮/), "the hidden amount never shows in the question");
    }
    assert.equal(qs[0].day, "11.03");
  });

  it("needs three questions; the week and label are the Sunday's", () => {
    assert.equal(buildWeeklyQuiz(STORIES.slice(0, 4), SUNDAY), null);
    const quiz = buildWeeklyQuiz(STORIES, SUNDAY);
    assert.ok(quiz);
    assert.equal(quiz.week, 202645);
    assert.equal(quiz.label, "11.02–11.08");
    assert.deepEqual(parseWeeklyQuiz(JSON.stringify(quiz)), quiz);
    assert.equal(parseWeeklyQuiz("{"), null);
    assert.equal(parseWeeklyQuiz(JSON.stringify({ ...quiz, questions: [{ ...quiz.questions[0], correct: 4 }] })), null);
  });

  it("goes out Sunday from 19:00 (a late run until 06:00 Monday), answers the next evening", () => {
    assert.equal(isQuizTime(d("2026-11-08T10:59:00Z")), false); // Sunday 18:59
    assert.equal(isQuizTime(d("2026-11-08T11:00:00Z")), true);
    assert.equal(isQuizTime(d("2026-11-08T21:59:00Z")), true); // Monday 05:59
    assert.equal(isQuizTime(d("2026-11-08T22:00:00Z")), false);
    assert.equal(isQuizTime(d("2026-11-07T12:00:00Z")), false); // Saturday 20:00
    assert.equal(quizWeek(d("2026-11-08T17:00:00Z")), quizWeek(SUNDAY)); // Monday 01:00 still Sunday's quiz
    const posted = SUNDAY;
    assert.equal(answersDue(d("2026-11-08T14:00:00Z"), posted), false); // same evening
    assert.equal(answersDue(d("2026-11-09T10:59:00Z"), posted), false); // Monday 18:59
    assert.equal(answersDue(d("2026-11-09T11:00:00Z"), posted), true); // Monday 19:00
    assert.equal(answersDue(d("2026-11-11T12:00:00Z"), posted), false); // more than 72 h later
  });
});

describe("weekly quiz posts", () => {
  const quiz = buildWeeklyQuiz(STORIES, SUNDAY)!;

  it("lists every question with its options and never asks for comments or shares", () => {
    const fb = quizCaption(quiz, "facebook");
    assert.ok(fb.startsWith("🧠 7 ХОНОГИЙН ТЕСТ · 11.02–11.08\n"));
    assert.ok(fb.includes("1. Гэр бүлийн гараашийг татвараас чөлөөлж, 2027 оноос ❓ ₮ хэмнэнэ\nА) 430 тэрбум · Б) 1.3 их наяд · В) 3.9 их наяд · Г) 13 их наяд"));
    assert.ok(fb.includes("👉 https://iltodmedee.mn"));
    assert.ok(quizCaption(quiz, "instagram").includes("холбоос bio-д"));
    const th = quizThreadsText(quiz);
    assert.ok(threadsLength(th) <= 500);
    for (const text of [fb, quizCaption(quiz, "instagram"), th, answersCaption(quiz, "facebook"), answersThreadsText(quiz)]) {
      assert.ok(!/коммент|сэтгэгдэл|хуваалц|найздаа|tag|comment|share/i.test(text), text);
    }
  });

  it("answers name the letter, the amount, the story and the per-person share as plain division", () => {
    const fb = answersCaption(quiz, "facebook");
    assert.match(fb, /1\. Б\) 1\.3 их наяд ₮\nГэр бүлийн гараашийг татвараас чөлөөлж, 2027 оноос 1\.3 их наяд ₮ хэмнэнэ\n👤 3\.43 сая хүнд хуваавал ≈ 379.500₮ \/ хүн\n👉 https:\/\/iltodmedee\.mn\/article\/garaash/);
    assert.ok(fb.includes("хүн бүр төлнө гэсэн үг биш"));
    assert.ok(!answersCaption(quiz, "instagram").includes("/article/"));
    assert.ok(answersThreadsText(quiz).includes("1-Б: 1.3 их наяд ₮\n2-В: 19.5 тэрбум ₮"));
  });

  it("every card renders (Satori refuses some layouts only at render time)", async () => {
    for (const slide of [0, 1, 2, 3, 4, 5, 6, "answers"] as const) {
      const png = new Uint8Array(await (await quizCard(quiz, slide)).arrayBuffer());
      assert.deepEqual([...png.slice(1, 4)], [0x50, 0x4e, 0x47], `slide ${slide}`);
    }
  });

  it("cards: cover, one per question, closing card; the answers card apart", () => {
    assert.deepEqual(quizImageUrls(quiz), Array.from({ length: 7 }, (_, n) => `https://iltodmedee.mn/quiz-image?w=202645&n=${n}`));
    assert.equal(answersImageUrl(quiz), "https://iltodmedee.mn/quiz-image?w=202645&n=a");
  });
});

describe("carousel publishing", () => {
  const urls = ["https://iltodmedee.mn/quiz-image?w=1&n=0", "https://iltodmedee.mn/quiz-image?w=1&n=1"];

  it("Instagram: one item per card, each waited for, then the CAROUSEL container", async () => {
    const calls: string[] = [];
    let n = 0;
    const f = (async (url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body ?? ""));
      calls.push(`${init?.method ?? "GET"} ${url.split("?")[0].split("/").pop()}${body.get("media_type") ? ` ${body.get("media_type")}` : ""}${body.get("is_carousel_item") ? " item" : ""}`);
      if (url.endsWith("/me/media")) {
        if (body.get("media_type") === "CAROUSEL") {
          assert.equal(body.get("children"), "i1,i2");
          assert.equal(body.get("caption"), "cap");
          return Response.json({ id: "p1" });
        }
        return Response.json({ id: `i${++n}` });
      }
      if (url.includes("?fields=")) return Response.json({ status_code: "FINISHED" });
      return Response.json({ id: "m1" });
    }) as unknown as typeof fetch;
    assert.equal(await publishInstagramCarousel({ token: "T", imageUrls: urls, caption: "cap", fetchImpl: f, sleep: async () => {} }), "m1");
    assert.deepEqual(calls, ["POST media item", "POST media item", "GET i1", "GET i2", "POST media CAROUSEL", "GET p1", "POST media_publish"]);
    await assert.rejects(publishInstagramCarousel({ token: "T", imageUrls: urls.slice(0, 1), caption: "c", fetchImpl: f }), /2–10 images/);
  });

  it("Threads: IMAGE items, then the CAROUSEL with the text, then publish", async () => {
    const calls: string[] = [];
    let n = 0;
    const f = (async (url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body ?? ""));
      calls.push(`${init?.method ?? "GET"} ${url.split("?")[0].split("/").pop()} ${body.get("media_type") ?? ""}`.trim());
      if (url.endsWith("/me/threads")) return Response.json({ id: body.get("media_type") === "CAROUSEL" ? (assert.equal(body.get("children"), "t1,t2"), "c1") : `t${++n}` });
      if (url.includes("?fields=")) return Response.json({ status: "FINISHED" });
      return Response.json({ id: "post1" });
    }) as unknown as typeof fetch;
    assert.equal(await publishThreadsCarousel({ token: "T", imageUrls: urls, text: "x", fetchImpl: f, sleep: async () => {} }), "post1");
    assert.deepEqual(calls, ["POST threads IMAGE", "POST threads IMAGE", "GET t1", "GET t2", "POST threads CAROUSEL", "GET c1", "POST threads_publish"]);
  });

  it("Facebook: unpublished photos, then one feed post attaching them in order", async () => {
    let feed: URLSearchParams | null = null;
    let n = 0;
    const f = (async (url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body ?? ""));
      if (url.endsWith("/photos")) {
        assert.equal(body.get("published"), "false");
        return Response.json({ id: `ph${++n}` });
      }
      feed = body;
      return Response.json({ id: "page_post" });
    }) as unknown as typeof fetch;
    assert.equal(await publishAlbum({ pageId: "1", token: "T", imageUrls: urls, message: "msg", fetchImpl: f }), "page_post");
    assert.equal(feed!.get("message"), "msg");
    assert.equal(feed!.get("attached_media[0]"), '{"media_fbid":"ph1"}');
    assert.equal(feed!.get("attached_media[1]"), '{"media_fbid":"ph2"}');
    // A 5xx on the feed call may have posted: an unknown outcome, never retried.
    const lost = (async (url: string) => (url.endsWith("/photos") ? Response.json({ id: "ph" }) : Response.json({ error: { message: "oops", code: 2 } }, { status: 500 }))) as unknown as typeof fetch;
    await assert.rejects(publishAlbum({ pageId: "1", token: "T", imageUrls: urls, message: "m", fetchImpl: lost }), (err: unknown) => outcomeUnknown(err));
    // A refused upload is a plain refusal (nothing public yet).
    const refused = (async () => Response.json({ error: { message: "bad image", code: 324 } }, { status: 400 })) as unknown as typeof fetch;
    await assert.rejects(publishAlbum({ pageId: "1", token: "T", imageUrls: urls, message: "m", fetchImpl: refused }), (err: unknown) => !outcomeUnknown(err));
  });
});
