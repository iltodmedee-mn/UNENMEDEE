/**
 * Open petitions to the State Great Khural (petition.parliament.mn) → `indicator_snapshots` key
 * `petitions`, for /participate (src/lib/participation/petitions.ts).
 *
 *   npm run petitions:sync              # read the listing pages, store the open petitions
 *   npm run petitions:sync -- --dry-run # no DB: print them
 *
 * The listing is sorted by signatures; we read pages until one has no open petition (at most
 * MAX_PAGES), through politeFetch (robots.txt, 8 s per host). A run that finds no petition at all
 * keeps the previous snapshot and turns the step red: the page markup probably changed.
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { closeDb, getDb, hasDatabase } from "@/db";
import { indicatorSnapshots } from "@/db/schema";
import { errorDetail, oneLine } from "@/lib/log-safe";
import { isOpen, openPetitions, parsePetitions, type Petition, PETITION_SITE, type PetitionsSnapshot } from "@/lib/participation/petitions";
import { politeFetch } from "@/lib/scraper/http";
import { unshoutTitle } from "@/lib/scraper/titles";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });

const MAX_PAGES = 6;

async function main() {
  const dry = values["dry-run"];
  if (!dry && !hasDatabase()) {
    console.error("✗ DATABASE_URL is not set. Use --dry-run to test without a database.");
    process.exitCode = 1;
    return;
  }
  const now = new Date();
  const all: Petition[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? `${PETITION_SITE}/` : `${PETITION_SITE}/?pageindex=${page}`;
    const res = await politeFetch(url);
    if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
    const cards = parsePetitions(await res.text(), unshoutTitle);
    all.push(...cards);
    if (cards.length === 0 || !cards.some((p) => isOpen(p, now))) break;
  }
  if (all.length === 0) throw new Error("no petition cards found: the listing markup may have changed");
  const { items, skippedNamed } = openPetitions(all, now);
  const snapshot: PetitionsSnapshot = { fetchedAt: now.toISOString(), items, skippedNamed };
  console.log(`✓ ${all.length} cards read, ${items.length} open shown, ${skippedNamed} naming a person left out`);
  for (const p of items.slice(0, 5)) console.log(`  ${p.code} ${p.signatures}/${p.threshold} until ${p.endsAt} ${oneLine(p.title).slice(0, 80)}`);
  if (dry) return;
  const row = { key: "petitions", data: snapshot, asOf: now.toISOString().slice(0, 10), updatedAt: now };
  await getDb().insert(indicatorSnapshots).values(row).onConflictDoUpdate({ target: indicatorSnapshots.key, set: row });
}

main()
  .catch((err) => {
    console.error(`::error::petitions:sync failed: ${errorDetail(err)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
