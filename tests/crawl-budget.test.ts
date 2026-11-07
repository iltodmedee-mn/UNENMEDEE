import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BROWSER_BUDGET_SHARE, domainDelayMs, httpBudgetMs } from "@/lib/scraper/crawl";
import { backoffMs, MAX_BACKOFF_H } from "@/lib/scraper/db-sink";
import { MIN_DOMAIN_DELAY_MS } from "@/lib/scraper/robots";

describe("scraper time budget", () => {
  it("keeps a share of the budget for the browser pass, all of it without a browser", () => {
    assert.equal(httpBudgetMs(30 * 60_000, true), Math.round(30 * 60_000 * (1 - BROWSER_BUDGET_SHARE)));
    assert.equal(httpBudgetMs(30 * 60_000, false), 30 * 60_000);
    assert.ok(BROWSER_BUDGET_SHARE > 0.2 && BROWSER_BUDGET_SHARE < 0.5);
  });

  it("paces each domain by its own robots.txt, floor 8 s, cap 20 s", () => {
    assert.equal(domainDelayMs({}), MIN_DOMAIN_DELAY_MS);
    assert.equal(domainDelayMs({ crawlDelayMs: 2_000 }), MIN_DOMAIN_DELAY_MS);
    assert.equal(domainDelayMs({ crawlDelayMs: 15_000 }), 15_000);
    assert.equal(domainDelayMs({ crawlDelayMs: 90_000 }), 20_000);
  });

  it("backs failing sources off 2, 4, 8 hours and never more", () => {
    assert.equal(backoffMs(0), 0);
    assert.equal(backoffMs(1), 2 * 3_600_000);
    assert.equal(backoffMs(2), 4 * 3_600_000);
    assert.equal(backoffMs(3), MAX_BACKOFF_H * 3_600_000);
    assert.equal(backoffMs(6), MAX_BACKOFF_H * 3_600_000);
    assert.equal(MAX_BACKOFF_H, 8);
  });
});
