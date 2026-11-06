import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GLOSSARY, glossarySegments } from "@/lib/glossary";

const marked = (text: string, seen?: Set<string>) => glossarySegments(text, seen).flatMap((s) => (s.term ? [`${s.term.slug}:${s.text}`] : []));

describe("glossary", () => {
  it("marks terms in real summaries with their Mongolian endings (Nov 2026)", () => {
    assert.deepEqual(marked("Засгийн газар 2016 болон 2022 оны тогтоолыг хүчингүй болголоо."), ["togtool:тогтоолыг"]);
    assert.deepEqual(marked("Батлан хамгаалахын сайдын тушаалаар шийдэв."), ["tushaal:тушаалаар"]);
    assert.deepEqual(marked("шинэчилсэн найруулгад ДНБ-ий 5%-аас доош"), ["dnb:ДНБ-ий"]);
    assert.deepEqual(marked("«Ногоон бургастай» төслийн ТЭЗҮ-г боловсруулна."), ["tezu:ТЭЗҮ-г"]);
    assert.deepEqual(marked("2026 оны төсөвт хийх тодотголыг хэлэлцэв."), ["todotgol:тодотголыг"]);
    assert.deepEqual(marked("УИХ-ын намрын ээлжит чуулганаар хэлэлцэнэ."), ["chuulgan:ээлжит чуулганаар"]);
  });

  it("leaves look-alike words alone", () => {
    assert.deepEqual(marked("Тэрээр сайдын орлогч зэрэг албан тушаалд ажиллаж байсан."), []);
    assert.deepEqual(marked("Албан тушаалтан ХАСХОМ-оо хугацаандаа өгөөгүй."), ["khaskhom:ХАСХОМ-оо"]);
    assert.deepEqual(marked("Н.Учрал уул уурхайн чуулганд оролцож үг хэлэв."), []);
    assert.deepEqual(marked("Экспортын хориг тавьсан, хориглосон бараа."), [], "хориг is not marked inline");
    assert.deepEqual(marked("ДНБХ, НӨАТУС гэх мэт өөр товчлол"), [], "an abbreviation inside a longer one is not it");
  });

  it("marks each term once and at most four in all, keeping the text whole", () => {
    const seen = new Set<string>();
    const text = "Тогтоол гарав. Тогтоолоор журам батлав. НӨАТ, ХХОАТ, НДШ, ТӨХК, ТЭЗҮ.";
    const segs = glossarySegments(text, seen);
    assert.equal(segs.map((s) => s.text).join(""), text);
    assert.deepEqual(segs.flatMap((s) => (s.term ? [s.term.slug] : [])), ["togtool", "juram", "nuat", "khkhoat"]);
    assert.deepEqual(marked("Бас нэг тогтоол.", seen), [], "already seen on this page");
  });

  it("has a unique slug and one plain sentence for every term", () => {
    assert.equal(new Set(GLOSSARY.map((t) => t.slug)).size, GLOSSARY.length);
    for (const t of GLOSSARY) {
      assert.match(t.slug, /^[a-z0-9-]+$/, t.slug);
      assert.ok(t.text.length > 20 && t.text.length < 220, t.slug);
      assert.ok(t.text.endsWith("."), t.slug);
    }
  });
});
