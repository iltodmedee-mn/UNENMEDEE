import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { attendanceHighlight } from "@/lib/opendata-mn/highlights";
import { attributable, declarationFlags } from "@/lib/officials/flags";
import { mentionAlerts } from "@/lib/officials/follow-alerts";
import { linkPeople } from "@/lib/officials/links";
import { parseMemberDetail, parseRoster } from "@/lib/officials/parliament";
import { detailsDegraded, mayRetire } from "@/lib/officials/roster-guard";
import { termLabel, termOf } from "@/lib/officials/terms";
import { findPlace, PLACES, placeMatchesConstituency } from "@/lib/places";
import { mostNamed } from "@/lib/social/weekly";

const json = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;

// Active MPs' constituencies in production on 2026-10-27 (49 list MPs have none).
const PRODUCTION = [
  "Архангай, Өвөрхангай, Баянхонгор",
  "Багануур, Багахангай, Налайх",
  "Баян-Өлгий",
  "Баянгол",
  "Баянзүрх",
  "Булган, Хөвсгөл, Орхон",
  "Говь-Алтай, Завхан, Ховд, Увс",
  "Говьсүмбэр, Дорноговь, Дундговь, Өмнөговь",
  "Дархан-Уул, Сэлэнгэ, Төв",
  "Дорнод, Сүхбаатар, Хэнтий",
  "Сонгинохайрхан",
  "Сүхбаатар, Чингэлтэй",
  "Хан-Уул",
];

describe("after a parliamentary election", () => {
  it("a short or broken roster never retires members", () => {
    assert.ok(mayRetire(126, 126));
    assert.ok(mayRetire(126, 0), "first sync");
    assert.ok(mayRetire(101, 126));
    assert.ok(!mayRetire(100, 126), "below 80 % of the members active now");
    assert.ok(!mayRetire(20, 126), "one page of a paged list");
    assert.ok(!mayRetire(99, 0), "never fewer than 100 seats");
    assert.ok(detailsDegraded(126, 64));
    assert.ok(!detailsDegraded(126, 63));
    assert.ok(!detailsDegraded(0, 0));
  });

  it("a changed API shape reads as unknown, not as empty", () => {
    const roster = json("parliament-members.json");
    const broken = { members: (roster.members as Record<string, unknown>[]).map((m) => ({ ...m, positions: "changed" })) };
    const parsed = parseRoster(broken);
    assert.equal(parsed.length, 3);
    assert.ok(parsed.every((m) => !m.termKnown && m.termStart === null));
    assert.ok(parseRoster(roster).every((m) => m.termKnown));

    const detail = json("parliament-member-detail.json");
    const ok = parseMemberDetail(detail, parseRoster(roster)[0]);
    assert.ok(ok.electionKnown);
    const changed = parseMemberDetail({ ...detail, election_results: { new: "shape" } }, parseRoster(roster)[0]);
    assert.equal(changed.electionKnown, false);
    assert.equal(changed.constituency, null);
    const missing = parseMemberDetail({ ...detail, election_results: undefined }, parseRoster(roster)[0]);
    assert.equal(missing.electionKnown, false);
  });

  it("a new member never inherits a former member's short name", () => {
    const people = [
      { id: 1, shortName: "Б.Бат", isActive: false },
      { id: 2, shortName: "Б.Бат", isActive: true },
      { id: 3, shortName: "Ж.Алдаржавхлан", isActive: true },
      { id: 4, shortName: "Х.Баттулга", isActive: false },
    ];
    assert.deepEqual(attributable(people).map((p) => p.id), [3], "former members are never targets, namesakes never");
    assert.deepEqual(linkPeople(["Б.Бат", "Ж.Алдаржавхлан", "Х.Баттулга"], people), [
      { name: "Б.Бат", id: null },
      { name: "Ж.Алдаржавхлан", id: 3 },
      { name: "Х.Баттулга", id: null },
    ]);
    const alerts = mentionAlerts([{ slug: "a", title: "Б.Бат мэдэгдэл хийлээ", people: ["Б.Бат"] }], people, [{ endpoint: "e", follows: [2] }]);
    assert.deepEqual(alerts, [], "the follower of the new Б.Бат is not alerted about news naming Б.Бат");
    assert.equal(mostNamed([["Б.Бат"], ["Б.Бат"]], people, new Set(["Б.Бат"])), undefined);
    assert.deepEqual(mostNamed([["Х.Баттулга"], ["Х.Баттулга"]], people, new Set()), undefined, "a former member is not this week's most named MP");
  });

  it("parliamentary terms follow the four-year calendar", () => {
    assert.equal(termOf("2024-07-02"), 2024);
    assert.equal(termOf("2024-06-20"), 2020, "the spring session before the election");
    assert.equal(termOf("2027-12-01"), 2024);
    assert.equal(termOf("2028-07-03"), 2028);
    assert.equal(termOf("2031-01-10 00:00:00"), 2028);
    assert.equal(termOf("junk"), null);
    assert.equal(termLabel(2024), "2024–2028");
  });

  it("attendance is counted per member and term", () => {
    const row = (name: string, day: string, arrived: boolean) => ({ "Гишүүдийн нэр": name, "Ирсэн цаг": arrived ? `${day} 10:00:00` : null, Тайлбар: null, "Чуулганы огноо": `${day} 00:00:00` });
    const h = attendanceHighlight([row("Б.Бат", "2023-10-02", false), row("Б.Бат", "2023-10-03", false), row("Б.Бат", "2024-10-01", true)]);
    assert.ok(h?.kind === "attendance");
    assert.equal(h.top.length, 2);
    assert.equal(h.members, 1);
    const newMember = h.top.find((m) => m.term === 2024);
    assert.deepEqual([newMember?.records, newMember?.present, newMember?.unexplained], [1, 1, 0], "the 2020 term's absences stay with that term");
  });

  it("a gap outside the member's seat is not a missing filing", () => {
    const row = (year: number) => ({ year, incomeOwn: 1, incomeFamily: 0, loans: 0, totalAssets: 100_000_000 });
    const rows = [row(2019), row(2020), row(2024), row(2025)];
    const all = declarationFlags(rows).filter((f) => f.kind === "missing_year").map((f) => f.year);
    assert.deepEqual(all.sort(), [2021, 2022, 2023]);
    assert.deepEqual(declarationFlags(rows, [], { from: 2024, to: 2028 }).filter((f) => f.kind === "missing_year"), []);
    const gapInTerm = [row(2024), row(2026)];
    assert.deepEqual(declarationFlags(gapInTerm, [], { from: 2024, to: null }).filter((f) => f.kind === "missing_year").map((f) => f.year), [2025]);
  });

  it("every place finds today's MPs", () => {
    for (const p of PLACES) {
      if (p.kind === "capital") continue;
      const hits = PRODUCTION.filter((c) => placeMatchesConstituency(p, c));
      assert.deepEqual(hits, [p.constituency], p.slug);
    }
  });

  it("a redrawn or renamed constituency still finds its places", () => {
    const khovd = findPlace("khovd")!;
    assert.ok(placeMatchesConstituency(khovd, "Ховд, Увс"));
    assert.ok(placeMatchesConstituency(khovd, "Увс, Ховд аймаг"));
    assert.ok(placeMatchesConstituency(khovd, "3-р тойрог: Ховд"));
    assert.ok(!placeMatchesConstituency(khovd, "Увс, Завхан"));
    assert.ok(!placeMatchesConstituency(khovd, null));

    const aimag = findPlace("sukhbaatar")!;
    const district = findPlace("sukhbaatar-duureg")!;
    assert.ok(placeMatchesConstituency(district, "Чингэлтэй, Сүхбаатар"));
    assert.ok(!placeMatchesConstituency(aimag, "Чингэлтэй, Сүхбаатар"));
    assert.ok(placeMatchesConstituency(aimag, "Сүхбаатар, Дорнод"));
    assert.ok(!placeMatchesConstituency(district, "Сүхбаатар, Дорнод"));
    assert.ok(placeMatchesConstituency(district, "Сүхбаатар дүүрэг"));
    assert.ok(placeMatchesConstituency(aimag, "Сүхбаатар аймаг"));
    assert.ok(!placeMatchesConstituency(aimag, "Сүхбаатар") && !placeMatchesConstituency(district, "Сүхбаатар"), "unmarked and alone: no guess");

    const capital = findPlace("ulaanbaatar")!;
    assert.ok(placeMatchesConstituency(capital, "Хан-Уул"));
    assert.ok(placeMatchesConstituency(capital, "Сүхбаатар, Чингэлтэй"));
    assert.ok(placeMatchesConstituency(capital, "Улаанбаатар"));
    assert.ok(!placeMatchesConstituency(capital, "Дорнод, Сүхбаатар, Хэнтий"));
  });
});

describe("short names spelled with a space (Audit 6 C7)", () => {
  it("'Д. Ганмаа' is the namesake of 'Д.Ганмаа'", () => {
    const people = [
      { shortName: "Д.Ганмаа", isActive: true },
      { shortName: "Д. Ганмаа", isActive: false },
    ];
    assert.deepEqual(attributable(people), []);
  });
});
