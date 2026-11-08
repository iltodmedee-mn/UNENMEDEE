import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { award, BADGES, badgeState, COLLECTIONS, nextBadge, STREAK_MILESTONES, TIER_XP, tierCount } from "@/lib/badges";
import { PLACES } from "@/lib/places";
import { emptyProgress, type Progress, recordRead } from "@/lib/progress";
import { TOPICS } from "@/lib/topics";

// 2026-11-09 10:00 Ulaanbaatar.
const MON = Date.UTC(2026, 10, 9, 2);
const at = (patch: Partial<Progress>): Progress => ({ ...emptyProgress(), ...patch });

describe("the catalog", () => {
  it("ids are unique, every badge sits in a known collection, and steps are one or four", () => {
    assert.equal(new Set(BADGES.map((b) => b.id)).size, BADGES.length);
    const keys = new Set(COLLECTIONS.map((c) => c.key));
    for (const b of BADGES) {
      assert.ok(keys.has(b.collection), b.id);
      assert.ok(b.steps.length === 1 || b.steps.length === 4, `${b.id} has ${b.steps.length} steps`);
      for (let i = 1; i < b.steps.length; i++) assert.ok(b.steps[i].need >= b.steps[i - 1].need, `${b.id} steps go down`);
    }
    assert.ok(BADGES.length >= 32, "the 32 agreed with the owner, and more");
  });

  it("the thresholds the owner agreed (hard to earn)", () => {
    const needs = (id: string) => BADGES.find((b) => b.id === id)!.steps.map((s) => s.need);
    assert.deepEqual(needs("reader"), [50, 300, 1_500, 5_000]);
    assert.deepEqual(needs("facts"), [25, 150, 600, 2_000]);
    assert.deepEqual(needs("sources"), [10, 75, 300, 1_000]);
    const ladder = STREAK_MILESTONES.map((m) => m.days);
    for (const days of [7, 30, 100, 365]) assert.ok(ladder.includes(days), `${days} days is a streak milestone`);
    assert.deepEqual(needs("digests"), [10, 60, 250, 730]);
    assert.deepEqual(needs("laws"), [5, 25, 100, 300]);
    assert.deepEqual(needs("tenders"), [25, 150, 500, 2_000]);
    assert.deepEqual(TIER_XP, { b: 25, s: 50, g: 100, p: 250 });
  });

  it("Олон талт and Аймаг судлаач top out at every topic with 50 reads, and every aimag plus the 9 districts", () => {
    const topics = TOPICS.map((t) => t.key).filter((k) => k !== "other");
    const allTopics = Object.fromEntries(topics.map((k) => [k, 1]));
    assert.equal(badgeState(BADGES.find((b) => b.id === "topics")!, at({ topics: allTopics })).earned, 0, "earned only by award");
    const three = award(at({ topics: allTopics }), MON).progress.badges.topics;
    assert.equal(three.length, 3);
    const deep = award(at({ topics: Object.fromEntries(topics.map((k) => [k, 50])) }), MON).progress.badges.topics;
    assert.equal(deep.length, 4);
    const aimags = PLACES.filter((p) => p.kind === "aimag").map((p) => p.slug);
    assert.equal(aimags.length, 21);
    assert.equal(award(at({ places: Object.fromEntries(aimags.map((s) => [s, 1])) }), MON).progress.badges.places.length, 3);
  });

  it("the streak ladder climbs to 1 000 days, one named badge per milestone", () => {
    assert.equal(STREAK_MILESTONES.at(-1)!.days, 1_000);
    for (let i = 1; i < STREAK_MILESTONES.length; i++) assert.ok(STREAK_MILESTONES[i].days > STREAK_MILESTONES[i - 1].days);
    const ladder = BADGES.filter((b) => b.collection === "streak");
    assert.deepEqual(ladder.map((b) => b.name), STREAK_MILESTONES.map((m) => m.name));
    assert.ok(!BADGES.some((b) => b.id === "streak"), "the retired four-tier streak badge stays retired");
  });

  it("a 12-day best streak earns Оч and Гал, dated, with their tier XP", () => {
    const a = award(at({ bestStreak: 12 }), MON);
    assert.deepEqual(a.earned.map((e) => `${e.badge.id}:${e.tier}`), ["streak-3:b", "streak-7:b"]);
    assert.equal(a.gained, 50);
  });
});

describe("award", () => {
  it("the first counted read earns «Анхны алхам» once, dated, with its XP, and marks it unseen", () => {
    const read = recordRead(emptyProgress(), { id: 1, topic: "health", publishedAt: null, now: MON }).progress;
    const a = award(read, MON);
    assert.deepEqual(a.earned.map((e) => e.badge.id), ["first-read"]);
    assert.equal(a.gained, 25);
    assert.equal(a.progress.xp, read.xp + 25);
    assert.deepEqual(a.progress.badges["first-read"], ["2026-11-09"]);
    assert.deepEqual(a.progress.unseen, ["first-read"]);
    assert.equal(award(a.progress, MON + 1_000).progress, a.progress, "awarding again changes nothing");
  });

  it("crossing two tiers at once stamps both; earned tiers never go away", () => {
    const a = award(at({ reads: 300 }), MON);
    assert.equal(a.progress.badges.reader.length, 2);
    assert.equal(a.gained, 25 + 50 + 25, "хүрэл + мөнгө, and «Анхны алхам»");
    const later = award({ ...a.progress, reads: 10 }, MON);
    assert.equal(later.progress.badges.reader.length, 2);
  });

  it("a level crossed by a badge bonus is reported", () => {
    const a = award(at({ xp: 90, reads: 1 }), MON);
    assert.equal(a.levelUp?.level, 2);
  });

  it("tierCount counts earned tiers out of all", () => {
    const { earned, total } = tierCount(award(at({ reads: 50 }), MON).progress);
    assert.equal(earned, 2);
    assert.equal(total, BADGES.reduce((n, b) => n + b.steps.length, 0));
  });
});

describe("nextBadge (the dial)", () => {
  it("a new reader is shown the first Эхлэл badge; later the open badge closest to its next tier", () => {
    assert.equal(nextBadge(emptyProgress())?.badge.id, "first-read");
    const p = award(at({ reads: 45, facts: 3 }), MON).progress;
    const next = nextBadge(p);
    assert.equal(next?.badge.id, "reader");
    assert.deepEqual([next?.next?.have, next?.next?.need], [45, 50]);
  });

  it("never shows a secret badge", () => {
    const p = award(at({ reads: 999 }), MON).progress;
    assert.notEqual(nextBadge(p)?.badge.collection, "secret");
  });
});
