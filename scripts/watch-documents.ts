/**
 * Reports and tender documents kept on pages (src/lib/documents) → `documents`, for /documents.
 *
 *   npm run docs:watch              # audit.mn register + the watched WordPress pages
 *   npm run docs:watch -- --dry-run # no DB: print what was found
 *
 * audit.mn: a report id we have not stored is a new report. WordPress: each site's 100 most
 * recently edited pages whose title names a report, tender, procurement, transparency or audit;
 * a page is read again only when its `modified` time moved, and a file link not stored yet is a new
 * document. A page read for the first time, and audit.mn on the very first run, is a baseline:
 * stored, never announced. One failing site never stops the others; when every source failed the
 * step is red.
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { eq, sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { appSettings, documents, watchedPages } from "@/db/schema";
import { fetchAuditRegister, fetchPageDocuments, fetchWatchedPages } from "@/lib/documents/fetch";
import { docKind, WP_SITES } from "@/lib/documents/watch";
import { oneLine } from "@/lib/log-safe";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });

/** Pages read per site and run: a first run reads at most this many bodies per site. */
const PAGES_PER_SITE = 40;

async function main() {
  const dry = values["dry-run"];
  if (!dry && !hasDatabase()) {
    console.error("✗ DATABASE_URL is not set. Use --dry-run to test without a database.");
    process.exitCode = 1;
    return;
  }
  const db = dry ? null : getDb();
  let failed = 0;
  let sourcesTried = 0;
  let added = 0;

  // audit.mn
  sourcesTried++;
  try {
    const rows = await fetchAuditRegister();
    console.log(`📑 audit.mn: ${rows.length} reports on the register's first page.`);
    if (db) {
      const [{ n }] = (await db.execute(sql`select count(*)::int as n from documents where kind = 'audit' and domain = 'audit.mn'`)).rows as { n: number }[];
      const baseline = n === 0;
      const inserted = await db
        .insert(documents)
        .values(
          rows.map((r) => ({
            url: r.url,
            title: r.title,
            kind: "audit",
            domain: "audit.mn",
            pageTitle: "Аудитын тайлангийн сан",
            pageUrl: "https://audit.mn/audit",
            meta: Object.fromEntries(Object.entries({ office: r.office, auditType: r.auditType }).filter(([, v]) => v)) as Record<string, string>,
            baseline,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: documents.id });
      added += baseline ? 0 : inserted.length;
      console.log(`   ${inserted.length} new${baseline ? " (first run: baseline)" : ""}`);
    } else {
      for (const r of rows.slice(0, 5)) console.log(`   ${r.id} ${oneLine(r.title, 90)} · ${oneLine(r.office, 40)}`);
    }
  } catch (err) {
    failed++;
    console.log(`::warning::audit.mn: ${oneLine(err instanceof Error ? err.message : err, 160)}`);
  }

  // WordPress sites: one at a time per host (politeFetch keeps 8 s between requests to a host).
  await Promise.all(
    WP_SITES.map(async (site) => {
      sourcesTried++;
      try {
        const pages = await fetchWatchedPages(site);
        const known = db
          ? new Map((await db.select({ url: watchedPages.url, modified: watchedPages.modified }).from(watchedPages).where(eq(watchedPages.domain, site.domain))).map((p) => [p.url, p.modified]))
          : new Map<string, string>();
        const changed = pages.filter((p) => known.get(p.link) !== p.modified).slice(0, PAGES_PER_SITE);
        let siteNew = 0;
        for (const page of changed) {
          const firstRead = !known.has(page.link);
          let links;
          try {
            links = await fetchPageDocuments(site, page);
          } catch (err) {
            console.log(`   · ${site.domain} page ${page.id}: ${oneLine(err instanceof Error ? err.message : err, 80)}`);
            continue;
          }
          const kind = docKind(page.title);
          if (db) {
            if (links.length) {
              const inserted = await db
                .insert(documents)
                .values(links.map((l) => ({ url: l.url.slice(0, 1000), title: l.title, kind, domain: site.domain, pageTitle: page.title, pageUrl: page.link, fileType: l.fileType, baseline: firstRead })))
                .onConflictDoNothing()
                .returning({ id: documents.id });
              if (!firstRead) siteNew += inserted.length;
            }
            const row = { url: page.link.slice(0, 1000), domain: site.domain, title: page.title, kind, modified: page.modified, fileCount: links.length, checkedAt: new Date() };
            await db.insert(watchedPages).values(row).onConflictDoUpdate({ target: watchedPages.url, set: row });
          } else {
            console.log(`   ${site.domain} · ${oneLine(page.title, 60)} (${page.modified.slice(0, 10)}): ${links.length} files`);
          }
        }
        added += siteNew;
        console.log(`🗂  ${site.domain}: ${pages.length} watched pages, ${changed.length} read${siteNew ? `, ${siteNew} new files` : ""}.`);
      } catch (err) {
        failed++;
        console.log(`::warning::${site.domain}: ${oneLine(err instanceof Error ? err.message : err, 160)}`);
      }
    }),
  );

  if (failed === sourcesTried) {
    console.log("::error::Every document source failed.");
    process.exitCode = 1;
    return;
  }
  if (db) {
    const now = new Date().toISOString();
    await db.insert(appSettings).values({ key: "documents_checked_at", value: now }).onConflictDoUpdate({ target: appSettings.key, set: { value: now } });
  }
  console.log(`✓ ${added} new documents; ${failed} of ${sourcesTried} sources failed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
