/**
 * `.env.example` is the complete list of the environment names the code reads: every name has a
 * `NAME=` line, commented out when optional. `tests/env-example.test.ts` fails when the code reads
 * a name the file does not list (or lists one nothing reads), and `npm run doctor` warns about a
 * `.env` name that is not in it. Platform names (VERCEL_*, GITHUB_*, NODE_ENV…) are not listed.
 */
export function exampleNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)) names.add(m[1]);
  return names;
}

/** Names set by the platform or the workflows, not by a person in `.env`. */
export const PLATFORM_NAMES = /^(VERCEL|VERCEL_(ENV|URL|PROJECT_PRODUCTION_URL|GIT_[A-Z_]+)|GITHUB_[A-Z_]+|NODE_ENV|NEXT_PHASE|NEXT_RUNTIME|CI|NODE_TEST_CONTEXT|RUNTIME_BANNER|npm_[a-z_]+)$/;

/** Every environment name a source file reads: process.env.X, env.X, env["X"], num(env, "X"), envNumber(env, "X"). */
export function envNamesIn(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(/\b(?:process\.)?env\.([A-Z][A-Z0-9_]+)\b/g)) names.add(m[1]);
  for (const m of source.matchAll(/\benv\[\s*"([A-Z][A-Z0-9_]+)"\s*\]/g)) names.add(m[1]);
  for (const m of source.matchAll(/\b(?:num|envNumber|flag)\(\s*env,\s*"([A-Z][A-Z0-9_]+)"/g)) names.add(m[1]);
  return names;
}
