import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EXTRACT_MIN_PAGES, extractionBroken, parseExtractionReport } from "@/lib/scraper/recheck";
import { cleanRoute, errorKey } from "@/lib/site-errors";

describe("site error rows", () => {
  it("keeps the route pattern, or the path without its query, on one line", () => {
    assert.equal(cleanRoute("GET", "/article/abc?utm=fb", "/article/[slug]"), "GET /article/[slug]");
    assert.equal(cleanRoute("GET", "/tax?salary=1200000"), "GET /tax");
    assert.equal(cleanRoute("POST", "/a\nb"), "POST /a b");
    assert.ok(cleanRoute("GET", `/${"x".repeat(900)}`).length <= 300);
  });
  it("one key per route and message", () => {
    assert.equal(errorKey("GET /a", "x"), errorKey("GET /a", "x"));
    assert.notEqual(errorKey("GET /a", "x"), errorKey("GET /b", "x"));
    assert.equal(errorKey("GET /a", "x").length, 64);
  });
});

describe("weekly extraction check", () => {
  it("names a site only when most pages that answered gave no text", () => {
    const t = new Map([
      ["broken.gov.mn", { read: 5, empty: 5 }],
      ["mostly.gov.mn", { read: 10, empty: 8 }],
      ["fine.gov.mn", { read: 10, empty: 2 }],
      ["few.gov.mn", { read: EXTRACT_MIN_PAGES - 1, empty: EXTRACT_MIN_PAGES - 1 }],
    ]);
    assert.deepEqual(
      extractionBroken(t).map((b) => b.domain),
      ["broken.gov.mn", "mostly.gov.mn"],
    );
  });
  it("reads only a stored report of the right shape", () => {
    assert.equal(parseExtractionReport(null), null);
    assert.equal(parseExtractionReport("{bad"), null);
    assert.equal(parseExtractionReport('{"at":1}'), null);
    assert.deepEqual(parseExtractionReport('{"at":"2026-11-08T00:00:00Z","broken":[]}'), { at: "2026-11-08T00:00:00Z", broken: [] });
  });
});
