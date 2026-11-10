#!/usr/bin/env node
/**
 * Which queries read the most between two pg_stat_statements snapshots (docs/agents/ops.md
 * "Egress check"). Each file holds the one-line output of the snapshot SQL there:
 * "queryid:calls:rows queryid:calls:rows ...". No database access: paste the snapshots in.
 *
 *   node scripts/egress-diff.mjs before.txt after.txt [top=15]
 */
import { readFileSync } from "node:fs";

const [a, b, top = "15"] = process.argv.slice(2);
if (!a || !b) {
  console.error(
    "usage: node scripts/egress-diff.mjs before.txt after.txt [top]",
  );
  process.exit(2);
}
const parse = (f) =>
  new Map(
    readFileSync(f, "utf8")
      .trim()
      .split(/\s+/)
      .map((x) => x.split(":"))
      .filter((p) => p.length === 3)
      .map(([q, c, r]) => [q, [Number(c), Number(r)]]),
  );
const before = parse(a);
const after = parse(b);
const rows = [...after].map(([q, [c, r]]) => {
  const [c0, r0] = before.get(q) ?? [0, 0];
  return { q, calls: c - c0, rows: r - r0, isNew: !before.has(q) };
});
const total = rows.reduce(
  (s, x) => ({ calls: s.calls + x.calls, rows: s.rows + x.rows }),
  { calls: 0, rows: 0 },
);
console.log(`total: +${total.calls} calls, +${total.rows} rows`);
for (const x of rows.sort((p, q) => q.rows - p.rows).slice(0, Number(top)))
  console.log(
    `${String(x.rows).padStart(9)} rows ${String(x.calls).padStart(6)} calls  ${x.q}${x.isNew ? "  (new in the list)" : ""}`,
  );
