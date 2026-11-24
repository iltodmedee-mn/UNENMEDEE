import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";

/**
 * Heavy client libraries stay off the pages served most (audit P-10): the ~126 MP pages draw their
 * asset line as server SVG, and the root providers carry no React Aria router.
 */
const read = (p: string) => readFileSync(join(import.meta.dirname, "..", p), "utf8");

it("MP pages and the root providers load no chart or router library", () => {
  assert.doesNotMatch(read("src/app/officials/[id]/page.tsx"), /components\/iltod\/charts|from "recharts"/);
  assert.doesNotMatch(read("src/components/providers.tsx"), /react-aria/);
});
