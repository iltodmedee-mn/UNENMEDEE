/**
 * Imports the Government's 2024–2028 action programme (State Great Khural resolution No. 21 of
 * 2024-08-27, annex 1) from the official Word file on legalinfo.mn into
 * src/lib/promises/programme-2024.json, which /promises renders. Run it again only if the
 * resolution is amended; the text is stored verbatim.
 *
 *   npm run promises:import -- --dry-run   # print the counts, write nothing
 */
import "@/lib/runtime-banner";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { docxParagraphs, parseProgramme, type Programme } from "@/lib/promises/programme";
import { readZipEntry } from "@/lib/promises/zip";
import { politeFetch } from "@/lib/scraper/http";
import { errorDetail } from "@/lib/log-safe";

const SOURCE_URL = "https://legalinfo.mn/mn/detail?lawId=17141368141311";
const FILE_URL = "https://legalinfo.mn/storage/uploads/process/202409/file_1726126680639198_15996199185590.docx";
const OUT = new URL("../src/lib/promises/programme-2024.json", import.meta.url);

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });

async function main() {
  const res = await politeFetch(FILE_URL, { timeoutMs: 120_000 });
  if (!res.ok) throw new Error(`legalinfo.mn answered ${res.status}`);
  const xml = readZipEntry(Buffer.from(await res.arrayBuffer()), "word/document.xml");
  if (!xml) throw new Error("not a Word file: word/document.xml is missing");
  const parsed = parseProgramme(docxParagraphs(xml.toString("utf8")));
  const goals = parsed.policies.flatMap((p) => p.directions.flatMap((d) => d.sections.flatMap((s) => s.goals)));
  console.log(`📜 ${parsed.policies.length} policies, ${parsed.policies.reduce((n, p) => n + p.directions.length, 0)} directions, ${goals.length} goals, ${parsed.megaProjects.length} mega projects`);
  if (parsed.policies.length !== 4 || goals.length < 500) throw new Error("unexpected structure: the file may have changed, nothing written");
  if (values["dry-run"]) return;
  const programme: Programme = {
    title: "Монгол Улсын Засгийн газрын 2024–2028 оны үйл ажиллагааны хөтөлбөр",
    act: "Улсын Их Хурлын 2024 оны 21 дүгээр тогтоолын 1 дүгээр хавсралт",
    approved: "2024-08-27",
    sourceUrl: SOURCE_URL,
    fileUrl: FILE_URL,
    importedAt: new Date().toISOString().slice(0, 10),
    ...parsed,
  };
  writeFileSync(OUT, `${JSON.stringify(programme, null, 1)}\n`);
  console.log(`✓ wrote ${OUT.pathname}`);
}

main().catch((err) => {
  console.error(`::error::promises:import failed: ${errorDetail(err)}`);
  process.exitCode = 1;
});
