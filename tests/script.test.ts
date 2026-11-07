import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanImpact, cleanReaderTitle } from "@/lib/ai/reader-view";
import { Tier1Schema } from "@/lib/ai/schemas";
import { isLatinText } from "@/lib/script";

// Article 3637 (Nov 7 2026): a free model answered the whole analysis in a Latin transliteration.
const LATIN_TITLE = "Ömnögovi aimagt ‘Irgenii tankhim’ neegdlee, IH-iin darga ONB-tai uulzlaa";
const LATIN_TLDR = "Ömnögovi aimag’d “Irgenii tankhim” shinéer ajillaj ehellee, irgediin nutgiin udiirdlagad orolcoog nemegduuleh zoriigtoi.";

test("a Latin transliteration is not Mongolian Cyrillic", () => {
  assert.equal(isLatinText(LATIN_TITLE), true);
  assert.equal(isLatinText(LATIN_TLDR), true);
  assert.equal(isLatinText("Nutgiin shiidver gargaltai orolcoh bolomj nemegdene"), true);
});

test("Cyrillic with a few Latin names stays", () => {
  assert.equal(isLatinText("Өмнөговь аймагт «Иргэний танхим» нээгдлээ"), false);
  assert.equal(isLatinText("e-Mongolia системд COVID-19 вакцины гэрчилгээ нэмэгдлээ"), false);
  assert.equal(isLatinText("IMF болон ADB-ийн төлөөлөгчидтэй уулзлаа"), false);
  assert.equal(isLatinText("Short ok"), false);
});

test("a Latin reader headline and impact are dropped", () => {
  assert.equal(cleanReaderTitle(LATIN_TITLE, "Иргэний танхим нээгдлээ", null), null);
  assert.equal(
    cleanImpact({ who: "Ömnögovi aimagiin irged", change: "Nutgiin shiidver gargaltai orolcoh bolomj nemegdene", when: null, action: "Tankhimaar orj sanal huselt yavuulah" }, null),
    null,
  );
});

test("a Tier-1 reply written in Latin fails, so the repair or the next provider writes it", () => {
  const reply = { tldr_summary: LATIN_TLDR, facts: ["Irgenii tankhim neegdlee"], spin_detected: "", entities: {}, risk_score: 10 };
  const parsed = Tier1Schema.safeParse(reply);
  assert.equal(parsed.success, false);
  assert.match(JSON.stringify(parsed.error?.issues), /Latin/);
  const ok = Tier1Schema.safeParse({ ...reply, tldr_summary: "Өмнөговь аймагт «Иргэний танхим» шинээр ажиллаж эхэллээ.", facts: ["Иргэний танхим нээгдлээ"] });
  assert.equal(ok.success, true);
});

test("every system prompt carries the Cyrillic rule", async () => {
  const prompts = await import("@/lib/ai/prompts");
  for (const name of ["TIER1_SYSTEM", "TIER2_SYSTEM", "DIGEST_SYSTEM", "CLUSTER_SYSTEM"] as const) {
    assert.ok((prompts as Record<string, unknown>)[name]?.toString().includes(prompts.SCRIPT_RULE), `${name} has no Cyrillic rule`);
  }
});
