import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CODE_PREFIX, decodeProgress, encodeProgress } from "@/lib/progress-code";
import { emptyProgress, parseProgress, recordRead, sanitizeProgress } from "@/lib/progress";

const MON = Date.UTC(2026, 10, 9, 2);

describe("restore code", () => {
  it("a code brings the same progress back, without the unseen dot", async () => {
    let p = emptyProgress();
    for (let i = 0; i < 600; i++) p = recordRead(p, { id: 100_000 + i, topic: "health", publishedAt: null, now: MON + Math.floor(i / 20) * 86_400_000 }).progress;
    p = { ...p, badges: { reader: ["2026-11-09", "2026-11-20"] }, unseen: ["reader"], flags: ["imported"] };
    const code = await encodeProgress(p);
    assert.ok(code.startsWith(CODE_PREFIX));
    assert.ok(code.length < 4_000, `600 stories fit a short code (${code.length} characters)`);
    const back = await decodeProgress(`  ${code.slice(0, 40)}\n${code.slice(40)} `);
    assert.deepEqual(back, { ...p, unseen: [] });
  });

  it("refuses anything that is not a whole, valid code", async () => {
    const good = await encodeProgress(emptyProgress());
    for (const bad of ["", "hello", "ILTOD1.", "ILTOD1.!!!", good.slice(0, -6), "ILTOD2." + good.slice(CODE_PREFIX.length)]) assert.equal(await decodeProgress(bad), null, bad);
  });

  it("a hand-made value with wrong types becomes a safe one", () => {
    const p = sanitizeProgress({ v: 1, xp: 50, reads: "9", readIds: [1, "x", 2], topics: { a: 3, b: "no" }, badges: { reader: ["2026-01-01", 7], junk: "x" }, sections: { budget: { days: 2, last: "bad" } }, flags: "no" });
    assert.ok(p);
    assert.deepEqual([p.xp, p.reads, p.readIds, p.topics, p.badges, p.sections, p.flags], [50, 0, [1, 2], { a: 3 }, { reader: ["2026-01-01"] }, {}, []]);
    assert.equal(parseProgress(JSON.stringify({ v: 1, xp: -5 })).xp, 0);
  });
});
