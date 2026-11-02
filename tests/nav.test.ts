import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { TOPIC_ICONS } from "@/components/iltod/topic-icon";
import { activeHref, NAV_ALL, NAV_GROUPS, NAV_PRIMARY } from "@/components/layout/nav-data";
import { TOPICS } from "@/lib/topics";

/** The page file a link reaches: a segment with no folder of its own goes to the dynamic `[param]` folder. */
const route = (href: string) => {
  let dir = join(process.cwd(), "src/app");
  for (const seg of href.split("#")[0].split("/").filter(Boolean)) {
    const dynamic = existsSync(dir) ? readdirSync(dir).find((d) => /^\[[^.]+\]$/.test(d)) : undefined;
    dir = existsSync(join(dir, seg)) ? join(dir, seg) : join(dir, dynamic ?? seg);
  }
  return join(dir, "page.tsx");
};

describe("site map (desktop panel, phone menu, footer)", () => {
  it("every link is a real page", () => {
    for (const item of NAV_ALL) assert.ok(existsSync(route(item.href)), `${item.href} has no page.tsx`);
  });

  it("nothing the old menu or footer linked has disappeared (Nov 2026 tidy-up)", () => {
    const hrefs = new Set(NAV_ALL.map((i) => i.href.split("#")[0]));
    const before = ["/", "/digest", "/officials", "/budget", "/tax", "/my", "/data", "/prices", "/tenders", "/documents", "/risk", "/laws", "/promises", "/projects", "/sources", "/changes", "/transparency", "/about", "/clusters", "/archive", "/method", "/privacy"];
    for (const href of before) assert.ok(hrefs.has(href), `${href} is no longer in the menu`);
  });

  it("a page sits in one group only, and the bar's links are all in a group", () => {
    const seen = new Map<string, string>();
    for (const g of NAV_GROUPS) {
      for (const item of g.items) {
        assert.ok(!seen.has(item.href), `${item.href} is in ${seen.get(item.href)} and ${g.key}`);
        seen.set(item.href, g.key);
        assert.ok(item.icon, `${item.href} has no icon`);
      }
    }
    for (const item of NAV_PRIMARY) assert.ok(seen.has(item.href), `${item.href} (bar) is in no group`);
  });

  it("Миний аймаг opens a topic page that exists", () => {
    assert.ok(TOPICS.some((t) => t.key === "local"));
  });

  it("the active page is the longest matching prefix", () => {
    assert.equal(activeHref("/"), "/");
    assert.equal(activeHref("/officials/companies"), "/officials/companies");
    assert.equal(activeHref("/officials/12"), "/officials");
    assert.equal(activeHref("/place/khovd"), "/topic/local#places");
    assert.equal(activeHref("/topic/local"), "/topic/local#places");
    assert.equal(activeHref("/source/mof.gov.mn"), "/sources");
    assert.equal(activeHref("/archive/2026-11-02"), "/archive");
    assert.equal(activeHref("/article/some-story"), null);
    assert.equal(activeHref("/topic/politics"), null);
    assert.equal(activeHref("/taxes"), null);
    assert.equal(activeHref(null), null);
  });
});

describe("topic icons", () => {
  it("every topic, feed filter and the archive's undated group has an icon", () => {
    for (const key of [...TOPICS.map((t) => t.key), "other", "my", "digest", "risk", "undated"]) assert.ok(TOPIC_ICONS[key], `${key} has no icon`);
  });

  it("each tile is the topic's own hue, written out literally for Tailwind", () => {
    for (const t of TOPICS) {
      const hue = t.dot.match(/^bg-utility-([a-z]+)-500$/)?.[1];
      assert.ok(hue, t.key);
      assert.equal(t.tile, `bg-utility-${hue}-500/15 dark:bg-utility-${hue}-500/25`, t.key);
      assert.ok(t.color.includes(`utility-${hue}-`), t.key);
    }
  });
});
