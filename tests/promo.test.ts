import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { describe, it } from "node:test";

import { duePromo, LAUNCHPAD_URL, PROMOS } from "@/lib/social/promo";
import { THREADS_MAX, threadsLength } from "@/lib/social/threads";

describe("Launchpad campaign posts (3–7 Nov 2026)", () => {
  it("posts one day at 19:00 Ulaanbaatar, inside an 8-hour window, and nothing from 8 November", () => {
    assert.equal(duePromo(new Date("2026-11-03T10:59:00Z")), null);
    assert.equal(duePromo(new Date("2026-11-03T11:00:00Z"))?.day, 1);
    assert.equal(duePromo(new Date("2026-11-03T18:59:00Z"))?.day, 1);
    assert.equal(duePromo(new Date("2026-11-03T19:01:00Z")), null);
    assert.equal(duePromo(new Date("2026-11-07T12:00:00Z"))?.day, 5);
    for (const t of ["2026-11-08T11:30:00Z", "2026-11-09T11:30:00Z", "2027-11-03T11:30:00Z"]) assert.equal(duePromo(new Date(t)), null, t);
    assert.ok(PROMOS.every((p) => Date.parse(p.postAt) < Date.parse("2026-11-08T00:00:00Z")));
  });

  it("every text starts with the Launchpad link and fits each platform", () => {
    for (const p of PROMOS) {
      for (const text of [p.facebook, p.instagram, p.threads]) assert.ok(text.startsWith(`👉 ${LAUNCHPAD_URL}`), `day ${p.day}`);
      assert.ok(threadsLength(p.threads) <= THREADS_MAX, `threads day ${p.day}: ${threadsLength(p.threads)}`);
      assert.ok(p.instagram.length <= 2200);
    }
    assert.equal(new Set(PROMOS.map((p) => p.facebook)).size, PROMOS.length, "a different post each day");
  });

  it("each day's video is in public/ and small enough to serve", () => {
    for (const p of PROMOS) {
      const f = `public${p.video}`;
      assert.ok(existsSync(f), f);
      assert.ok(statSync(f).size < 8_000_000, f);
    }
  });
});
