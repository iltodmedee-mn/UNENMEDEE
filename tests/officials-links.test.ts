import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { linkPeople } from "@/lib/officials/links";

describe("linkPeople", () => {
  const mps = [
    { id: 1, shortName: "Ж.Алдаржавхлан" },
    { id: 2, shortName: "Д.Цогтбаатар" },
    { id: 3, shortName: "Д.Цогтбаатар" },
  ];
  it("links an exact, unique short name to the MP", () => {
    assert.deepEqual(linkPeople(["Ж.Алдаржавхлан", " Ж.Алдаржавхлан "], mps), [
      { name: "Ж.Алдаржавхлан", id: 1 },
      { name: " Ж.Алдаржавхлан ", id: 1 },
    ]);
  });
  it("a space after the initial is the same name (audit B-15)", () => {
    assert.deepEqual(linkPeople(["Ж. Алдаржавхлан"], mps), [{ name: "Ж. Алдаржавхлан", id: 1 }]);
  });
  it("never links a shared short name or someone who is not an MP", () => {
    assert.deepEqual(linkPeople(["Д.Цогтбаатар", "Б.Бат"], mps), [
      { name: "Д.Цогтбаатар", id: null },
      { name: "Б.Бат", id: null },
    ]);
  });
});
