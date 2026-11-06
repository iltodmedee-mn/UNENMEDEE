import { runtimeLine } from "./runtime-info";

/**
 * Side-effect import for every `scripts/*.ts` entry: prints the runtime line once, before anything
 * else, so the first line of every Actions step and local run names the Node version, commit,
 * database kind and arguments (what a bug report needs first). Silent in tests (`NODE_TEST_CONTEXT`)
 * and with `RUNTIME_BANNER=0`.
 */
const g = globalThis as { __iltodBanner?: boolean };
if (!g.__iltodBanner && process.env.RUNTIME_BANNER !== "0" && !process.env.NODE_TEST_CONTEXT) {
  g.__iltodBanner = true;
  console.log(runtimeLine());
}
