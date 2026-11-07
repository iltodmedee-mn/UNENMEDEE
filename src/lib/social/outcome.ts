/**
 * The platform said yes (2xx) but its answer could not be read or named no post id: the post may
 * well be live, so this is never a refusal that frees the reservation for another try.
 */
export class UnknownOutcomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownOutcomeError";
  }
}

/**
 * True when a publish call failed in a way that says nothing about the post itself: a timeout or a
 * dropped connection. The platform may have published before the answer was lost, so the caller
 * must not try again (scripts/post-social.ts keeps the reservation for a manual check).
 */
export function outcomeUnknown(err: unknown): boolean {
  const e = err as { name?: string; cause?: { code?: string; name?: string } } | null;
  if (!e) return false;
  return e.name === "UnknownOutcomeError" || e.name === "TimeoutError" || e.name === "AbortError" || /^(UND_ERR_|ECONNRESET|ETIMEDOUT|EPIPE)/.test(e.cause?.code ?? "") || e.cause?.name === "SocketError";
}

/** Graph API codes that mean "something went wrong on our side, try again" (is_transient). */
const TRANSIENT_GRAPH_CODES = new Set([1, 2, -1]);

/**
 * True when a failed *publish* call may still have published: a 5xx from the platform, or a Graph
 * error it marks as transient (codes 1, 2, -1). Read from the error's `status` / `code` or from
 * our clients' "<Platform> <status>: … (code <n>)" messages.
 */
export function maybePublished(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (!e) return false;
  const message = typeof e.message === "string" ? e.message : "";
  const status = typeof e.status === "number" ? e.status : Number(message.match(/^[^:]*?\b(\d{3}):/)?.[1] ?? NaN);
  const code = typeof e.code === "number" ? e.code : Number(message.match(/\(code (-?\d+)\)/)?.[1] ?? NaN);
  return status >= 500 || TRANSIENT_GRAPH_CODES.has(code);
}

/**
 * Runs the call that makes a post public. A 5xx or transient Graph error there used to free the
 * reservation, and the next run posted the same story again when the first had gone out: it is
 * an unknown outcome instead (kept for a manual check, never retried). Container creation and
 * status reads stay outside, so their failures can still be retried.
 */
export async function publishStep<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // A 5xx / transient Graph error, or a timeout and a dropped connection INSIDE the publish call:
    // the post may be live. The same timeout on a container step or a status read is a plain
    // failure (nothing public exists yet) and is retried: it used to mark the post "unknown" for
    // good, so one slow Threads status read meant the story was never posted there.
    if (maybePublished(err) || outcomeUnknown(err)) throw new UnknownOutcomeError(`publish answer lost: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
    throw err;
  }
}

/** Graph API throttling codes: app (4), user (17), page (32) and per-action (613) request limits. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

/**
 * True when the platform refused because we called it too often (Nov 7 2026: "Instagram 403:
 * Application request limit reached (code 4)"). Nothing is wrong with the post or the token: the
 * reservation is freed and the next run tries again, so it is a warning, not a failed step.
 */
export function isRateLimited(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (!e) return false;
  const message = typeof e.message === "string" ? e.message : "";
  const status = typeof e.status === "number" ? e.status : Number(message.match(/^[^:]*?\b(\d{3}):/)?.[1] ?? NaN);
  const code = typeof e.code === "number" ? e.code : Number(message.match(/\(code (-?\d+)\)/)?.[1] ?? NaN);
  return status === 429 || RATE_LIMIT_CODES.has(code) || /request limit reached|rate limit/i.test(message);
}
