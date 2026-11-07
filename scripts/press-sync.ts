/**
 * Reads the independent newsrooms' feeds (src/lib/press/feeds.ts OUTLETS), stores headline + link
 * of new items, and links press stories to the government stories they cover (src/lib/press/match.ts).
 *
 *   npm run press:sync               # every pipeline run, after the AI steps
 *   npm run press:sync -- --dry-run  # fetch and match, print, write nothing
 *
 * robots.txt and the 8 s per-host delay apply (politeFetch). A failing outlet is a warning, not a
 * failed step. Press rows older than PRESS_KEEP_DAYS are deleted (their links go with them).
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { articles, pressItems, pressLinks } from "@/db/schema";
import { OUTLETS, parseNewsMn, parseRssItems, type FeedItem } from "@/lib/press/feeds";
import { matchPress, PRESS_AFTER_DAYS, type GovDoc, type PressDoc } from "@/lib/press/match";
import { API_MAX_BYTES, politeFetch, readJsonLimited, readTextLimited } from "@/lib/scraper/http";
import { errorLine } from "@/lib/log-safe";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const DRY = values["dry-run"];
/** Press headlines are only needed while a story is fresh. */
const PRESS_KEEP_DAYS = 45;
/** Government stories of this many days are matched each run. */
const MATCH_DAYS = 7;

async function readOutlet(o: (typeof OUTLETS)[number]): Promise<FeedItem[]> {
  const res = await politeFetch(o.feed, { timeoutMs: 30_000, headers: { accept: o.kind === "rss" ? "application/rss+xml, application/xml" : "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return o.kind === "rss" ? parseRssItems(await readTextLimited(res, API_MAX_BYTES)) : parseNewsMn(await readJsonLimited(res), new Date());
}

async function main() {
  if (!hasDatabase() && !DRY) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const fetched: { outlet: string; item: FeedItem }[] = [];
  for (const o of OUTLETS) {
    try {
      const items = await readOutlet(o);
      for (const item of items) fetched.push({ outlet: o.domain, item });
      console.log(`📰 ${o.domain}: ${items.length} items`);
    } catch (err) {
      console.log(`::warning::press feed ${o.domain} failed: ${errorLine(err, 300)}`);
    }
  }
  if (!hasDatabase()) {
    console.log(`(dry run without a database: ${fetched.length} items read, nothing matched)`);
    return;
  }
  const db = getDb();
  if (!DRY && fetched.length) {
    const rows = fetched.map(({ outlet, item }) => ({ outlet, title: item.title.slice(0, 500), url: item.url, publishedAt: item.publishedAt }));
    for (let i = 0; i < rows.length; i += 200) {
      await db.insert(pressItems).values(rows.slice(i, i + 200)).onConflictDoNothing({ target: pressItems.url });
    }
  }

  const since = new Date(Date.now() - (MATCH_DAYS + PRESS_AFTER_DAYS) * 86_400_000);
  const press = await db.select({ id: pressItems.id, title: pressItems.title, url: pressItems.url, publishedAt: pressItems.publishedAt, foundAt: pressItems.foundAt }).from(pressItems).where(gte(pressItems.foundAt, since));
  const gov = await db
    .select({ id: articles.id, title: articles.title, summary: articles.tldrSummary, publishedAt: articles.publishedAt })
    .from(articles)
    .where(and(eq(articles.isPublished, true), isNotNull(articles.tldrSummary), eq(articles.summaryFallback, false), gte(articles.publishedAt, new Date(Date.now() - MATCH_DAYS * 86_400_000))));
  const pressDocs: PressDoc[] = press.map((p) => ({ id: p.id, title: p.title, publishedAt: p.publishedAt ?? p.foundAt }));
  const govDocs: GovDoc[] = gov.map((g) => ({ id: g.id, title: g.title, summary: g.summary ?? "", publishedAt: g.publishedAt }));
  const matches = matchPress(govDocs, pressDocs);
  console.log(`🔗 ${matches.length} press links for ${new Set(matches.map((m) => m.articleId)).size} of ${gov.length} government stories (${press.length} press items)`);
  if (DRY) {
    const pt = new Map(press.map((p) => [p.id, p.title]));
    const gt = new Map(gov.map((g) => [g.id, g.title]));
    for (const m of matches.slice(0, 40)) console.log(`  ${m.score.toFixed(2)}  #${m.articleId} ${gt.get(m.articleId)?.slice(0, 70)}  ↔  ${pt.get(m.pressId)?.slice(0, 70)}`);
    return;
  }
  // The matcher is deterministic over stored headlines: this window's links are replaced by the current answer.
  const govIds = gov.map((g) => g.id);
  for (let i = 0; i < govIds.length; i += 500) await db.delete(pressLinks).where(inArray(pressLinks.articleId, govIds.slice(i, i + 500)));
  for (let i = 0; i < matches.length; i += 500) {
    await db
      .insert(pressLinks)
      .values(matches.slice(i, i + 500).map((m) => ({ articleId: m.articleId, pressItemId: m.pressId, score: m.score })))
      .onConflictDoNothing();
  }
  const old = await db.delete(pressItems).where(lt(pressItems.foundAt, new Date(Date.now() - PRESS_KEEP_DAYS * 86_400_000))).returning({ id: pressItems.id });
  if (old.length) console.log(`🧹 ${old.length} press headlines older than ${PRESS_KEEP_DAYS} days deleted.`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(pressItems);
  console.log(`📰 ${n} press headlines stored.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
