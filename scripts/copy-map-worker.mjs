#!/usr/bin/env node
/**
 * MapLibre 6 runs its tile work in a module worker it loads by URL, and the bundler does not emit it.
 * This copies the worker (self-contained) to public/ before `dev` and `build`; the /money map points
 * MapLibre at it (src/components/money/money-map-view.tsx). The copy is not committed (.gitignore).
 */
import { copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const src = require.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs");
copyFileSync(src, "public/maplibre-gl-worker.mjs");
if (!existsSync("public/maplibre-gl-worker.mjs")) process.exit(1);
