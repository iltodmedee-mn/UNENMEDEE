import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";

/**
 * A server action is a public POST endpoint: every exported async function in a "use server"
 * file under src/app/admin must call requireAdmin() before it does anything (audit T-4). The
 * login and logout actions have their own checks and are listed by name.
 */
const ADMIN = join(import.meta.dirname, "..", "src", "app", "admin");
const OWN_CHECK = new Set(["login", "logout"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

it("every admin server action calls requireAdmin() first", () => {
  const missing: string[] = [];
  let seen = 0;
  for (const file of files(ADMIN)) {
    const src = readFileSync(file, "utf8");
    if (!/^["']use server["'];?/m.test(src)) continue;
    for (const m of src.matchAll(/^export async function (\w+)\([^)]*\)[^{]*\{\n([^\n]*)/gm)) {
      seen++;
      if (OWN_CHECK.has(m[1])) continue;
      if (!/^\s*await requireAdmin\(\);/.test(m[2])) missing.push(`${file.slice(ADMIN.length + 1)}: ${m[1]}`);
    }
  }
  assert.ok(seen >= 10, `found only ${seen} actions: the pattern no longer matches`);
  assert.deepEqual(missing, []);
});
