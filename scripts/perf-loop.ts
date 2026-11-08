/**
 * Phone-like load cost of a page, for deciding a speed change (docs/agents/web.md): Chromium at
 * 390 px with the CPU slowed 4x, Chrome's own counters after load, median of N loads. Optional CSS
 * is injected before the first paint, so a CSS idea can be measured on the live site before it is
 * built. Read-only: it only loads the page.
 *
 *   npm run perf -- https://iltodmedee.mn/
 *   npm run perf -- https://iltodmedee.mn/ --runs 5 --css "footer{content-visibility:auto}"
 */
import { parseArgs } from "node:util";

import { chromium, type Browser } from "playwright";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { runs: { type: "string", default: "5" }, css: { type: "string", default: "" } },
});
const url = positionals[0] ?? "https://iltodmedee.mn/";

interface Sample {
  style: number;
  layout: number;
  script: number;
  task: number;
  nodes: number;
}

async function once(browser: Browser): Promise<Sample> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  if (values.css) {
    await page.addInitScript((css: string) => {
      document.addEventListener("DOMContentLoaded", () => {
        const s = document.createElement("style");
        s.textContent = css;
        document.head.append(s);
      });
    }, values.css);
  }
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  // A fresh query string per load, so the CDN cannot hand back a page this run already warmed.
  await page.goto(`${url}${url.includes("?") ? "&" : "?"}perf=${Math.random().toString(36).slice(2)}`, { waitUntil: "load" });
  await page.waitForTimeout(3_000);
  const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  await ctx.close();
  return { style: m.RecalcStyleDuration * 1000, layout: m.LayoutDuration * 1000, script: m.ScriptDuration * 1000, task: m.TaskDuration * 1000, nodes: m.Nodes };
}

async function main() {
  const browser = await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {});
  const runs: Sample[] = [];
  try {
    for (let i = 0; i < Math.max(1, Number(values.runs)); i++) runs.push(await once(browser));
  } finally {
    await browser.close();
  }
  const median = (k: keyof Sample) => {
    const v = runs.map((r) => r[k]).sort((a, b) => a - b);
    return Math.round(v[Math.floor(v.length / 2)]);
  };
  console.log(`${url}${values.css ? " (with injected CSS)" : ""}, median of ${runs.length} at 4x CPU:`);
  console.log(`  style ${median("style")} ms · layout ${median("layout")} ms · script ${median("script")} ms · main thread ${median("task")} ms · ${median("nodes")} nodes`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
