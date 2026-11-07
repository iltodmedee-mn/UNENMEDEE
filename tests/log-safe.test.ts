import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { errorDetail, errorLine, oneLine } from "@/lib/log-safe";

describe("oneLine", () => {
  it("removes line breaks and control characters so a headline cannot start a workflow command", () => {
    assert.equal(oneLine("Мэдээ\n::error::fake\u0000x"), "Мэдээ ::error::fake x");
    assert.equal(oneLine(null), "");
  });
});

describe("errorLine", () => {
  it("follows the cause chain and names codes (drizzle 'Failed query' over a Postgres error)", () => {
    const pg = Object.assign(new Error("password authentication failed for user"), { code: "28P01" });
    const err = new Error("Failed query: select 1", { cause: pg });
    assert.equal(errorLine(err), "Error: Failed query: select 1 ← Error [28P01]: password authentication failed for user");
  });

  it("reads an AggregateError's first reason and a fetch failure's cause", () => {
    const agg = new AggregateError([Object.assign(new Error(""), { code: "ETIMEDOUT" })], "");
    assert.equal(errorLine(agg), "AggregateError: (no message) ← Error [ETIMEDOUT]: (no message)");
    const fetchErr = new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" }) });
    assert.match(errorLine(fetchErr), /TypeError: fetch failed ← Error \[ECONNREFUSED\]: connect ECONNREFUSED/);
  });

  it("never throws on non-errors or circular causes", () => {
    assert.equal(errorLine("plain string"), "plain string");
    assert.equal(errorLine({ a: 1 }), '{"a":1}');
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as Error & { cause?: unknown }).cause = b;
    assert.equal(errorLine(b), "Error: b ← Error: a");
  });
});

describe("errorDetail", () => {
  it("prints the chain one level per line, the body, and the first stack frames, with continuation lines indented", () => {
    const api = Object.assign(new Error("Connection error."), { status: 502, cause: new Error("socket hang up"), body: { error: { message: "upstream\n::error::x" } } });
    const text = errorDetail(api);
    const lines = text.split("\n");
    assert.equal(lines[0], "Error [502]: Connection error.");
    assert.equal(lines[1], String.raw`    body: {"error":{"message":"upstream\n::error::x"}}`, "JSON keeps the break escaped: still one line");
    assert.equal(lines[2], "  ← Error: socket hang up");
    assert.ok(lines.slice(3).every((l) => l.startsWith("    at ")), "stack frames follow, indented");
    assert.ok(lines.slice(3).length <= 5);
    assert.ok(lines.slice(1).every((l) => l.startsWith("  ")), "no continuation line can start a workflow command");
  });

  it("caps the length and keeps a non-error value", () => {
    assert.equal(errorDetail(42), "42");
    assert.ok(errorDetail(new Error("x".repeat(5000)), 500).length <= 500);
  });
});

describe("secrets in a failed database write (Audit 6 O1)", () => {
  const drizzleShaped = () =>
    new Error('Failed query: insert into "app_settings" ("key", "value") values ($1, $2)\nparams: threads,{"token":"THAA-SECRET"}', {
      cause: new Error("Connection terminated"),
    });

  it("never prints the params of a drizzle query error", () => {
    for (const text of [errorLine(drizzleShaped(), 2000), errorDetail(drizzleShaped())]) {
      assert.ok(!text.includes("THAA-SECRET"), text);
      assert.ok(!text.includes("params"), text);
      assert.ok(text.includes("Failed query"), text);
      assert.ok(text.includes("Connection terminated"), text);
    }
  });

  it("replaces backticks so a headline cannot close the issue's code fence", () => {
    assert.equal(oneLine("a ``` b"), "a ''' b");
  });
});
