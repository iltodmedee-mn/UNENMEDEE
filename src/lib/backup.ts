/**
 * Weekly backup of the database (`.github/workflows/backup.yml`, `npm run db:backup` /
 * `npm run db:restore`, docs/BACKUP.md). There was none: the VAPID key pair (every push
 * subscriber is bound to it), the live Threads/Instagram tokens, admin edits and the article
 * archive existed only in one free Supabase project.
 *
 * Format: NDJSON, one `{"t": table, "r": row}` per line, tables in foreign-key order. It goes
 * through the app's own connection (Drizzle), because the runner's pg_dump 16 refuses Supabase's
 * Postgres 17. The workflow streams it through gzip and `age` (the owner's public key), so the
 * plain text never touches the disk; only the encrypted file is uploaded.
 */
import { asc, getTableColumns, getTableName, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import type { DB } from "@/db";
import * as schema from "@/db/schema";

interface BackupTable {
  table: PgTable;
  /** The primary key column (rows are read in its order, in pages, and upserted by it on restore). */
  key: PgColumn;
  /** Whether `key` is a serial whose sequence must move past the restored ids. */
  serial: boolean;
}

/**
 * Every table worth restoring, parents before children (articles → sources, clusters;
 * asset_declarations → politicians). Left out: ai_usage_logs (the ledger keeps the monthly
 * totals), open_datasets (the next `data:sync` rebuilds it) and press_items / press_links (45 days
 * of other sites' headlines; the next `press:sync` reads the feeds again) and videos (MP4 files kept
 * a few days for the platforms to fetch; a lost row only means that video can be made again).
 */
export const BACKUP_TABLES: BackupTable[] = [
  { table: schema.appSettings, key: schema.appSettings.key, serial: false },
  { table: schema.sources, key: schema.sources.id, serial: true },
  { table: schema.clusters, key: schema.clusters.id, serial: true },
  { table: schema.articles, key: schema.articles.id, serial: true },
  { table: schema.seenUrls, key: schema.seenUrls.originalUrl, serial: false },
  { table: schema.digests, key: schema.digests.id, serial: true },
  { table: schema.politicians, key: schema.politicians.id, serial: true },
  { table: schema.assetDeclarations, key: schema.assetDeclarations.id, serial: true },
  { table: schema.indicatorSnapshots, key: schema.indicatorSnapshots.key, serial: false },
  { table: schema.transparencyLedger, key: schema.transparencyLedger.id, serial: true },
  { table: schema.donations, key: schema.donations.id, serial: true },
  { table: schema.pushSubscriptions, key: schema.pushSubscriptions.id, serial: true },
  { table: schema.socialPosts, key: schema.socialPosts.id, serial: true },
  // first_seen_at / awarded_seen_at drive the "new contracts" list; a watched page's edit time says
  // whether a document is new: lost, the next sync would treat everything as a baseline.
  { table: schema.tenders, key: schema.tenders.id, serial: true },
  { table: schema.watchedPages, key: schema.watchedPages.url, serial: false },
  { table: schema.documents, key: schema.documents.id, serial: true },
];

const PAGE = 500;
export const BACKUP_LAST_KEY = "backup_last_at";

export const tableName = (t: BackupTable) => getTableName(t.table);

function findTable(name: string): BackupTable {
  const t = BACKUP_TABLES.find((x) => tableName(x) === name);
  if (!t) throw new Error(`unknown table in backup: ${JSON.stringify(name).slice(0, 80)}`);
  return t;
}

/**
 * Writes every row as one NDJSON line through `write` (which may return a promise for
 * back-pressure). Returns the row count per table: the only thing the workflow log prints.
 */
export async function exportTables(db: DB, write: (line: string) => void | Promise<void>, tables: BackupTable[] = BACKUP_TABLES): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const name = tableName(t);
    counts[name] = 0;
    let after: unknown = undefined;
    for (;;) {
      const page: Record<string, unknown>[] = await db
        .select()
        .from(t.table)
        .where(after === undefined ? undefined : sql`${t.key} > ${after}`)
        .orderBy(asc(t.key))
        .limit(PAGE);
      for (const row of page) await write(`${JSON.stringify({ t: name, r: row })}\n`);
      counts[name] += page.length;
      if (page.length < PAGE) break;
      after = page[page.length - 1][keyField(t)];
    }
  }
  return counts;
}

/** The JS property name of a table's key column. */
function keyField(t: BackupTable): string {
  const entry = Object.entries(getTableColumns(t.table)).find(([, c]) => c === t.key);
  if (!entry) throw new Error(`no key column on ${tableName(t)}`);
  return entry[0];
}

/** JSON turned Dates into strings: give timestamp columns their Date back, drop unknown fields. */
function revive(t: BackupTable, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(getTableColumns(t.table))) {
    if (!(field in row)) continue;
    const v = row[field];
    out[field] = v !== null && typeof v === "string" && column.columnType === "PgTimestamp" ? new Date(v) : v;
  }
  return out;
}

export interface ImportOptions {
  /** Only restore these tables (by SQL name). */
  only?: string[];
  /** Parse and count, write nothing. */
  dryRun?: boolean;
}

/**
 * Upserts backup lines by primary key, `PAGE` rows at a time, in the order of the file (which is
 * foreign-key order). Rows already in the database are overwritten with the backup's values; rows
 * not in the backup are left alone. Serial sequences are moved past the restored ids.
 *
 * One transaction: a unique-key conflict or a bad line halfway through used to leave half a
 * restore behind with the sequences not moved, and the next pipeline insert failed on a taken id.
 * Now either the whole file is restored (sequences included) or nothing changes.
 */
export async function importLines(db: DB, lines: AsyncIterable<string> | Iterable<string>, opts: ImportOptions = {}): Promise<Record<string, number>> {
  if (opts.dryRun) return importInto(db, lines, opts);
  return db.transaction((tx) => importInto(tx as unknown as DB, lines, opts));
}

async function importInto(db: DB, lines: AsyncIterable<string> | Iterable<string>, opts: ImportOptions): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const only = opts.only ? new Set(opts.only.map((n) => findTable(n)).map(tableName)) : null;
  // One pending batch per table run; a holder object so TypeScript follows writes made in `flush`.
  const pending: { t: BackupTable | null; rows: Record<string, unknown>[] } = { t: null, rows: [] };

  const flush = async () => {
    const { t, rows } = pending;
    if (!t || rows.length === 0) return;
    if (!opts.dryRun) {
      const columns = getTableColumns(t.table);
      const set = Object.fromEntries(Object.entries(columns).filter(([, c]) => c !== t.key).map(([field, c]) => [field, sql.raw(`excluded."${c.name}"`)]));
      await db.insert(t.table).values(rows).onConflictDoUpdate({ target: t.key, set });
    }
    pending.rows = [];
  };

  let skipped = 0;
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // A stray non-JSON line (a tool's banner or warning that reached stdout) must not void a
    // restore; it is counted and reported, and the data lines around it are still loaded.
    if (!line.startsWith("{")) {
      skipped++;
      continue;
    }
    const parsed = JSON.parse(line) as { t?: unknown; r?: unknown };
    if (typeof parsed.t !== "string" || typeof parsed.r !== "object" || parsed.r === null) throw new Error("not a backup line");
    const t = findTable(parsed.t);
    const name = tableName(t);
    if (only && !only.has(name)) continue;
    if (pending.t !== t) {
      await flush();
      pending.t = t;
    }
    pending.rows.push(revive(t, parsed.r as Record<string, unknown>));
    counts[name] = (counts[name] ?? 0) + 1;
    if (pending.rows.length >= PAGE) await flush();
  }
  await flush();
  if (skipped) console.error(`::warning::${skipped} non-JSON line(s) in the backup file were skipped (something printed to stdout during the export)`);

  if (!opts.dryRun) {
    for (const t of BACKUP_TABLES) {
      if (!t.serial || !counts[tableName(t)]) continue;
      const name = tableName(t);
      await db.execute(sql`select setval(pg_get_serial_sequence(${name}, ${t.key.name}), greatest((select max(${t.key}) from ${t.table}), 1))`);
    }
    // videos is not backed up, but social_posts (kind 'video', ref_id = videos.id) is: a fresh
    // videos sequence would hand new videos the ids of old posted ones, and post-social would skip
    // them as "already posted" until the ids passed the old maximum.
    if (counts.social_posts) {
      await db.execute(
        sql`select setval(pg_get_serial_sequence('videos', 'id'), greatest((select coalesce(max(id), 0) from videos), (select coalesce(max(ref_id), 0) from social_posts where kind = 'video'), 1))`,
      );
    }
  }
  return counts;
}

/** Recorded after an uploaded backup; the watchdog reports it when it is older than 10 days. */
export async function markBackup(db: DB, at = new Date()): Promise<void> {
  await db
    .insert(schema.appSettings)
    .values({ key: BACKUP_LAST_KEY, value: at.toISOString(), updatedAt: at })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: at.toISOString(), updatedAt: at } });
}
