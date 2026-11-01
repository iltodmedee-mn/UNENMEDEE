import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deploymentsToDelete, type VercelDeployment } from "@/lib/vercel-cleanup";

const d = (uid: string, created: number, target: string | null, readyState = "READY"): VercelDeployment => ({ uid, created, target, readyState });

describe("vercel cleanup", () => {
  const all = [
    d("p5", 500, "production"),
    d("p4", 400, "production"),
    d("p3", 300, "production"),
    d("p2", 200, "production"),
    d("p1", 100, "production"),
    d("e1", 450, "production", "ERROR"),
    d("pre1", 350, null),
    d("b1", 600, "production", "BUILDING"),
  ];

  it("keeps the newest ready production deployments and unfinished builds, deletes the rest", () => {
    const gone = deploymentsToDelete(all, { keepProduction: 3, currentProductionId: "p5" }).map((x) => x.uid).sort();
    assert.deepEqual(gone, ["e1", "p1", "p2", "pre1"]);
  });

  it("deletes nothing when the live deployment is unknown or not in the list", () => {
    assert.deepEqual(deploymentsToDelete(all, { keepProduction: 3 }), []);
    assert.deepEqual(deploymentsToDelete(all, { keepProduction: 3, currentProductionId: "gone-from-list" }), []);
  });

  it("reads an invalid keep count as 3, never as none", () => {
    const gone = deploymentsToDelete(all, { keepProduction: Number.NaN, currentProductionId: "p5" }).map((x) => x.uid);
    for (const kept of ["p5", "p4", "p3"]) assert.ok(!gone.includes(kept), kept);
  });

  it("never deletes the deployment serving production, even after a rollback to an old one", () => {
    const gone = deploymentsToDelete(all, { keepProduction: 3, currentProductionId: "p1" }).map((x) => x.uid);
    assert.ok(!gone.includes("p1"));
    assert.ok(gone.includes("p2"));
  });

  it("keeps at least one production deployment", () => {
    const gone = deploymentsToDelete(all, { keepProduction: 0, currentProductionId: "p1" }).map((x) => x.uid);
    assert.ok(!gone.includes("p5"));
    assert.ok(!gone.includes("p1"));
  });
});
