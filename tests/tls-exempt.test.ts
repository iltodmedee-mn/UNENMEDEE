import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo, LookupFunction } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { gotScraping } from "crawlee";

import { applyTlsPolicy, certChecker, certValid, nextTlsReport, parseTlsReport, tlsExempt } from "@/lib/scraper/tls-exempt";

const local = ((_h: string, o: { all?: boolean }, cb: (e: null, a: unknown, f?: number) => void) => (o?.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4))) as unknown as LookupFunction;

describe("TLS exemptions", () => {
  it("exempts only the exact hosts on the list", () => {
    const hosts = new Set(["broken.gov.mn"]);
    assert.equal(tlsExempt("https://broken.gov.mn/news/1", hosts), true);
    assert.equal(tlsExempt("https://BROKEN.gov.mn/", hosts), true);
    assert.equal(tlsExempt("https://www.broken.gov.mn/", hosts), false, "a subdomain is its own host");
    assert.equal(tlsExempt("https://mof.gov.mn/", hosts), false);
    assert.equal(tlsExempt("not a url", hosts), false);
  });

  it("reads a stored report and refuses a malformed one", () => {
    assert.deepEqual(parseTlsReport(JSON.stringify({ at: "2026-11-11T00:00:00Z", hosts: ["A.gov.mn", 5, ""], added: ["a.gov.mn"] })), { at: "2026-11-11T00:00:00Z", hosts: ["a.gov.mn"], added: ["a.gov.mn"] });
    assert.equal(parseTlsReport("{"), null);
    assert.equal(parseTlsReport(JSON.stringify({ hosts: [] })), null);
    assert.equal(parseTlsReport(null), null);
  });

  it("the next report keeps an unanswered host, drops a repaired one and names the new ones", () => {
    const prev = { at: "x", hosts: ["old.gov.mn", "fixed.gov.mn", "silent.gov.mn"], added: [] };
    const next = nextTlsReport(prev, new Map<string, boolean | null>([["old.gov.mn", false], ["fixed.gov.mn", true], ["silent.gov.mn", null], ["new.gov.mn", false], ["down.gov.mn", null], ["fine.gov.mn", true]]), new Date("2026-11-11T00:00:00Z"));
    assert.deepEqual(next, { at: "2026-11-11T00:00:00.000Z", hosts: ["new.gov.mn", "old.gov.mn", "silent.gov.mn"], added: ["new.gov.mn"] });
  });
});

describe("TLS verification against a self-signed server", () => {
  let server: https.Server;
  let port = 0;
  let cert = "";
  before(async () => {
    const dir = mkdtempSync(join(tmpdir(), "tls-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem")], { stdio: "ignore" });
    cert = readFileSync(join(dir, "c.pem"), "utf8");
    server = https.createServer({ key: readFileSync(join(dir, "k.pem")), cert }, (_req, res) => res.end("ok"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  after(() => new Promise((r) => server.close(r)));

  const get = (hosts: Set<string>) =>
    gotScraping(
      // Crawlee's own crawler-wide switch arrives as rejectUnauthorized: false; the policy must win.
      applyTlsPolicy({ url: `https://localhost:${port}/`, https: { rejectUnauthorized: false }, retry: { limit: 0 }, useHeaderGenerator: false, http2: false, timeout: { request: 5_000 } }, hosts),
    );

  it("a request to a host that is not on the list refuses the bad certificate", async () => {
    await assert.rejects(get(new Set()), (err: NodeJS.ErrnoException) => /self.signed|DEPTH_ZERO/i.test(`${err.code} ${err.message}`));
    await assert.rejects(get(new Set(["other.gov.mn"])));
  });

  it("a request to a listed host is read without the check", async () => {
    const res = await get(new Set(["localhost"]));
    assert.equal(res.body, "ok");
  });

  it("certValid tells a bad certificate (false) from a good one (true) and from no answer (null)", async () => {
    assert.equal(await certValid("localhost", { port, lookup: local }), false);
    assert.equal(await certValid("localhost", { port, lookup: local, ca: cert }), true);
    assert.equal(await certValid("localhost", { port: 1, lookup: local, timeoutMs: 2_000 }), null);
    assert.equal(await certValid("localhost", { port }), null, "the default lookup refuses a private address");
  });

  it("certChecker asks each host once", async () => {
    let asked = 0;
    const counting = ((h: string, o: never, cb: never) => (asked++, (local as unknown as (h: string, o: never, cb: never) => void)(h, o, cb))) as unknown as LookupFunction;
    const check = certChecker({ port, lookup: counting });
    assert.deepEqual(await Promise.all([check("localhost"), check("LOCALHOST"), check("localhost")]), [false, false, false]);
    assert.equal(asked, 1);
  });
});
