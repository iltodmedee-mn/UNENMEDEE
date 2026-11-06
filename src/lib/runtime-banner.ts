import { runtimeLine } from "./runtime-info";

/**
 * Side-effect import for every `scripts/*.ts` entry: prints the runtime line once, before anything
 * else, so the first line of every Actions step and local run names the Node version, commit,
 * database kind and arguments (what a bug report needs first). Silent in tests (`NODE_TEST_CONTEXT`)
 * and with `RUNTIME_BANNER=0`. On stderr, never stdout: `db:backup` streams NDJSON to stdout
 * (`backup.yml` pipes it into gzip and age), and a banner there would be the first line of every
 * backup file and make `db:restore` fail on it.
 */
const g = globalThis as { __iltodBanner?: boolean };
if (!g.__iltodBanner && process.env.RUNTIME_BANNER !== "0" && !process.env.NODE_TEST_CONTEXT) {
  g.__iltodBanner = true;
  console.error(runtimeLine());
}
