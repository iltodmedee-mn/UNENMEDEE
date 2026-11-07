import assert from "node:assert/strict";
import { test } from "node:test";

import { feedProblems, feedReport, type FeedCheckItem } from "@/lib/feed-check";

const NOW = new Date("2026-11-07T12:00:00Z");
let n = 0;
const item = (over: Partial<FeedCheckItem> = {}): FeedCheckItem => {
  n += 1;
  return { id: n, slug: `s-${n}`, title: `Төсвийн тодотгол батлагдлаа ${n}`, summary: "Засгийн газар тодотгол баталлаа.", source: `site${n}.gov.mn`, publishedAt: new Date(NOW.getTime() - n * 60_000), undated: false, ...over };
};

test("a clean feed has no problems and no report", () => {
  const feed = Array.from({ length: 25 }, () => item());
  assert.deepEqual(feedProblems(feed, NOW), []);
  assert.equal(feedReport([], "https://iltodmedee.mn"), "");
});

test("the two Nov 7 2026 cases are caught by outcome, whatever their cause", () => {
  const latin = item({ title: "Ömnögovi aimagt 'Irgenii tankhim' neegdlee, IH-iin darga ONB-tai uulzlaa" });
  const oldPage = item({ title: "Сумын 2025 оны төсөвт тодотгол хийх тухай", summary: "Хурал 2025 оны 7-р сард тогтоол гаргасан.", undated: true });
  const rules = feedProblems([latin, oldPage], NOW).map((p) => p.rule).sort();
  assert.deepEqual(rules, ["latin", "old-as-new"]);
});

test("an undated story naming this year is not flagged", () => {
  assert.deepEqual(feedProblems([item({ title: "2026 оны төсвийн тодотгол хэлэлцлээ", undated: true })], NOW), []);
});

test("broken text, a future date, a duplicate headline and a flood from one site", () => {
  const p = feedProblems(
    [
      item({ summary: "undefined" }),
      item({ publishedAt: new Date(NOW.getTime() + 5 * 3_600_000) }),
      item({ title: "Ижил гарчиг" }),
      item({ title: "ижил гарчиг!" }),
      ...Array.from({ length: 5 }, () => item({ source: "orkhon.khural.mn", undated: true, title: `2026 оны тогтоол ${n}` })),
    ],
    NOW,
  );
  assert.deepEqual(p.map((x) => x.rule).sort(), ["broken", "date", "duplicate", "flood"]);
});

test("the report links each story, keys the problem set and never mentions anyone", () => {
  const p = feedProblems([item({ title: "@everyone Ömnögovi aimagt Irgenii tankhim neegdlee" })], NOW);
  const report = feedReport(p, "https://iltodmedee.mn");
  assert.match(report.split("\n")[0], /^<!-- feed-check: latin:\d+ -->$/);
  assert.match(report, /https:\/\/iltodmedee\.mn\/article\/s-\d+/);
  assert.doesNotMatch(report, /@everyone/);
});

test("a portal posting for many bodies is not a flood: only undated stories count", () => {
  assert.deepEqual(feedProblems(Array.from({ length: 9 }, () => item({ source: "gov.mn" })), NOW), []);
});

test("a platform request limit is a warning, not a failure", async () => {
  const { isRateLimited } = await import("@/lib/social/outcome");
  assert.equal(isRateLimited(new Error("Instagram 403: Application request limit reached (code 4)")), true);
  assert.equal(isRateLimited(Object.assign(new Error("x"), { status: 429 })), true);
  assert.equal(isRateLimited(new Error("Instagram 400: Invalid parameter (code 100)")), false);
});
