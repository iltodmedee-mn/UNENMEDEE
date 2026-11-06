/**
 * One-off repair for rows stored before the scraper learned to (1) ignore a stray <time> stamp
 * repeated on every page, (2) distrust year-old dates printed in the body text, (3) keep archive
 * material unpublished and (4) strip invisible "blank" letters from titles. The scraper now does
 * all four itself (src/lib/scraper/extractor.ts, db-sink.ts, src/lib/text.ts).
 *
 *   npm run db:repair-dates -- --dry-run      # list what would change
 *   npm run db:repair-dates
 *
 * 1. A day-level published_at shared by 10+ articles of one source and 30+ days older than they
 *    were found → published_at = created_at + scrape_meta.date_unknown (the story stays published).
 * 2. Articles dated more than 60 days before they were found → is_published = false (the row,
 *    its hash and its AI summary stay; it is archive material, not news).
 * 3. Titles starting with U+3164 / U+2800 and friends → trimmed.
 * 4. Sources that cannot be scraped are deactivated with the reason in last_error.
 * 6. Published help and "about" pages (`looksLikeUnitPage`: "… холбоотой асуулт хариулт", "Чиг
 *    үүрэг") → is_published = false, the rule db-sink now applies to new rows.
 * No network requests, except:
 * 5. `--refetch [--refetch-days 14]`: undated articles found in the last N days are fetched again
 *    (robots.txt and the 8 s per-host delay apply) and re-dated with the current extractor; one
 *    that turns out older than MAX_AGE_DAYS is unpublished. Adapter sources (feeds, APIs) are
 *    skipped: their dates come from the API, not the page.
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { isFutureDate, MAX_AGE_DAYS } from "@/lib/scraper/dates";
import { extractArticleSafe } from "@/lib/scraper/extract-safe";
import { politeFetch } from "@/lib/scraper/http";
import { looksLikeUnitPage } from "@/lib/scraper/titles";
import { normalizeText } from "@/lib/text";
import { errorDetail } from "@/lib/log-safe";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    refetch: { type: "boolean", default: false },
    "refetch-days": { type: "string", default: "14" },
  },
});
const dry = values["dry-run"];

/** Sources the crawler cannot turn into news; `constcourt.mn` moved to conscourt.gov.mn (seeded). */
const DEACTIVATE: Record<string, string> = {
  "constcourt.mn": "domain no longer resolves; replaced by conscourt.gov.mn",
  "inspection.gov.mn": "site is a bare directory listing, no news section",
  "dundgovi.gov.mn": "site is a bare directory listing, no news section",
  "orkhon.gov.mn": "site answers with an empty page",
  "naog.gov.mn": "site is an empty application shell without news",
};

const INVISIBLE = "[ㅤᅟᅠ⠀ﾠ​-‍﻿]";

async function main() {
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const db = getDb();

  // 1. Shared stray dates.
  const shared = (
    await db.execute(sql`
      select a.source_id, s.domain, a.published_at, count(*)::int as n
      from articles a join sources s on s.id = a.source_id
      where a.published_at = date_trunc('day', a.published_at)
        and a.published_at < a.created_at - interval '30 days'
        and (a.scrape_meta->>'date_unknown') is distinct from 'true'
      group by a.source_id, s.domain, a.published_at
      having count(*) >= 10`)
  ).rows as { source_id: number; domain: string; published_at: Date; n: number }[];
  for (const g of shared) console.log(`📅 ${g.domain}: ${g.n} article(s) share ${new Date(g.published_at).toISOString().slice(0, 10)} → date unknown`);
  if (!dry) {
    for (const g of shared) {
      await db.execute(sql`
        update articles set published_at = created_at,
          scrape_meta = coalesce(scrape_meta, '{}'::jsonb) || '{"date_unknown": true}'::jsonb
        where source_id = ${g.source_id} and published_at = ${g.published_at}`);
    }
  }

  // 2. Archive material published as news.
  const old = (
    await db.execute(sql`
      select s.domain, count(*)::int as n
      from articles a join sources s on s.id = a.source_id
      where a.is_published and a.published_at < a.created_at - make_interval(days => ${MAX_AGE_DAYS})
        and (a.scrape_meta->>'date_unknown') is distinct from 'true'
      group by s.domain order by n desc`)
  ).rows as { domain: string; n: number }[];
  const oldTotal = old.reduce((a, r) => a + r.n, 0);
  console.log(`🗄️  ${oldTotal} published article(s) dated > ${MAX_AGE_DAYS} days before they were found → unpublished`);
  for (const r of old) console.log(`   ${r.domain}: ${r.n}`);
  if (!dry && oldTotal) {
    await db.execute(sql`
      update articles set is_published = false
      where is_published and published_at < created_at - make_interval(days => ${MAX_AGE_DAYS})
        and (scrape_meta->>'date_unknown') is distinct from 'true'`);
  }

  // 3. Invisible first letters.
  const titles = (await db.execute(sql`select id, title from articles where title ~ ${INVISIBLE}`)).rows as { id: number; title: string }[];
  console.log(`🔤 ${titles.length} title(s) with invisible characters`);
  for (const t of titles) {
    const next = normalizeText(t.title) || t.title;
    console.log(`   #${t.id} "${t.title.slice(0, 60)}" → "${next.slice(0, 60)}"`);
    if (!dry && next !== t.title) await db.execute(sql`update articles set title = ${next} where id = ${t.id}`);
  }

  // 4. Dead sources.
  const domains = Object.keys(DEACTIVATE);
  const dead = (await db.execute(sql`select domain from sources where is_active and domain in (${sql.join(domains.map((d) => sql`${d}`), sql`, `)})`)).rows as { domain: string }[];
  for (const d of dead) {
    console.log(`⛔ ${d.domain}: ${DEACTIVATE[d.domain]}`);
    if (!dry) await db.execute(sql`update sources set is_active = false, last_error = ${DEACTIVATE[d.domain]} where domain = ${d.domain}`);
  }
  // 6. Help and "about" pages published as news.
  const pages = (
    await db.execute(sql`select a.id, s.domain, a.title, left(a.clean_content, 300) as head from articles a join sources s on s.id = a.source_id where a.is_published`)
  ).rows as { id: number; domain: string; title: string; head: string }[];
  const notNews = pages.filter((p) => looksLikeUnitPage(p.title, p.head ?? ""));
  console.log(`📄 ${notNews.length} published help/about page(s) → unpublished`);
  for (const p of notNews) console.log(`   #${p.id} ${p.domain}: "${p.title.slice(0, 70)}"`);
  if (!dry && notNews.length) await db.execute(sql`update articles set is_published = false where id in (${sql.join(notNews.map((p) => sql`${p.id}`), sql`, `)})`);

  if (values.refetch) await refetchUndated(db, Math.max(1, Number(values["refetch-days"]) || 14));
  console.log(dry ? "Dry run: nothing written." : "✓ Done.");
}

/** Feeds and APIs: their dates come from the API, a page fetch would not add one. */
const API_SOURCES = ["opendata.gov.mn", "parliament.mn", "mongolia.gov.mn", "zasag.mn", "legalinfo.mn", "police.gov.mn"];

async function refetchUndated(db: ReturnType<typeof getDb>, days: number) {
  const rows = (
    await db.execute(sql`
      select a.id, a.original_url as url, a.created_at
      from articles a join sources s on s.id = a.source_id
      where a.is_published and (a.scrape_meta->>'date_unknown') = 'true'
        and a.created_at > now() - make_interval(days => ${days})
        and a.edited_at is null and a.content_pruned_at is null
        and s.domain not in (${sql.join(API_SOURCES.map((d) => sql`${d}`), sql`, `)})
      order by a.id`)
  ).rows as { id: number; url: string; created_at: Date }[];
  console.log(`🔁 ${rows.length} undated article(s) from the last ${days} days to fetch again`);
  let dated = 0;
  for (const r of rows) {
    try {
      const res = await politeFetch(r.url);
      if (!res.ok) {
        console.log(`   #${r.id} HTTP ${res.status}`);
        continue;
      }
      const date = (await extractArticleSafe(await res.text(), r.url))?.publishedAt ?? null;
      if (!date || isFutureDate(date)) {
        console.log(`   #${r.id} still no date`);
        continue;
      }
      const tooOld = date.getTime() < new Date(r.created_at).getTime() - MAX_AGE_DAYS * 86_400_000;
      dated++;
      console.log(`   #${r.id} → ${date.toISOString()}${tooOld ? " (archive: unpublished)" : ""}`);
      if (!dry) {
        await db.execute(sql`
          update articles set published_at = ${date}, scrape_meta = scrape_meta - 'date_unknown',
            is_published = ${!tooOld}
          -- The same conditions as the selection: an editor may have unpublished or edited the
          -- row while its page was being fetched, and that decision stands.
          where id = ${r.id} and is_published and (scrape_meta->>'date_unknown') = 'true'
            and edited_at is null and content_pruned_at is null`);
      }
    } catch (err) {
      console.log(`   #${r.id} ${err instanceof Error ? err.message.slice(0, 120) : err}`);
    }
  }
  console.log(`📅 ${dated}/${rows.length} re-dated`);
}

main()
  .catch((err) => {
    console.error(`::error::repair-dates: ${errorDetail(err)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
