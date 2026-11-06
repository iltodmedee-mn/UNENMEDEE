import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { envNamesIn, exampleNames, PLATFORM_NAMES } from "@/lib/env-example";

const ROOT = join(import.meta.dirname, "..");

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (/\.(ts|tsx|mjs)$/.test(name)) yield p;
  }
}

/** Names whose provider prefix the code builds at runtime (`${PROVIDER}_DAILY_MAX_CALLS`, `AI_TIER${n}_CHAIN`). */
const DYNAMIC = /^(([A-Z]+)_(DAILY_MAX_CALLS|RPM|PRICE_IN|PRICE_OUT)|AI_TIER[12]_CHAIN)$/;
/** Read by the workflows' shell steps only (never by the code), yet set by a person. */
const WORKFLOW_ONLY = new Set(["DATABASE_URL_DIRECT"]);

describe(".env.example is the complete list of environment names", () => {
  const example = exampleNames(readFileSync(join(ROOT, ".env.example"), "utf8"));
  const read = new Set<string>();
  for (const dir of ["src", "scripts"]) for (const f of sourceFiles(join(ROOT, dir))) for (const n of envNamesIn(readFileSync(f, "utf8"))) read.add(n);

  it("finds the names the code reads", () => {
    for (const n of ["DATABASE_URL", "GROQ_API_KEY", "GEMINI_FREE_TIER", "AI_MONTHLY_BUDGET_USD", "ELEVENLABS_RESERVE_CHARS", "CHROMIUM_EXECUTABLE_PATH"]) assert.ok(read.has(n), n);
  });

  it("every name the code reads has a line in .env.example", () => {
    const missing = [...read].filter((n) => !PLATFORM_NAMES.test(n) && !example.has(n)).sort();
    assert.deepEqual(missing, [], `add to .env.example (commented out when optional): ${missing.join(", ")}`);
  });

  it("every line in .env.example is read by the code", () => {
    const unread = [...example].filter((n) => !read.has(n) && !DYNAMIC.test(n) && !WORKFLOW_ONLY.has(n)).sort();
    assert.deepEqual(unread, [], `nothing reads: ${unread.join(", ")} (remove the line or read it)`);
  });

  it("parses NAME= lines whether commented out or not", () => {
    assert.deepEqual([...exampleNames('AA=""\n# BB="x"\n#   CC=1\n# not a name\ndd=1\n')], ["AA", "BB", "CC"]);
    assert.deepEqual([...envNamesIn('process.env.XX; env.YY ?? 1; env["ZZ"]; num(env, "NN", 3); envNumber(env, "MM", 1); opts.env.QQ')].sort(), ["MM", "NN", "QQ", "XX", "YY", "ZZ"]);
  });
});
