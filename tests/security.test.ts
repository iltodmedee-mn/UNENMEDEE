import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createToken, isValidToken, SESSION_MAX_AGE_S } from "@/lib/admin-auth";
import { aiModelLabel } from "@/lib/ai/model-label";
import { assertPublicUrl, BlockedUrlError, isPrivateAddress } from "@/lib/scraper/public-url";

describe("SSRF guard", () => {
  it("flags private, loopback, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "202.131.0.1", "2606:4700:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
    // Every spelling of a private IPv6 class is private (they used to be matched as text).
    for (const ip of ["0:0:0:0:0:0:0:1", "0000::1", "0:0::1", "FD12:3456::1", "fe80:0:0::1", "FEBF::1", "fec0::1", "ff02::1"]) assert.equal(isPrivateAddress(ip), true, ip);
  });

  it("sees through every IPv6 spelling of an IPv4 host", () => {
    // mapped in hex, compatible, NAT64 and 6to4 forms of 127.0.0.1 / 169.254.169.254 / 10.0.0.1
    for (const ip of ["::ffff:7f00:1", "::7f00:1", "::127.0.0.1", "64:ff9b::7f00:1", "64:ff9b::169.254.169.254", "2002:a9fe:a9fe::", "2002:0a00:0001::1", "::ffff:10.0.0.1", "0:0:0:0:0:ffff:a9fe:a9fe"]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ["::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1", "2001:db8::1"]) assert.equal(isPrivateAddress(ip), false, ip);
    assert.equal(isPrivateAddress("1:2:3:4:5:6:7:8:9"), true, "malformed is refused");
  });

  it("rejects internal hosts and non-http URLs before any request", async () => {
    for (const url of ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "file:///etc/passwd", "http://user:pw@example.com/", "http://example.com:8080/", "http://localhost/"]) {
      await assert.rejects(assertPublicUrl(url), BlockedUrlError, url);
    }
  });
});

describe("admin session token", () => {
  it("is valid for 7 days, then expires; tampering fails", async () => {
    process.env.ADMIN_SECRET_PASSWORD = "test-password-12345";
    const now = Date.UTC(2026, 9, 21);
    const token = await createToken(now);
    assert.ok(token);
    assert.equal(await isValidToken(token, now + 1000), true);
    assert.equal(await isValidToken(token, now + (SESSION_MAX_AGE_S + 60) * 1000), false);
    const [iat, mac] = token.split(".");
    assert.equal(await isValidToken(`${Number(iat) + 3600}.${mac}`, now), false, "issuedAt cannot be moved");
    assert.equal(await isValidToken(mac, now), false, "the old static-HMAC format is rejected");
    process.env.ADMIN_SECRET_PASSWORD = "another-password-123";
    assert.equal(await isValidToken(token, now + 1000), false, "rotating the password logs out");
  });
});

describe("AI model label", () => {
  it("names the provider and strips the vendor prefix", () => {
    assert.equal(aiModelLabel({ provider: "gemini", model: "gemini-flash-lite-latest" }), "Google Gemini · gemini-flash-lite-latest");
    assert.equal(aiModelLabel({ provider: "nvidia", model: "google/gemma-4-31b-it" }), "NVIDIA NIM · gemma-4-31b-it");
  });
});

describe("content-based topics", async () => {
  const { topicFor } = await import("@/lib/topics");
  const { Tier1Schema } = await import("@/lib/ai/schemas");
  const { TopicBatchSchema } = await import("@/lib/ai/topic-classify");

  it("the AI topic overrides a generic domain, but not local sites or opendata", () => {
    assert.equal(topicFor("gov.mn", "ministry").key, "politics");
    assert.equal(topicFor("gov.mn", "ministry", "society").key, "society");
    assert.equal(topicFor("khovd.gov.mn", "local", "economy").key, "local");
    assert.equal(topicFor("opendata.gov.mn", "portal", "economy").key, "data");
    assert.equal(topicFor("gov.mn", "ministry", "made-up").key, "politics");
  });

  it("Tier 1 keeps only known topics", () => {
    const base = { tldr_summary: "Нэг. Хоёр өгүүлбэр байна. Гурав дахь өгүүлбэр.", facts: [], spin_detected: "", neutrality_score: 80, entities: {}, risk_score: 10, risk_reason: "" };
    assert.equal(Tier1Schema.parse({ ...base, topic: " Economy " }).topic, "economy");
    assert.equal(Tier1Schema.parse({ ...base, topic: "sports" }).topic, null);
    assert.equal(Tier1Schema.parse(base).topic, null);
  });

  it("batch classification drops invented ids and unknown topics", () => {
    const out = TopicBatchSchema.parse({ topics: { "12": "health", "13": "weather", x: "economy" } }).topics;
    assert.deepEqual([...out.entries()], [[12, "health"]]);
  });
});
