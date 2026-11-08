/**
 * Phone layout check: opens pages in headless Chromium at phone widths and reports every page
 * wider than the screen (horizontal scrolling, content cut off on the right).
 *
 * Nov 2026: a one-line card header made /risk and /clusters/<id> 644 px wide on 360–390 px phones
 * and nothing noticed until a reader sent a screenshot. Two uses:
 *   - CI (`ci.yml` job `mobile-layout`), on the demo build before a merge: exits 1 on an overflow.
 *   - The daily watchdog, on the live site: `--report <file>` writes the overflows as JSON for
 *     `npm run health`, which opens the watchdog issue; the step itself never fails.
 *
 *   npx tsx scripts/check-layout.ts --base http://localhost:3123 --sitemap
 *   npx tsx scripts/check-layout.ts --base https://iltodmedee.mn --sitemap --pages /risk,/clusters --report layout.json
 *
 * The width is compared with the viewport we set, not `innerWidth`: a mobile browser widens its
 * layout viewport to the content, so `scrollWidth > innerWidth` never fires there.
 */
import "@/lib/runtime-banner";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { chromium } from "playwright";

import { layoutPages, type LayoutOverflow } from "@/lib/layout-check";
import { errorDetail, oneLine } from "@/lib/log-safe";
import { chromiumExecutablePath } from "@/lib/chromium-path";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    sitemap: { type: "boolean", default: false },
    pages: { type: "string", default: "" },
    widths: { type: "string", default: "320,360,390" },
    report: { type: "string" },
    "per-section": { type: "string", default: "2" },
  },
});

/**
 * Runs in the page. A string, not a function: tsx compiles named inner functions with a
 * `__name(...)` helper that does not exist in the browser ("ReferenceError: __name").
 */
const MEASURE = `(w) => {
  const clipped = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) return true;
    return false;
  };
  let culprit = "";
  for (const el of document.querySelectorAll("body *")) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.right <= w + 1 || getComputedStyle(el).position === "fixed" || clipped(el)) continue;
    const parent = el.parentElement && el.parentElement.getBoundingClientRect();
    if (parent && parent.right > w + 1 && !clipped(el.parentElement)) continue;
    culprit = el.tagName.toLowerCase() + "." + (el.getAttribute("class") || "").split(" ").slice(0, 4).join(".") + ' "' + (el.textContent || "").trim().slice(0, 40) + '"';
    break;
  }
  return { scrollWidth: document.documentElement.scrollWidth, culprit };
}`;

async function main() {
  const base = values.base!.replace(/\/$/, "");
  let sitemapUrls: string[] = [];
  if (values.sitemap) {
    const res = await fetch(`${base}/sitemap.xml`, { signal: AbortSignal.timeout(30_000) });
    if (res.ok) sitemapUrls = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  }
  const pages = layoutPages(sitemapUrls, (values.pages ?? "").split(",").filter(Boolean), Number(values["per-section"]));
  const widths = values.widths!.split(",").map(Number).filter((w) => w >= 240 && w <= 2000);
  const browser = await chromium.launch({ executablePath: chromiumExecutablePath() });
  const found: LayoutOverflow[] = [];
  let checked = 0;
  try {
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const page = await context.newPage();
      for (const path of pages) {
        try {
          // new URL encodes a Cyrillic query once and leaves the sitemap's %-escapes alone.
          await page.goto(new URL(path, `${base}/`).href, { waitUntil: "networkidle", timeout: 45_000 });
        } catch (err) {
          console.log(`  · ${width}px ${path}: not loaded (${oneLine(err instanceof Error ? err.message : err, 80)})`);
          continue;
        }
        checked++;
        // `content-visibility: auto` (story rows, archive links, footer) skips laying out what is
        // off screen, so an overflow down the page would not show in scrollWidth: lay it all out.
        await page.addStyleTag({ content: "*{content-visibility:visible!important}" });
        const r = (await page.evaluate(`(${MEASURE})(${width})`)) as { scrollWidth: number; culprit: string };
        if (r.scrollWidth > width + 1) {
          found.push({ path, viewport: width, width: r.scrollWidth, culprit: oneLine(r.culprit, 120) });
          console.log(`::error::${width}px ${path} is ${r.scrollWidth}px wide: ${oneLine(r.culprit, 120)}`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`📱 ${checked} page views at ${widths.join("/")} px: ${found.length} wider than the screen.`);
  if (values.report) writeFileSync(values.report, JSON.stringify(found));
  else if (found.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`::error::check-layout: ${errorDetail(err)}`);
  process.exitCode = 1;
});
