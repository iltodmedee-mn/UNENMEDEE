/**
 * Polite, resilient scraper for Mongolian government sources.
 *
 *   npm run scrape                          # all due sources (DB)
 *   npm run scrape -- --source mof.gov.mn   # one or more domains (comma separated)
 *   npm run scrape -- --dry-run --source mlsp.gov.mn --limit 2   # no DB, prints results
 *
 * Options: --limit <n> new articles per source (default 8), --budget <minutes> (default 40),
 *          --concurrency <n> parallel domains (default 8),
 *          --days <n> backfill: also collect older posts, up to n days back (use with a larger --limit),
 *          --no-browser skip the headless-Chromium pass for JavaScript-rendered sites.
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { eq } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { appSettings } from "@/db/schema";
import { API_ADAPTERS, groupByApiHost } from "@/lib/scraper/adapters";
import { crawlSources, type ArticleSink } from "@/lib/scraper/crawl";
import { createDbSink, loadDueSources, recordSourceResults } from "@/lib/scraper/db-sink";
import { SourceRun } from "@/lib/scraper/source-run";
import { parseTlsReport, TLS_BROKEN_KEY } from "@/lib/scraper/tls-exempt";
import type { ScrapedItem, SourceRef, SourceRunResult } from "@/lib/scraper/types";
import { SOURCE_SEEDS } from "@/lib/sources";
import { contentHash } from "@/lib/text";
import { errorLine, oneLine } from "@/lib/log-safe";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    source: { type: "string" },
    limit: { type: "string", default: "8" },
    budget: { type: "string", default: "40" },
    concurrency: { type: "string", default: "8" },
    days: { type: "string" },
    "no-browser": { type: "boolean", default: false },
  },
});

const dryRun = values["dry-run"];
const domains = values.source?.split(",").map((d) => d.trim()).filter(Boolean);
const perSourceLimit = Math.max(1, Number(values.limit));
const budgetMs = Math.max(1, Number(values.budget)) * 60_000;
/** Share of the run the JSON API sources may use (Nov 2026: 40 gov.mn portal sources share one 8 s host; each host has its own queue). */
const API_BUDGET_SHARE = 0.35;
const concurrency = Math.max(1, Number(values.concurrency));
const backfillDays = values.days ? Math.max(1, Math.min(90, Number(values.days) || 0)) : 0;
const since = backfillDays ? new Date(Date.now() - backfillDays * 86_400_000) : undefined;

function createDryRunSink(): ArticleSink {
  const urls = new Set<string>();
  const hashes = new Set<string>();
  return {
    async filterNewUrls(list) {
      return new Set(list.filter((u) => !urls.has(u)));
    },
    async save(source, item) {
      const hash = contentHash(item.text);
      if (urls.has(item.url) || hashes.has(hash)) return "duplicate";
      urls.add(item.url);
      hashes.add(hash);
      console.log(`\n── [${source.domain}] ${item.title}`);
      console.log(`   url:  ${item.url}`);
      console.log(`   date: ${item.publishedAt?.toISOString() ?? "—"}   sha256: ${hash.slice(0, 16)}…   chars: ${item.text.length}`);
      if (item.meta) console.log(`   meta: ${JSON.stringify(item.meta)}`);
      console.log(`   text: ${item.text.slice(0, 220).replace(/\n/g, " ")}…`);
      return "inserted";
    },
  };
}

async function runApiSource(source: SourceRef, sink: ArticleSink, fetchItems: (limit: number) => Promise<ScrapedItem[]>, deadline: number): Promise<SourceRunResult> {
  const run = new SourceRun(source.id, source.domain);
  // Past the API share of the budget: not reached, so the source keeps its place in line.
  if (Date.now() > deadline) return run.result();
  try {
    const listed = await fetchItems(perSourceLimit * 3);
    // Outside the backfill window there is nothing to read: counted as known, not as an empty listing.
    const items = listed.filter((i) => !since || (i.publishedAt !== null && i.publishedAt >= since));
    run.known(listed.length - items.length);
    const fresh = await sink.filterNewUrls(items.map((i) => i.url));
    run.known(items.length - fresh.size);
    let read = 0;
    let cutOff = false;
    for (const item of items.filter((i) => fresh.has(i.url))) {
      // The limit counts stories read, not pages tried: photo posts and failed pages do not use it up.
      if (read >= perSourceLimit) break;
      // Detail pages cost 8 s each on one host (www.gov.mn serves ~20 sources): stop at the deadline.
      if (Date.now() > deadline) {
        cutOff = true;
        break;
      }
      run.queued();
      let loaded: Awaited<ReturnType<NonNullable<ScrapedItem["loadText"]>>> | string;
      try {
        loaded = item.loadText ? await item.loadText() : item.text;
      } catch (err) {
        // One slow or failed page (a 30 s portal timeout) must not end the source: the verdict
        // fails it only when every page failed and nothing was stored.
        run.pageFailed(errorLine(err, 200));
        console.log(`  ⚠ ${source.domain}: ${oneLine(item.url, 120)}: ${errorLine(err, 160)}`);
        continue;
      }
      if (!loaded) {
        await sink.markNoText?.(source, item.url);
        continue;
      }
      read += 1;
      const full = { ...item, ...(typeof loaded === "string" ? { text: loaded } : loaded), loadText: undefined };
      if ((await sink.save(source, full)) === "inserted") run.stored();
      else run.duplicate();
    }
    // Stopped by the time budget before a single page was tried: not reached.
    if (cutOff && run.found === 0) run.notReached();
    else run.reached();
  } catch (err) {
    // One line (it reaches the Actions log and `last_error`), with the cause: "fetch failed" alone
    // hid ECONNREFUSED / ETIMEDOUT / a certificate error.
    run.failed(errorLine(err));
    run.reached();
  }
  return run.result();
}

async function main() {
  const started = Date.now();
  let sourceRefs: SourceRef[];
  let sink: ArticleSink;
  // Without a database (a dry run) nothing is exempt: a site with a broken certificate fails.
  let tlsBrokenHosts: ReadonlySet<string> = new Set();

  if (dryRun || !hasDatabase()) {
    if (!dryRun) {
      console.error("✗ DATABASE_URL is not set. Use --dry-run to test without a database.");
      process.exitCode = 1;
      return;
    }
    const seeds = SOURCE_SEEDS.filter((s) => !domains?.length || domains.includes(s.domain));
    sourceRefs = seeds.map((s, i) => ({ id: i + 1, domain: s.domain, name: s.name, urlPattern: s.urlPattern }));
    sink = createDryRunSink();
    console.log(`🧪 Dry run (no DB) over ${sourceRefs.length} source(s).`);
  } else {
    const db = getDb();
    const due = await loadDueSources(db, domains);
    sourceRefs = due.map((s) => ({ id: s.id, domain: s.domain, name: s.name, urlPattern: s.urlPattern }));
    sink = createDbSink(db, { maxAgeDays: backfillDays || undefined });
    const [tlsRow] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, TLS_BROKEN_KEY));
    tlsBrokenHosts = new Set(parseTlsReport(tlsRow?.value)?.hosts ?? []);
    if (tlsBrokenHosts.size) console.log(`🔓 ${tlsBrokenHosts.size} host(s) read without a certificate check (weekly re-check): ${[...tlsBrokenHosts].join(", ")}`);
    console.log(
      `🔎 Scraping ${sourceRefs.length} due source(s); limit ${perSourceLimit}/source; budget ${budgetMs / 60000} min${since ? `; backfill since ${since.toISOString().slice(0, 10)}` : ""}.`,
    );
  }
  if (sourceRefs.length === 0) {
    console.log("Nothing to scrape.");
    return;
  }

  const results: SourceRunResult[] = [];
  // JSON API sources first (fast), then one shared Crawlee run for every HTML site.
  // The JSON API sources get at most API_BUDGET_SHARE of the budget, so the HTML crawl always runs.
  const apiDeadline = started + budgetMs * API_BUDGET_SHARE;
  // One queue per host, run side by side: politeFetch keeps 8 s between requests to the same host.
  const apiQueues = groupByApiHost(sourceRefs.filter((s) => API_ADAPTERS[s.domain]));
  const apiResults = await Promise.all(
    apiQueues.map(async (queue) => {
      const done: SourceRunResult[] = [];
      for (const s of queue) done.push(await runApiSource(s, sink, API_ADAPTERS[s.domain], apiDeadline));
      return done;
    }),
  );
  results.push(...apiResults.flat());
  const htmlSources = sourceRefs.filter((s) => !API_ADAPTERS[s.domain]);
  if (htmlSources.length) {
    results.push(
      ...(await crawlSources(htmlSources, sink, {
        perSourceLimit,
        budgetMs: Math.max(60_000, budgetMs - (Date.now() - started)),
        concurrency,
        since,
        browser: !values["no-browser"],
        tlsBrokenHosts,
        onProgress: (m) => console.log(m),
      })),
    );
  }

  if (!dryRun) await recordSourceResults(getDb(), results);

  const inserted = results.reduce((n, r) => n + r.inserted, 0);
  const failed = results.filter((r) => r.verdict.kind === "failing");
  console.log(`\n📊 Summary (${Math.round((Date.now() - started) / 1000)}s): ${inserted} new article(s) from ${results.length} source(s).`);
  for (const r of results.sort((a, b) => b.inserted - a.inserted)) {
    const status = r.verdict.kind === "keepsPlace" ? "⏸ not reached" : r.verdict.kind === "failing" ? `✗ ${r.verdict.reason}` : "✓";
    console.log(`  ${r.domain.padEnd(28)} new=${String(r.inserted).padStart(2)} dup=${String(r.skippedDuplicates).padStart(2)} ${status}`);
  }
  if (failed.length) console.log(`\n${failed.length} source(s) failed; they back off automatically. The batch itself succeeded.`);
}

main()
  .catch((err) => {
    console.error("✗ Scraper crashed:", err);
    process.exitCode = 1;
  })
  .finally(closeDb);
