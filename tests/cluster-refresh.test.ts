import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import type { DB } from "@/db";

process.env.DATABASE_URL = "pglite:memory";

/** Admin unpublish and republish against a cluster (CodeRabbit on #337, audit D-4). */
describe("refreshCluster after members are hidden (PGlite)", () => {
  let db: DB;
  before(async () => {
    const { getDb } = await import("@/db");
    const { migrateDemo } = await import("@/db/demo-migrate");
    db = getDb();
    await migrateDemo(db);
    await db.execute(sql`insert into sources (name, domain, url_pattern, category) values ('A', 'a.gov.mn', '/', 'ministry'), ('B', 'b.gov.mn', '/', 'ministry'), ('C', 'c.gov.mn', '/', 'ministry')`);
    await db.execute(sql`insert into clusters (id, title, article_count, synthesis_summary) values (1, 'Төсөв', 3, 'Гурван эх сурвалжийн нэгтгэл')`);
    for (const [i, d] of ["a", "b", "c"].entries())
      await db.execute(sql`insert into articles (source_id, title, slug, original_url, content_hash, clean_content, cluster_id, risk_score)
        values ((select id from sources where domain = ${d + ".gov.mn"}), ${"t" + i}, ${"s" + i}, ${"https://x/" + i}, ${"h" + i}, 'text', 1, ${10 * i})`);
  });
  after(async () => {
    const { closeDb } = await import("@/db");
    await closeDb();
  });

  it("a shrunk cluster drops the synthesis written from the hidden stories", async () => {
    const { refreshCluster } = await import("@/lib/ai/analyze");
    await db.execute(sql`update articles set is_published = false where slug in ('s1', 's2')`);
    await refreshCluster(db, 1);
    const [c] = (await db.execute(sql`select article_count, synthesis_summary from clusters where id = 1`)).rows as { article_count: number; synthesis_summary: string | null }[];
    assert.deepEqual([c.article_count, c.synthesis_summary], [1, null]);
  });

  it("with every member hidden the cluster stays, so a story published again keeps its group", async () => {
    const { refreshCluster } = await import("@/lib/ai/analyze");
    await db.execute(sql`update articles set is_published = false`);
    await refreshCluster(db, 1);
    const members = (await db.execute(sql`select count(*)::int as n from articles where cluster_id = 1`)).rows[0] as { n: number };
    assert.equal(Number(members.n), 3);
    await db.execute(sql`update articles set is_published = true where slug = 's0'`);
    await refreshCluster(db, 1);
    const [c] = (await db.execute(sql`select article_count from clusters where id = 1`)).rows as { article_count: number }[];
    assert.equal(c.article_count, 1);
  });
});
