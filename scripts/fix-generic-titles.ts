/**
 * One-off repair for articles stored before the scraper learned to spot site-wide titles and
 * undated pages (the scraper now does both itself, see src/lib/scraper/titles.ts and db-sink.ts).
 *
 *   npm run db:fix-titles -- --dry-run        # list what would change
 *   npm run db:fix-titles                     # generic titles → the article's first sentence
 *   npm run db:fix-titles -- --dates          # also flag undated rows and hide old archive posts
 *
 * Titles that name the site or a section ("Мэдээ | ТТХГ", "Нүүр хуудас", the agency name), or that
 * one source used 3+ times, get the first sentence of the stored text. Slugs are left alone, so
 * every URL keeps working. No network requests.
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { looksOld } from "@/lib/scraper/dates";
import { firstSentenceTitle, isGenericTitle, looksLikeNavigation } from "@/lib/scraper/titles";

const { values } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false }, dates: { type: "boolean", default: false } },
});
const dry = values["dry-run"];

interface Row {
  id: number;
  title: string;
  text: string;
  tldr: string | null;
  source: string;
  domain: string;
  repeats: number;
}

async function fixTitles(db: ReturnType<typeof getDb>) {
  const rows = (
    await db.execute(sql`
      select * from (
        select a.id, a.title, left(a.clean_content, 2000) as text, a.tldr_summary as tldr, s.name as source, s.domain,
               count(*) over (partition by a.source_id, a.title)::int as repeats
        from articles a join sources s on s.id = a.source_id
        where s.domain <> 'opendata.gov.mn'
      ) x
      where repeats >= 3 or length(title) < 60`)
  ).rows as unknown as Row[];
  const siteTitled = rows.filter((r) => r.repeats >= 3 || isGenericTitle(r.title, [r.source]));
  // A site title over menu text is a homepage or menu page that was scraped as news: hide it.
  const hide = siteTitled.filter((r) => looksLikeNavigation(r.text));
  const fixes = siteTitled
    .filter((r) => !looksLikeNavigation(r.text))
    .map((r) => ({ ...r, next: firstSentenceTitle(r.text) || firstSentenceTitle(r.tldr ?? "") }))
    .filter((r) => r.next && r.next !== r.title);
  console.log(`📰 ${fixes.length} title(s) to replace, ${hide.length} menu/homepage page(s) to hide.`);
  for (const f of fixes.slice(0, 40)) console.log(`   [${f.domain}] "${f.title}" → "${f.next}"`);
  if (fixes.length > 40) console.log(`   … and ${fixes.length - 40} more`);
  for (const h of hide.slice(0, 20)) console.log(`   hide [${h.domain}] "${h.title}": ${h.text.slice(0, 70).replace(/\s+/g, " ")}`);
  if (dry) return;
  for (const f of fixes) await db.execute(sql`update articles set title = ${f.next.slice(0, 500)} where id = ${f.id}`);
  for (const h of hide) await db.execute(sql`update articles set is_published = false where id = ${h.id}`);
  console.log("✓ Titles updated.");
}

async function fixDates(db: ReturnType<typeof getDb>) {
  // Undated rows were stored with published_at = the time we found them.
  const rows = (
    await db.execute(sql`
      select a.id, a.title, left(a.clean_content, 4000) as text, a.is_published as published, s.domain
      from articles a join sources s on s.id = a.source_id
      where abs(extract(epoch from a.published_at - a.created_at)) < 120
        and coalesce((a.scrape_meta->>'date_unknown')::boolean, false) = false`)
  ).rows as unknown as { id: number; title: string; text: string; published: boolean; domain: string }[];
  const old = rows.filter((r) => r.published && looksOld(r.text));
  console.log(`📅 ${rows.length} undated article(s) to flag; ${old.length} of them look like old archive posts to hide.`);
  for (const r of old.slice(0, 30)) console.log(`   hide [${r.domain}] ${r.title.slice(0, 90)}`);
  if (dry) return;
  const ids = rows.map((r) => r.id);
  const oldIds = old.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await db.execute(sql`update articles set scrape_meta = coalesce(scrape_meta, '{}'::jsonb) || '{"date_unknown": true}'::jsonb where id in (${sql.join(chunk, sql`, `)})`);
  }
  for (let i = 0; i < oldIds.length; i += 500) {
    const chunk = oldIds.slice(i, i + 500);
    await db.execute(sql`update articles set is_published = false where id in (${sql.join(chunk, sql`, `)})`);
  }
  console.log("✓ Dates flagged.");
}

async function main() {
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const db = getDb();
  await fixTitles(db);
  if (values.dates) await fixDates(db);
  if (dry) console.log("(dry run: nothing written)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
