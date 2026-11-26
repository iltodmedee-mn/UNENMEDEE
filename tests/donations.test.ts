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

describe("donation rules (Nov 2026)", () => {
  it("records a gift above 500 000 ₮ only under the full name", async () => {
    const { ANON_MAX_MNT, nameModeAllowed } = await import("@/lib/donations");
    assert.equal(ANON_MAX_MNT, 500_000);
    assert.equal(nameModeAllowed(500_000, "anonymous"), true);
    assert.equal(nameModeAllowed(500_001, "anonymous"), false);
    assert.equal(nameModeAllowed(500_001, "initials"), false);
    assert.equal(nameModeAllowed(2_000_000, "full"), true);
  });

  it("takes phone numbers, accounts, links and e-mails out of a note", async () => {
    const { maskNote, MASK } = await import("@/lib/donations");
    assert.equal(maskNote("Амжилт хүсье!"), "Амжилт хүсье!");
    assert.equal(maskNote("залга 9911 2233"), `залга ${MASK}`);
    assert.equal(maskNote("утас 99-11-22-33 шүү"), `утас ${MASK} шүү`);
    assert.equal(maskNote("данс MN12 0005 0050 8529 3387"), `данс ${MASK}`);
    assert.equal(maskNote("манай дэлгүүр https://shop.example.com/x үзээрэй"), `манай дэлгүүр ${MASK} үзээрэй`);
    assert.equal(maskNote("www.example.mn"), MASK);
    assert.equal(maskNote("shop.mn-ээс"), MASK);
    assert.equal(maskNote("жишээ.mn"), MASK, "a Cyrillic host name too (CodeRabbit on #343)");
    assert.equal(maskNote("манай жишээ.mn сайт"), `манай ${MASK} сайт`);
    assert.equal(maskNote("bat@gmail.com"), MASK);
    // Short numbers stay: amounts, years, a class.
    assert.equal(maskNote("2026 онд 10 000₮"), "2026 онд 10 000₮");
  });

  it("knows the days of a month", async () => {
    const { daysInMonth } = await import("@/lib/donations");
    assert.equal(daysInMonth("2026-11"), 30);
    assert.equal(daysInMonth("2026-12"), 31);
    assert.equal(daysInMonth("2028-02"), 29);
  });
});

describe("Supporters (/transparency)", () => {
  const gifts = (): import("@/lib/donations").DonationsSummary => ({
    rows: [
      { id: 3, receivedOn: "2026-11-26", amountMnt: 50_000, donor: "Г.О.", note: "Хараал", notePublic: false },
      { id: 2, receivedOn: "2026-11-26", amountMnt: 10_000, donor: null, note: null, notePublic: false },
      { id: 1, receivedOn: "2026-11-25", amountMnt: 9_999, donor: "Ц.Э.", note: "Good luck", notePublic: true },
    ],
    count: 3,
    totalMnt: 69_999,
    monthMnt: 69_999,
    monthCount: 3,
    month: "2026-11",
    days: [
      { day: 25, named: 1, anonymous: 0 },
      { day: 26, named: 1, anonymous: 1 },
    ],
    months: [],
    firstId: 1,
  });

  it("shows a note only once cleared, the amount and №1 on the first gift", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { Supporters } = await import("@/components/iltod/supporters");
    const html = renderToStaticMarkup(createElement(Supporters, { gifts: gifts() }));
    assert.ok(html.includes("«Good luck»"));
    assert.ok(!html.includes("Хараал"), "an uncleared note never reaches the page");
    assert.ok(html.includes("50 000 ₮") && html.includes("9 999 ₮"));
    assert.equal(html.match(/№1/g)?.length, 1);
    assert.ok(html.includes(">нууц<"));
    // Order received, not by amount: the 50 000 ₮ gift is first because it is newest.
    assert.ok(html.indexOf("Г.О.") < html.indexOf("Ц.Э."));
  });

  it("draws one square per donation, hollow when anonymous, in one SVG", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { DayTicks } = await import("@/components/iltod/supporters");
    const html = renderToStaticMarkup(createElement(DayTicks, { month: "2026-11", days: gifts().days }));
    assert.equal(html.match(/<svg/g)?.length, 1);
    assert.equal(html.match(/<rect/g)?.length, 3);
    assert.equal(html.match(/fill="none"/g)?.length, 1);
  });
});
