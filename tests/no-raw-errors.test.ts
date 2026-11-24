import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";

/**
 * A raw error object printed to a log carries everything inside it: a Drizzle query error holds
 * "params:" with stored tokens, VAPID keys and push endpoints, and Actions logs are public. Errors
 * are printed through errorLine / errorDetail (src/lib/log-safe.ts) only (Nov 2026 audit S-10).
 */
const ROOT = join(import.meta.dirname, "..");
const RAW = /console\.(?:error|log|warn|info)\((?:[^()]*,\s*)?(?:err|error|e|reason)\s*\)/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|mjs)$/.test(name) ? [path] : [];
  });
}

it("no script or source file prints a raw error object", () => {
  const bad = [...files(join(ROOT, "scripts")), ...files(join(ROOT, "src"))]
    .flatMap((f) => readFileSync(f, "utf8").split("\n").map((line, i) => ({ f, line, n: i + 1 })))
    .filter(({ line }) => RAW.test(line))
    .map(({ f, n }) => `${f.slice(ROOT.length + 1)}:${n}`);
  assert.deepEqual(bad, [], "print errors with errorDetail(err) / errorLine(err)");
});
