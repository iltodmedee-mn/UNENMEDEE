import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isTransientDbError, retryTransientRead } from "@/db/retry";

describe("one retry for a connection failure (src/db/retry.ts)", () => {
  it("knows node-postgres' read timeout, also when it is the cause of a Drizzle error", () => {
    assert.equal(isTransientDbError(new Error("Query read timeout")), true);
    assert.equal(
      isTransientDbError(
        new Error("Failed query: select …", {
          cause: new Error("Query read timeout"),
        }),
      ),
      true,
    );
    assert.equal(
      isTransientDbError(new Error("Connection terminated unexpectedly")),
      true,
    );
    assert.equal(
      isTransientDbError(new Error('relation "x" does not exist')),
      false,
    );
    assert.equal(
      isTransientDbError(
        new Error("duplicate key value violates unique constraint"),
      ),
      false,
    );
  });

  it("reads again once after a connection failure, never after a query error", async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1)
        throw new Error("Failed query", {
          cause: new Error("Query read timeout"),
        });
      return "rows";
    };
    assert.equal(await retryTransientRead(flaky, 0), "rows");
    assert.equal(calls, 2);

    let bad = 0;
    await assert.rejects(
      retryTransientRead(async () => {
        bad++;
        throw new Error("syntax error at or near");
      }, 0),
      /syntax error/,
    );
    assert.equal(bad, 1);

    let twice = 0;
    await assert.rejects(
      retryTransientRead(async () => {
        twice++;
        throw new Error("Query read timeout");
      }, 0),
      /read timeout/,
    );
    assert.equal(twice, 2);
  });
});
