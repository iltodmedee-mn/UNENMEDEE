/**
 * Finds Mongolian government websites we don't monitor yet and adds them as sources.
 * Crawls hub pages (gov.mn, cabinet.gov.mn, khural.mn, ...) plus every active source's
 * homepage, collects *.gov.mn / *.khural.mn hosts, checks each responds with HTML, and
 * inserts it with its <title> as the name.
 *
 *   npm run sources:discover               # insert new sources
 *   npm run sources:discover -- --dry-run  # only print what would be added
 *   npm run sources:discover -- --deep     # also scan every known source's homepage
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { closeDb, getDb, hasDatabase } from "@/db";
import { sources } from "@/db/schema";
import { canonicalHost, classifyDomain, harvestGovernmentHosts, siteName } from "@/lib/scraper/discover";
import { API_MAX_BYTES, politeFetch, readTextLimited } from "@/lib/scraper/http";
import { DISCOVERY_HUBS, SOURCE_SEEDS } from "@/lib/sources";
import { errorLine } from "@/lib/log-safe";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    deep: { type: "boolean", default: false },
    max: { type: "string", default: "300" },
  },
});

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await politeFetch(url, { timeoutMs: 20_000 });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.includes("html")) return null;
    return { html: await readTextLimited(res, API_MAX_BYTES), finalUrl: res.url || url };
  } catch (err) {
    console.warn(`  ⚠ ${url}: ${errorLine(err, 200)}`);
    return null;
  }
}

/** Runs tasks with a concurrency limit (different hosts, so politeness is per host). */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

async function main() {
  const dryRun = values["dry-run"] || !hasDatabase();
  const known = new Set<string>(SOURCE_SEEDS.map((s) => canonicalHost(s.domain)));
  let hubs = [...DISCOVERY_HUBS];
  if (!dryRun) {
    const rows = await getDb().select({ domain: sources.domain, urlPattern: sources.urlPattern }).from(sources);
    for (const r of rows) known.add(canonicalHost(r.domain));
    if (values.deep) hubs = [...new Set([...hubs, ...rows.map((r) => `${new URL(r.urlPattern).origin}/`)])];
  }

  console.log(`🌐 Scanning ${hubs.length} hub page(s) for government domains…`);
  const found = new Map<string, string>(); // host -> hub it came from
  await pool(hubs, 8, async (hub) => {
    const page = await fetchHtml(hub);
    if (!page) return;
    for (const host of harvestGovernmentHosts(page.html, page.finalUrl)) if (!found.has(host)) found.set(host, hub);
  });

  const candidates = [...found.entries()].filter(([host]) => !known.has(host)).slice(0, Number(values.max));
  console.log(`Found ${found.size} government host(s); ${candidates.length} new. Checking each responds…`);

  const added = await pool(candidates, 10, async ([host, hub]) => {
    const page = (await fetchHtml(`https://${host}/`)) ?? (await fetchHtml(`http://${host}/`));
    if (!page || page.html.length < 500) return null;
    const finalHost = canonicalHost(new URL(page.finalUrl).hostname);
    if (finalHost !== host && known.has(finalHost)) return null; // redirect to a source we already track
    return {
      name: siteName(page.html, host),
      domain: host,
      urlPattern: page.finalUrl,
      category: classifyDomain(host),
      discoveredFrom: hub,
    };
  });

  const rows = added.filter((r): r is NonNullable<typeof r> => r !== null);
  for (const r of rows) console.log(`  + ${r.domain.padEnd(32)} [${r.category}] ${r.name}`);

  if (dryRun) {
    console.log(`\n🧪 Dry run: ${rows.length} source(s) would be added.`);
    return;
  }
  if (rows.length) {
    const inserted = await getDb().insert(sources).values(rows).onConflictDoNothing().returning({ id: sources.id });
    console.log(`\n✓ Added ${inserted.length} new source(s).`);
  } else {
    console.log("\nNo new sources.");
  }
}

main()
  .catch((err) => {
    console.error("✗ Discovery failed:", err);
    process.exitCode = 1;
  })
  .finally(closeDb);
