import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import type { DB } from "@/db";

process.env.DATABASE_URL = "pglite:memory";

/**
 * The public API routes that write (audit T-4): what they refuse before any work is done, and
 * the push renewal that may move another row only with that row's auth secret (audit S-6).
 */
const VALID_P256DH = "BPe38kOyL4cN8Pnaf-62lVPknyC-N67sYFzhYzlsJe95AtVhV6QyPxF3hAQNkuF09ZNwAsJ7ynGxjWxxULF6nhM";
const AUTH = "c2VjcmV0LWF1dGgta2V5IQ";

function post(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://iltodmedee.mn${path}`, { method: "POST", body, headers: { "content-type": "application/json", origin: "https://iltodmedee.mn", ...headers } });
}

describe("public API routes (PGlite)", () => {
  let db: DB;
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

  it("/api/revalidate: null, arrays and a malformed nonce are refused before the database", async () => {
    const { POST } = await import("@/app/api/revalidate/route");
    assert.equal((await POST(post("/api/revalidate", "null"))).status, 400);
    assert.equal((await POST(post("/api/revalidate", "[1]"))).status, 400);
    assert.equal((await POST(post("/api/revalidate", '{"nonce":"x"}'))).status, 403);
    assert.equal((await POST(post("/api/revalidate", JSON.stringify({ nonce: "a".repeat(64) })))).status, 403, "no stored nonce");
  });

  it("/api/push: only same-site JSON is taken", async () => {
    const { POST } = await import("@/app/api/push/route");
    const body = JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/a1", keys: { p256dh: VALID_P256DH, auth: AUTH } });
    assert.equal((await POST(post("/api/push", body, { "content-type": "text/plain" }))).status, 415);
    assert.equal((await POST(post("/api/push", body, { origin: "https://evil.example" }))).status, 403);
    assert.equal((await POST(post("/api/push", body, { "x-forwarded-for": "203.0.113.9" }))).status, 200);
  });

  it("a renewal moves the old row only with its auth secret", async () => {
    const { storeSubscription } = await import("@/lib/push/store");
    const keys = { p256dh: VALID_P256DH, auth: AUTH };
    await storeSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/victim", keys }, null);
    await db.execute(sql`update push_subscriptions set follow_politicians = '{7}' where endpoint = 'https://fcm.googleapis.com/fcm/send/victim'`);

    await storeSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/attacker", keys: { ...keys, auth: "b3RoZXItYXV0aC1zZWNyZXQ" } }, { endpoint: "https://fcm.googleapis.com/fcm/send/victim", auth: "d3JvbmctYXV0aC1zZWNyZXQ" });
    // Posting other keys over the stored endpoint is refused, so they cannot be used as proof next.
    assert.equal(await storeSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/victim", keys: { ...keys, auth: "b3RoZXItYXV0aC1zZWNyZXQ" } }, null), false);
    assert.equal(await storeSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/victim", keys }, null), true, "a retry with the same keys is fine");
    const left = (await db.execute(sql`select endpoint from push_subscriptions where endpoint like '%victim'`)).rows;
    assert.equal(left.length, 1, "a wrong auth secret deletes nothing");

    await storeSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/renewed", keys }, { endpoint: "https://fcm.googleapis.com/fcm/send/victim", auth: AUTH });
    const rows = (await db.execute(sql`select endpoint, follow_politicians as f from push_subscriptions where endpoint like '%victim' or endpoint like '%renewed'`)).rows as { endpoint: string; f: number[] }[];
    assert.deepEqual(
      rows.map((r) => [r.endpoint.split("/").pop(), r.f]),
      [["renewed", [7]]],
    );
  });
});
