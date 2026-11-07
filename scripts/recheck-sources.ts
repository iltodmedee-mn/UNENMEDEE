/**
 * Fetches recent articles' source pages again and records whether the government site changed or
 * removed them ("Эх хуудасны өөрчлөлт", /changes). The comparison rules are in
 * src/lib/scraper/recheck.ts; robots.txt and the 8 s per-host delay come from politeFetch.
 *
 *   npm run sources:recheck -- --dry-run          # print what would be recorded
 *   npm run sources:recheck                       # last 30 days, 40-minute budget
 *   npm run sources:recheck -- --days 14 --limit 50 --budget 10
 *
 * Skipped: opendata.gov.mn (datasets), parliament.mn (JSON API), zasag.mn (RSS), and articles an
 * editor changed in /admin. Nothing but cleaned sentences is stored (never HTML).
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { and, asc, eq, gte, isNull, notInArray, sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { articles, sources } from "@/db/schema";
import { isGovMnNotFound, parseGovMnArticle } from "@/lib/scraper/adapters/govmn";
import { legalinfoDetailText } from "@/lib/scraper/adapters/legalinfo";
import { parsePoliceArticle } from "@/lib/scraper/adapters/police";
import { extractArticleSafe } from "@/lib/scraper/extract-safe";
import { htmlFragmentToText } from "@/lib/scraper/extractor";
import { API_MAX_BYTES, politeFetch, readTextLimited } from "@/lib/scraper/http";
import { isWordPress, sameSite, wordPressApiBase, wordPressPostId, wordPressPostsUrl } from "@/lib/scraper/links";
import { decide, type FetchResult, MIN_FRESH_CHARS, type SourceDiff, type SourceStatus } from "@/lib/scraper/recheck";
import { errorDetail, errorLine } from "@/lib/log-safe";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    days: { type: "string", default: "30" },
    limit: { type: "string", default: "2000" },
    budget: { type: "string", default: "40" },
  },
});
const dry = values["dry-run"];
// nhrcm.gov.mn: stories are hash routes of an Angular app, the page HTML never holds the text.
const SKIP_DOMAINS = ["opendata.gov.mn", "parliament.mn", "zasag.mn", "nhrcm.gov.mn"];
const HOSTS_IN_PARALLEL = 8;
const deadline = Date.now() + Number(values.budget) * 60_000;

interface Row {
  id: number;
  url: string;
  text: string;
  domain: string;
  status: string | null;
  missingCount: number;
  checkedAt: Date | null;
}

/**
 * The page's text, read the same way the scraper read it the first time. Never throws: the
 * timeout also covers reading the body, and one slow page used to end the whole run (Nov 2026).
 */
async function fetchText(row: Row): Promise<FetchResult> {
  try {
    return await readPage(row);
  } catch (err) {
    // Skipped, not counted as changed; but say why, or a dead source reads as "never re-read".
    console.warn(`  ⚠ #${row.id} could not be re-read: ${errorLine(err, 200)}`);
    return { kind: "error" };
  }
}

async function readPage(row: Row): Promise<FetchResult> {
  let res: Response;
  try {
    res = await politeFetch(row.url, { timeoutMs: 30_000 });
  } catch {
    return { kind: "error" }; // timeout, DNS, robots.txt disallow: proves nothing
  }
  if (res.status === 404 || res.status === 410) return { kind: "missing" };
  if (!res.ok) return { kind: "error" };
  const from = new URL(row.url);
  const to = new URL(res.url || row.url);
  // Redirected to another site or to the homepage: the article itself is gone.
  if (to.host.replace(/^www\./, "") !== from.host.replace(/^www\./, "") || (to.pathname.replace(/\/+$/, "") === "" && from.pathname.replace(/\/+$/, "") !== "")) {
    return { kind: "missing" };
  }
  const html = await readTextLimited(res, API_MAX_BYTES);
  if (row.domain === "police.gov.mn") return { kind: "text", text: parsePoliceArticle(html).text };
  if (row.domain === "legalinfo.mn") return { kind: "text", text: legalinfoDetailText(html) };
  // Stories read from the www.gov.mn portal (govmn.ts) are re-read from its page payload the same way.
  // The portal answers 200 with its "page not found" screen for a deleted story (Nov 2026 audit).
  if (from.host === "www.gov.mn") return isGovMnNotFound(html) ? { kind: "missing" } : { kind: "text", text: parseGovMnArticle(html)?.text ?? "" };
  // WordPress posts were stored from the REST API's `content.rendered` (crawl.ts handleWpApi):
  // read them the same way. Readability drops paragraphs that are on the page, which made
  // unchanged mod.gov.mn posts read as "changed" by the government (Nov 2026 audit).
  const wp = isWordPress(html) ? await wordPressText(html, row) : null;
  if (wp !== null) return { kind: "text", text: wp };
  return { kind: "text", text: (await extractArticleSafe(html, row.url))?.text ?? "" };
}

/** The post's REST content as text, or null (not a post, API closed, or another site's base). */
async function wordPressText(html: string, row: Row): Promise<string | null> {
  const id = wordPressPostId(html);
  if (!id) return null;
  const advertised = wordPressApiBase(html, row.url);
  const base = sameSite(new URL(advertised).hostname, row.domain) ? advertised : `${new URL(row.url).origin}/wp-json/`;
  try {
    const res = await politeFetch(wordPressPostsUrl(base, `include=${id}&_fields=id,content`), { timeoutMs: 30_000 });
    if (!res.ok) return null;
    const posts = JSON.parse(await res.text()) as unknown;
    const rendered = Array.isArray(posts) ? (posts[0] as { content?: { rendered?: unknown } } | undefined)?.content?.rendered : undefined;
    return typeof rendered === "string" ? htmlFragmentToText(rendered) : null;
  } catch (err) {
    console.warn(`  ⚠ WordPress post ${id} at ${base}: ${errorLine(err, 200)}`);
    return null;
  }
}

/** Fetch errors in a row after which a host's remaining rows wait for the next run. */
const MAX_HOST_ERRORS = 3;

async function main() {
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const db = getDb();
  const rows: Row[] = await db
    .select({
      id: articles.id,
      url: articles.originalUrl,
      text: articles.cleanContent,
      domain: sources.domain,
      status: articles.sourceStatus,
      missingCount: articles.sourceMissingCount,
      checkedAt: articles.sourceCheckedAt,
    })
    .from(articles)
    .innerJoin(sources, eq(articles.sourceId, sources.id))
    .where(
      and(
        eq(articles.isPublished, true),
        isNull(articles.editedAt),
        isNull(articles.contentPrunedAt),
        notInArray(sources.domain, SKIP_DOMAINS),
        gte(sql`coalesce(${articles.publishedAt}, ${articles.createdAt})`, sql`now() - make_interval(days => ${Number(values.days)})`),
      ),
    )
    .orderBy(asc(sql`coalesce(${articles.sourceCheckedAt}, 'epoch'::timestamptz)`))
    .limit(Number(values.limit));

  // One queue per host: politeFetch waits 8 s between requests to the same host anyway.
  const byHost = new Map<string, Row[]>();
  for (const r of rows) {
    const host = new URL(r.url).host;
    byHost.set(host, [...(byHost.get(host) ?? []), r]);
  }
  console.log(`🔁 ${rows.length} article(s) on ${byHost.size} site(s) to re-check${dry ? " (dry run)" : ""}.`);

  const counts: Record<SourceStatus | "skip" | "new", number> = { ok: 0, changed: 0, gone: 0, skip: 0, new: 0 };
  const skipped: Record<string, number> = {};
  const samples: string[] = [];
  const queues = [...byHost.values()];

  async function worker() {
    for (let q = queues.shift(); q; q = queues.shift()) {
      let hostErrors = 0;
      for (const [i, row] of q.entries()) {
        if (Date.now() > deadline) return;
        const result = await fetchText(row);
        // Rows that fail to fetch keep a null checked_at and stay first in line: a dead host with
        // 100 rows (30 s timeout + 8 s each) held a worker for the whole run, every week. After a
        // few errors in a row the rest of that host waits for the next run.
        if (result.kind === "error") {
          if (++hostErrors >= MAX_HOST_ERRORS) {
            const left = q.length - i - 1;
            skipped["host skipped after errors"] = (skipped["host skipped after errors"] ?? 0) + left;
            counts.skip += left;
            console.warn(`  ⚠ ${new URL(row.url).host}: ${MAX_HOST_ERRORS} fetch errors in a row, ${left} row(s) left for the next run`);
            counts.skip++;
            skipped["fetch error"] = (skipped["fetch error"] ?? 0) + 1;
            break;
          }
        } else hostErrors = 0;
        const now = new Date();
        const d = decide({ status: row.status as SourceStatus | null, missingCount: row.missingCount, checkedAt: row.checkedAt }, row.text, result, now);
        counts[d.status ?? "skip"]++;
        if (!d.status) {
          const why = result.kind === "error" ? "fetch error" : result.kind === "missing" ? "missing once" : result.text.length < MIN_FRESH_CHARS ? "no text extracted" : "too short to judge";
          skipped[why] = (skipped[why] ?? 0) + 1;
        }
        const isNew = (d.status === "changed" || d.status === "gone") && row.status !== d.status;
        if (isNew) {
          counts.new++;
          if (samples.length < 10) samples.push(`${d.status} ${row.url}${d.diff ? `\n   ${JSON.stringify(d.diff).slice(0, 400)}` : ""}`);
        }
        if (dry || result.kind === "error") continue;
        await db
          .update(articles)
          .set({
            sourceCheckedAt: now,
            sourceMissingCount: d.missingCount,
            ...(d.status && d.status !== row.status
              ? {
                  sourceStatus: d.status,
                  sourceChangedAt: d.status === "ok" ? null : now,
                  sourceDiff: (d.diff ?? null) as SourceDiff | null,
                }
              : {}),
          })
          .where(eq(articles.id, row.id));
      }
    }
  }
  await Promise.all(Array.from({ length: HOSTS_IN_PARALLEL }, worker));

  console.log(`✓ ok ${counts.ok} · changed ${counts.changed} · gone ${counts.gone} · skipped ${counts.skip} · newly flagged ${counts.new}`);
  console.log(`   skipped: ${Object.entries(skipped).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}`);
  for (const s of samples) console.log(`   ${s}`);
}

main()
  .catch((err) => {
    console.error(`::error::recheck-sources: ${errorDetail(err)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
