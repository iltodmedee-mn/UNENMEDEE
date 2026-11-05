import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildSnapshot, onceMoreOn5xx, parseNumber } from "@/lib/mongolbank/client";

type Env = { data: Record<string, unknown>[] };
const fx = JSON.parse(readFileSync(new URL("./fixtures/mongolbank.json", import.meta.url), "utf8")) as Record<string, Env>;

describe("Mongolbank snapshot", () => {
  it("parses comma numbers", () => {
    assert.equal(parseNumber("3,597.30"), 3597.3);
    assert.equal(parseNumber("476,791.37"), 476791.37);
    assert.equal(parseNumber(""), null);
    assert.equal(parseNumber(null), null);
    assert.equal(parseNumber("n/a"), null);
  });

  it("matches the mongolbank.mn homepage cards", () => {
    const s = buildSnapshot({
      policy: fx["policy-interest-rate"].data,
      inflation: fx.inflation.data,
      fx: fx["currency-rates"].data,
      gold: fx["gold-and-silver-price"].data,
      reserves: fx["international-reserves"].data,
    });
    assert.deepEqual([s.policyRate?.value, s.policyRate?.since], [12.5, "2026-09-17"]);
    assert.deepEqual([s.inflation?.month, s.inflation?.ub, s.inflation?.core, s.inflation?.national], ["2026-09", 11.9, 7.2, 12.9]);
    assert.deepEqual([s.fx?.date, s.fx?.rates.find((r) => r.code === "USD")?.rate], ["2026-10-20", 3597.3]);
    assert.deepEqual([s.gold?.date, s.gold?.buy], ["2026-10-21", 476791.37]);
    assert.deepEqual([s.reserves?.month, s.reserves?.value], ["2026-09", 8896.86]);
    assert.equal(s.inflation?.history.length, 24);
  });

  it("returns nulls, not errors, for empty responses", () => {
    const s = buildSnapshot({ policy: [], inflation: [], fx: [], gold: [], reserves: [] });
    assert.deepEqual(s, { policyRate: null, inflation: null, fx: null, gold: null, reserves: null });
  });
});

describe("Mongolbank request retry", () => {
  const answers = (...statuses: number[]) => {
    let calls = 0;
    const request = async () => new Response("{}", { status: statuses[Math.min(calls++, statuses.length - 1)] });
    return { request, calls: () => calls };
  };

  it("asks once more after a 5xx and returns the second answer", async () => {
    const a = answers(502, 200);
    assert.equal((await onceMoreOn5xx(a.request)).status, 200);
    assert.equal(a.calls(), 2);
  });

  it("does not repeat a success or a 4xx, and stops after the second 5xx", async () => {
    const ok = answers(200);
    assert.equal((await onceMoreOn5xx(ok.request)).status, 200);
    assert.equal(ok.calls(), 1);
    const notFound = answers(404);
    assert.equal((await onceMoreOn5xx(notFound.request)).status, 404);
    assert.equal(notFound.calls(), 1);
    const down = answers(503, 503, 200);
    assert.equal((await onceMoreOn5xx(down.request)).status, 503);
    assert.equal(down.calls(), 2);
  });
});
