import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { API_ADAPTERS, apiHost, groupByApiHost } from "@/lib/scraper/adapters";
import { GOVMN_ORGS, govMnListUrl, isGovMnNotFound, parseGovMnArticle, parseGovMnList, rscStream } from "@/lib/scraper/adapters/govmn";
import { parseNhrcmList } from "@/lib/scraper/adapters/nhrcm";
import { SOURCE_SEEDS } from "@/lib/sources";

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, "utf8");

describe("www.gov.mn portal news (govmn.ts)", () => {
  it("reads the organisation's list: story URL, title and the Ulaanbaatar time", () => {
    const list = parseGovMnList(JSON.parse(fixture("govmn-list.json")));
    assert.equal(list.length, 5);
    assert.equal(list[0].url, "https://www.gov.mn/news/n/dd01");
    assert.match(list[0].title, /^УЛСЫН ТӨСВИЙН ХӨРӨНГӨ ОРУУЛАЛТААР/);
    // "2026-10-30T09:12:00" on the portal is Ulaanbaatar time.
    assert.equal(list[0].publishedAt?.toISOString(), "2026-10-30T01:12:00.000Z");
  });

  it("refuses a list that changed shape instead of reading it as empty", () => {
    assert.throws(() => parseGovMnList({ content: [] }), /no items array/);
  });

  it("drops entries whose code is not a story code", () => {
    const list = parseGovMnList({ items: [{ slug: "../admin", title: "x", createdAt: "2026-11-01T10:00:00" }, { slug: "n/ab12", title: "Мэдээ", createdAt: "bad" }] });
    assert.deepEqual(list.map((i) => [i.url, i.publishedAt]), [["https://www.gov.mn/news/n/ab12", null]]);
  });

  it("reads a long story whose text sits in a separate payload row (UTF-8 byte length)", () => {
    const a = parseGovMnArticle(fixture("govmn-article.html"));
    assert.ok(a);
    assert.equal(a.publishedAt?.toISOString(), "2026-10-30T01:12:00.000Z");
    assert.ok(a.text.length > 1000, `text ${a.text.length}`);
    assert.match(a.text, /^2026 оны 10 дугаар сарын 26-30-ны долоо хоногт/);
    // The row ends exactly at its byte length: the last sentence is whole, nothing after it.
    assert.match(a.text, /мэдээллийг тогтмол хүргэх болно\.$/);
    assert.ok(!a.text.includes("fileUrl"));
  });

  it("a photo post has no text, so it is skipped rather than stored as a headline only", () => {
    const a = parseGovMnArticle(fixture("govmn-photo.html"));
    assert.ok(a);
    assert.equal(a.text, "");
  });

  it("tells a deleted story (200 + generic title, no news object) from a real one", () => {
    assert.equal(isGovMnNotFound("<html><head><title>Мэдээ - Цахим үйлчилгээний нэгдсэн портал</title></head><body></body></html>"), true);
    assert.equal(isGovMnNotFound(fixture("govmn-article.html")), false);
    assert.equal(isGovMnNotFound(fixture("govmn-photo.html")), false);
  });

  it("a page without the payload is null", () => {
    assert.equal(parseGovMnArticle("<html><body>Уучлаарай</body></html>"), null);
    assert.equal(rscStream("<script>self.__next_f.push([1,\"a\\nb\"])</script>"), "a\nb");
  });

  it("asks the portal's own list call, at most 20 a page", () => {
    assert.equal(govMnListUrl("mof", 8), "https://www.gov.mn/api/routes/news?page=0&pageSize=8&language=MN&organizationSlug=mof");
  });

  it("every mapped domain is a seeded source and uses the portal adapter", () => {
    const seeded = new Set(SOURCE_SEEDS.map((s) => s.domain));
    for (const domain of Object.keys(GOVMN_ORGS)) {
      assert.ok(seeded.has(domain), `${domain} is not in seed-sources.ts`);
      assert.equal(typeof API_ADAPTERS[domain], "function", domain);
    }
  });
});

describe("API sources run one queue per host (run-scraper.ts)", () => {
  it("puts every portal source in one queue and keeps the others apart, in order", () => {
    const list = ["mof.gov.mn", "police.gov.mn", "customs.gov.mn", "zasag.mn", "legalinfo.mn", "vet.gov.mn"].map((domain) => ({ domain }));
    assert.deepEqual(
      groupByApiHost(list).map((g) => g.map((s) => s.domain)),
      [["mof.gov.mn", "customs.gov.mn", "vet.gov.mn"], ["police.gov.mn"], ["zasag.mn"], ["legalinfo.mn"]],
    );
    assert.equal(apiHost("zasag.mn"), "mongolia.gov.mn");
    assert.equal(apiHost("parliament.mn"), "parliament.mn");
  });
});

describe("nhrcm.gov.mn (nhrcm.ts)", () => {
  it("reads full stories from the list call, with the hash route the site links", () => {
    const items = parseNhrcmList(JSON.parse(fixture("nhrcm-list.json")));
    assert.ok(items.length >= 5);
    assert.equal(items[0].url, "https://nhrcm.gov.mn/#/page/42/post/view/7149");
    assert.equal(items[0].publishedAt?.toISOString(), "2026-10-29T16:00:00.000Z");
    assert.ok(items.every((i) => i.text.length >= 200 && !/<p>/.test(i.text)));
  });

  it("refuses a changed shape", () => {
    assert.throws(() => parseNhrcmList({ data: [] }), /no list array/);
  });
});
