/**
 * Keeps the free 500 MB database from filling up (`src/lib/retention.ts` has the rules and the
 * size ladder): old article bodies are cut to an excerpt, unpublished rows older than 90 days are
 * deleted (their URL and hash stay in seen_urls so the scraper skips them), old AI call logs go,
 * and past 420 MB minor stories older than two years go too. The run is recorded in
 * app_settings `prune_state` (the watchdog checks it ran).
 *
 * It also stores headlines still in capitals in sentence case (`unshoutTitle`, which the scraper
 * applies to new articles since Oct 2026); slugs stay, so every URL keeps working.
 *
 *   npm run db:prune                 # RETENTION_DAYS=180 by default
 *   npm run db:prune -- --dry-run    # counts only, nothing changes
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { DEFAULT_RETENTION_DAYS, EXCERPT_CHARS, OLD_STORY_DAYS, runRetention, SEEN_URL_KEEP_DAYS, LOG_KEEP_MONTHS } from "@/lib/retention";
import { unshoutTitle } from "@/lib/scraper/titles";
import { errorDetail } from "@/lib/log-safe";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const configured = Number(process.env.RETENTION_DAYS || DEFAULT_RETENTION_DAYS);

async function main() {
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const db = getDb();
  const dryRun = values["dry-run"];
  await fixShoutingTitles(db);
  const s = await runRetention(db, { configuredDays: configured, dryRun });
  const verb = dryRun ? "would" : "did";
  console.log(`🗄️  Database ${s.dbMbBefore} MB → bodies after ${s.plan.bodyDays} d, unpublished rows after ${s.plan.unpublishedDays} d${s.plan.deleteOldStories ? ", old minor stories too (past 420 MB)" : ""}.`);
  console.log(`✂️  ${verb} cut ${s.bodiesCut} article bodies to ${EXCERPT_CHARS} characters.`);
  console.log(`🗑️  ${verb} delete ${s.unpublishedDeleted} unpublished rows (URL + hash kept in seen_urls).`);
  if (s.plan.deleteOldStories) console.log(`::warning::${verb} delete ${s.oldStoriesDeleted} minor stories older than ${OLD_STORY_DAYS} days: the database is past 420 MB.`);
  console.log(`🧹 ${verb} forget ${s.seenUrlsPruned} seen URLs older than ${SEEN_URL_KEEP_DAYS} days and ${s.logsDeleted} AI call logs older than ${LOG_KEEP_MONTHS} months.`);
  if (!dryRun) console.log(`✓ Done. Database ${s.dbMbAfter} MB (freed space is reused after autovacuum).`);
}

async function fixShoutingTitles(db: ReturnType<typeof getDb>) {
  const rows = (await db.execute(sql`select id, title from articles where title = upper(title) and title ~ '[А-ЯӨҮЁ]{3}' and edited_at is null`)).rows as { id: number; title: string }[];
  const changes = rows.map((r) => ({ id: r.id, from: r.title, to: unshoutTitle(r.title) })).filter((c) => c.to !== c.from);
  console.log(`🔡 ${changes.length} headline(s) in capitals to store in sentence case.`);
  for (const c of changes.slice(0, 5)) console.log(`   ${c.from}\n → ${c.to}`);
  if (values["dry-run"]) return;
  for (const c of changes) await db.execute(sql`update articles set title = ${c.to} where id = ${c.id}`);
}

main()
  .catch((err) => {
    console.error(`::error::prune-content: ${errorDetail(err)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
