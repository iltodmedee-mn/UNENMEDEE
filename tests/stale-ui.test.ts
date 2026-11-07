import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { editionLabel, EDITION_DATE_AFTER_H } from "@/lib/edition";
import { FEED_QUIET_HOURS, hoursSince, isUbWeekend, staleAfter } from "@/lib/stale";

describe("stale data is visible", () => {
  const end = new Date("2026-10-25T12:40:00Z"); // 20:40 in Ulaanbaatar
  const later = (h: number) => new Date(end.getTime() + h * 3_600_000);

  it("an edition older than 18 h carries its date", () => {
    assert.equal(EDITION_DATE_AFTER_H, 18);
    assert.equal(editionLabel({ kind: "12h", periodEnd: end }), "ОРОЙН ТОЙМ · 20:40", "no clock: the plain label (OG cards, posts)");
    assert.equal(editionLabel({ kind: "12h", periodEnd: end }, later(17)), "ОРОЙН ТОЙМ · 20:40");
    assert.equal(editionLabel({ kind: "12h", periodEnd: end }, later(19)), "ОРОЙН ТОЙМ · 20:40 · 25.10");
    assert.equal(editionLabel({ kind: "30d", periodEnd: end }, later(400)), "САРЫН ТОЙМ");
  });

  it("staleness and quiet hours", () => {
    const now = new Date("2026-10-27T00:00:00Z");
    assert.ok(!staleAfter("2026-10-25T00:00:01Z", 2, now));
    assert.ok(staleAfter("2026-10-24T23:59:59Z", 2, now));
    assert.ok(staleAfter("not a date", 2, now), "an unreadable date is treated as stale");
    assert.equal(hoursSince("2026-10-26T17:30:00Z", now), 6);
    assert.equal(hoursSince(null, now), 0);
    assert.equal(hoursSince("2026-10-28T00:00:00Z", now), 0, "a future date is not negative");
    assert.equal(FEED_QUIET_HOURS, 6);
  });
});

describe("weekend in Ulaanbaatar", () => {
  const at = (iso: string) => Date.parse(iso);
  it("uses UTC+8, not UTC", () => {
    assert.equal(isUbWeekend(at("2026-11-06T15:59:00Z")), false, "Friday 23:59 in Ulaanbaatar");
    assert.equal(isUbWeekend(at("2026-11-06T16:00:00Z")), true, "Saturday 00:00");
    assert.equal(isUbWeekend(at("2026-11-08T15:59:00Z")), true, "Sunday 23:59");
    assert.equal(isUbWeekend(at("2026-11-08T16:00:00Z")), false, "Monday 00:00");
    assert.equal(isUbWeekend(at("2026-11-04T04:00:00Z")), false, "Wednesday");
  });
});

describe("SOE average wage sanity", () => {
  it("is null for tiny staff counts and implausible results", async () => {
    const { avgMonthlyWage } = await import("@/components/officials/soe-table");
    assert.equal(avgMonthlyWage({ wageFund: 5_000_000_000, staff: 1 }), null);
    assert.equal(avgMonthlyWage({ wageFund: 5_000_000_000, staff: 2 }), null);
    assert.equal(avgMonthlyWage({ wageFund: 120_000_000_000, staff: 3 }), null, "over 50 000 000 a month");
    assert.equal(avgMonthlyWage({ wageFund: 3_600_000_000, staff: 100 }), 3_000_000);
    assert.equal(avgMonthlyWage({ wageFund: null, staff: 10 }), null);
  });
});
