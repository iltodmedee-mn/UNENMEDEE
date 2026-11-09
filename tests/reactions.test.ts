import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import type { DB } from "@/db";
import { addReaction, parseArticleId, parseReaction, reactionCounts } from "@/lib/reactions";

process.env.DATABASE_URL = "pglite:memory";

describe("reaction requests", () => {
  it("accepts only a positive article id and a known kind", () => {
    assert.deepEqual(parseReaction('{"id":42,"kind":"doubt"}'), { articleId: 42, kind: "doubt" });
    for (const bad of ['{"id":42,"kind":"love"}', '{"id":-1,"kind":"useful"}', '{"id":"42","kind":"useful"}', '{"id":1.5,"kind":"useful"}', "nope", "[]", `{"id":1,"kind":"useful","x":"${"y".repeat(300)}"}`]) {
      assert.equal(parseReaction(bad), null, bad);
    }
    assert.equal(parseArticleId("123"), 123);
    for (const bad of [null, "", "0", "-3", "12a", "1234567890"]) assert.equal(parseArticleId(bad), null, String(bad));
  });
});

describe("reaction counts (PGlite)", () => {
  let db: DB;
  let id = 0;
  before(async () => {
    const { getDb } = await import("@/db");
    const { migrateDemo } = await import("@/db/demo-migrate");
    db = getDb();
    await migrateDemo(db);
    const src = (await db.execute(sql`insert into sources (name, domain, url_pattern, category) values ('Test', 'reactions.test', 'https://reactions.test/', 'agency') returning id`)) as unknown as { rows: { id: number }[] };
    const art = (await db.execute(
      sql`insert into articles (source_id, title, slug, original_url, content_hash, clean_content) values (${src.rows[0].id}, 'Мэдээ', 'reactions-test', 'https://reactions.test/1', 'h-reactions', 'Текст') returning id`,
    )) as unknown as { rows: { id: number }[] };
    id = art.rows[0].id;
  });
  after(async () => {
    const { closeDb } = await import("@/db");
    await closeDb();
  });

  it("counts each tap per kind and answers all three counts", async () => {
    assert.deepEqual(await reactionCounts(db, id), { useful: 0, doubt: 0, correction: 0 });
    await addReaction(db, id, "useful");
    await addReaction(db, id, "useful");
    assert.deepEqual(await addReaction(db, id, "correction"), { useful: 2, doubt: 0, correction: 1 });
  });

  it("refuses a story that does not exist (nothing is stored)", async () => {
    await assert.rejects(addReaction(db, 999_999, "doubt"));
    assert.deepEqual(await reactionCounts(db, 999_999), { useful: 0, doubt: 0, correction: 0 });
  });

  it("a deleted story takes its counts along", async () => {
    await db.execute(sql`delete from articles where id = ${id}`);
    const left = (await db.execute(sql`select count(*)::int as n from article_reactions where article_id = ${id}`)) as unknown as { rows: { n: number }[] };
    assert.equal(left.rows[0].n, 0);
  });
});
