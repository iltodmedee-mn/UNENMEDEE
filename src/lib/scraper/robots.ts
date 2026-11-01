import { publicFetch } from "./net-guard";

/**
 * Minimal, dependency-free robots.txt support (RFC 9309 + Google wildcard semantics).
 *
 * - Groups are matched by user-agent token; all `User-agent: *` groups are merged.
 * - Longest matching rule wins; `Allow` wins ties.
 * - `*` matches any sequence, `$` anchors the end.
 * - A robots.txt that is missing (4xx) or is not plain text (e.g. an SPA
 *   returning its HTML shell) means "allow everything".
 * - A 5xx or network failure means "disallow everything" for this run (RFC 9309 §2.3.1.4).
 */

export const BOT_NAME = "IlTodBot";
export const USER_AGENT = `Mozilla/5.0 (compatible; ${BOT_NAME}/1.0; +https://iltodmedee.mn)`;

/** Minimum delay between two requests to the same host. CLAUDE.md rule #1. */
export const MIN_DOMAIN_DELAY_MS = 8_000;
/** The longest Crawl-delay we honour (≤ 20 s per request); a longer one is read as this. */
export const MAX_CRAWL_DELAY_MS = 20_000;

interface Rule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  isAllowed(pathAndQuery: string): boolean;
  /** Crawl-delay in ms declared for our agent, if any. */
  crawlDelayMs?: number;
  sitemaps: string[];
  /** Why everything is disallowed when robots.txt could not be read (5xx, timeout, network). */
  unavailable?: string;
}

const ALLOW_ALL: RobotsPolicy = { isAllowed: () => true, sitemaps: [] };
const DISALLOW_ALL: RobotsPolicy = { isAllowed: () => false, sitemaps: [] };

/**
 * Google's robots.txt wildcards without a regular expression: `*` is any run of characters, a
 * trailing `$` anchors the end, otherwise the pattern only has to match a prefix. A regex built
 * from the publisher's file ("/*a*a*a*b") backtracks exponentially on a long path; this greedy
 * matcher keeps one restart point and stays at path × pattern steps at worst.
 */
export function matchesRobotsPattern(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const p = anchored ? pattern.slice(0, -1) : `${pattern}*`;
  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (i < path.length) {
    if (j < p.length && p[j] !== "*" && p[j] === path[i]) {
      i++;
      j++;
    } else if (j < p.length && p[j] === "*") {
      star = j++;
      mark = i;
    } else if (star >= 0) {
      j = star + 1;
      i = ++mark;
    } else {
      return false;
    }
  }
  while (j < p.length && p[j] === "*") j++;
  return j === p.length;
}

/** Looks like an HTML page rather than a robots file. */
function looksLikeHtml(text: string): boolean {
  return /^\s*<(!doctype|html|head|body)/i.test(text);
}

export function parseRobots(text: string, agent: string = BOT_NAME): RobotsPolicy {
  if (!text || looksLikeHtml(text)) return ALLOW_ALL;

  const ua = agent.toLowerCase();
  const sitemaps: string[] = [];
  // Each group: its agents and its rules.
  const groups: { agents: string[]; rules: Rule[]; crawlDelay?: number }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") {
      sitemaps.push(value);
      continue;
    }
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      // An empty Disallow means "allow all" and adds no rule.
      if (!value) continue;
      current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }

  // Prefer groups naming our bot; otherwise merge every `*` group.
  // RFC 9309: a group names our product token, compared as a whole token (case-insensitive). A
  // substring match let "User-agent: bot" or "User-agent: i" groups meant for others apply to us.
  let selected = groups.filter((g) => g.agents.some((a) => a === ua || a.startsWith(`${ua}/`)));
  if (selected.length === 0) selected = groups.filter((g) => g.agents.includes("*"));
  const rules = selected.flatMap((g) => g.rules);
  const delays = selected.map((g) => g.crawlDelay).filter((d): d is number => d !== undefined);

  return {
    sitemaps,
    crawlDelayMs: delays.length ? Math.max(...delays) * 1000 : undefined,
    isAllowed(pathAndQuery: string) {
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!matchesRobotsPattern(rule.pattern, pathAndQuery)) continue;
        if (
          !best ||
          rule.pattern.length > best.pattern.length ||
          (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
        ) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}

const cache = new Map<string, Promise<RobotsPolicy>>();

/** RFC 9309 § 2.5: at least 500 KiB must be parsed; more is not needed. */
export const ROBOTS_MAX_BYTES = 500 * 1024;

/** The first `maxBytes` of a body (counted after decompression), the rest left unread. */
async function readHead(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
}

/** A network error (timeout, reset) gets one more try after this pause; a 5xx answer does not. */
export const ROBOTS_RETRY_MS = 3_000;

/** Fetches (once per origin per process) and parses robots.txt. */
export function getRobots(origin: string, fetchImpl: typeof fetch = publicFetch, retryMs = ROBOTS_RETRY_MS): Promise<RobotsPolicy> {
  const cached = cache.get(origin);
  if (cached) return cached;
  const promise = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchImpl(`${origin}/robots.txt`, {
          headers: { "user-agent": USER_AGENT },
          redirect: "follow",
          signal: AbortSignal.timeout(15_000),
        });
        // RFC 9309: an unreachable robots.txt (5xx, network error) means "crawl nothing" for now.
        if (res.status >= 500) return { ...DISALLOW_ALL, unavailable: `robots.txt answered HTTP ${res.status}` };
        if (!res.ok) return ALLOW_ALL;
        const type = res.headers.get("content-type") ?? "";
        if (type.includes("html")) return ALLOW_ALL;
        // RFC 9309 lets a crawler stop reading at 500 KiB; a bigger file is read up to that.
        const text = await readHead(res, ROBOTS_MAX_BYTES);
        return parseRobots(text);
      } catch (err) {
        // Slow .gov.mn hosts drop a connection now and then: one failed attempt used to take the
        // source out of the run and start its backoff.
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, retryMs));
          continue;
        }
        const e = err as { name?: string; code?: string; cause?: { code?: string } };
        return { ...DISALLOW_ALL, unavailable: `robots.txt unreachable (${e.cause?.code ?? e.code ?? e.name ?? "error"})` };
      }
    }
  })();
  cache.set(origin, promise);
  return promise;
}

export async function isAllowedByRobots(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const u = new URL(url);
  const policy = await getRobots(u.origin, fetchImpl);
  return policy.isAllowed(u.pathname + u.search);
}

/** Per-host politeness scheduler: guarantees >= delay between request starts to one host. */
export class DomainThrottle {
  private nextSlot = new Map<string, number>();

  constructor(private readonly minDelayMs: number = MIN_DOMAIN_DELAY_MS) {}

  async wait(host: string, extraDelayMs = 0): Promise<void> {
    const delay = Math.max(this.minDelayMs, extraDelayMs);
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + delay);
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  }
}
