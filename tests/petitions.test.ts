import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { namesPerson, openPetitions, parsePetitions, type Petition } from "@/lib/participation/petitions";
import { unshoutTitle } from "@/lib/scraper/titles";

// petition.parliament.mn's first listing page, Nov 6 2026 (4 cards; authors, images and descriptions removed).
const html = readFileSync(new URL("./fixtures/petitions-page.html", import.meta.url), "utf8");

describe("parliament petitions", () => {
  it("reads number, title, type, signatures, threshold and the countdown's end time", () => {
    const all = parsePetitions(html, unshoutTitle);
    assert.equal(all.length, 4);
    assert.deepEqual(all[1], {
      id: "966ada00-ffa0-4ce5-bc89-ffa57afbe299",
      code: "PN-202608-79225",
      title: "Ажилтны ХХОАТ болон НД-ын шимтгэл төлөлтийг бууруулах.",
      kind: "1. Ажлын хэсэг байгуулах",
      signatures: 8665,
      threshold: 33000,
      endsAt: "2026-11-07T01:16:45+08:00",
      url: "https://petition.parliament.mn/Detail?id=966ada00-ffa0-4ce5-bc89-ffa57afbe299",
    });
    assert.equal(all[0].signatures, 60569);
    assert.equal(all[0].threshold, 100000);
    assert.equal(all[0].endsAt, "2026-11-08T23:02:46+08:00");
    assert.ok(!all.some((p) => /Иргэн/.test(p.title)), "author names are never read");
  });

  it("keeps petitions still open, most signed first, and leaves out titles that name a person", () => {
    const all = parsePetitions(html, unshoutTitle);
    const named: Petition = { ...all[3], id: "00000000-0000-0000-0000-000000000000", title: "Б.Батыг огцруулах тухай" };
    const { items, skippedNamed } = openPetitions([...all, named, all[0]], new Date("2026-11-07T12:00:00+08:00"));
    assert.deepEqual(
      items.map((p) => p.code),
      ["PN-202609-61758", "PN-202610-66834", "PN-202609-48562"],
      "PN-202608-79225 ended on Nov 7 01:16; the repeated card counts once",
    );
    assert.equal(skippedNamed, 1);
  });

  it("knows a person's short name from an abbreviation", () => {
    assert.equal(namesPerson("Х. Баттулгад хариуцлага тооцох"), true);
    assert.equal(namesPerson("Б.Батыг огцруулах"), true);
    assert.equal(namesPerson("Б.БАТЫГ ОГЦРУУЛАХ"), true, "a shouted title still names a person");
    assert.equal(namesPerson("Б. баттулгад хариуцлага тооцох"), true, "unshoutTitle lowercases a spaced initial's name");
    assert.equal(namesPerson("АТГ-ын тайланг нийтлэх"), false);
    assert.equal(namesPerson("НӨАТ 1% болгож бууруулах"), false);
    assert.equal(namesPerson("Ажилтны ХХОАТ болон НД-ын шимтгэл"), false);
  });
});
