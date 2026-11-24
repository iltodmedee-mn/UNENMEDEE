/**
 * What readers see, checked after every pipeline run (src/lib/feed-check.ts): the newest 40 stories
 * of the home feed against a few rules (Cyrillic, no broken text, no duplicate headline, no flood
 * from one site, no old page shown as new, no future date), and that the live site runs the build of
 * the checked-out `main` (GITHUB_SHA vs /api/pulse's commit, 60 minutes of grace). Writes FEED_REPORT (feed-check.md):
 * empty when all is well. The workflow opens, updates or closes the "feed-check" issue from it.
 * Read-only: nothing is changed.
 */
import "dotenv/config";
import "@/lib/runtime-banner";

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { and, desc, eq } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { articles, sources } from "@/db/schema";
import { deployProblem, feedProblems, feedReport } from "@/lib/feed-check";
import { errorDetail } from "@/lib/log-safe";
import { PRODUCTION_URL } from "@/lib/site";
import { displayTitle, feedVisible, undated, visible } from "@/lib/story-rules";

/** The commit the live site was built from (/api/pulse), or null when it cannot be read. */
async function liveCommit(): Promise<string | null> {
  try {
    const res = await fetch(`${PRODUCTION_URL}/api/pulse`, { signal: AbortSignal.timeout(15_000), headers: { "Cache-Control": "no-cache" } });
    const body = (await res.json()) as { commit?: unknown };
    return typeof body.commit === "string" && /^[0-9a-f]{40}$/.test(body.commit) ? body.commit : null;
  } catch {
    return null;
  }
}

/**
 * The newest commit on the checked-out branch that changes the site, and when it was committed.
 * Vercel skips a build when a main commit only touches docs, tests, scripts, workflows, .claude or
 * Markdown (vercel.json ignoreCommand, the same list as DEPLOY_EXCLUDES), so the live site rightly
 * stays on the commit before it: comparing with GITHUB_SHA raised a false "stuck deploy" alarm an
 * hour after every such merge (Nov 2026 audit R-4). Null when unknown (no checkout, or a shallow one
 * whose only commit changes nothing deployable): then no alarm.
 */
const DEPLOY_EXCLUDES = ["docs", "tests", "scripts", ".github", ".claude", "*.md"];

/** The commits at the edge of a shallow clone (empty when the history is complete). */
function shallowRoots(): Set<string> {
  try {
    const file = execFileSync("git", ["rev-parse", "--git-path", "shallow"], { encoding: "utf8" }).trim();
    return new Set(readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function deployableHead(): { sha: string; at: Date } | null {
  try {
    // --first-parent: main's own history, as Vercel compares HEAD^ with HEAD.
    const out = execFileSync("git", ["log", "-1", "--first-parent", "--format=%H %ct", "--", ".", ...DEPLOY_EXCLUDES.map((p) => `:(exclude)${p}`)], { encoding: "utf8" }).trim();
    const [sha, ct] = out.split(" ");
    const s = Number(ct);
    if (!/^[0-9a-f]{40}$/.test(sha ?? "") || !Number.isFinite(s) || s <= 0) return null;
    // In a shallow checkout the oldest fetched commit looks as if it added every file: when the
    // search reaches it, the real answer is older than the history we have, so say nothing.
    if (shallowRoots().has(sha)) return null;
    return { sha, at: new Date(s * 1000) };
  } catch {
    return null;
  }
}

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
  const head = deployableHead();
  const stuck = deployProblem({ live: await liveCommit(), main: head?.sha ?? null, mainAt: head?.at ?? null, now: new Date() });
  if (stuck) problems.push(stuck);
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
