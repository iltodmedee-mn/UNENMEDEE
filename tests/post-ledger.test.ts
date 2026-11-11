import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import type { DB } from "@/db";
import { UnknownOutcomeError } from "@/lib/social/outcome";
import { ABANDONED_AFTER_MS, countSince, lastRealPost, mayPost, MAX_TRIES, neverPosted, type PostKind, postedAt, publishOnce, unknownSince } from "@/lib/social/post-ledger";

process.env.DATABASE_URL = "pglite:memory";

let db: DB;
type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: Row[] }).rows;
const postId = async (platform: string, kind: string, ref: number) => {
  const [r] = await rows(sql`select post_id from social_posts where platform = ${platform} and kind = ${kind} and ref_id = ${ref}`);
  return r ? r.post_id : "NO ROW";
};
const insertRow = (platform: string, kind: string, ref: number, id: string | null, ageMs: number) =>
  db.execute(sql`insert into social_posts (platform, kind, ref_id, post_id, created_at) values (${platform}, ${kind}, ${ref}, ${id}, ${new Date(Date.now() - ageMs)})`);

/** The port: a fake platform that counts calls. */
function fake(result: string | Error = "p1") {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    publish: async () => {
      calls++;
      await new Promise((r) => setImmediate(r));
      if (result instanceof Error) throw result;
      return result;
    },
  };
}
const go = (platform: string, kind: PostKind, refId: number, f: ReturnType<typeof fake>) => publishOnce(db, { platform, kind, refId, publish: f.publish });

/** Captures console output so ::warning:: / ::error:: semantics can be asserted. */
function capture() {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  console.error = (...a: unknown[]) => void lines.push(a.join(" "));
  return { lines, restore: () => ((console.log = log), (console.error = err)) };
}

describe("platform post ledger (PGlite)", () => {
  let cap: ReturnType<typeof capture>;
  before(async () => {
    const { getDb } = await import("@/db");
    const { migrateDemo } = await import("@/db/demo-migrate");
    db = getDb();
    await migrateDemo(db);
  });
  after(async () => {
    const { closeDb } = await import("@/db");
    await closeDb();
  });
  afterEach(async () => {
    cap?.restore();
    await db.execute(sql`delete from social_posts`);
  });
  const quiet = () => (cap = capture());

  it("posts once and records the platform's id; a second call for the same ref is skipped", async () => {
    quiet();
    const a = fake("fb-1");
    assert.equal(await go("facebook", "article", 1, a), "posted");
    assert.equal(await postId("facebook", "article", 1), "fb-1");
    const b = fake("fb-2");
    assert.equal(await go("facebook", "article", 1, b), "skipped");
    assert.equal(b.calls, 0);
    assert.equal(await postId("facebook", "article", 1), "fb-1");
    // Another platform has its own row.
    assert.equal(await go("threads", "article", 1, fake("th-1")), "posted");
  });

  it("a refusal on a normal kind frees the row and rethrows, so the next run tries again", async () => {
    quiet();
    await assert.rejects(go("facebook", "article", 2, fake(new Error("Facebook 400: bad"))), /bad/);
    assert.equal(await postId("facebook", "article", 2), "NO ROW");
    const again = fake("fb-9");
    assert.equal(await go("facebook", "article", 2, again), "posted");
    assert.equal(again.calls, 1);
  });

  it("a limited kind keeps failed:n and is tried MAX_TRIES times in all, then ::error::", async () => {
    const f = fake(new Error("refused"));
    for (let n = 1; n <= MAX_TRIES; n++) {
      quiet();
      await assert.rejects(go("instagram", "video", 3, f), /refused/);
      assert.equal(await postId("instagram", "video", 3), `failed:${n}`);
      const errors = cap.lines.filter((l) => l.startsWith("::error::"));
      assert.equal(errors.length, n === MAX_TRIES ? 1 : 0, `try ${n}`);
      cap.restore();
    }
    assert.equal(f.calls, MAX_TRIES);
    quiet();
    assert.equal(await go("instagram", "video", 3, f), "skipped");
    assert.equal(f.calls, MAX_TRIES, "no fourth try");
    assert.equal(await postId("instagram", "video", 3), `failed:${MAX_TRIES}`);
  });

  it("a limited kind that succeeds after a refusal records the id", async () => {
    quiet();
    await assert.rejects(go("facebook", "wquiz", 202645, fake(new Error("x"))));
    assert.equal(await go("facebook", "wquiz", 202645, fake("album-1")), "posted");
    assert.equal(await postId("facebook", "wquiz", 202645), "album-1");
  });

  it("a retry that succeeds days later is dated when it was posted, not when it was first tried", async () => {
    quiet();
    await insertRow("facebook", "wquiz", 202646, "failed:1", 3 * 86_400_000);
    assert.equal(await go("facebook", "wquiz", 202646, fake("album-2")), "posted");
    const at = await postedAt(db, "facebook", "wquiz", 202646);
    assert.ok(at && Date.now() - at.getTime() < 60_000, `postedAt ${at?.toISOString()} is the retry's time`);
  });

  it("an UnknownOutcomeError keeps the row as unknown with a ::warning:: and is never retried", async () => {
    quiet();
    const f = fake(new UnknownOutcomeError("publish answer lost: timeout"));
    assert.equal(await go("threads", "article", 4, f), "unknown");
    assert.equal(await postId("threads", "article", 4), "unknown");
    assert.ok(cap.lines.some((l) => l.startsWith("::warning::threads article #4")));
    const g = fake("th-2");
    assert.equal(await go("threads", "article", 4, g), "skipped");
    assert.equal(g.calls, 0);
  });

  it("a reservation with no id older than the limit becomes unknown (warning) and is not reposted", async () => {
    quiet();
    await insertRow("discord", "digest", 5, null, ABANDONED_AFTER_MS + 60_000);
    const f = fake("d-1");
    assert.equal(await go("discord", "digest", 5, f), "skipped");
    assert.equal(f.calls, 0);
    assert.equal(await postId("discord", "digest", 5), "unknown");
    assert.ok(cap.lines.some((l) => l.startsWith("::warning::discord digest #5")));
    // Asking again is quiet: it is already unknown.
    cap.lines.length = 0;
    assert.equal(await go("discord", "digest", 5, f), "skipped");
    assert.ok(!cap.lines.some((l) => l.startsWith("::warning::")));
  });

  it("a fresh reservation (30 min) is left alone: a run may still be publishing", async () => {
    quiet();
    await insertRow("discord", "digest", 6, null, 30 * 60_000);
    const f = fake("d-2");
    assert.equal(await go("discord", "digest", 6, f), "skipped");
    assert.equal(f.calls, 0);
    assert.equal(await postId("discord", "digest", 6), null);
    assert.ok(!cap.lines.some((l) => l.startsWith("::warning::")));
  });

  it("two concurrent posts of one ref publish only once", async () => {
    quiet();
    const f = fake("tg-1");
    const [a, b] = await Promise.all([go("telegram", "article", 7, f), go("telegram", "article", 7, f)]);
    assert.deepEqual([a, b].sort(), ["posted", "skipped"]);
    assert.equal(f.calls, 1);
  });

  it("two concurrent retries of one failed:n row claim it once", async () => {
    quiet();
    await insertRow("facebook", "video", 8, "failed:1", 3_600_000);
    const f = fake("reel-1");
    const [a, b] = await Promise.all([go("facebook", "video", 8, f), go("facebook", "video", 8, f)]);
    assert.deepEqual([a, b].sort(), ["posted", "skipped"]);
    assert.equal(f.calls, 1);
  });

  describe("read side", () => {
    it("neverPosted / mayPost / postedAt / countSince answer for a mix of rows", async () => {
      quiet();
      await insertRow("facebook", "video", 10, "reel-10", 3_600_000);
      await insertRow("facebook", "video", 11, "failed:1", 3_600_000);
      await insertRow("facebook", "video", 12, `failed:${MAX_TRIES}`, 3_600_000);
      await insertRow("facebook", "video", 13, null, 60_000);
      await insertRow("facebook", "video", 14, "unknown", 3_600_000);
      await insertRow("threads", "video", 15, "t-15", 3_600_000);
      const ids = (cond: ReturnType<typeof sql>) => rows(sql`select v from generate_series(10, 16) v where ${cond} order by v`).then((r) => r.map((x) => Number(x.v)));
      assert.deepEqual(await ids(sql`${neverPosted("facebook", "video", sql`v`)}`), [15, 16], "any row at all counts as taken");
      assert.deepEqual(await ids(sql`${mayPost("facebook", "video", sql`v`)}`), [11, 15, 16], "a refusal below the limit may be retried; nothing else");
      assert.ok(await postedAt(db, "facebook", "video", 10));
      assert.equal(await postedAt(db, "facebook", "video", 11), null, "a refusal is not a post");
      assert.equal(await postedAt(db, "facebook", "video", 99), null);
      assert.equal(await countSince(db, "facebook", "video", new Date(Date.now() - 2 * 3_600_000)), 5);
      assert.equal(await countSince(db, "facebook", "video", new Date(Date.now() - 1_800_000)), 1);
      assert.equal(await countSince(db, "facebook", "article", new Date(0)), 0);
    });

    it("lastRealPost ignores reservations, unknown and failed rows; unknownSince counts the window", async () => {
      quiet();
      await insertRow("instagram", "article", 20, "ig-old", 5 * 3_600_000);
      await insertRow("instagram", "article", 21, "ig-new", 2 * 3_600_000);
      await insertRow("instagram", "article", 22, "unknown", 1 * 3_600_000);
      await insertRow("instagram", "video", 23, "failed:2", 60_000);
      await insertRow("instagram", "article", 24, null, 30_000);
      const last = await lastRealPost(db, "instagram");
      assert.ok(last);
      assert.ok(Math.abs(Date.now() - last.getTime() - 2 * 3_600_000) < 60_000, "the newest real post is ig-new");
      assert.equal(await lastRealPost(db, "instagram", "video"), null);
      assert.equal(await lastRealPost(db, "discord"), null);
      await insertRow("threads", "article", 25, "unknown", 10 * 86_400_000);
      await insertRow("threads", "article", 26, "unknown", 86_400_000);
      assert.deepEqual(await unknownSince(db, 7), { instagram: 1, threads: 1 });
      assert.deepEqual(await unknownSince(db, 30), { instagram: 1, threads: 2 });
    });
  });
});
