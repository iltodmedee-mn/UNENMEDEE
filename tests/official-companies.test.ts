import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { allPages, checkCompany } from "@/lib/officials/companies-sync";
import { bareName, type CompanyCheck, declaredCompanies, dueKeys, exactMatches, foundKeys, isOrgName, matchWinners, orgKey, parsePayers, parseSuppliers, searchQueries, winnerKeys } from "@/lib/officials/companies";

const fixture = (f: string) => JSON.parse(readFileSync(`tests/fixtures/shilendans/${f}`, "utf8")) as unknown;

describe("companies named in a declaration", () => {
  it("one key for every spelling of the same company", () => {
    // М.Энхцэцэг's 2025 filing names the same lender twice: "Бодит чадал ХХК, Бодитчадал ХХК".
    assert.equal(orgKey("Бодит чадал ХХК"), orgKey("Бодитчадал ХХК"));
    assert.equal(orgKey("Эрчим хэмнэлтийн төв ХХК ХХК"), orgKey("«Эрчим хэмнэлтийн төв» ХХК"));
    assert.notEqual(orgKey("Нутгийн буян групп ХХК"), orgKey("Нутгийн буян ХХК"));
    assert.equal(bareName("«Хүчит хөтлүүр» ХХК  ХХК"), "Хүчит хөтлүүр");
    assert.deepEqual(searchQueries("Бодит чадал ХХК"), ["Бодит чадал", "Бодитчадал"]);
    assert.deepEqual(searchQueries("Бодитчадал ХХК"), ["Бодитчадал"]);
  });

  it("lists organisations once, never private people, and does not look up banks, funds or Erdenes Tavantolgoi", () => {
    const c = declaredCompanies({
      stocks: " Эрчим хэмнэлтийн төв ХХК, Эрчим хэмнэлтийн төв ХХК ХХК, Хүчит хөтлүүр ХХК  ХХК, Эрдэнэс Тавантолгой ХК, Эрдэнэс Тавантолгой ХК",
      lenders: "Викториа мужийн анхны байр худалдан авахад дэмжих сан, Австриалийн хамтын нөхөрлөлийн банк, Бодит чадал ХХК, Бодитчадал ХХК, Б.Батболд, Дорж Болд",
    });
    assert.deepEqual(
      c.stocks.map((o) => [o.name, o.lookup]),
      [
        ["Эрчим хэмнэлтийн төв ХХК", true],
        ["Хүчит хөтлүүр ХХК", true],
        ["Эрдэнэс Тавантолгой ХК", false],
      ],
    );
    assert.deepEqual(
      c.lenders.map((o) => [o.name, o.lookup]),
      [
        ["Викториа мужийн анхны байр худалдан авахад дэмжих сан", false],
        ["Австриалийн хамтын нөхөрлөлийн банк", false],
        ["Бодит чадал ХХК", true],
      ],
    );
    assert.equal(c.hiddenPeople, 2);
    assert.equal(isOrgName("Б.Батболд"), false);
    assert.equal(declaredCompanies(null).stocks.length, 0);
  });
});

describe("Шилэн данс lookups", () => {
  it("links a company only when exactly one register has its name", () => {
    // A real search for "Нутгийн буян": five suppliers contain the words, one is the company.
    const hits = parseSuppliers(fixture("supplier-search.json"));
    assert.equal(hits.length, 5);
    assert.deepEqual(
      exactMatches(hits, orgKey("Нутгийн буян групп ХХК")).map((h) => h.register),
      ["5467446"],
    );
    assert.equal(exactMatches(hits, orgKey("Нутгийн буян ХХК")).length, 0, "a shorter name is not the same company");
    const twins = [...hits, { name: "Нутгийн буян групп", register: "9999999", amount: 1, count: 1 }];
    assert.equal(exactMatches(twins, orgKey("Нутгийн буян групп ХХК")).length, 2, "two registers: ambiguous, never linked");
  });

  it("reads the state bodies that paid, largest first", () => {
    const payers = parsePayers(fixture("supplier-payers.json"), 3);
    assert.equal(payers.length, 3);
    assert.ok(payers[0].amount >= payers[1].amount && payers[1].amount >= payers[2].amount);
    assert.ok(payers.every((p) => p.name.length > 0 && p.count >= 1));
  });

  it("checks never-seen names first, then those older than 30 days", () => {
    const now = new Date("2026-10-29T00:00:00Z");
    const at = (d: string): CompanyCheck => ({ status: "none", name: "x", checkedAt: `${d}T00:00:00Z` });
    const wanted = new Map([
      ["a", "A ХХК"],
      ["b", "B ХХК"],
      ["c", "C ХХК"],
      ["d", "D ХХК"],
    ]);
    assert.deepEqual(dueKeys(wanted, { a: at("2026-10-20"), b: at("2026-08-01"), c: at("2026-09-01") }, now), ["d", "b", "c"]);
  });
});

describe("Шилэн данс lookup reads every page", () => {
  const supplier = (name: string, register: string) => ({ name, register, amount: 1_000_000, count: 3 });
  const page = (content: unknown[], n: number, total: number) => ({ content, number: n, totalPages: total, last: n + 1 >= total });

  it("finds a second company with the same name on page 2 and links neither", async () => {
    const get = async (path: string) =>
      path.startsWith("getBeltgenNiiluulegch")
        ? path.includes("page=0")
          ? page([supplier("Алтан Тэвш ХХК", "1111111"), ...Array.from({ length: 49 }, (_, i) => supplier(`Өөр ${i} ХХК`, `9${i}`))], 0, 2)
          : page([supplier("Алтан тэвш ХХК", "2222222")], 1, 2)
        : page([], 0, 1);
    const c = await checkCompany("Алтан Тэвш ХХК", "2026-11-01", new Date("2026-11-01T00:00:00Z"), get);
    assert.equal(c.status, "ambiguous");
  });

  it("refuses to decide on a list longer than it reads", async () => {
    await assert.rejects(allPages((p) => `x?page=${p}`, 2, async () => ({ content: [1], last: false, totalPages: 9 })));
  });
});

describe("organisation names", () => {
  it("reads 'сан' and 'банк' as words, not as the end of a person's name", () => {
    assert.equal(isOrgName("Г.Отгонсан"), false);
    assert.equal(isOrgName("Б.Батсан"), false);
    assert.equal(isOrgName("Хүний хөгжил сан"), true);
    assert.equal(isOrgName("Хаан банк"), true);
    assert.equal(isOrgName("Төрийн банк ХХК"), true);
  });
});

describe("declared companies in tender winner cells", () => {
  it("reads every company of a consortium cell, legal form and spacing ignored", () => {
    assert.deepEqual(winnerKeys("Монос трейд ХХК"), ["монострейд"]);
    assert.deepEqual(winnerKeys("Чоногол трейд, Нуган, Медиконт ХХК"), ["чоноголтрейд", "нуган", "медиконт"]);
    assert.deepEqual(winnerKeys("«Бодит чадал» ХХК болон Номин даатгал ХХК"), ["бодитчадал", "номиндаатгал"]);
    assert.deepEqual(winnerKeys("А, -"), []);
  });

  it("matches only companies Шилэн данс knows under one register, each cell once", () => {
    const snapshot = {
      from: "2017-01-01",
      to: "2026-11-01",
      companies: {
        бодитчадал: { status: "found", name: "Бодитчадал", checkedAt: "2026-11-01", register: "5462789", amount: 1, count: 1, payers: [] },
        монос: { status: "ambiguous", name: "Монос ХХК", checkedAt: "2026-11-01", registers: 3 },
        талхчихэр: { status: "none", name: "Талх чихэр ХК", checkedAt: "2026-11-01" },
      } satisfies Record<string, CompanyCheck>,
    };
    const keys = foundKeys(snapshot);
    assert.deepEqual([...keys], ["бодитчадал"]);
    const m = matchWinners(keys, ["Бодит чадал ХХК", "БОДИТЧАДАЛ ХХК", "Бодит чадал ХХК", "Монос ХХК", "Талх чихэр ХК", "Бодит чадал трейд ХХК"]);
    assert.deepEqual([...m.entries()], [["бодитчадал", ["Бодит чадал ХХК", "БОДИТЧАДАЛ ХХК"]]]);
    assert.equal(foundKeys(null).size, 0);
  });

  it("a person with a bank in brackets, or a surname 'Сан', is a private person (Audit 6 C3)", () => {
    const c = declaredCompanies({ lenders: "Б.Батболд (Хаан банк), Хаан банк, Д.Сан" });
    assert.deepEqual(c.lenders.map((l) => l.name), ["Хаан банк"]);
    assert.equal(c.hiddenPeople, 2);
    assert.equal(isOrgName("Б.Бат ХХК"), true);
  });
});
