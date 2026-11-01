import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ALL_GOALS, PROGRAMME } from "@/lib/promises";
import { BUDGET_KIND_LABEL, findProject, latestBudget, officialSpent, perPerson, projectLd, projectListLd, PROJECTS, PROJECTS_VERIFIED_THROUGH, projectUrls, sinceLabel, sourceKind, STAGES, whenLabel, whenToDate, yearsSince } from "@/lib/projects";

const WHEN = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAGE_KEYS = new Set(STAGES.map((s) => s.key));
const BUDGET_KINDS = new Set(Object.keys(BUDGET_KIND_LABEL));

/** Words that would turn a fact into a verdict. The page quotes bodies and budgets, never judges. */
// Stems, so every inflection is caught: "авлигын", "завшиж", "үрэн таран", "хулгайлсан".
const VERDICT = /үрсэн|үрэн\s*тар|алдсан|авлиг|хулгай|луйвар|цаасан дээр|худал|хуурсан|завш|зальж/i;

function texts(p: (typeof PROJECTS)[number]): string[] {
  return [p.name, p.summary, p.announced.act, p.planned?.note ?? "", p.stage.basis, ...p.budgets.map((b) => b.note ?? ""), ...p.events.map((e) => e.text), ...p.people.map((x) => `${x.role} ${x.name}`)];
}

describe("projects dataset", () => {
  it("has unique slugs and every entry carries its sources and dates", () => {
    assert.equal(new Set(PROJECTS.map((p) => p.slug)).size, PROJECTS.length);
    assert.ok(PROJECTS.length >= 8);
    for (const p of PROJECTS) {
      assert.match(p.slug, /^[a-z0-9-]+$/, p.slug);
      assert.ok(p.events.length >= 1, `${p.slug}: events`);
      assert.ok(STAGE_KEYS.has(p.stage.level), `${p.slug}: stage`);
      assert.ok(p.stage.basis.length > 20, `${p.slug}: stage basis`);
      assert.match(p.verifiedThrough, ISO_DAY);
      assert.ok(p.verifiedThrough <= PROJECTS_VERIFIED_THROUGH, `${p.slug}: verifiedThrough`);
      assert.match(p.announced.date, WHEN, `${p.slug}: announced`);
      assert.match(p.stage.asOf, WHEN, `${p.slug}: stage asOf`);
      for (const e of p.events) assert.match(e.date, WHEN, `${p.slug}: ${e.text}`);
      for (const x of p.people) assert.match(x.from, WHEN, `${p.slug}: ${x.name}`);
      if (p.planned) {
        assert.ok(p.planned.amount > 0);
        assert.match(p.planned.asOf, WHEN);
      }
      for (const b of p.budgets) {
        assert.ok(b.amount > 0, `${p.slug}: ${b.year}`);
        assert.ok(b.year >= 2000 && b.year <= 2035);
        assert.ok(BUDGET_KINDS.has(b.kind));
      }
      // Nothing on the page is dated after the day its sources were read.
      const dates = [p.announced.date, p.stage.asOf, p.planned?.asOf, ...p.events.map((e) => e.date), ...p.people.map((x) => x.from)].filter((d): d is string => !!d);
      for (const d of dates) assert.ok(whenToDate(d).getTime() <= new Date(`${p.verifiedThrough}T23:59:59Z`).getTime(), `${p.slug}: ${d} after verifiedThrough`);
      for (const u of projectUrls(p)) {
        assert.match(u, /^https:\/\//, `${p.slug}: ${u}`);
        assert.doesNotThrow(() => new URL(u));
      }
      assert.ok(p.links.search.length >= 1);
      if (p.links.megaIndex !== undefined) assert.ok(PROGRAMME.megaProjects[p.links.megaIndex], `${p.slug}: megaIndex`);
    }
    assert.ok(ALL_GOALS.length > 0);
  });

  it("never judges: no verdict words in any text", () => {
    for (const p of PROJECTS) for (const t of texts(p)) assert.doesNotMatch(t, VERDICT, `${p.slug}: ${t}`);
  });

  it("links the mega projects of the programme to the right entries", () => {
    assert.match(PROGRAMME.megaProjects[findProject("oil-refinery")!.links.megaIndex!], /^Газрын тос боловсруулах/);
    assert.match(PROGRAMME.megaProjects[findProject("erdeneburen-hpp")!.links.megaIndex!], /^Эрдэнэбүрэнгийн 90 МВт/);
    assert.match(PROGRAMME.megaProjects[findProject("egiin-gol-hpp")!.links.megaIndex!], /^Эгийн голын 310 МВт/);
    assert.match(PROGRAMME.megaProjects[findProject("tavantolgoi-tpp")!.links.megaIndex!], /^Тавантолгойн 450 МВт/);
    assert.match(PROGRAMME.megaProjects[findProject("national-satellite")!.links.megaIndex!], /^Үндэсний хиймэл дагуул/);
  });
});

describe("projects helpers", () => {
  it("reads partial dates and labels them as precisely as the source", () => {
    assert.equal(whenLabel("2018"), "2018 он");
    assert.equal(whenLabel("2025-05"), "2025 оны 5-р сар");
    assert.equal(whenLabel("2025-03-26"), "2025 оны 3-р сарын 26");
    assert.equal(whenToDate("2018").toISOString().slice(0, 10), "2018-07-01");
    assert.equal(whenToDate("2025-05").toISOString().slice(0, 10), "2025-05-01");
  });

  it("counts whole years and months since the first act", () => {
    const today = new Date("2026-10-29T00:00:00Z");
    assert.deepEqual(yearsSince("2022-12-20", today), { years: 3, months: 10 });
    assert.equal(sinceLabel("2022-12-20", today), "3 жил 10 сар");
    assert.equal(sinceLabel("2025-10-29", today), "1 жил");
    assert.equal(sinceLabel("2026-04-01", today), "6 сар");
    assert.equal(sinceLabel("2027-01-01", today), "0 сар");
  });

  it("sums only reported spending and picks the firmest lines of the newest year", () => {
    const kh = findProject("shine-kharkhorum")!;
    assert.equal(officialSpent(kh), 0);
    assert.deepEqual(
      latestBudget(kh).map((b) => [b.year, b.kind]),
      [
        [2026, "approved"],
        [2026, "amendment"],
      ],
    );
    const refinery = findProject("oil-refinery")!;
    assert.equal(officialSpent(refinery), 706.36e9);
    assert.deepEqual(
      latestBudget(refinery).map((b) => [b.year, b.kind]),
      [[2025, "plan"]],
    );
    assert.equal(latestBudget(findProject("ub-metro")!).length, 0);
  });

  it("gives a per-person share only for ₮ amounts of a billion and more", () => {
    assert.equal(perPerson(5e8), null);
    assert.match(perPerson(706.36e9)!, /^≈ \d[\d ]*₮$/);
  });

  it("tells official pages from state media and the press", () => {
    assert.equal(sourceKind("https://mongolia.gov.mn/news/view/27036"), "official");
    assert.equal(sourceKind("https://mcud.gov.mn/a/1295"), "official");
    assert.equal(sourceKind("https://kharkhorum.gov.mn/about-us"), "official");
    assert.equal(sourceKind("https://montsame.mn/mn/read/363864"), "state-media");
    assert.equal(sourceKind("https://news.mnb.mn/i/350900"), "state-media");
    assert.equal(sourceKind("https://ikon.mn/n/3b1e"), "press");
    assert.equal(sourceKind("not a url"), "press");
  });

  it("builds JSON-LD naming the sources", () => {
    const list = projectListLd() as { "@graph": { mainEntity?: { itemListElement: unknown[] } }[] };
    assert.equal(list["@graph"][0].mainEntity!.itemListElement.length, PROJECTS.length);
    const one = projectLd(findProject("shine-kharkhorum")!) as { "@graph": { isBasedOn?: string[] }[] };
    // Exact match on the whole URL (CodeQL reads `includes` on a string as a substring check).
    assert.ok(one["@graph"][0].isBasedOn!.some((u) => u === "https://kharkhorum.gov.mn/about-us"));
  });
});
