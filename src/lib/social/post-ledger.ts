/**
 * The platform post ledger: one module that owns what `social_posts.post_id` means and the whole
 * cycle reserve → publish → record, for every platform.
 *
 * `post_id` is a small state machine, and nothing outside this file reads its strings:
 *   null        reserved: a run is publishing (or died before it could record anything)
 *   "<id>"      posted, the platform's own id
 *   "unknown"   the post may or may not be live (lost answer, id not stored, abandoned
 *               reservation): never posted again, a person checks the page (watchdog line, 7 days)
 *   "failed:n"  the platform refused it n times (only kinds in LIMITED_TRIES keep this; the other
 *               kinds delete the row on a refusal so the next run simply tries again)
 *
 * Interface (depth): `publishOnce` for writing; `neverPosted` / `mayPost` (SQL conditions for
 * story selection), `postedAt`, `countSince`, `lastRealPost`, `unknownSince` for reading.
 * The seam is the `publish` port: five real adapters (Facebook, Threads, Instagram, Telegram,
 * Discord) and a fake in tests/post-ledger.test.ts. Locality: the rules fixed in audits 1–6 live here.
 */
import { and, eq, gte, isNotNull, isNull, lt, type SQL, sql } from "drizzle-orm";

import type { DB } from "@/db";
import { socialPosts } from "@/db/schema";
import { errorLine } from "@/lib/log-safe";
import { UnknownOutcomeError } from "@/lib/social/outcome";

export type PostKind = "digest" | "article" | "quiz" | "weekly" | "video" | "wquiz" | "wquiz_ans" | "announce";

/**
 * Kinds whose refusal is retried at most MAX_TRIES times ("failed:n"), not every run: each try
 * uploads files to the platform (a Reel, the quiz's unpublished photos and containers).
 */
export const LIMITED_TRIES: ReadonlySet<PostKind> = new Set<PostKind>(["video", "wquiz", "wquiz_ans"]);

/** A limited kind the platform refused is tried this many times in all. */
export const MAX_TRIES = 3;

/** A reservation that never got a post id this long ago belongs to a run that died before publishing. */
export const ABANDONED_AFTER_MS = 2 * 3_600_000;

const failedTries = (postId: string | null | undefined) => Number(/^failed:(\d+)$/.exec(postId ?? "")?.[1] ?? 0);

/** True for a row with no post id older than ABANDONED_AFTER_MS (not "unknown", not "failed:n"). */
function abandonedReservation(postId: string | null | undefined, createdAt: Date | null | undefined, now: Date): boolean {
  if (postId !== null && postId !== undefined) return false;
  if (!createdAt) return false;
  return now.getTime() - createdAt.getTime() > ABANDONED_AFTER_MS;
}

export interface PublishRequest {
  platform: string;
  kind: PostKind;
  refId: number;
  /** The port: makes the post public and returns the platform's id. */
  publish(): Promise<string>;
}

export type PublishResult = "posted" | "unknown" | "skipped";

const rowOf = (platform: string, kind: string, refId: number) => and(eq(socialPosts.platform, platform), eq(socialPosts.kind, kind), eq(socialPosts.refId, refId));

/**
 * Reserve, publish, record the id. Only a post the platform clearly refused frees the row for the
 * next run (a limited kind keeps "failed:n" instead, and a refusal is rethrown). Once it may have
 * gone out (published but the DB update failed, or the answer was lost to a timeout) the
 * reservation stays marked for a manual check: a repost would be a duplicate.
 */
export async function publishOnce(db: DB, req: PublishRequest): Promise<PublishResult> {
  const { platform, kind, refId } = req;
  let [row] = await db.insert(socialPosts).values({ platform, kind, refId }).onConflictDoNothing().returning({ id: socialPosts.id });
  let tries = 0;
  if (!row && LIMITED_TRIES.has(kind)) {
    // A post the platform refused before ("failed:n"): claim the row for one more try, atomically.
    const [prev] = await db.select({ postId: socialPosts.postId }).from(socialPosts).where(rowOf(platform, kind, refId));
    tries = failedTries(prev?.postId);
    if (tries > 0 && tries < MAX_TRIES) {
      [row] = await db
        .update(socialPosts)
        .set({ postId: null })
        .where(and(rowOf(platform, kind, refId), eq(socialPosts.postId, `failed:${tries}`)))
        .returning({ id: socialPosts.id });
    }
  }
  if (!row) {
    // A reservation with no post id from a run that died (cancelled, killed) is "already posted"
    // forever and nobody hears of it. It may also be a post that went out before the run died, so
    // it is never posted again here: it becomes "unknown" (a ::warning:: now, a watchdog line for
    // 7 days), the same as any other post whose outcome cannot be known, for a check by hand.
    const [prev] = await db.select({ postId: socialPosts.postId, createdAt: socialPosts.createdAt }).from(socialPosts).where(rowOf(platform, kind, refId));
    if (prev && abandonedReservation(prev.postId, prev.createdAt, new Date())) {
      const marked = await db
        .update(socialPosts)
        .set({ postId: "unknown" })
        .where(and(rowOf(platform, kind, refId), isNull(socialPosts.postId), lt(socialPosts.createdAt, new Date(Date.now() - ABANDONED_AFTER_MS))))
        .returning({ id: socialPosts.id });
      if (marked.length) console.error(`::warning::${platform} ${kind} #${refId}: the run that reserved it at ${prev.createdAt.toISOString()} died before storing a post id. It may or may not be on ${platform}: check the page by hand (marked "unknown", never posted twice).`);
    }
  }
  if (!row) {
    console.log("    already posted, skipped");
    return "skipped";
  }
  let id: string;
  try {
    id = await req.publish();
  } catch (err) {
    // Only the publish call itself can leave the outcome unknown (publishStep / the one-call
    // platforms throw UnknownOutcomeError); a timeout on a container step is a refusal, retried.
    if (err instanceof UnknownOutcomeError || (err as { name?: string } | null)?.name === "UnknownOutcomeError") {
      await db.update(socialPosts).set({ postId: "unknown" }).where(eq(socialPosts.id, row.id));
      console.error(`::warning::${platform} ${kind} #${refId}: no answer (${errorLine(err, 400)}); kept as posted, check the page by hand.`);
      return "unknown";
    }
    if (LIMITED_TRIES.has(kind)) {
      // A refused reel is retried at most MAX_TRIES times, not every 30 min for 48 h
      // (each Facebook try leaves an unpublished upload on the Page).
      const n = tries + 1;
      await db.update(socialPosts).set({ postId: `failed:${n}` }).where(eq(socialPosts.id, row.id));
      if (n >= MAX_TRIES) console.error(`::error::${platform} ${kind} #${refId} refused ${n} times; not tried again.`);
      throw err;
    }
    await db.delete(socialPosts).where(eq(socialPosts.id, row.id));
    throw err;
  }
  console.log(`    ✓ posted ${id}`);
  try {
    await db.update(socialPosts).set({ postId: id }).where(eq(socialPosts.id, row.id));
  } catch (err) {
    // Published: keep the reservation (without its id) rather than posting it again next run.
    console.error(`::warning::${platform} post ${id} went out but its id was not stored: ${errorLine(err, 400)}`);
  }
  return "posted";
}

// --- read side ---------------------------------------------------------------------------------

/** SQL condition: no ledger row at all for this platform + kind + ref (any state counts as taken). */
export const neverPosted = (platform: string, kind: PostKind, ref: unknown): SQL =>
  sql`not exists (select 1 from ${socialPosts} where ${socialPosts.platform} = ${platform} and ${socialPosts.kind} = ${kind} and ${socialPosts.refId} = ${ref})`;

/** SQL condition: not posted, or refused fewer than MAX_TRIES times (a retry is still allowed). */
export const mayPost = (platform: string, kind: PostKind, ref: unknown): SQL =>
  sql`not exists (select 1 from ${socialPosts} where ${socialPosts.platform} = ${platform} and ${socialPosts.kind} = ${kind} and ${socialPosts.refId} = ${ref}
    and (${socialPosts.postId} is null or ${socialPosts.postId} not like 'failed:%' or split_part(${socialPosts.postId}, ':', 2)::int >= ${MAX_TRIES}))`;

/** When this ref really went out on the platform (a refusal does not count), or null. */
export async function postedAt(db: DB, platform: string, kind: PostKind, refId: number): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: socialPosts.createdAt })
    .from(socialPosts)
    .where(and(rowOf(platform, kind, refId), isNotNull(socialPosts.postId), sql`${socialPosts.postId} not like 'failed:%'`));
  return row?.createdAt ?? null;
}

/** How many ledger rows of this kind the platform has had since a moment (the per-day and per-run caps). */
export async function countSince(db: DB, platform: string, kind: PostKind, since: Date): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(socialPosts)
    .where(and(eq(socialPosts.platform, platform), eq(socialPosts.kind, kind), gte(socialPosts.createdAt, since)));
  return r?.n ?? 0;
}

/**
 * The newest post that really went out on a platform (optionally of one kind): a real id only, never
 * a reservation, "unknown" or "failed:n". For the watchdog.
 */
export async function lastRealPost(db: DB, platform: string, kind?: PostKind): Promise<Date | null> {
  const [r] = await db
    .select({ at: sql<Date | string | null>`max(${socialPosts.createdAt})` })
    .from(socialPosts)
    .where(and(eq(socialPosts.platform, platform), kind ? eq(socialPosts.kind, kind) : undefined, isNotNull(socialPosts.postId), sql`${socialPosts.postId} <> 'unknown'`, sql`${socialPosts.postId} not like 'failed:%'`));
  return r?.at ? new Date(r.at) : null;
}

/** Posts whose outcome is unknown, per platform, created in the last `days` days (for the watchdog). */
export async function unknownSince(db: DB, days: number, now: Date = new Date()): Promise<Record<string, number>> {
  const rows = await db
    .select({ platform: socialPosts.platform, n: sql<number>`count(*)::int` })
    .from(socialPosts)
    .where(and(eq(socialPosts.postId, "unknown"), gte(socialPosts.createdAt, new Date(now.getTime() - days * 86_400_000))))
    .groupBy(socialPosts.platform);
  return Object.fromEntries(rows.map((r) => [r.platform, r.n]));
}
