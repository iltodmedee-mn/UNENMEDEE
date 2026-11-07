/**
 * At-most-once claims over `app_settings`, for scheduled side effects that two workflows (or a
 * retry) could both start: the daily video slot, the digest push, the weekly quiz.
 *
 * Every primitive is ONE statement (an upsert with a `setWhere`, or a conditional update/delete),
 * so the database decides the winner; nothing is read first and then trusted. `now` is always
 * passed in, so expiry rules are testable without the clock.
 */
import { and, eq, sql } from "drizzle-orm";

import type { DB } from "@/db";
import { appSettings } from "@/db/schema";

/** A lease's stored value: `<scope>|<claimed at ISO>`. The scope is whatever the lease guards (a slot start). */
function leaseValue(scope: string, now: Date): string {
  return `${scope}|${now.toISOString()}`;
}

/**
 * May a run take `scope` given the stored lease value? Yes when nothing is stored, when the stored
 * lease is for another scope, or when the same scope's lease is older than `leaseMs` (its run died).
 * A value with no readable claim time (a plain scope from before leases existed) counts as expired.
 */
function leaseFree(stored: string | null, scope: string, now: Date, leaseMs: number): boolean {
  if (!stored) return true;
  const sep = stored.indexOf("|");
  const storedScope = sep < 0 ? stored : stored.slice(0, sep);
  if (storedScope !== scope) return true;
  const claimedAt = sep < 0 ? NaN : Date.parse(stored.slice(sep + 1));
  return Number.isNaN(claimedAt) || now.getTime() - claimedAt >= leaseMs;
}

/**
 * Takes the lease `key` for `scope`. One of several concurrent callers wins and gets a token
 * (pass it to `releaseLease`); the others get null. The write is a compare-and-swap on the value
 * that was read, so two callers who both saw it free cannot both win.
 */
export async function claimLease(db: DB, key: string, o: { scope: string; now: Date; leaseMs: number }): Promise<string | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key));
  const stored = row?.value ?? null;
  if (!leaseFree(stored, o.scope, o.now, o.leaseMs)) return null;
  const token = leaseValue(o.scope, o.now);
  const won = await db
    .insert(appSettings)
    .values({ key, value: token, updatedAt: o.now })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: token, updatedAt: o.now },
      // A first claim has no row to swap: a conflict means someone else inserted meanwhile.
      setWhere: stored === null ? sql`false` : sql`${appSettings.value} = ${stored}`,
    })
    .returning({ key: appSettings.key });
  return won.length > 0 ? token : null;
}

/** Gives a lease back, only if it is still ours (an expired lease another run took over stays theirs). */
export async function releaseLease(db: DB, key: string, token: string): Promise<void> {
  await db.delete(appSettings).where(and(eq(appSettings.key, key), eq(appSettings.value, token)));
}

/** Moves the integer marker `key` forward to `value`. True for exactly one of several concurrent callers; never moves back. */
export async function advanceMarker(db: DB, key: string, value: number): Promise<boolean> {
  const rows = await db
    .insert(appSettings)
    .values({ key, value: String(value) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(value), updatedAt: new Date() }, setWhere: sql`${appSettings.value}::int < ${value}` })
    .returning({ key: appSettings.key });
  return rows.length > 0;
}

/** Gives an advance back: sets the marker to `to` only while it still reads `from` (nobody advanced it further). */
export async function rewindMarker(db: DB, key: string, from: number, to: number): Promise<boolean> {
  const rows = await db
    .update(appSettings)
    .set({ value: String(to), updatedAt: new Date() })
    .where(and(eq(appSettings.key, key), eq(appSettings.value, String(from))))
    .returning({ key: appSettings.key });
  return rows.length > 0;
}

/**
 * Stores `make()`'s text under `key` unless a value written less than `keepIfYoungerThanMs` ago is
 * there; returns what is stored afterwards. `make` runs only when the stored value is old or
 * missing, and may return null (nothing to store: the old value, if any, is returned). The
 * replace is conditional in the database, so a value another run wrote meanwhile is not overwritten.
 */
export async function putOnce(
  db: DB,
  key: string,
  make: () => Promise<string | null> | string | null,
  o: { keepIfYoungerThanMs: number; now: Date },
): Promise<{ value: string | null; written: boolean }> {
  const read = async () => (await db.select({ value: appSettings.value, updatedAt: appSettings.updatedAt }).from(appSettings).where(eq(appSettings.key, key)))[0];
  const cutoff = new Date(o.now.getTime() - o.keepIfYoungerThanMs);
  const before = await read();
  if (before && before.updatedAt > cutoff) return { value: before.value, written: false };
  const value = await make();
  if (value === null) return { value: before?.value ?? null, written: false };
  const rows = await db
    .insert(appSettings)
    .values({ key, value, updatedAt: o.now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: o.now }, setWhere: sql`${appSettings.updatedAt} <= ${cutoff}` })
    .returning({ key: appSettings.key });
  if (rows.length > 0) return { value, written: true };
  return { value: (await read())?.value ?? null, written: false };
}
