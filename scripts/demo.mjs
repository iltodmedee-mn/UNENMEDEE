#!/usr/bin/env node
/**
 * `npm run demo`: the whole site on sample data, with no database server and no API keys.
 * Loads real saved responses (tests/fixtures) into an in-process Postgres (PGlite) in .demo-db/,
 * then starts `next dev`. Works the same on Windows, macOS and Linux.
 */
import { spawnSync, spawn } from "node:child_process";

// The one version everything else runs on (package.json engines, .nvmrc, CI, Vercel). An older
// Node reaches the first crash minutes later with an error that names nothing about the version.
const major = Number(process.versions.node.split(".")[0]);
if (major < 24) {
  console.error(`✗ Node.js ${process.versions.node} is too old: this project runs on Node 24 (.nvmrc). Install it from https://nodejs.org or run \`nvm use\`.`);
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: "pglite:./.demo-db" };
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const seed = spawnSync(npx, ["tsx", "scripts/seed-demo.ts"], { stdio: "inherit", env, shell: process.platform === "win32" });
if (seed.status !== 0) process.exit(seed.status ?? 1);

console.log("\n▶ http://localhost:3000  (Ctrl+C to stop)\n");
const dev = spawn(npx, ["next", "dev", ...process.argv.slice(2)], { stdio: "inherit", env, shell: process.platform === "win32" });
dev.on("exit", (code) => process.exit(code ?? 0));
