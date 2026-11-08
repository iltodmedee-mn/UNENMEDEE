import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DAILY_CAP, emptyProgress, FULL_DAY, importHistory, LEVELS, levelOf, liveStreak, pageOf, parseProgress, recentDays, recordDigest, recordFact, recordFlag, recordItem, recordPage, recordPress, recordRead, recordSource, XP } from "@/lib/progress";

// 2026-11-09 10:00 Ulaanbaatar (02:00 UTC), a Monday.
const MON = Date.UTC(2026, 10, 9, 2);
const DAY = 86_400_000;
const read = (p = emptyProgress(), id = 1, now = MON, extra: Partial<{ topic: string; publishedAt: number | null }> = {}) =>
  recordRead(p, { id, topic: extra.topic ?? "health", publishedAt: extra.publishedAt ?? null, now });

describe("counted reads", () => {
  it("a story counts once and earns read XP", () => {
    const a = read();
    assert.equal(a.gained, XP.read);
    assert.equal(a.progress.reads, 1);
    const again = read(a.progress);
    assert.equal(again.gained, 0);
    assert.equal(again.progress.reads, 1);
  });

  it("at most DAILY_CAP reads a day count, and a new Ulaanbaatar day starts again", () => {
    let p = emptyProgress();
    for (let i = 0; i < DAILY_CAP + 5; i++) p = read(p, i).progress;
    assert.equal(p.reads, DAILY_CAP);
    const next = read(p, 999, MON + DAY);
    assert.ok(next.gained > 0);
    assert.equal(next.progress.dayReads, 1);
  });

  it("consecutive days build a streak with a bonus; a gap restarts it; 7+ days away is a return", () => {
    let p = read().progress;
    assert.equal(p.streak, 1);
    const d2 = read(p, 2, MON + DAY);
    assert.equal(d2.gained, XP.read + XP.streakDay);
    assert.equal(d2.progress.streak, 2);
    p = read(d2.progress, 3, MON + 9 * DAY).progress;
    assert.equal(p.streak, 1);
    assert.equal(p.bestStreak, 2);
    assert.equal(p.returns, 1);
    assert.equal(liveStreak(p, MON + 10 * DAY), 1);
    assert.equal(liveStreak(p, MON + 11 * DAY), 0);
  });

  it("counts topics, Ulaanbaatar morning / night / weekend, and fast reads", () => {
    const morning = Date.UTC(2026, 10, 8, 23); // 07:00 UB Monday
    const night = Date.UTC(2026, 10, 9, 15, 30); // 23:30 UB Monday
    const saturday = Date.UTC(2026, 10, 14, 4); // 12:00 UB Saturday
    let p = read(emptyProgress(), 1, morning, { topic: "budget" }).progress;
    p = read(p, 2, night, { topic: "budget", publishedAt: night - 5 * 60_000 }).progress;
    p = read(p, 3, saturday, { publishedAt: saturday - 3 * 3_600_000 }).progress;
    assert.deepEqual(p.topics, { budget: 2, health: 1 });
    assert.equal(p.morning, 1);
    assert.equal(p.night, 1);
    assert.equal(p.weekend, 1);
    assert.equal(p.fast, 1);
  });
});

describe("facts, sources and digests", () => {
  it("each counts once per story or edition", () => {
    let p = recordFact(emptyProgress(), { id: 1, now: MON }).progress;
    assert.equal(recordFact(p, { id: 1, now: MON }).gained, 0);
    p = recordSource(p, { id: 1, now: MON }).progress;
    p = recordDigest(p, { edition: 7, now: MON }).progress;
    assert.equal(recordDigest(p, { edition: 7, now: MON }).gained, 0);
    assert.equal(p.xp, XP.fact + XP.source + XP.digest);
    assert.deepEqual([p.facts, p.sources, p.digests], [1, 1, 1]);
  });
});

describe("levels", () => {
  it("ten levels, and the top takes about a year of ~100 XP a day", () => {
    assert.equal(LEVELS.length, 10);
    assert.equal(levelOf(0).name, "Шинэ уншигч");
    assert.equal(levelOf(99).level, 1);
    assert.equal(levelOf(100).level, 2);
    assert.equal(levelOf(1_500).name, "Шалгагч");
    assert.equal(levelOf(36_000).level, 10);
    assert.equal(levelOf(36_000).fraction, 1);
    assert.ok(LEVELS[9].xp / 100 >= 300, "the top needs 300+ days at 100 XP a day");
  });

  it("an event that crosses a threshold reports the new level", () => {
    const p = { ...emptyProgress(), xp: 95 };
    const out = read(p);
    assert.equal(out.levelUp?.level, 2);
    assert.equal(read({ ...emptyProgress(), xp: 10 }).levelUp, null);
  });
});

describe("storage", () => {
  it("a broken, missing or other-version value starts fresh", () => {
    assert.equal(parseProgress(null).xp, 0);
    assert.equal(parseProgress("{bad").xp, 0);
    assert.equal(parseProgress(JSON.stringify({ v: 99, xp: 5 })).xp, 0);
    assert.equal(parseProgress(JSON.stringify({ ...emptyProgress(), xp: 42 })).xp, 42);
  });
});

describe("what reads, pages and rows count toward (badges)", () => {
  it("a read counts its kind: law, place, several outlets, high risk; the 10th of a day is a full day", () => {
    let p = emptyProgress();
    for (let i = 0; i < FULL_DAY; i++) p = recordRead(p, { id: i, topic: "justice", publishedAt: null, now: MON, law: i === 0, place: i < 2 ? "khovd" : null, multi: i === 1, risky: i === 2 }).progress;
    assert.deepEqual([p.laws, p.multi, p.risky, p.places.khovd, p.fullDays], [1, 1, 1, 2, 1]);
    p = recordRead(p, { id: 99, topic: "justice", publishedAt: null, now: MON }).progress;
    assert.equal(p.fullDays, 1, "the 11th read of the day is not another full day");
  });

  it("a read on a holiday in Ulaanbaatar is remembered (Naadam, New Year)", () => {
    const naadam = Date.UTC(2027, 6, 11, 4); // 12:00 UB, 11 July
    const eve = Date.UTC(2026, 11, 31, 17); // 01:00 UB, 1 January
    assert.ok(read(emptyProgress(), 1, naadam).progress.flags.includes("naadam"));
    assert.ok(read(emptyProgress(), 1, eve).progress.flags.includes("new-year"));
    assert.deepEqual(read(emptyProgress(), 1, MON).progress.flags, []);
  });

  it("pageOf knows section pages and once-each pages, with or without a trailing slash", () => {
    assert.deepEqual(pageOf("/budget/"), { section: "budget", item: null });
    assert.deepEqual(pageOf("/promises/economy"), { section: "promises", item: null });
    assert.deepEqual(pageOf("/officials/12"), { section: null, item: { kind: "mp", id: "12" } });
    assert.deepEqual(pageOf("/archive/2026-11-02"), { section: null, item: { kind: "archive", id: "2026-11-02" } });
    assert.deepEqual(pageOf("/officials/companies"), { section: "soe", item: null });
    assert.deepEqual(pageOf("/article/x"), { section: null, item: null });
  });

  it("a section counts once per Ulaanbaatar day; an MP page counts once ever", () => {
    let p = recordPage(emptyProgress(), { path: "/budget", now: MON }).progress;
    p = recordPage(p, { path: "/budget", now: MON + 3_600_000 }).progress;
    assert.equal(p.sections.budget.days, 1);
    p = recordPage(p, { path: "/budget", now: MON + DAY }).progress;
    assert.equal(p.sections.budget.days, 2);
    p = recordPage(p, { path: "/officials/7", now: MON }).progress;
    assert.equal(recordPage(p, { path: "/officials/7", now: MON + DAY }).progress, p);
    assert.equal(p.items.mp.n, 1);
    assert.equal(p.xp, 0, "pages earn no XP themselves");
  });

  it("list rows and press links count once each, at most DAILY_CAP a day", () => {
    let p = emptyProgress();
    for (let i = 0; i < DAILY_CAP + 5; i++) p = recordItem(p, { kind: "tender", id: String(i), now: MON }).progress;
    assert.equal(p.items.tender.n, DAILY_CAP);
    p = recordItem(p, { kind: "tender", id: "999", now: MON + DAY }).progress;
    assert.equal(p.items.tender.n, DAILY_CAP + 1);
    p = recordPress(p, { id: 5, now: MON }).progress;
    assert.equal(recordPress(p, { id: 5, now: MON }).progress, p);
    assert.equal(p.press, 1);
  });

  it("flags stay once set", () => {
    const p = recordFlag(emptyProgress(), "request").progress;
    assert.equal(recordFlag(p, "request").progress, p);
    assert.deepEqual(p.flags, ["request"]);
  });

  it("recentDays marks the current streak's days, oldest first", () => {
    let p = read(emptyProgress(), 1, MON).progress;
    p = read(p, 2, MON + DAY).progress;
    assert.deepEqual(recentDays(p, MON + DAY, 5), [false, false, false, true, true]);
    assert.deepEqual(recentDays(p, MON + 2 * DAY, 5), [false, false, true, true, false]);
    assert.deepEqual(recentDays(p, MON + 9 * DAY, 3), [false, false, false]);
  });

  it("a value stored before badges existed gets the new counters empty", () => {
    const { places, sections, items, flags, badges, unseen, ...old } = emptyProgress();
    void [places, sections, items, flags, badges, unseen];
    const p = parseProgress(JSON.stringify({ ...old, xp: 70, reads: 7 }));
    assert.equal(p.reads, 7);
    assert.deepEqual([p.places, p.badges, p.unseen], [{}, {}, []]);
  });
});

describe("importHistory (readers who were here before progress existed)", () => {
  const today = "2026-11-09"; // MON in Ulaanbaatar
  it("earlier read stories count once, with their XP, and never again", () => {
    const out = importHistory(emptyProgress(), { readIds: [1, 2, 3, 3], digestStreak: null, now: MON });
    assert.equal(out.gained, 3 * XP.read);
    assert.deepEqual([out.progress.reads, out.progress.imported], [3, 3]);
    assert.equal(read(out.progress, 2).gained, 0, "an imported story is already read");
    assert.equal(importHistory(out.progress, { readIds: [4, 5], digestStreak: null, now: MON }).progress, out.progress, "only once per browser");
  });

  it("a live digest streak becomes the streak; an ended one still counts as the best", () => {
    const live = importHistory(emptyProgress(), { readIds: [], digestStreak: { d: "2026-11-08", n: 12 }, now: MON }).progress;
    assert.deepEqual([live.streak, live.lastDay, live.bestStreak, liveStreak(live, MON)], [12, "2026-11-08", 12, 12]);
    assert.equal(read(live, 9, MON).progress.streak, 13, "reading today continues it");
    const ended = importHistory(emptyProgress(), { readIds: [], digestStreak: { d: "2026-10-01", n: 30 }, now: MON }).progress;
    assert.deepEqual([ended.streak, ended.bestStreak], [0, 30]);
  });

  it("a read already counted today joins yesterday's digest streak", () => {
    const p = read(emptyProgress(), 1, MON).progress;
    assert.equal(p.lastDay, today);
    const out = importHistory(p, { readIds: [1], digestStreak: { d: "2026-11-08", n: 4 }, now: MON }).progress;
    assert.deepEqual([out.streak, out.reads, out.imported], [5, 1, 0]);
  });
});
