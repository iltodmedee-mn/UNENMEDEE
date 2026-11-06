/**
 * Applies the SQL migrations in ./drizzle (same journal table as drizzle-kit:
 * drizzle.__drizzle_migrations).
 *
 * Replaces `drizzle-kit migrate`, which hides connection errors behind a spinner and
 * uses prepared statements that the Supabase transaction pooler (port 6543) rejects.
 */
import "dotenv/config";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { closeDb, getDb, isLocalDatabase, isPgliteUrl } from "@/db";
import { databaseTls, withoutSslParams } from "@/db/tls";
import { migrateDemo } from "@/db/demo-migrate";
import { errorDetail } from "@/lib/log-safe";

/** Host, port and user only, so logs help debug a wrong secret without leaking the password. */
function describe(url: string): string {
  try {
    const u = new URL(url);
    return `${u.username || "?"}@${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "an unparseable DATABASE_URL (check for unencoded special characters in the password)";
  }
}

/**
 * Supabase pooler hosts are aws-<cluster>-<region>.pooler.supabase.com and the cluster number
 * differs between projects. When the host is wrong, try the siblings and say which one works.
 */
async function suggestPoolerHost(url: string): Promise<void> {
  const u = new URL(url);
  const m = u.hostname.match(/^aws-(\d+)-([a-z0-9-]+)\.pooler\.supabase\.com$/);
  if (!m) return;
  for (const cluster of [0, 1, 2]) {
    if (String(cluster) === m[1]) continue;
    const candidate = new URL(url);
    candidate.hostname = `aws-${cluster}-${m[2]}.pooler.supabase.com`;
    const probe = postgres(withoutSslParams(candidate.toString()), { max: 1, prepare: false, ssl: databaseTls(), onnotice: () => {}, connect_timeout: 15 });
    try {
      await probe`select 1`;
      console.error(`  ✓ ${candidate.hostname} works. Replace the host in the DATABASE_URL secret (GitHub and Vercel) with it.`);
      return;
    } catch (err) {
      const cause = (err as { message?: string }).message ?? String(err);
      console.error(`  ✗ ${candidate.hostname}: ${cause.slice(0, 120)}`);
    } finally {
      await probe.end({ timeout: 5 });
    }
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  if (isPgliteUrl(url)) {
    // `npm run demo`: the in-process demo database.
    const n = await migrateDemo(getDb());
    console.log(`✓ Demo database ready (${n} migration(s) applied).`);
    await closeDb();
    return;
  }
  console.log(`🗄  Migrating ${describe(url)} …`);
  // Verified TLS as in src/db (tls.ts); postgres.js's "require" accepted any certificate.
  const client = isLocalDatabase(url)
    ? postgres(url, { max: 1, prepare: false, ssl: false, onnotice: () => {}, connect_timeout: 30 })
    : postgres(withoutSslParams(url), { max: 1, prepare: false, ssl: databaseTls(), onnotice: () => {}, connect_timeout: 30 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    const [last] = await client`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`;
    console.log(`✓ Migrations up to date (latest ${last ? new Date(Number(last.created_at)).toISOString() : "none"}).`);
  } catch (err) {
    // drizzle wraps driver errors ("Failed query: …"); the reason is in `cause`.
    const outer = err as { message?: string; cause?: { message?: string; code?: string } };
    const e = { message: [outer.message, outer.cause?.message].filter(Boolean).join(" ← "), code: outer.cause?.code ?? (err as { code?: string }).code };
    console.error(`✗ Migration failed: ${e.code ? `[${e.code}] ` : ""}${e.message || String(err)}`);
    if (/password authentication failed|28P01/.test(`${e.message} ${e.code}`)) console.error("  → The password in DATABASE_URL is wrong.");
    if (/getaddrinfo ENOTFOUND/.test(e.message ?? "")) console.error("  → The host in DATABASE_URL does not resolve. Copy it again from Supabase → Connect.");
    if (/certificate|self[- ]signed|altname|UNABLE_TO_VERIFY|ERR_TLS/i.test(`${e.message} ${e.code}`)) console.error("  → The database's TLS certificate was not accepted (src/db/tls.ts). For a database outside Supabase, set DATABASE_SSL_CA to its root certificate (PEM).");
    if (/tenant\/user .* not found|Tenant or user not found/i.test(e.message ?? "")) {
      console.error("  → This pooler host does not know the project. Use the exact string from Supabase → Connect → Transaction pooler.");
      await suggestPoolerHost(url);
    }
    process.exitCode = 1;
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(`::error::migrate crashed: ${errorDetail(err)}`);
  process.exitCode = 1;
});
