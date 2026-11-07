/**
 * What readers see, checked after every pipeline run (src/lib/feed-check.ts): the newest 40 stories
 * of the home feed against a few rules (Cyrillic, no broken text, no duplicate headline, no flood
 * from one site, no old page shown as new, no future date). Writes FEED_REPORT (feed-check.md):
 * empty when all is well. The workflow opens, updates or closes the "feed-check" issue from it.
 * Read-only: nothing is changed.
 */
import "dotenv/config";
import "@/lib/runtime-banner";

import { writeFileSync } from "node:fs";

import { and, desc, eq } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { articles, sources } from "@/db/schema";
import { feedProblems, feedReport } from "@/lib/feed-check";
import { errorDetail } from "@/lib/log-safe";
import { PRODUCTION_URL } from "@/lib/site";
import { displayTitle, feedVisible, undated, visible } from "@/lib/story-rules";

async function main() {
  const out = process.env.FEED_REPORT ?? "feed-check.md";
  if (!hasDatabase()) {
    console.log("No DATABASE_URL: nothing to check.");
    return;
  }
  // The home feed's own conditions (getFeed("all") in queries.ts), newest first.
  const rows = await getDb()
    .select({
      id: articles.id,
      slug: articles.slug,
      title: displayTitle,
      summary: articles.tldrSummary,
      source: sources.domain,
      publishedAt: articles.publishedAt,
      undated,
    })
    .from(articles)
    .innerJoin(sources, eq(articles.sourceId, sources.id))
    .where(and(visible, feedVisible))
    .orderBy(desc(articles.publishedAt), desc(articles.id))
    .limit(40);
  const problems = feedProblems(rows, new Date());
  writeFileSync(out, feedReport(problems, PRODUCTION_URL));
  for (const p of problems) console.log(`::warning::feed-check ${p.rule}: ${p.ids.join(", ")}`);
  console.log(problems.length ? `${problems.length} problem(s) on the home feed.` : `Home feed OK (${rows.length} stories checked).`);
}

main()
  .catch((err) => {
    console.error(`::error::${errorDetail(err)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
