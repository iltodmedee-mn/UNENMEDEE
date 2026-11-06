import { execFileSync } from "node:child_process";
import { basename } from "node:path";

/** The Node major the project is built and run on (package.json engines, .nvmrc, every workflow, Vercel). */
export const NODE_MAJOR = 24;

/** The database kind from a connection string, never its credentials: "pglite", "supabase (host)", "postgres (host)", "none". */
export function databaseKind(url: string | undefined): string {
  if (!url) return "none";
  if (url.startsWith("pglite:")) return "pglite";
  try {
    const host = new URL(url).hostname;
    return `${host.endsWith(".supabase.com") || host.endsWith(".supabase.co") ? "supabase" : "postgres"} (${host})`;
  } catch {
    return "postgres (unparsable URL)";
  }
}

/** The commit this code is from: the platform's variable, else git, else "unknown". */
export function commitSha(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.GITHUB_SHA || env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * One line naming the runtime, for the first line of every script's output and the doctor:
 * "▸ process-ai.ts · node v24.11.0 linux-x64 · commit 1e6d0fd · db supabase (aws-…) · args --limit 60".
 * A bug report that carries it answers "which version, which commit, which database" at once.
 * Never a credential: the database is its host only.
 */
export function runtimeLine(opts: { script?: string; args?: string[]; env?: NodeJS.ProcessEnv } = {}): string {
  const env = opts.env ?? process.env;
  const script = opts.script ?? (process.argv[1] ? basename(process.argv[1]) : "node");
  const parts = [`▸ ${script}`, `node ${process.version} ${process.platform}-${process.arch}`, `commit ${commitSha(env)}`, `db ${databaseKind(env.DATABASE_URL)}`];
  const where = env.GITHUB_ACTIONS ? "GitHub Actions" : env.VERCEL ? "Vercel" : env.CI ? "CI" : null;
  if (where) parts.push(where);
  const args = opts.args ?? process.argv.slice(2);
  if (args.length) parts.push(`args ${args.join(" ")}`);
  return parts.join(" · ");
}
