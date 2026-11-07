import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import type { DB } from "@/db";
import { dailySpendUsd } from "@/lib/ai/usage-log";
import { collectCore, collectIntegrity, collectSocial, collectVideosAndPress } from "@/lib/health-collect";
import { sourceHealth } from "@/lib/scraper/db-sink";

process.env.DATABASE_URL = "pglite:memory";

const NOW = new Date("2026-11-07T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

let db: DB;
let seq = 0;

const source = (domain: string, active: boolean, failures: number) =>
  db.execute(sql`insert into sources (name, domain, url_pattern, category, is_active, consecutive_failures, last_error)
    values (${domain}, ${domain}, '/', 'ministry', ${active}, ${failures}, ${failures ? "timeout" : null})`);

async function article(domain: string, o: { published?: boolean; tldr?: string | null; fallback?: boolean; createdH: number; undated?: boolean; hash?: string }) {
  seq++;
  await db.execute(sql`insert into articles (source_id, title, slug, original_url, content_hash, clean_content, is_published, tldr_summary, summary_fallback, scrape_meta, published_at, created_at)
    values ((select id from sources where domain = ${domain}), ${"t" + seq}, ${"s" + seq}, ${"https://x/" + seq}, ${o.hash ?? "h" + seq}, 'text',
      ${o.published ?? true}, ${o.tldr === undefined ? "summary" : o.tldr}, ${o.fallback ?? false},
      ${o.undated ? JSON.stringify({ date_unknown: true }) : null}::text::jsonb, ${ago(o.createdH).toISOString()}::timestamptz, ${ago(o.createdH).toISOString()}::timestamptz)`);
}

const usage = (provider: string, usd: number, at: string) =>
  db.execute(sql`insert into ai_usage_logs (provider, model, purpose, estimated_cost_usd, created_at) values (${provider}, 'm', 'tier1', ${usd}, ${at}::timestamptz)`);

const post = (platform: string, kind: string, ref: number, id: string | null, hoursAgo: number) =>
  db.execute(sql`insert into social_posts (platform, kind, ref_id, post_id, created_at) values (${platform}, ${kind}, ${ref}, ${id}, ${ago(hoursAgo).toISOString()}::timestamptz)`);

describe("watchdog collectors (PGlite)", () => {
  before(async () => {
    const { getDb } = await import("@/db");
    const { migrateDemo } = await import("@/db/demo-migrate");
    db = getDb();
    await migrateDemo(db);

    await source("ok.gov.mn", true, 0);
    await source("failing.gov.mn", true, 2);
    await source("off.gov.mn", false, 5);
    await source("silent.gov.mn", true, 0);
    await source("undated.gov.mn", true, 0);

    await article("ok.gov.mn", { createdH: 2 }); // published, AI
    await article("ok.gov.mn", { createdH: 1, fallback: true, undated: true }); // newest published, fallback
    await article("ok.gov.mn", { createdH: 0.5, published: false }); // withdrawn: never the "newest"
    await article("ok.gov.mn", { createdH: 5, tldr: null }); // backlog
    await article("ok.gov.mn", { createdH: 72, tldr: "x undefined x" }); // broken AI text
    await article("ok.gov.mn", { createdH: 100, hash: "dup" });
    await article("ok.gov.mn", { createdH: 101, hash: "dup" }); // duplicate hash
    for (let i = 0; i < 10; i++) {
      await article("silent.gov.mn", { createdH: 24 + i, published: false }); // dated, recent, none published
      await article("undated.gov.mn", { createdH: 24 + i, published: false, undated: true }); // undated archive: not silent
    }

    // The guard's day is UTC. 23:50 and 00:10 UTC straddle the UTC midnight (but not Ulaanbaatar's).
    await usage("groq", 0.2, "2026-11-06T23:50:00Z");
    await usage("deepseek", 0.2, "2026-11-07T00:10:00Z");
    await usage("deepseek", 0.3, "2026-11-04T10:00:00Z"); // one day at the cap
    await usage("elevenlabs", 1, "2026-11-05T10:00:00Z"); // prepaid voice: not part of the guard

    await post("facebook", "article", 1, "fb-1", 3);
    await post("facebook", "video", 2, "unknown", 24);
    await post("facebook", "wquiz", 3, "unknown", 240); // older than 7 days
    await post("threads", "article", 4, null, 1); // reserved
    await post("instagram", "article", 5, "failed:1", 1);
    await post("instagram", "video", 6, "ig-1", 5);
  });
  after(async () => {
    const { closeDb } = await import("@/db");
    await closeDb();
  });

  it("source health counts failing among active sources only", async () => {
    assert.deepEqual(await sourceHealth(db), { active: 4, failing: 1 });
  });

  it("dailySpendUsd uses UTC days and leaves the prepaid voice out", async () => {
    assert.deepEqual(await dailySpendUsd(db, 7, NOW), [0, 0, 0, 0.3, 0, 0.2, 0.2]);
  });

  it("core: owner rules for newest/AI/backlog/24h and the paid cap day", async () => {
    const c = await collectCore(db, NOW, 0.3);
    assert.equal(Math.round(c.hoursSinceArticle! * 10) / 10, 1);
    assert.equal(Math.round(c.hoursSinceAi!), 2);
    assert.equal(c.aiBacklog, 1);
    assert.equal(c.published24h, 3);
    assert.equal(c.fallback24h, 1);
    assert.equal(c.activeSources, 4);
    assert.equal(c.failingSources, 1);
    assert.equal(c.hoursSinceDigest, null);
    assert.equal(c.pushSubs, 0);
    assert.deepEqual(c.recentDigests, []);
    // 0.30 on Nov 4 only; 0.2 + 0.2 on either side of the UTC midnight stay below 0.27.
    assert.equal(c.paidCapDays, 1);
    assert.equal(c.hoursSinceRecheck, null);
    assert.ok(c.dbMb >= 0);
  });

  it("integrity: broken text, duplicate hashes, silent dated sources", async () => {
    const i = await collectIntegrity(db, NOW);
    assert.equal(i.brokenAiText, 1);
    assert.equal(i.duplicateHashes, 1);
    assert.equal(i.widespreadClusters, 0);
    assert.deepEqual(i.silentSources, ["silent.gov.mn"]);
  });

  it("social: only a real post id counts, unknown is counted for 7 days", async () => {
    const s = await collectSocial(db, NOW);
    assert.equal(s.facebook?.hoursSinceOk, 3);
    assert.equal(s.facebook?.unknown7d, 1);
    assert.equal(s.threads?.hoursSinceOk, null);
    assert.equal(s.instagram?.hoursSinceOk, 5);
    assert.equal(s.instagram?.unknown7d, 0);
  });

  it("videos: per platform the newest video really posted", async () => {
    const v = await collectVideosAndPress(db, NOW);
    assert.equal(v.videos.hoursSinceVideo, null);
    assert.equal(v.videos.hoursSincePost.instagram, 5);
    assert.equal(v.videos.hoursSincePost.facebook, undefined); // its only video row is "unknown"
    assert.ok(Object.values(v.press).every((h) => h === null));
  });
});
