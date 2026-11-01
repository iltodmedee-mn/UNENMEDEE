import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextRunAt, nextRunLabel, ubMidnight } from "@/lib/ticker";

describe("status ticker helpers", () => {
  it("finds the next pipeline run among the four crons (:17/:32 even, :02/:47 odd UTC hours)", () => {
    const next = (iso: string) => new Date(nextRunAt(Date.parse(iso))).toISOString();
    assert.equal(next("2026-10-22T05:25:00Z"), "2026-10-22T05:47:00.000Z");
    assert.equal(next("2026-10-22T06:00:00Z"), "2026-10-22T06:17:00.000Z");
    assert.equal(next("2026-10-22T06:17:00Z"), "2026-10-22T06:32:00.000Z");
    assert.equal(next("2026-10-22T06:40:00Z"), "2026-10-22T07:02:00.000Z");
    assert.equal(next("2026-10-22T07:02:00Z"), "2026-10-22T07:47:00.000Z");
    assert.equal(next("2026-10-22T23:50:00Z"), "2026-10-23T00:17:00.000Z");
  });

  it("labels the wait in hours and minutes", () => {
    assert.equal(nextRunLabel(Date.parse("2026-10-22T04:00:00Z")), "17 мин");
    assert.equal(nextRunLabel(Date.parse("2026-10-22T05:37:00Z")), "10 мин");
  });

  it("returns Ulaanbaatar midnight as UTC", () => {
    // 2026-10-22 02:00 UB = 2026-10-21 18:00 UTC; that day began at 2026-10-21 16:00 UTC.
    assert.equal(new Date(ubMidnight(Date.parse("2026-10-21T18:00:00Z"))).toISOString(), "2026-10-21T16:00:00.000Z");
    assert.equal(new Date(ubMidnight(Date.parse("2026-10-21T15:59:00Z"))).toISOString(), "2026-10-20T16:00:00.000Z");
  });
});
