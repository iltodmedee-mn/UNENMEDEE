import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { declarationFlags, formatPercent, sharedShortNames, suspectUnitYears } from "@/lib/officials/flags";
import { hiddenYearsFromText, hiddenYearsToText, parseHiddenYears } from "@/lib/officials/hidden";
import { parseMemberDetail, parseRoster, xacxomIdFromUrl } from "@/lib/officials/parliament";
import { parseDeclarations } from "@/lib/officials/xacxom";

const json = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as unknown;

describe("parliament.mn roster", () => {
  const roster = parseRoster(json("parliament-members.json"));
  it("reads members, party and the parliament term", () => {
    assert.equal(roster.length, 3);
    const m = roster[0];
    assert.equal(m.parliamentMemberId, 2);
    assert.equal(m.fullName, "Жуков Алдаржавхлан");
    assert.equal(m.shortName, "Ж.Алдаржавхлан");
    assert.equal(m.party, "Монгол Ардын нам");
    assert.equal(m.termStart, "2024-07-02");
    assert.equal(m.termEnd, "2028-08-02");
    assert.equal(m.profileUrl, "https://parliament.mn/member/2");
  });

  it("links the member to ХАСХОМ and the latest election", () => {
    const d = parseMemberDetail(json("parliament-member-detail.json"), roster[0]);
    assert.equal(d.xacxomId, "5846381");
    assert.equal(d.constituency, "Хан-Уул");
    assert.equal(d.votes, 40915);
    assert.equal(d.electionSystem, "MAJORITARIAN");
    assert.equal(xacxomIdFromUrl(null), null);
  });
});

describe("ХАСХОМ declarations", () => {
  const rows = parseDeclarations(json("xacxom-declarations.json"));
  it("converts thousand ₮ to ₮ and keeps one row per year", () => {
    assert.deepEqual(rows.map((r) => r.year), [2021, 2022, 2023, 2024, 2025]);
    const y21 = rows[0];
    assert.equal(y21.incomeOwn, 104_700_320);
    assert.equal(y21.buildingsValue, 120_000_000);
    assert.equal(y21.positionName, "ИТХ ын төлөөлөгч");
    assert.equal(y21.totalAssets, 120_000_000 + 29_000_000 + 2_000_000 + 56_453_450);
    assert.match(y21.details.transports ?? "", /X-Trail/);
  });

  it("stores an empty filing as no total, not 0 ₮", () => {
    const sample = (json("xacxom-declarations.json") as { retdata: Record<string, unknown>[] }).retdata[0];
    const empty = Object.fromEntries(Object.keys(sample).map((k) => [k, k === "year" ? 2024 : null]));
    const rows = parseDeclarations({ retdata: [empty] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].totalAssets, null);
  });
});

describe("neutral declaration flags", () => {
  const base = { incomeOwn: 100_000_000, incomeFamily: 0, loans: 0 };
  it("flags a >50% asset jump, loans above income and a missing year", () => {
    const flags = declarationFlags([
      { year: 2021, totalAssets: 100_000_000, ...base },
      { year: 2022, totalAssets: 200_000_000, ...base },
      { year: 2024, totalAssets: 210_000_000, ...base, loans: 350_000_000 },
    ]);
    assert.deepEqual(flags.map((f) => [f.year, f.kind]).sort(), [
      [2022, "asset_jump"],
      [2023, "missing_year"],
      [2024, "loans_over_income"],
    ]);
    assert.ok(flags.every((f) => !/хулгай|авлига|буруу/i.test(f.text)), "flags state numbers, never accusations");
  });

  it("ignores jumps on very small totals and loans below three times the income", () => {
    assert.equal(declarationFlags([{ year: 2021, totalAssets: 1_000_000, ...base }, { year: 2022, totalAssets: 10_000_000, ...base }]).length, 0);
    assert.equal(declarationFlags([{ year: 2022, totalAssets: 100_000_000, ...base, loans: 250_000_000 }]).length, 0);
  });

  it("treats a year 20× away from the others as a suspected unit error and keeps it out of comparisons", () => {
    // Д.Ганмаа's case: one savings line typed in ₮ instead of thousand ₮ made 2025 look 78× richer.
    const two = [
      { year: 2024, totalAssets: 4_160_000_000, ...base },
      { year: 2025, totalAssets: 324_000_000_000, ...base },
    ];
    assert.deepEqual(suspectUnitYears(two), [2024, 2025]);
    const flags = declarationFlags(two);
    assert.deepEqual(flags.map((f) => f.kind), ["unit_suspect"]);
    assert.match(flags[0].text, /2024 ба 2025/);
    assert.match(flags[0].text, /нэгжийн/);
    assert.ok(flags.every((f) => f.kind !== "asset_jump"), "no 7691% jump");

    const three = [
      { year: 2022, totalAssets: 3_900_000_000, ...base },
      { year: 2023, totalAssets: 4_000_000_000, ...base },
      { year: 2024, totalAssets: 4_160_000_000, ...base },
      { year: 2025, totalAssets: 324_000_000_000, ...base },
    ];
    assert.deepEqual(suspectUnitYears(three), [2025]);
    // Two filings at each scale: nobody can tell which pair is off, so all four are in doubt.
    const split = [
      { year: 2022, totalAssets: 300_000_000 },
      { year: 2023, totalAssets: 320_000_000 },
      { year: 2024, totalAssets: 310_000_000_000 },
      { year: 2025, totalAssets: 330_000_000_000 },
    ];
    assert.deepEqual(suspectUnitYears(split), [2022, 2023, 2024, 2025]);
    const note = declarationFlags(split.map((r) => ({ ...r, totalIncome: null, totalLiabilities: null })) as never).filter((f) => f.kind === "unit_suspect");
    assert.equal(note.length, 1);
    assert.match(note[0].text, /2022, 2023, 2024 ба 2025/);
    assert.deepEqual(declarationFlags(three).map((f) => [f.year, f.kind]), [[2025, "unit_suspect"]]);
    assert.deepEqual(suspectUnitYears([{ year: 2024, totalAssets: null }, { year: 2025, totalAssets: 5_000_000_000 }]), []);
  });

  it("caps the shown percentage and keeps colours out of the numbers", () => {
    assert.equal(formatPercent(0.734), "73%");
    assert.equal(formatPercent(-0.2), "20%");
    assert.equal(formatPercent(76.9), "500%+");
  });

  it("finds short names two members share", () => {
    assert.deepEqual([...sharedShortNames([{ shortName: "Д.Цогтбаатар" }, { shortName: "Б.Бейсен" }, { shortName: "Д.Цогтбаатар" }])], ["Д.Цогтбаатар"]);
  });

  it("parses editor-hidden declaration years defensively", () => {
    assert.deepEqual(hiddenYearsFromText("46:2025, 12 : 2023, junk, 46:2025"), { "46": [2025], "12": [2023] });
    assert.equal(hiddenYearsToText({ "46": [2025], "12": [2023] }), "12:2023, 46:2025"); // integer keys come out ascending
    assert.deepEqual(parseHiddenYears(JSON.stringify({ "46": [2025] })), { "46": [2025] });
    assert.deepEqual(parseHiddenYears("{\"46\": [\"x\"]}"), {});
    assert.deepEqual(parseHiddenYears("not json"), {});
    assert.deepEqual(parseHiddenYears(null), {});
  });
});

describe("declaration flags with editor-hidden years", () => {
  const row = (year: number, total: number) => ({ year, totalAssets: total, incomeOwn: 100_000_000, incomeFamily: 0, loans: 0 });
  it("never calls a hidden year a missing filing, and lists every year of a real gap", () => {
    const rows = [row(2021, 400_000_000), row(2022, 410_000_000), row(2024, 420_000_000), row(2025, 430_000_000)];
    const missing = (hidden: number[]) => declarationFlags(rows, hidden).filter((f) => f.kind === "missing_year").map((f) => f.year);
    assert.deepEqual(missing([2023]), []);
    assert.deepEqual(missing([]), [2023]);
    assert.deepEqual(declarationFlags([row(2020, 4e8), row(2023, 4e8)]).filter((f) => f.kind === "missing_year").map((f) => f.year).sort(), [2021, 2022]);
  });
});
