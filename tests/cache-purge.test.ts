import assert from "node:assert/strict";
import { test } from "node:test";

import { allowedTags, NONCE_TTL_MS, nonceValid, nonceValue, RUN_TAGS } from "@/lib/cache-purge";

const NOW = new Date("2026-11-08T04:00:00Z");
const N = "a".repeat(64);

test("a fresh nonce is accepted once it matches exactly", () => {
  const stored = nonceValue(N, new Date(NOW.getTime() - 60_000));
  assert.equal(nonceValid(stored, N, NOW), true);
  assert.equal(nonceValid(stored, "b".repeat(64), NOW), false);
  assert.equal(nonceValid(stored, N.slice(1), NOW), false);
  assert.equal(nonceValid(stored, 42, NOW), false);
  assert.equal(nonceValid(null, N, NOW), false);
});

test("an old or a future-dated nonce is refused", () => {
  assert.equal(nonceValid(nonceValue(N, new Date(NOW.getTime() - NONCE_TTL_MS - 1)), N, NOW), false);
  assert.equal(nonceValid(nonceValue(N, new Date(NOW.getTime() + 5 * 60_000)), N, NOW), false);
  assert.equal(nonceValid(`${N}|not a date`, N, NOW), false);
});

test("only known tags are purged; the default is the list pages, not every article", () => {
  assert.deepEqual(allowedTags(undefined), RUN_TAGS);
  assert.ok(!RUN_TAGS.includes("articles"));
  assert.deepEqual(allowedTags(["feed", "officials", "articles", "feed"]), ["feed", "articles"]);
});
