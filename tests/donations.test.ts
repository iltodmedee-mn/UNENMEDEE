import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanLine, initials, parseAmount, publicDonor, validDay } from "@/lib/donations";

describe("donations", () => {
  it("publishes initials by default, the full name only when chosen, nothing when anonymous", () => {
    assert.equal(publicDonor("Б.Батболд", "initials"), "Б.Б.");
    assert.equal(publicDonor("БАТБОЛД БААТАР", "initials"), "Б.Б.");
    assert.equal(publicDonor("өлзий-орших", "initials"), "Ө.О.");
    assert.equal(publicDonor("  Номин  ХХК ", "full"), "Номин ХХК");
    assert.equal(publicDonor("Б.Батболд", "anonymous"), null);
    assert.equal(publicDonor("   ", "full"), null);
    assert.equal(publicDonor("123", "initials"), null);
    assert.equal(initials("Дорж"), "Д.");
  });

  it("reads amounts as whole tögrög and refuses anything else", () => {
    assert.equal(parseAmount("50000"), 50000);
    assert.equal(parseAmount("50 000"), 50000);
    assert.equal(parseAmount("1,250,000₮"), 1250000);
    assert.equal(parseAmount("20000 төгрөг"), 20000);
    assert.equal(parseAmount("-5000"), null);
    assert.equal(parseAmount("0"), null);
    assert.equal(parseAmount("abc"), null);
    assert.equal(parseAmount("99999999999"), null);
  });

  it("accepts only real days up to today", () => {
    assert.equal(validDay("2026-10-29", "2026-10-29"), "2026-10-29");
    assert.equal(validDay("2026-10-30", "2026-10-29"), null);
    assert.equal(validDay("2026-02-30", "2026-10-29"), null);
    assert.equal(validDay("2023-12-31", "2026-10-29"), null);
    assert.equal(validDay("29.10.2026", "2026-10-29"), null);
  });

  it("keeps notes on one line", () => {
    assert.equal(cleanLine("Амжилт\nхүсье!\u0007", 140), "Амжилт хүсье!");
    assert.equal(cleanLine("x".repeat(200), 140).length, 140);
  });
});

it("a bank statement's cents never multiply the amount by 100 (audit B-3)", async () => {
  const { parseAmount } = await import("@/lib/donations");
  assert.equal(parseAmount("50,000.00"), 50_000);
  assert.equal(parseAmount("5000.00 төгрөг"), 5_000);
  assert.equal(parseAmount("50.000"), 50_000, "a dot before three digits is still a thousands separator");
  assert.equal(parseAmount("45 000₮"), 45_000);
});
