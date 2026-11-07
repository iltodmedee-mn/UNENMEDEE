import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// CLAUDE.md rides in every agent turn, so it holds only the mission, the hard rules, the commands
// and one pointer per area; the area rules live in docs/agents/*.md (one place each).
const ROOT = join(import.meta.dirname, "..");
const CLAUDE = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
const MAX_BYTES = 25_000;
const AREA_DOCS = ["stack", "scraper", "ai", "web", "civic", "social", "video", "ops"];

test("CLAUDE.md stays a short index", () => {
  const size = Buffer.byteLength(CLAUDE);
  assert.ok(size <= MAX_BYTES, `CLAUDE.md is ${size} bytes (max ${MAX_BYTES}): move the detail to its docs/agents file`);
});

test("every docs path CLAUDE.md names exists, and every area doc is named", () => {
  for (const [, path] of CLAUDE.matchAll(/`(docs\/[\w./-]+\.md)`/g)) {
    assert.ok(existsSync(join(ROOT, path)), `CLAUDE.md names ${path}, which does not exist`);
  }
  for (const area of AREA_DOCS) {
    assert.ok(CLAUDE.includes(`\`docs/agents/${area}.md\``), `CLAUDE.md has no pointer to docs/agents/${area}.md`);
  }
});

test("a rule lives in one place: no bullet is written twice", () => {
  const files = ["CLAUDE.md", ...readdirSync(join(ROOT, "docs/agents")).map((f) => `docs/agents/${f}`)];
  const seen = new Map<string, string>();
  for (const file of files) {
    for (const line of readFileSync(join(ROOT, file), "utf8").split("\n")) {
      const bullet = line.trim();
      if (!/^(- |\d+\. )/.test(bullet) || bullet.length < 60) continue;
      const first = seen.get(bullet);
      assert.equal(first, undefined, `the same bullet is in ${first} and ${file}: ${bullet.slice(0, 80)}…`);
      seen.set(bullet, file);
    }
  }
});

test("docs/HISTORY.md merges with merge=union, so parallel PRs never conflict there", () => {
  const attributes = readFileSync(join(ROOT, ".gitattributes"), "utf8");
  assert.match(attributes, /^docs\/HISTORY\.md\s+merge=union$/m);
});
