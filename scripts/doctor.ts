/**
 * `npm run doctor`: is this computer set up to run the project, and what to paste into a bug
 * report. Prints the runtime line (Node, commit, database kind), then checks Node 24, the lockfile,
 * whether node_modules matches it, Playwright's Chromium, ffmpeg (videos only) and `.env` names
 * the project does not read. `--clean` removes the demo database and the Next build cache and
 * seeds the demo again: the "fresh start" the docs name. Exit code 1 when a hard check failed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { exampleNames } from "@/lib/env-example";
import { NODE_MAJOR, runtimeLine } from "@/lib/runtime-info";
import { errorDetail } from "@/lib/log-safe";

const { values } = parseArgs({ options: { clean: { type: "boolean", default: false } } });
const root = process.cwd();
let failed = 0;

function ok(line: string) {
  console.log(`  ✓ ${line}`);
}
function warn(line: string) {
  console.log(`  ⚠ ${line}`);
}
function bad(line: string) {
  failed++;
  console.log(`  ✗ ${line}`);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(join(root, path), "utf8")) as T;
  } catch {
    return null;
  }
}

async function main() {
  console.log(runtimeLine({ script: "doctor" }));
  console.log();

  // Node and npm
  const major = Number(process.versions.node.split(".")[0]);
  if (major === NODE_MAJOR) ok(`Node ${process.versions.node}`);
  else bad(`Node ${process.versions.node}: the project runs on Node ${NODE_MAJOR} (.nvmrc). \`nvm use\` or https://nodejs.org`);
  try {
    ok(`npm ${execFileSync("npm", ["-v"], { encoding: "utf8", timeout: 10_000 }).trim()}`);
  } catch {
    warn("npm not found on PATH");
  }

  // Lockfile and node_modules
  const lock = readJson<{ packages?: Record<string, { version?: string }> }>("package-lock.json");
  if (!lock) bad("package-lock.json missing or unreadable: run `git checkout package-lock.json`");
  else ok("package-lock.json present");
  if (!existsSync(join(root, "node_modules"))) bad("node_modules missing: run `npm ci`");
  else if (lock) {
    const want = lock.packages?.["node_modules/next"]?.version;
    const have = readJson<{ version?: string }>("node_modules/next/package.json")?.version;
    if (want && have && want !== have) bad(`node_modules is out of date (next ${have}, lockfile ${want}): run \`npm ci\``);
    else ok(`node_modules matches the lockfile (next ${have ?? "?"})`);
  }

  // Browser and ffmpeg
  try {
    // Loaded lazily: a missing node_modules was reported above.
    const { chromium } = await import("playwright");
    const fromEnv = process.env.CHROMIUM_EXECUTABLE_PATH?.trim() || process.env.CHROMIUM_PATH?.trim();
    const path = fromEnv || chromium.executablePath();
    if (existsSync(path)) ok(`Chromium ${fromEnv ? "(CHROMIUM_EXECUTABLE_PATH)" : "(Playwright)"} ${path}`);
    else warn(`Chromium not installed (${path}): \`npx playwright install chromium\` for the browser pass, videos and the layout scan`);
  } catch {
    warn("playwright not loadable (run `npm ci`)");
  }
  try {
    ok(execFileSync("ffmpeg", ["-version"], { encoding: "utf8", timeout: 10_000 }).split("\n")[0]);
  } catch {
    warn("ffmpeg not found: only `npm run video:make` needs it");
  }

  // .env names the code never reads (a typo there is a setting that silently does nothing)
  if (existsSync(join(root, ".env"))) {
    const known = exampleNames(readFileSync(join(root, ".env.example"), "utf8"));
    const unknown = [...readFileSync(join(root, ".env"), "utf8").matchAll(/^\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]).filter((n) => !known.has(n));
    if (unknown.length) warn(`.env names the project does not read: ${unknown.join(", ")} (compare .env.example)`);
    else ok(".env names all known");
  } else ok("no .env (the demo and `npm run check` need none)");

  if (values.clean) {
    console.log("\n🧹 Fresh start: removing .demo-db/ and .next/, seeding the demo again …");
    for (const dir of [".demo-db", ".next"]) rmSync(join(root, dir), { recursive: true, force: true });
    execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "scripts/seed-demo.ts"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: "pglite:./.demo-db" } });
  }

  console.log(failed ? `\n✗ ${failed} problem(s). Paste this whole output into the bug report.` : "\n✓ Ready. Paste the first line into a bug report when something fails.");
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(`::error::doctor: ${errorDetail(err)}`);
  process.exitCode = 1;
});
