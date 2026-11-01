import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import type { DB } from "@/db";

// In-memory database: this file runs in its own process, so the env change stays here.
process.env.DATABASE_URL = "pglite:memory";

let db: DB;
let sourceId: number;
let legalId: number;

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: Row[] }).rows;
const one = async (q: ReturnType<typeof sql>) => (await rows(q))[0];

async function article(opts: { url: string; daysOld: number; published?: boolean; importance?: number | null; tldr?: boolean; cluster?: number | null; edited?: boolean; source?: number; text?: string }) {
  const created = sql`now() - make_interval(days => ${opts.daysOld})`;
  const text = opts.text ?? `Text of ${opts.url} `.repeat(80);
  const [r] = await rows(sql`insert into articles (source_id, title, slug, original_url, content_hash, clean_content, is_published, importance_score, tldr_summary, cluster_id, edited_at, published_at, created_at)
    values (${opts.source ?? sourceId}, ${`Title ${opts.url}`}, ${opts.url.replace(/\W+/g, "-")}, ${opts.url}, md5(${text}) || md5(${opts.url}), ${text},
      ${opts.published ?? true}, ${opts.importance === undefined ? 50 : opts.importance}, ${opts.tldr ? "summary" : null}, ${opts.cluster ?? null},
      ${opts.edited ? sql`now()` : null}, ${created}, ${created}) returning id`);
  return Number(r.id);
}

const exists = async (url: string) => Number((await one(sql`select count(*)::int as n from articles where original_url = ${url}`)).n) === 1;
const seen = async (url: string) => Number((await one(sql`select count(*)::int as n from seen_urls where original_url = ${url}`)).n) === 1;

describe("database retention (db:prune)", () => {
  before(async () => {
    const { getDb } = await import("@/db");
    const { migrateDemo } = await import("@/db/demo-migrate");
    db = getDb();
    await migrateDemo(db);
    sourceId = Number((await one(sql`insert into sources (name, domain, url_pattern, category) values ('Яам', 'yam.gov.mn', 'https://yam.gov.mn', 'ministry') returning id`)).id);
    legalId = Number((await one(sql`insert into sources (name, domain, url_pattern, category) values ('Эрх зүйн мэдээлэл', 'legalinfo.mn', 'https://legalinfo.mn', 'ministry') returning id`)).id);
  });

  after(async () => {
    const { closeDb } = await import("@/db");
    await closeDb();
  });

  it("tightens itself as the database grows", async () => {
    const { retentionPlan } = await import("@/lib/retention");
    assert.deepEqual(retentionPlan(22), { bodyDays: 180, unpublishedDays: 90, deleteOldStories: false });
    assert.deepEqual(retentionPlan(22, 365), { bodyDays: 365, unpublishedDays: 90, deleteOldStories: false });
    assert.deepEqual(retentionPlan(22, 5), { bodyDays: 30, unpublishedDays: 90, deleteOldStories: false }, "never below 30 days");
    assert.deepEqual(retentionPlan(22, Number("x")), { bodyDays: 180, unpublishedDays: 90, deleteOldStories: false }, "a junk variable falls back");
    assert.deepEqual(retentionPlan(360), { bodyDays: 90, unpublishedDays: 30, deleteOldStories: false });
    assert.deepEqual(retentionPlan(430), { bodyDays: 45, unpublishedDays: 30, deleteOldStories: true });
  });

  it("deletes old unpublished rows, remembers them, and the scraper still skips them", async () => {
    const { deleteUnpublished } = await import("@/lib/retention");
    const { createDbSink } = await import("@/lib/scraper/db-sink");
    const oldText = "Цэсний хуудас. ".repeat(60);
    await article({ url: "https://yam.gov.mn/menu", daysOld: 100, published: false, tldr: true, text: oldText });
    await article({ url: "https://yam.gov.mn/fresh-menu", daysOld: 10, published: false });
    await article({ url: "https://yam.gov.mn/edited", daysOld: 100, published: false, edited: true });
    const clusterId = Number((await one(sql`insert into clusters (title) values ('c') returning id`)).id);
    await article({ url: "https://yam.gov.mn/clustered", daysOld: 100, published: false, cluster: clusterId });
    await article({ url: "https://yam.gov.mn/story", daysOld: 100 });

    assert.deepEqual(await deleteUnpublished(db, 90, true), { rows: 1, analyzed: 1 }, "dry run counts");
    assert.ok(await exists("https://yam.gov.mn/menu"), "dry run changes nothing");
    assert.deepEqual(await deleteUnpublished(db, 90), { rows: 1, analyzed: 1 });
    assert.ok(!(await exists("https://yam.gov.mn/menu")));
    assert.ok(await seen("https://yam.gov.mn/menu"));
    for (const kept of ["fresh-menu", "edited", "clustered", "story"]) assert.ok(await exists(`https://yam.gov.mn/${kept}`), kept);

    const sink = createDbSink(db);
    const fresh = await sink.filterNewUrls(["https://yam.gov.mn/menu", "https://yam.gov.mn/new"]);
    assert.deepEqual([...fresh], ["https://yam.gov.mn/new"], "a deleted URL is not fetched again");
    const source = { id: sourceId, name: "Яам", domain: "yam.gov.mn" };
    // The same text under another URL is still a duplicate (hash kept in seen_urls).
    const { contentHash } = await import("@/lib/text");
    await db.execute(sql`update seen_urls set content_hash = ${contentHash(oldText)} where original_url = 'https://yam.gov.mn/menu'`);
    const result = await sink.save(source as never, { url: "https://yam.gov.mn/menu-copy", title: "Цэсний хуудас шинэ", text: oldText } as never);
    assert.equal(result, "duplicate");
  });

  it("deletes old minor stories only past 420 MB, never important, clustered, legal or digest ones", async () => {
    const { deleteOldStories } = await import("@/lib/retention");
    const clusterId = Number((await one(sql`insert into clusters (title) values ('c2') returning id`)).id);
    await article({ url: "https://yam.gov.mn/old-minor", daysOld: 800, importance: 20, tldr: true });
    await article({ url: "https://yam.gov.mn/old-null", daysOld: 800, importance: null });
    await article({ url: "https://yam.gov.mn/old-important", daysOld: 800, importance: 70 });
    await article({ url: "https://yam.gov.mn/old-clustered", daysOld: 800, importance: 20, cluster: clusterId });
    await article({ url: "https://legalinfo.mn/old-law", daysOld: 800, importance: 20, source: legalId });
    await article({ url: "https://yam.gov.mn/recent-minor", daysOld: 300, importance: 20 });
    const inDigest = await article({ url: "https://yam.gov.mn/old-digest", daysOld: 800, importance: 20 });
    await db.execute(sql`insert into digests (kind, period_start, period_end, title, intro, items, generated_by)
      values ('12h', now(), now(), 't', 'i', ${JSON.stringify([{ articleId: inDigest, slug: "x" }])}::jsonb, 'rule-based')`);

    assert.deepEqual(await deleteOldStories(db), { rows: 2, analyzed: 1 });
    assert.ok(!(await exists("https://yam.gov.mn/old-minor")));
    assert.ok(!(await exists("https://yam.gov.mn/old-null")), "unknown importance counts as minor once two years old");
    assert.ok(await seen("https://yam.gov.mn/old-minor"));
    for (const kept of ["https://yam.gov.mn/old-important", "https://yam.gov.mn/old-clustered", "https://legalinfo.mn/old-law", "https://yam.gov.mn/recent-minor", "https://yam.gov.mn/old-digest"]) {
      assert.ok(await exists(kept), kept);
    }
  });

  it("never cuts an edited body", async () => {
    const { pruneBodies } = await import("@/lib/retention");
    await db.execute(sql`insert into articles (source_id, title, slug, original_url, content_hash, clean_content, published_at, created_at, edited_at)
      values (${sourceId}, 'Засварласан', 'edited-old', 'https://yam.gov.mn/edited-old', md5('edited-old'), repeat('ө', 3000), now() - interval '400 days', now() - interval '400 days', now() - interval '300 days')`);
    await pruneBodies(db, 180);
    const [r] = await rows(sql`select length(clean_content)::int as len, content_pruned_at from articles where original_url = 'https://yam.gov.mn/edited-old'`);
    assert.equal(r.len, 3000);
    assert.equal(r.content_pruned_at, null);
  });

  it("cuts old bodies in batches", async () => {
    const { BATCH, EXCERPT_CHARS, pruneBodies } = await import("@/lib/retention");
    await db.execute(sql`insert into articles (source_id, title, slug, original_url, content_hash, clean_content, published_at, created_at)
      select ${sourceId}, 'Бөөн ' || g, 'bulk-' || g, 'https://yam.gov.mn/bulk/' || g, md5(g::text), repeat('ү', 2000), now() - interval '200 days', now() - interval '200 days'
      from generate_series(1, ${BATCH + 3}) as g`);
    const before = Number((await one(sql`select count(*)::int as n from articles where content_pruned_at is null and edited_at is null and created_at < now() - interval '180 days' and length(clean_content) > ${EXCERPT_CHARS}`)).n);
    assert.equal(await pruneBodies(db, 180, true), before);
    assert.equal(await pruneBodies(db, 180), before, "more than one batch");
    const [r] = await rows(sql`select max(length(clean_content))::int as len, count(*)::int as n from articles where original_url like 'https://yam.gov.mn/bulk/%' and content_pruned_at is not null`);
    assert.equal(r.len, EXCERPT_CHARS);
    assert.equal(r.n, BATCH + 3);
    assert.equal(await pruneBodies(db, 180), 0, "a second run has nothing left");
  });

  it("deletes old AI call logs but keeps the call that wrote a living article's summary", async () => {
    const { deleteOldUsageLogs } = await import("@/lib/retention");
    const id = await article({ url: "https://yam.gov.mn/logged", daysOld: 500, tldr: true });
    const log = (purpose: string, success: boolean, articleId: number | null, months: number) =>
      db.execute(sql`insert into ai_usage_logs (provider, model, purpose, prompt_tokens, completion_tokens, success, article_id, created_at)
        values ('groq', 'm', ${purpose}, 1, 1, ${success}, ${articleId}, now() - make_interval(months => ${months}))`);
    await log("tier1", true, id, 15);
    await log("tier1", false, id, 15);
    await log("digest", true, null, 15);
    await log("tier1", true, null, 15);
    await log("digest", true, null, 2);
    assert.equal(await deleteOldUsageLogs(db), 3);
    const [r] = await rows(sql`select count(*)::int as n from ai_usage_logs`);
    assert.equal(r.n, 2);
  });

  it("records each run and keeps the running totals for the public counters", async () => {
    const { runRetention, readPruneState } = await import("@/lib/retention");
    const { deletedTotals } = await import("@/lib/queries");
    await article({ url: "https://yam.gov.mn/menu-2", daysOld: 120, published: false, tldr: true });
    const dry = await runRetention(db, { dryRun: true });
    assert.equal(dry.unpublishedDeleted, 1);
    assert.equal(await readPruneState(db), null, "a dry run stores nothing");
    const first = await runRetention(db, { configuredDays: 180 });
    assert.equal(first.unpublishedDeleted, 1);
    assert.equal(first.articlesDeletedTotal, 1);
    assert.equal(first.analyzedDeletedTotal, 1);
    await article({ url: "https://yam.gov.mn/menu-3", daysOld: 120, published: false });
    const second = await runRetention(db, { configuredDays: 180 });
    assert.equal(second.articlesDeletedTotal, 2, "totals accumulate across runs");
    assert.equal(second.analyzedDeletedTotal, 1);
    const stored = await one(sql`select value from app_settings where key = 'prune_state'`);
    assert.deepEqual(deletedTotals(String(stored.value)), { articles: 2, analyzed: 1 });
    assert.deepEqual(deletedTotals(undefined), { articles: 0, analyzed: 0 });
    assert.deepEqual(deletedTotals("{broken"), { articles: 0, analyzed: 0 });
    assert.deepEqual(deletedTotals(JSON.stringify({ articlesDeletedTotal: -4, analyzedDeletedTotal: "9" })), { articles: 0, analyzed: 0 });
  });

  it("an old month's AI total is never recomputed from pruned logs", async () => {
    const { monthRecomputable } = await import("@/lib/ai/usage-log");
    const now = new Date("2027-12-15T00:00:00Z");
    assert.ok(monthRecomputable("2027-12", now));
    assert.ok(monthRecomputable("2027-01", now));
    assert.ok(!monthRecomputable("2026-12", now));
  });
});
