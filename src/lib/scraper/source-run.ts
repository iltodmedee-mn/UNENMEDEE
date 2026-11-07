import type { SourceRunResult } from "./types";

/**
 * What one run says about one source. This is the only place that decides it, for the Crawlee
 * (HTML) path and the JSON-API path alike; `recordSourceResults` (db-sink.ts) writes it down.
 *
 * - `ok`: the source is healthy (last_error cleared, backoff reset).
 * - `failing`: back it off 2^n hours and say why (`last_error`).
 * - `keepsPlace`: nothing is recorded and the source stays first in line (the time budget ran
 *   out before it was reached, or its JavaScript-only listing could not be tried).
 */
export type Verdict = { kind: "ok" } | { kind: "failing"; reason: string } | { kind: "keepsPlace" };

export const NO_ARTICLES_REASON = "listing reached but no articles were stored";

/**
 * The accumulator of one source's run. Callers report what happened (events) and read the
 * verdict once at the end; they never decide "healthy" themselves.
 *
 * Rules, in order:
 *  1. not reached (budget ran out, or a JavaScript-only listing the browser pass could not try) → keepsPlace
 *  2. something was stored → ok
 *  3. the listing offered articles we already had, and not every new request failed → ok
 *  4. a listing/feed/robots error → failing(that error)
 *  5. every article request failed (403, timeouts) → failing
 *  6. nothing queued and nothing known → failing("listing reached but no articles were stored")
 *  7. otherwise ok (e.g. photo posts, remembered as no-text)
 */
export class SourceRun {
  private foundCount = 0;
  private insertedCount = 0;
  private knownCount = 0;
  private failureCount = 0;
  private lastFailure: string | null = null;
  private listingError: string | null = null;
  private isReached = false;
  private jsListing = false;

  constructor(
    readonly sourceId: number,
    readonly domain: string,
  ) {}

  // ------------------------------------------------------------ events: articles
  /** New article requests/pages we mean to read (not known yet); counts against the per-source limit. */
  queued(n = 1): void {
    this.foundCount += n;
  }
  /** Gives slots back: robots refused them, outside the backfill window, or the browser pass will try. */
  unqueued(n = 1): void {
    this.foundCount -= n;
  }
  /** Articles the listing offered that were already stored. */
  known(n = 1): void {
    this.knownCount += n;
  }
  stored(): void {
    this.insertedCount += 1;
  }
  /** Read, but the sink already had it (same text under another URL). */
  duplicate(): void {
    this.knownCount += 1;
  }
  /** One article request/page failed (403, timeout). */
  pageFailed(message: string): void {
    this.failureCount += 1;
    this.lastFailure = message;
  }

  // ------------------------------------------------------------ events: the listing
  /** The listing, feed or API failed, robots.txt refused or was unavailable, or it held no links. */
  failed(reason: string): void {
    this.listingError = reason;
  }
  /** Links were found after all: an earlier error no longer counts. */
  recovered(): void {
    this.listingError = null;
  }
  /** The listing needs JavaScript: only the browser pass can read it. */
  needsBrowser(): void {
    this.jsListing = true;
  }
  /** Everything this run will do with the source is done. */
  reached(): void {
    this.isReached = true;
  }
  /** Something is still outstanding (a section page, the homepage retry, the browser pass). */
  pending(): void {
    this.isReached = false;
  }
  /** The run cannot go on (time budget): the source keeps its place in line. */
  notReached(): void {
    this.isReached = false;
  }
  /**
   * The browser pass could not run (no Chromium, no time). A JavaScript-only listing with no
   * error and nothing stored was not tried, so it keeps its place; any other source is recorded as
   * it stands, so a dead site backs off instead of sitting at the front of the queue for days.
   */
  browserUnavailable(): void {
    if (this.jsListing && !this.listingError && this.insertedCount === 0) this.isReached = false;
  }

  // ------------------------------------------------------------ reads
  get found(): number {
    return this.foundCount;
  }
  get inserted(): number {
    return this.insertedCount;
  }
  get error(): string | null {
    return this.listingError;
  }
  get needsBrowserListing(): boolean {
    return this.jsListing;
  }

  verdict(): Verdict {
    if (!this.isReached) return { kind: "keepsPlace" };
    if (this.insertedCount > 0) return { kind: "ok" };
    const everyFailed = this.foundCount > 0 && this.failureCount >= this.foundCount;
    if (this.knownCount > 0 && !everyFailed) return { kind: "ok" };
    if (this.listingError) return { kind: "failing", reason: this.listingError };
    if (everyFailed) return { kind: "failing", reason: `every article request failed: ${this.lastFailure ?? "error"}` };
    if (this.foundCount === 0) return { kind: "failing", reason: NO_ARTICLES_REASON };
    return { kind: "ok" };
  }

  result(): SourceRunResult {
    return { sourceId: this.sourceId, domain: this.domain, found: this.foundCount, inserted: this.insertedCount, skippedDuplicates: this.knownCount, verdict: this.verdict() };
  }
}
