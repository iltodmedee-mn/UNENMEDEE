import "./net-setup";
import { CheerioCrawler, Configuration, gotScraping, log, LoggerText, type LogLevel, PlaywrightCrawler } from "crawlee";

import { extractTenderMeta, hasTenderSignals } from "./adapters/tender";
import { extractArticle, htmlFragmentToText, MIN_ARTICLE_CHARS, parseDateValue, plainTitle } from "./extractor";
import { findFeedUrl, harvestArticleLinks, harvestSectionLinks, isWordPress, parseFeed, sameSite, wordPressApiBase, wordPressPostsUrl, wordPressPostUrl } from "./links";
import { oneLine } from "@/lib/log-safe";

import { assertPublicHostLiteral, guardGotOptions, isPublicHost } from "./net-guard";
import { applyTlsPolicy, certChecker, certValid, tlsExempt } from "./tls-exempt";
import { getRobots, MAX_CRAWL_DELAY_MS, MIN_DOMAIN_DELAY_MS, type RobotsPolicy, USER_AGENT } from "./robots";
import { isGenericTitle, looksLikeNavigation } from "./titles";
import { SourceRun } from "./source-run";
import type { ScrapedItem, SourceRef, SourceRunResult } from "./types";
import { chromiumExecutablePath } from "@/lib/chromium-path";

/** Storage hooks so the crawler works with the DB or in --dry-run mode. */
export interface ArticleSink {
  /** Returns the subset of URLs not yet stored. */
  filterNewUrls(urls: string[]): Promise<Set<string>>;
  save(source: SourceRef, item: ScrapedItem): Promise<"inserted" | "duplicate">;
  /** A URL whose page holds no article text (a photo post): remembered so it is never fetched again. */
  markNoText?(source: SourceRef, url: string): Promise<void>;
}

export interface CrawlOptions {
  /** Max new articles per source per run. */
  perSourceLimit: number;
  /** Stop gracefully after this many ms (GitHub Actions job budget). */
  budgetMs: number;
  /** Parallel requests across different domains. Same-domain requests are always >= 8s apart. */
  concurrency: number;
  /** Backfill mode: keep only items with a known publication date after this one. */
  since?: Date;
  /** Second pass with headless Chromium for JavaScript-rendered sites. Default true. */
  browser?: boolean;
  /** Hosts read without checking their certificate (`app_settings.tls_broken_hosts`, tls-exempt.ts). Every other host is verified. */
  tlsBrokenHosts?: ReadonlySet<string>;
  onProgress?: (msg: string) => void;
}

type Label = "LISTING" | "FEED" | "WP_API" | "ARTICLE";
type Mode = "http" | "browser";

interface UserData {
  label: Label;
  sourceId: number;
  /** "primary" = source.urlPattern, "home" = homepage fallback, "section" = a news section the splash page links to */
  attempt?: "primary" | "home" | "section";
  /** Harvested HTML links to use if the WP API / feed path fails. */
  fallbackLinks?: string[];
  /** The page's RSS feed: tried when the WordPress REST API fails or is empty. */
  feedUrl?: string;
}

interface SourceState {
  source: SourceRef;
  /** Reports events; its verdict is the only health decision (source-run.ts). */
  run: SourceRun;
  domain: string;
  sourceId: number;
  triedHome: boolean;
  /** Article URLs whose raw HTML had no extractable body: retry them in the browser. */
  needsBrowserArticles: string[];
  /** Section listings queued from a splash page that have not answered yet. */
  pendingSections: number;
  /** Sections are followed once per pass (a section page never fans out again). */
  sectionsTried: boolean;
}

const BODY_MIME_TYPES = ["application/json", "application/rss+xml", "application/atom+xml", "application/xml", "text/xml"];
const BLOCKED_RESOURCES = new Set(["image", "media", "font", "stylesheet"]);

/** The hosts this run may read without a certificate check (set by crawlSources from its options). */
let tlsBroken: ReadonlySet<string> = new Set();

/**
 * robots.txt fetched with the same TLS stance as the pages themselves (tls-exempt.ts: verified,
 * except the hosts the weekly re-check found with a broken certificate), so a listed site's bad
 * certificate does not read as "unreachable".
 */
const robotsFetch = (async (url: string) => {
  assertPublicHostLiteral(url);
  const res = await gotScraping(
    applyTlsPolicy(
      guardGotOptions({
        url,
        headers: { "user-agent": USER_AGENT },
        timeout: { request: 15_000 },
        throwHttpErrors: false,
        useHeaderGenerator: false,
      }),
      tlsBroken,
    ),
  );
  return new Response(res.statusCode === 204 || res.statusCode === 304 ? null : res.body, {
    status: res.statusCode,
    headers: { "content-type": String(res.headers["content-type"] ?? "") },
  });
}) as unknown as typeof fetch;

/**
 * robots.txt files fetched at once before a run. A Promise.all over every source opened 100+ TLS
 * connections together from a GitHub runner, and on Oct 26 2026 ~40 sources failed in the same
 * second with "robots.txt unreachable (ETIMEDOUT)" though most answered in 1–2 s on their own.
 */
const ROBOTS_CONCURRENCY = 8;

/** `fn` over `items`, at most `limit` at a time, results in input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/** A domain's own pause between requests: our 8 s floor, its robots.txt Crawl-delay above that, 20 s at most. */
export function domainDelayMs(policy: Pick<RobotsPolicy, "crawlDelayMs">): number {
  return Math.min(MAX_CRAWL_DELAY_MS, Math.max(MIN_DOMAIN_DELAY_MS, policy.crawlDelayMs ?? 0));
}

/**
 * The share of the time budget kept for the browser pass. Before Oct 29 2026 the HTTP pass
 * always ran out the whole budget (122 sources, 20 s between requests on every domain), the
 * browser pass never started, the JavaScript-only sites were never read and 69 sources a run
 * ended "not reached".
 */
export const BROWSER_BUDGET_SHARE = 0.3;
export function httpBudgetMs(budgetMs: number, browser: boolean): number {
  return browser ? Math.round(budgetMs * (1 - BROWSER_BUDGET_SHARE)) : budgetMs;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function homepage(source: SourceRef): string {
  return `${new URL(source.urlPattern).origin}/`;
}

/** First line of the message; network errors often have none, so fall back to their code. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const e = error as Error & { code?: string; cause?: unknown; errors?: unknown[] };
  const inner = [e.cause, ...(e.errors ?? [])].find((x): x is Error & { code?: string } => x instanceof Error);
  const text = e.message.split("\n")[0].trim() || inner?.message.split("\n")[0].trim() || "";
  const code = e.code ?? inner?.code ?? (inner?.cause as { code?: string } | undefined)?.code;
  // The cause's own first line when the outer message is something else ("fetch failed" ←
  // "connect ETIMEDOUT 1.2.3.4:443"): the outer message alone said nothing about the network.
  const innerText = inner?.message.split("\n")[0].trim() ?? "";
  const withCause = innerText && text && !text.includes(innerText) && !innerText.includes(text) ? `${text} ← ${innerText}` : text;
  // One line: the text reaches the Actions log and `last_error`, and a publisher's error page can
  // put a line break (and a "::error::" workflow command) into it.
  return oneLine((code && !withCause.includes(code) ? `${code} ${withCause}` : withCause || e.name).trim()).slice(0, 300);
}

/**
 * Crawls many government sources:
 *  1. plain HTTP (Cheerio) for every source: WordPress REST API, RSS, or link harvesting;
 *  2. headless Chromium for the sources whose news only appears after JavaScript runs.
 * Different domains run in parallel; each domain gets >= 8s between requests and
 * robots.txt is respected. One dead site never fails the batch.
 */
/**
 * Crawlee's warnings quote request errors, which can carry a publisher's text: each message is
 * printed on one line, so nothing a site sends can start a "::error::" workflow command line.
 */
class OneLineLogger extends LoggerText {
  override _log(level: LogLevel, message: string, data?: unknown, exception?: unknown, opts?: Record<string, unknown>): string {
    const safe = exception instanceof Error ? Object.assign(new Error(oneLine(exception.message)), { name: exception.name, stack: undefined }) : exception;
    return super._log(level, oneLine(message, 1000), data, safe, opts);
  }
}

export async function crawlSources(sources: SourceRef[], sink: ArticleSink, opts: CrawlOptions): Promise<SourceRunResult[]> {
  log.setOptions({ logger: new OneLineLogger() });
  log.setLevel(log.LEVELS.WARNING);
  const progress = opts.onProgress ?? (() => {});
  const deadline = Date.now() + opts.budgetMs;
  const browserEnabled = opts.browser ?? process.env.SCRAPER_BROWSER !== "0";
  tlsBroken = opts.tlsBrokenHosts ?? new Set();
  const checkCert = certChecker();
  /** Browser pass: an https host is either listed (read unverified) or has just passed a verified handshake. */
  const certTrusted = async (url: string): Promise<boolean> => {
    const u = new URL(url);
    if (u.protocol !== "https:" || tlsExempt(u, tlsBroken)) return true;
    return (await (u.port && u.port !== "443" ? certValid(u.hostname, { port: Number(u.port) }) : checkCert(u.hostname))) === true;
  };
  const states = new Map<number, SourceState>(
    sources.map((s) => [
      s.id,
      {
        source: s,
        sourceId: s.id,
        domain: s.domain,
        run: new SourceRun(s.id, s.domain),
        triedHome: false,
        needsBrowserArticles: [],
        pendingSections: 0,
        sectionsTried: false,
      },
    ]),
  );

  // Our own robots.txt check (src/lib/scraper/robots.ts) instead of Crawlee's, which treats an
  // unreachable robots.txt as "allowed", fetches it again before every request and ignores
  // Crawl-delay. RFC 9309: a 5xx or unreachable robots.txt means crawl nothing this run.
  const robotsFor = (url: string) => getRobots(new URL(url).origin, robotsFetch);
  const policies: RobotsPolicy[] = await mapLimit(sources, ROBOTS_CONCURRENCY, (s) => robotsFor(s.urlPattern));
  // Crawlee's sameDomainDelaySecs is one number for every domain, so it stays at the 8 s floor
  // and a domain whose robots.txt asks for more waits the rest here, before each of its requests
  // (one site's 20 s used to slow all 122 domains to 20 s).
  const delayByHost = new Map(sources.map((s, i) => [new URL(s.urlPattern).hostname, domainDelayMs(policies[i])]));
  const lastRequestAt = new Map<string, number>();
  // The slot is reserved before sleeping (like DomainThrottle): two concurrent requests to one
  // host both read the same "last request" time, slept the same amount and fired together.
  const politeWait = async (url: string) => {
    const host = new URL(url).hostname;
    const want = delayByHost.get(host) ?? MIN_DOMAIN_DELAY_MS;
    if (want <= MIN_DOMAIN_DELAY_MS) return; // Crawlee's sameDomainDelaySecs covers the 8 s floor
    const now = Date.now();
    const slot = Math.max(now, (lastRequestAt.get(host) ?? 0) + want);
    lastRequestAt.set(host, slot);
    if (slot > now) await sleep(slot - now);
  };

  // ---------------------------------------------------------------- shared logic
  async function saveItem(state: SourceState, item: ScrapedItem) {
    if (opts.since && (!item.publishedAt || item.publishedAt < opts.since)) {
      // Backfill: older than the window, or undated (it would be stored as "today" and show up
      // as fresh news). Give the slot back to a newer article.
      state.run.unqueued();
      return;
    }
    if (hasTenderSignals(item.text)) {
      const meta = extractTenderMeta(item.text);
      if (Object.keys(meta).length) item.meta = { ...item.meta, ...meta };
    }
    const outcome = await sink.save(state.source, item);
    if (outcome === "inserted") {
      state.run.stored();
      progress(`  ✓ ${state.domain}: ${oneLine(item.title, 90)}`);
    } else {
      state.run.duplicate();
    }
  }

  /** Dedupe against storage, respect the per-source limit, and hand URLs to `add`. */
  async function pickArticles(state: SourceState, urls: string[]): Promise<string[]> {
    const room = opts.perSourceLimit - state.run.found;
    if (room <= 0 || urls.length === 0) return [];
    const unique = [...new Set(urls)];
    const fresh = await sink.filterNewUrls(unique);
    state.run.known(unique.length - fresh.size);
    const picked = [...fresh].slice(0, room);
    state.run.queued(picked.length);
    return picked;
  }

  /** Runs one pass; false when there was no time left to start it. */
  async function runPass(mode: Mode, seed: (add: Adder) => Promise<void>, passDeadline = deadline): Promise<boolean> {
    const remaining = passDeadline - Date.now();
    if (remaining < 30_000) return false;
    const config = new Configuration({ persistStorage: false, purgeOnStart: true });
    let crawler: CheerioCrawler | PlaywrightCrawler;

    /** Queues requests that robots.txt allows; a refused one fails like a failed request. */
    const add: Adder = async (reqs) => {
      const allowed: CrawlRequest[] = [];
      for (const r of reqs) {
        const u = new URL(r.url);
        const policy = await robotsFor(r.url);
        if (policy.isAllowed(u.pathname + u.search)) {
          allowed.push(r);
          continue;
        }
        const why = policy.unavailable ?? `robots.txt disallows ${u.pathname}`;
        const state = states.get(r.userData.sourceId);
        if (state && r.userData.label === "ARTICLE") {
          state.run.unqueued(); // give the slot back
          progress(`  ⛔ ${state.domain} ${r.url}: ${why}`);
        } else {
          await onFailure(r.url, r.userData, new Error(why), add);
        }
      }
      if (allowed.length) await crawler.addRequests(allowed);
    };

    const handle = async (url: string, loadedUrl: string, data: UserData, html: string, add: Adder) => {
      const state = states.get(data.sourceId);
      if (!state) return;
      switch (data.label) {
        case "LISTING":
          return handleListing(mode, state, data, loadedUrl, html, add);
        case "WP_API":
          return handleWpApi(state, data, html, add);
        case "FEED":
          return handleFeed(state, data, html, add);
        case "ARTICLE": {
          const article = extractArticle(html, loadedUrl);
          // A JavaScript site's article URL returns its shell over HTTP: the site's own title over
          // the menu text. Stored, the URL was "known" and never read in the browser, so
          // sport.gov.mn had no published story at all (Nov 2026 audit). The browser pass reads it;
          // only a shell the browser also returns is stored (unpublished, by db-sink).
          const shell = article && isGenericTitle(article.title, [state.source.name]) && looksLikeNavigation(article.text);
          if (article && !(shell && mode === "http")) {
            await saveItem(state, { url, title: article.title, text: article.text, publishedAt: article.publishedAt });
          } else if (mode === "http") {
            state.run.unqueued(); // give the slot back; the browser pass may fill it
            // No text and no browser pass to try: a photo or video post, remembered like the API
            // sources do, so it is not fetched (8 s) again every run.
            if (!article && !browserEnabled) await sink.markNoText?.(state.source, url);
            else state.needsBrowserArticles.push(url);
          } else if (!article) {
            // The browser read it too and found no article text: never fetch it again.
            await sink.markNoText?.(state.source, url);
          }
        }
      }
    };

    const onFailure = async (url: string, data: UserData, error: unknown, add: Adder) => {
      const state = states.get(data.sourceId);
      if (!state) return;
      const message = errorMessage(error);
      if (data.label === "LISTING") {
        if (data.attempt === "section") {
          state.pendingSections -= 1;
          if (state.pendingSections <= 0) {
            state.run.reached();
            if (state.run.found === 0 && state.run.inserted === 0 && !state.run.error) state.run.failed(`listing failed: ${message}`);
          }
        } else if (mode === "http" && !state.triedHome && url !== homepage(state.source)) {
          state.triedHome = true;
          await add([listingRequest(state, homepage(state.source), "home")]);
        } else {
          state.run.failed(`listing failed: ${message}`);
          state.run.reached();
        }
      } else if (data.label === "WP_API" && data.feedUrl) {
        await add([{ url: data.feedUrl, userData: { label: "FEED", sourceId: state.sourceId, fallbackLinks: data.fallbackLinks } satisfies UserData }]);
      } else if ((data.label === "WP_API" || data.label === "FEED") && data.fallbackLinks?.length) {
        const picked = await pickArticles(state, data.fallbackLinks);
        await add(picked.map((u) => articleRequest(state, u)));
      } else if (data.label === "WP_API" || data.label === "FEED") {
        // Nothing else to try: say so instead of counting the run as a success.
        state.run.failed(`${data.label === "WP_API" ? "WordPress API" : "feed"} failed: ${message}`);
        if (mode === "http") state.run.needsBrowser();
      }
      if (data.label === "ARTICLE") {
        state.run.pageFailed(message);
      }
      progress(`  ✗ ${state.domain} ${data.label} ${url} — ${message}`);
    };

    const common = {
      maxConcurrency: mode === "http" ? opts.concurrency : Math.min(4, opts.concurrency),
      sameDomainDelaySecs: MIN_DOMAIN_DELAY_MS / 1000,
      maxRequestRetries: 1,
      navigationTimeoutSecs: 45, // some .gov.mn servers answer slowly from abroad
      requestHandlerTimeoutSecs: 90,
    };

    if (mode === "http") {
      const c: CheerioCrawler = new CheerioCrawler(
        {
          ...common,
          // Crawlee's switch is crawler-wide and is applied after the hooks, so it stays "off" here
          // and applyTlsPolicy (below) turns verification on for every host that is not listed.
          ignoreSslErrors: true,
          // A 404/410 page is not an article (Crawlee hands other 4xx bodies to the handler).
          additionalHttpErrorStatusCodes: [404, 410, 451],
          additionalMimeTypes: BODY_MIME_TYPES,
          preNavigationHooks: [
            async ({ request }, gotOptions) => {
              // Public addresses only, redirects included (net-guard.ts).
              assertPublicHostLiteral(request.url);
              guardGotOptions(gotOptions);
              applyTlsPolicy(gotOptions, tlsBroken);
              await politeWait(request.url);
              gotOptions.headers = { ...gotOptions.headers, "user-agent": USER_AGENT, "accept-language": "mn,en;q=0.8" };
            },
          ],
          requestHandler: async (ctx) => {
            await handle(ctx.request.url, ctx.request.loadedUrl ?? ctx.request.url, ctx.request.userData as UserData, ctx.body.toString(), add);
          },
          failedRequestHandler: async ({ request }, error) => {
            await onFailure(request.url, request.userData as UserData, error, add);
          },
        },
        config,
      );
      crawler = c;
    } else {
      const p: PlaywrightCrawler = new PlaywrightCrawler(
        {
          ...common,
          headless: true,
          launchContext: {
            userAgent: USER_AGENT,
            launchOptions: {
              executablePath: chromiumExecutablePath(),
              args: ["--ignore-certificate-errors"],
            },
          },
          preNavigationHooks: [
            async ({ page, request }) => {
              // Chromium's certificate switch is browser-wide (the listed hosts need it), so every
              // other host must pass one verified handshake first; its sub-requests likewise.
              if (!(await certTrusted(request.url))) throw new Error(`TLS certificate not valid for ${new URL(request.url).hostname} (not in tls_broken_hosts)`);
              await politeWait(request.url);
              // Heavy resources are skipped; a page's scripts must not reach a private address either.
              await page.route("**/*", async (route) => {
                const req = route.request();
                if (BLOCKED_RESOURCES.has(req.resourceType())) return route.abort();
                const { protocol, hostname } = new URL(req.url());
                if ((protocol === "http:" || protocol === "https:") && !(await isPublicHost(hostname))) return route.abort("addressunreachable");
                if (!(await certTrusted(req.url()))) return route.abort("failed");
                return route.continue();
              });
            },
          ],
          requestHandler: async ({ page, request, response }) => {
            const status = response?.status() ?? 200;
            if (status >= 400) return onFailure(request.url, request.userData as UserData, new Error(`HTTP ${status}`), add);
            // Let client-side rendering finish (SPAs fetch their news after load).
            await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
            const html = await page.content();
            await handle(request.url, request.loadedUrl ?? request.url, request.userData as UserData, html, add);
          },
          failedRequestHandler: async ({ request }, error) => {
            await onFailure(request.url, request.userData as UserData, error, add);
          },
        },
        config,
      );
      crawler = p;
    }

    await seed(add);
    const timer = setTimeout(() => {
      progress(`⏱  Time budget reached; stopping the ${mode} pass gracefully.`);
      crawler.stop("time budget reached");
    }, remaining);
    try {
      await crawler.run();
    } finally {
      clearTimeout(timer);
    }
    return true;
  }

  // ---------------------------------------------------------------- handlers
  async function handleListing(mode: Mode, state: SourceState, data: UserData, pageUrl: string, html: string, add: Adder) {
    if (data.attempt === "section") state.pendingSections -= 1;
    if (state.pendingSections <= 0) state.run.reached();
    const links = harvestArticleLinks(html, pageUrl, state.domain, opts.perSourceLimit * 4).map((l) => l.url);
    const feed = mode === "http" ? findFeedUrl(html, pageUrl) : null;
    const sameSiteFeed = feed && sameSite(new URL(feed).hostname, state.domain) ? feed : undefined;

    if (mode === "http" && isWordPress(html)) {
      const perPage = opts.since ? 100 : Math.min(opts.perSourceLimit * 2, 50);
      const after = opts.since ? `&after=${opts.since.toISOString().slice(0, 19)}` : "";
      // The advertised REST base: "/index.php?rest_route=/" on sites without pretty permalinks.
      // The advertised base is the publisher's markup: only on the source's own site.
      const advertised = wordPressApiBase(html, pageUrl);
      const apiBase = sameSite(new URL(advertised).hostname, state.domain) ? advertised : `${new URL(pageUrl).origin}/wp-json/`;
      const api = wordPressPostsUrl(apiBase, `per_page=${perPage}${after}&_fields=id,link,title,date,date_gmt,content`);
      await add([{ url: api, userData: { label: "WP_API", sourceId: state.sourceId, fallbackLinks: links, feedUrl: sameSiteFeed } satisfies UserData }]);
      return;
    }
    if (sameSiteFeed) {
      await add([{ url: sameSiteFeed, userData: { label: "FEED", sourceId: state.sourceId, fallbackLinks: links } satisfies UserData }]);
      return;
    }
    // A splash page (govi-altai's "/" only links to "/home", dornod's to "/j"): follow its news
    // sections once, in this pass, before giving up on the source.
    if (links.length < 3 && !state.sectionsTried) {
      const sections = harvestSectionLinks(html, pageUrl, state.domain).filter((u) => u !== pageUrl);
      if (sections.length) {
        state.sectionsTried = true;
        state.pendingSections += sections.length;
        state.run.pending();
        await add(sections.map((u) => listingRequest(state, u, "section", mode)));
      }
    }
    if (links.length > 0) {
      state.run.recovered();
      const picked = await pickArticles(state, links);
      await add(picked.map((u) => articleRequest(state, u)));
      return;
    }
    if (state.pendingSections > 0) return; // a section page may still deliver the news
    if (mode === "http" && data.attempt === "primary" && !state.triedHome && pageUrl !== homepage(state.source)) {
      state.triedHome = true;
      state.run.pending();
      await add([listingRequest(state, homepage(state.source), "home")]);
      return;
    }
    if (state.run.found > 0 || state.run.inserted > 0) return; // another listing of this source found the news
    if (mode === "http") state.run.needsBrowser();
    state.run.failed(mode === "http" ? "no article links in HTML" : "no article links found even after JavaScript rendering");
  }

  async function handleWpApi(state: SourceState, data: UserData, body: string, add: Adder) {
    let posts: { id?: number; link?: string; title?: { rendered?: string }; date?: string; date_gmt?: string; content?: { rendered?: string } }[] = [];
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) posts = parsed;
    } catch {
      /* REST API disabled or not JSON: fall back to the feed or harvested links */
    }
    if (posts.length === 0) {
      if (data.feedUrl) {
        await add([{ url: data.feedUrl, userData: { label: "FEED", sourceId: state.sourceId, fallbackLinks: data.fallbackLinks } satisfies UserData }]);
        return;
      }
      const picked = await pickArticles(state, data.fallbackLinks ?? []);
      if (picked.length === 0 && !(data.fallbackLinks ?? []).length) state.run.needsBrowser();
      await add(picked.map((u) => articleRequest(state, u)));
      return;
    }
    const origin = new URL(state.source.urlPattern).origin;
    const linkOf = (p: (typeof posts)[number]) => wordPressPostUrl(p, origin);
    const urls = posts.map(linkOf).filter((u): u is string => Boolean(u));
    const fresh = await sink.filterNewUrls(urls);
    state.run.known(urls.length - fresh.size);
    for (const post of posts) {
      const link = linkOf(post);
      if (!link || !fresh.has(link) || state.run.found >= opts.perSourceLimit) continue;
      const text = htmlFragmentToText(post.content?.rendered ?? "");
      if (text.length < MIN_ARTICLE_CHARS) continue;
      state.run.queued();
      // Some installs strip date_gmt from the response (bnd.ub.gov.mn): `date` is site-local time.
      const date = post.date_gmt ? new Date(`${post.date_gmt}Z`) : parseDateValue(post.date);
      await saveItem(state, {
        url: link,
        title: plainTitle(htmlFragmentToText(post.title?.rendered ?? "")) || text.slice(0, 100),
        text,
        publishedAt: date && !Number.isNaN(date.getTime()) ? date : null,
      });
    }
  }

  async function handleFeed(state: SourceState, data: UserData, body: string, add: Adder) {
    const items = parseFeed(body).filter((i) => {
      if (opts.since && i.publishedAt && i.publishedAt < opts.since) return false;
      try {
        return sameSite(new URL(i.url).hostname, state.domain);
      } catch {
        return false;
      }
    });
    const picked = await pickArticles(state, items.length ? items.map((i) => i.url) : (data.fallbackLinks ?? []));
    await add(picked.map((u) => articleRequest(state, u)));
  }

  // ---------------------------------------------------------------- passes
  const httpDeadline = Date.now() + httpBudgetMs(opts.budgetMs, browserEnabled);
  await runPass(
    "http",
    async (add) => {
      await add([...states.values()].map((s) => listingRequest(s, s.source.urlPattern, "primary")));
    },
    httpDeadline,
  );

  const forBrowser = [...states.values()].filter((s) => s.run.needsBrowserListing || s.needsBrowserArticles.length);
  // Without a browser this run (--no-browser after a failed Chromium install, or a launch error
  // below) a JavaScript-only listing was not tried: it keeps its place instead of backing off as
  // "listing reached but no articles were stored".
  if (!browserEnabled) for (const s of forBrowser) s.run.browserUnavailable();
  if (browserEnabled && forBrowser.length) {
    progress(`🖥  Rendering ${forBrowser.length} JavaScript-heavy source(s) in headless Chromium…`);
    try {
      const ran = await runPass("browser", async (add) => {
        const reqs = [];
        for (const s of forBrowser) {
          if (s.run.needsBrowserListing) {
            s.run.pending();
            s.sectionsTried = false;
            s.pendingSections = 0;
            reqs.push(listingRequest(s, s.source.urlPattern, "primary", "browser"));
          }
          const retry = s.needsBrowserArticles.splice(0, Math.max(0, opts.perSourceLimit - s.run.found));
          s.run.queued(retry.length);
          reqs.push(...retry.map((u) => articleRequest(s, u, "browser")));
        }
        await add(reqs);
      });
      // No time left for the browser: a JavaScript-only listing the HTTP pass could not read is
      // not a failure and keeps its place in line; everything the HTTP pass did learn is recorded.
      if (!ran) for (const s of forBrowser) s.run.browserUnavailable();
    } catch (err) {
      for (const s of forBrowser) {
        s.run.reached();
        s.run.browserUnavailable();
      }
      progress(`  ✗ Browser pass unavailable: ${errorMessage(err)} (set CHROMIUM_EXECUTABLE_PATH or run \`npx playwright install chromium\`)`);
    }
  }

  return [...states.values()].map((s) => s.run.result());
}

type CrawlRequest = { url: string; uniqueKey?: string; userData: UserData };
type Adder = (reqs: CrawlRequest[]) => Promise<void>;

function listingRequest(state: { sourceId: number }, url: string, attempt: NonNullable<UserData["attempt"]>, mode: Mode = "http"): CrawlRequest {
  return { url, uniqueKey: `${mode}:${attempt}:${url}`, userData: { label: "LISTING", sourceId: state.sourceId, attempt } };
}

function articleRequest(state: { sourceId: number }, url: string, mode: Mode = "http"): CrawlRequest {
  return { url, uniqueKey: `${mode}:article:${url}`, userData: { label: "ARTICLE", sourceId: state.sourceId } };
}
