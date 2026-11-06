import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

import { tenders } from "@/db/schema";
import { tenderAwarded, tenderFirstOfSame, tenderThisYear } from "@/lib/procurement/tender-sql";

const db = drizzle.mock();
const render = (...where: Parameters<typeof and>) => db.select({ id: tenders.id }).from(tenders).where(and(...where)).toSQL().sql;

describe("tender SQL conditions", () => {
  it("reads the year from the code with a real \\d (a template literal drops a single backslash)", () => {
    const q = render(tenderThisYear);
    assert.ok(q.includes("'/(\\d{4})'"), q);
    assert.ok(!q.includes("'/(d{4})'"), q);
  });

  it("finds re-filed copies with one uncorrelated join, not a NOT EXISTS per row (10.8 s on 8 000 lots)", () => {
    const q = render(tenderAwarded, tenderFirstOfSame);
    assert.match(q, /"tenders"\."id" not in \(select r\.id from "tenders" r join "tenders" e on e\.awarded/);
    assert.doesNotMatch(q, /not exists/i);
    // The outer row is referenced only by the qualified id, so the subquery never depends on it.
    const sub = q.slice(q.indexOf("not in ("));
    assert.doesNotMatch(sub.slice(8), /"tenders"\./);
  });
});
