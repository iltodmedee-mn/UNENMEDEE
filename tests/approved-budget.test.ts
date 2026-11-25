import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ApprovedBudget,
  reconciliationGap,
  growthPct,
  perPersonMillions,
  trillions,
} from "@/components/iltod/approved-budget";
import {
  APPROVED_2027 as B,
  COUNCIL,
  FOR_YOU,
  HIGHLIGHTS,
  OYU_TOLGOI,
  SOURCES,
  VIEWS,
} from "@/lib/budget/approved-2027";

/** Same rule as /projects: the section quotes bodies and budgets, never judges. */
const VERDICT =
  /үрсэн|үрэн\s*тар|алдсан|авлиг|хулгай|луйвар|цаасан дээр|худал|хуурсан|завш|зальж/i;

describe("approved 2027 budget", () => {
  it("adds up: revenue − expenditure = balance", () => {
    assert.ok(Math.abs(B.revenue - B.expenditure - B.balance) < 1e-6);
  });

  it("states the figures a reader quotes", () => {
    assert.equal(trillions(B.expenditure), "41.6 их наяд ₮");
    assert.equal(trillions(B.balance), "−2.3 их наяд ₮");
    assert.equal(perPersonMillions(B.expenditure), "12.1");
    assert.equal(perPersonMillions(B.debt), "16.8");
    assert.equal(growthPct(B.expenditure, B.expenditure2026), 22);
  });

  it("states the gap between the council's two lines and the total", () => {
    assert.equal(reconciliationGap(), 330.5);
    assert.ok(
      Math.abs(B.currentShare.after + B.capitalShare.after - 100.8) < 1e-9,
    );
    const html = renderToStaticMarkup(createElement(ApprovedBudget, {}));
    assert.ok(!html.includes("100 төгрөг тутмын"));
    assert.ok(html.includes("Энэ зөрүүг эх сурвалж тайлбарлаагүй."));
  });

  it("links every source to an official https page", () => {
    for (const s of Object.values(SOURCES))
      assert.match(
        s.url,
        /^https:\/\/([a-z0-9-]+\.)*(gov\.mn|parliament\.mn)\//,
      );
    for (const h of HIGHLIGHTS) assert.ok(SOURCES[h.source]);
    for (const v of VIEWS) assert.ok(SOURCES[v.source]);
  });

  it("never judges: no verdict words in any text", () => {
    const texts = [
      ...COUNCIL,
      OYU_TOLGOI,
      ...VIEWS.map((v) => v.text),
      ...FOR_YOU.flatMap((f) => [f.text, f.strong, f.note]),
      ...HIGHLIGHTS.flatMap((h) => [h.name, h.sub]),
    ];
    for (const t of texts) assert.doesNotMatch(t, VERDICT);
  });

  it("renders with and without the inflation snapshot", () => {
    const html = renderToStaticMarkup(
      createElement(ApprovedBudget, {
        inflation: { value: 13.4, month: "2026-10" },
      }),
    );
    assert.ok(html.includes("12.1 сая ₮"));
    assert.ok(html.includes("2026-10 сарын инфляц 13.4%"));
    const bare = renderToStaticMarkup(createElement(ApprovedBudget, {}));
    assert.ok(bare.includes("8.0%-ийн инфляцаар тооцсон."));
    assert.ok(!bare.includes("Монголбанк"));
  });
});
