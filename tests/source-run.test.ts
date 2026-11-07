import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import type { DB } from "@/db";
import { NO_ARTICLES_REASON, SourceRun, type Verdict } from "@/lib/scraper/source-run";

// In-memory database: this file runs in its own process, so the env change stays here.
process.env.DATABASE_URL = "pglite:memory";

type Shape = (r: SourceRun) => void;
const fresh = () => new SourceRun(1, "example.gov.mn");
const ok: Verdict = { kind: "ok" };
const keeps: Verdict = { kind: "keepsPlace" };
const failing = (reason: string): Verdict => ({ kind: "failing", reason });

/** One outcome told the way the HTML crawl reports it and the way the API loop does. */
const cases: { name: string; html: Shape; api: Shape; expect: Verdict }[] = [
  {
    name: "healthy: an article was stored (one more request failed)",
    html: (r) => (r.queued(2), r.stored(), r.pageFailed("HTTP 403"), r.reached()),
    api: (r) => (r.queued(), r.stored(), r.queued(), r.pageFailed("HTTP 403"), r.reached()),
    expect: ok,
  },
  {
    name: "healthy: the listing only had articles we already stored",
    html: (r) => (r.known(8), r.reached()),
    api: (r) => (r.known(8), r.reached()),
    expect: ok,
  },
  {
    name: "healthy: the new article turned out to be a duplicate text",
    html: (r) => (r.queued(), r.duplicate(), r.reached()),
    api: (r) => (r.queued(), r.duplicate(), r.reached()),
    expect: ok,
  },
  {
    name: "healthy: new pages without text (photo posts) are not failures",
    html: (r) => (r.queued(2), r.reached()),
    api: (r) => (r.queued(2), r.reached()),
    expect: ok,
  },
  {
    name: "failing: every article request failed (403)",
    html: (r) => (r.queued(3), r.pageFailed("HTTP 403"), r.pageFailed("HTTP 403"), r.pageFailed("HTTP 403"), r.reached()),
    api: (r) => (r.queued(), r.pageFailed("HTTP 403"), r.queued(), r.pageFailed("HTTP 403"), r.queued(), r.pageFailed("HTTP 403"), r.reached()),
    expect: failing("every article request failed: HTTP 403"),
  },
  {
    name: "failing: known items listed, but every new request failed",
    html: (r) => (r.known(5), r.queued(2), r.pageFailed("timeout"), r.pageFailed("timeout"), r.reached()),
    api: (r) => (r.known(5), r.queued(), r.pageFailed("timeout"), r.queued(), r.pageFailed("timeout"), r.reached()),
    expect: failing("every article request failed: timeout"),
  },
  {
    name: "healthy: some of the new requests worked, some failed, nothing new stored",
    html: (r) => (r.queued(3), r.pageFailed("timeout"), r.reached()),
    api: (r) => (r.queued(), r.pageFailed("timeout"), r.queued(), r.queued(), r.reached()),
    expect: ok,
  },
  {
    name: "failing: listing reached but nothing queued and nothing known",
    html: (r) => r.reached(),
    api: (r) => r.reached(),
    expect: failing(NO_ARTICLES_REASON),
  },
  {
    name: "failing: every slot was given back (robots refused the articles)",
    html: (r) => (r.queued(2), r.unqueued(2), r.reached()),
    api: (r) => (r.queued(2), r.unqueued(2), r.reached()),
    expect: failing(NO_ARTICLES_REASON),
  },
  {
    name: "failing: robots.txt unavailable, with its reason",
    html: (r) => (r.failed("listing failed: robots.txt unreachable (ETIMEDOUT)"), r.reached()),
    api: (r) => (r.failed("listing failed: robots.txt unreachable (ETIMEDOUT)"), r.reached()),
    expect: failing("listing failed: robots.txt unreachable (ETIMEDOUT)"),
  },
  {
    name: "failing: the listing request failed",
    html: (r) => (r.failed("fetch failed ← connect ETIMEDOUT"), r.reached()),
    api: (r) => (r.failed("fetch failed ← connect ETIMEDOUT"), r.reached()),
    expect: failing("fetch failed ← connect ETIMEDOUT"),
  },
  {
    name: "failing: a listing error with nothing stored beats an empty count",
    html: (r) => (r.needsBrowser(), r.failed("no article links in HTML"), r.reached()),
    api: (r) => (r.failed("no article links in HTML"), r.reached()),
    expect: failing("no article links in HTML"),
  },
  {
    name: "recovered: an earlier error is cleared once links are found",
    html: (r) => (r.failed("listing failed: x"), r.recovered(), r.queued(), r.stored(), r.reached()),
    api: (r) => (r.failed("listing failed: x"), r.recovered(), r.queued(), r.stored(), r.reached()),
    expect: ok,
  },
  {
    name: "keepsPlace: not reached before the time budget ran out",
    html: (r) => r.pending(),
    api: (r) => r.notReached(),
    expect: keeps,
  },
  {
    name: "keepsPlace: a section page is still outstanding",
    html: (r) => (r.queued(), r.stored(), r.pending()),
    api: (r) => (r.queued(), r.stored(), r.notReached()),
    expect: keeps,
  },
  {
    name: "keepsPlace: JavaScript-only listing, no HTTP error, browser pass could not run",
    html: (r) => (r.needsBrowser(), r.reached(), r.browserUnavailable()),
    api: (r) => (r.needsBrowser(), r.reached(), r.browserUnavailable()),
    expect: keeps,
  },
  {
    name: "recorded: JavaScript listing with an HTTP error is not held back when the browser could not run",
    html: (r) => (r.needsBrowser(), r.failed("listing failed: 404"), r.reached(), r.browserUnavailable()),
    api: (r) => (r.needsBrowser(), r.failed("listing failed: 404"), r.reached(), r.browserUnavailable()),
    expect: failing("listing failed: 404"),
  },
  {
    name: "recorded: JavaScript listing with something stored is not held back when the browser could not run",
    html: (r) => (r.needsBrowser(), r.queued(), r.stored(), r.reached(), r.browserUnavailable()),
    api: (r) => (r.needsBrowser(), r.queued(), r.stored(), r.reached(), r.browserUnavailable()),
    expect: ok,
  },
  {
    name: "recorded: no JavaScript listing, so a skipped browser pass changes nothing",
    html: (r) => (r.reached(), r.browserUnavailable()),
    api: (r) => (r.reached(), r.browserUnavailable()),
    expect: failing(NO_ARTICLES_REASON),
  },
];

describe("source run verdict", () => {
  for (const c of cases) {
    it(`${c.name} (HTML-shaped)`, () => {
      const r = fresh();
      c.html(r);
      assert.deepEqual(r.verdict(), c.expect);
    });
    it(`${c.name} (API-shaped)`, () => {
      const r = fresh();
      c.api(r);
      assert.deepEqual(r.verdict(), c.expect);
    });
  }

  it("a run that has reported nothing has not reached its source", () => {
    assert.deepEqual(fresh().verdict(), keeps);
  });

  it("the result carries the counts the summary prints and the verdict recording reads", () => {
    const r = fresh();
    r.known(4);
    r.queued(2);
    r.stored();
    r.duplicate();
    r.reached();
    assert.deepEqual(r.result(), { sourceId: 1, domain: "example.gov.mn", found: 2, inserted: 1, skippedDuplicates: 5, verdict: ok });
  });
});

type Row = Record<string, unknown>;
let db: DB;
const rows = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: Row[] }).rows;

describe("recording verdicts and the queue (PGlite)", () => {
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

  const add = async (domain: string, extra: { lastScrapedAt?: string | null; failures?: number; active?: boolean } = {}) =>
    Number(
      (
        await rows(sql`
          insert into sources (name, domain, url_pattern, category, last_scraped_at, consecutive_failures, is_active)
          values (${domain}, ${domain}, ${`https://${domain}`}, 'ministry', ${extra.lastScrapedAt ?? null}, ${extra.failures ?? 0}, ${extra.active ?? true})
          returning id`)
      )[0].id,
    );
  const state = async (id: number) => (await rows(sql`select last_error, consecutive_failures, last_scraped_at from sources where id = ${id}`))[0];

  it("failing counts a failure and keeps the reason; ok clears both; keepsPlace writes nothing", async () => {
    const { recordSourceResults } = await import("@/lib/scraper/db-sink");
    const a = await add("rec-a.gov.mn");
    const b = await add("rec-b.gov.mn", { failures: 2, lastScrapedAt: "2026-01-01T00:00:00Z" });
    const c = await add("rec-c.gov.mn", { failures: 1, lastScrapedAt: "2026-01-02T00:00:00Z" });

    await recordSourceResults(db, [
      { sourceId: a, verdict: failing("every article request failed: HTTP 403") },
      { sourceId: b, verdict: ok },
      { sourceId: c, verdict: keeps },
    ]);
    const sa = await state(a);
    assert.equal(sa.last_error, "every article request failed: HTTP 403");
    assert.equal(Number(sa.consecutive_failures), 1);
    assert.ok(sa.last_scraped_at);
    const sb = await state(b);
    assert.equal(sb.last_error, null);
    assert.equal(Number(sb.consecutive_failures), 0);
    const sc = await state(c);
    assert.equal(Number(sc.consecutive_failures), 1, "a source that keeps its place is not touched");
    assert.equal(new Date(String(sc.last_scraped_at)).toISOString(), "2026-01-02T00:00:00.000Z");

    // A second failure makes it two: backoff grows.
    await recordSourceResults(db, [{ sourceId: a, verdict: failing("listing failed: HTTP 404") }]);
    const sa2 = await state(a);
    assert.equal(Number(sa2.consecutive_failures), 2);
    assert.equal(sa2.last_error, "listing failed: HTTP 404");
  });

  it("a reason is cut to 500 characters", async () => {
    const { recordSourceResults } = await import("@/lib/scraper/db-sink");
    const id = await add("rec-long.gov.mn");
    await recordSourceResults(db, [{ sourceId: id, verdict: failing("x".repeat(900)) }]);
    assert.equal(String((await state(id)).last_error).length, 500);
  });

  it("loadDueSources: least recently scraped first (never scraped first), inside-backoff and inactive sources skipped", async () => {
    const { loadDueSources, backoffMs } = await import("@/lib/scraper/db-sink");
    await rows(sql`delete from sources`);
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const old = await add("q-old.gov.mn", { lastScrapedAt: hoursAgo(30) });
    const recent = await add("q-recent.gov.mn", { lastScrapedAt: hoursAgo(1) });
    const never = await add("q-never.gov.mn");
    const waiting = await add("q-waiting.gov.mn", { lastScrapedAt: hoursAgo(1), failures: 1 }); // 2 h backoff, 1 h passed
    const dueAgain = await add("q-due.gov.mn", { lastScrapedAt: hoursAgo(3), failures: 1 }); // 2 h backoff, 3 h passed
    await add("q-off.gov.mn", { active: false });

    const due = await loadDueSources(db);
    assert.deepEqual(
      due.map((s) => s.id),
      [never, old, dueAgain, recent],
    );
    assert.ok(!due.some((s) => s.id === waiting));
    assert.equal(backoffMs(1), 2 * 3_600_000);

    // Naming a domain skips the backoff (a manual run).
    const named = await loadDueSources(db, ["q-waiting.gov.mn"]);
    assert.deepEqual(named.map((s) => s.id), [waiting]);
  });
});
