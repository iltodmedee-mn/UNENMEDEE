import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eventData, linkHost, MAX_PROPS, track } from "@/lib/track";

describe("analytics events", () => {
  it("keeps at most the plan's two properties, cut short, finite numbers and booleans only", () => {
    assert.equal(MAX_PROPS, 2);
    assert.deepEqual(eventData({ kind: "clap", story: 42, extra: "dropped" }), { kind: "clap", story: 42 });
    assert.deepEqual(eventData({ a: "x".repeat(500) }).a, "x".repeat(120));
    assert.deepEqual(eventData({ a: Number.NaN, b: true }), { b: true });
    assert.deepEqual(eventData(), {});
  });

  it("names the host of a source link without www", () => {
    assert.equal(linkHost("https://www.parliament.mn/n/abc"), "parliament.mn");
    assert.equal(linkHost("https://mof.gov.mn/x"), "mof.gov.mn");
    assert.equal(linkHost("not a url"), "");
    assert.equal(linkHost(null), "");
  });

  it("sends va('event', {name, data}) when the Vercel script is there, and is silent when not", () => {
    const calls: unknown[][] = [];
    const g = globalThis as unknown as { window?: unknown };
    const before = g.window;
    try {
      g.window = {};
      track("Share", { via: "facebook", page: "/article/x" }); // no va: nothing, no throw
      g.window = { va: (...args: unknown[]) => calls.push(args) };
      track("Reaction", { kind: "wow", story: 7 });
      assert.deepEqual(calls, [["event", { name: "Reaction", data: { kind: "wow", story: 7 } }]]);
      g.window = {
        va: () => {
          throw new Error("blocked");
        },
      };
      track("Digest done", { edition: 1 }); // a blocked script never breaks the tap
    } finally {
      g.window = before;
    }
  });
});
