import { createRequire } from "node:module";

import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";
import { databaseTls, withoutSslParams } from "./tls";

export type DB = NodePgDatabase<typeof schema>;

declare global {
  // Reuse the pool across Next.js dev hot reloads.
  var __iltodDb: { db: DB; close: () => Promise<void> } | undefined;
}

/** `DATABASE_URL=pglite:./.demo-db` runs the in-process demo database (`npm run demo`). */
export function isPgliteUrl(url: string | undefined): url is string {
  return Boolean(url?.startsWith("pglite:"));
}

/** True when the site runs on the local demo database, not the real one. */
export function isDemoDatabase(): boolean {
  return isPgliteUrl(process.env.DATABASE_URL);
}

/**
 * The demo database: PGlite (Postgres compiled to WebAssembly) in this process. Loaded at run
 * time from node_modules (a devDependency, listed in serverExternalPackages), so it is never part
 * of a production bundle. Same schema and queries as Supabase.
 */
function openPglite(url: string): { db: DB; close: () => Promise<void> } {
  const load = createRequire(`${process.cwd()}/`);
  const { PGlite } = load("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = load("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
  const dir = url.slice("pglite:".length).replace(/^\/\//, "");
  const client = dir === "memory" || dir === "" ? new PGlite() : new PGlite(dir);
  // Same query builder API; the result types differ only in driver metadata we never read.
  const db = drizzlePglite(client, { schema }) as unknown as DB;
  return { db, close: () => client.close() };
}

/** True when a database is configured. Pages use this to render empty states without a DB. */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function isLocalDatabase(url: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Lazy database singleton. Throws only when actually used without DATABASE_URL,
 * so `next build` and unit tests work without secrets.
 *
 * node-postgres runs one query per connection at a time. postgres.js pipelines concurrent
 * queries on a connection, which the Supabase transaction pooler (Supavisor, port 6543)
 * left hanging on Vercel (pages rendered empty after the query timeout).
 */
export function getDb(): DB {
  if (globalThis.__iltodDb) return globalThis.__iltodDb.db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  if (isPgliteUrl(url)) {
    globalThis.__iltodDb = openPglite(url);
    return globalThis.__iltodDb.db;
  }
  const pool = new Pool({
    // TLS is set here only (tls.ts): the URL's ssl* parameters would replace it.
    connectionString: isLocalDatabase(url) ? url : withoutSslParams(url),
    // Verified TLS for every remote database: Supabase's own root CA, host name checked.
    ssl: isLocalDatabase(url) ? false : databaseTls(),
    max: Number(process.env.DB_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Client-side cap: a stuck query errors instead of holding a connection forever. On Vercel the
    // pages give up after 10 s (queries.ts QUERY_TIMEOUT_MS), so a connection is freed 2 s later, not
    // 10 s later with only three in the pool; scripts keep 20 s for their larger reads.
    query_timeout: process.env.VERCEL ? 12_000 : 20_000,
  });
  // An idle client losing its connection must not crash the process.
  pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  // Vercel Fluid compute: keep the instance alive until idle connections are closed.
  if (process.env.VERCEL) attachDatabasePool(pool);
  const db = drizzle(pool, { schema });
  globalThis.__iltodDb = { db, close: () => pool.end() };
  return db;
}

/** Close the pool (used by CLI scripts so the process can exit). */
export async function closeDb(): Promise<void> {
  if (globalThis.__iltodDb) {
    await globalThis.__iltodDb.close();
    globalThis.__iltodDb = undefined;
  }
}

export { schema };
