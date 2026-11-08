import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DAILY_CAP, emptyProgress, LEVELS, levelOf, liveStreak, parseProgress, recordDigest, recordFact, recordRead, recordSource, XP } from "@/lib/progress";

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
