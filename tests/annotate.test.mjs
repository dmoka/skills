import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pr-review-"));
const DIFF = `diff --git a/src/domain/refund.ts b/src/domain/refund.ts
--- a/src/domain/refund.ts
+++ b/src/domain/refund.ts
@@ -10,2 +10,2 @@
 const fee = order.feeCents;
-return total - fee;
+return total - fee - fee;
`;
writeFileSync(join(dir, "x.diff"), DIFF);
writeFileSync(join(dir, "body.md"), "Rounds partial refunds.\n\nNo behaviour change for full refunds.");

function tour(body = true) {
  const args = ["skills/pr-tour/scripts/tour.mjs", "--diff-file", join(dir, "x.diff"), "--out", dir, "--title", "t"];
  if (body) args.push("--body-file", join(dir, "body.md"));
  execFileSync("node", args, { encoding: "utf8" });
  return join(dir, "tour-local.json");
}
function annotate(report, notes) {
  const n = join(dir, "notes.json");
  writeFileSync(n, JSON.stringify(notes));
  try { execFileSync("node", ["skills/pr-tour/scripts/annotate.mjs", report, n], { encoding: "utf8", stdio: "pipe" }); return { ok: true }; }
  catch (e) { return { ok: false, err: e.stderr }; }
}
const good = { whatItDoes: "Subtracts the fee twice.", claims: [{ quote: "No behaviour change for full refunds.", file: "src/domain/refund.ts", line: 11 }],
  items: [{ severity: "high", file: "src/domain/refund.ts", line: 11, title: "Fee subtracted twice", why: "Contradicts the claim." }] };

test("accepts line-checked notes and reorders", () => {
  const r = tour();
  assert.equal(annotate(r, good).ok, true);
  const out = JSON.parse(readFileSync(r, "utf8"));
  assert.equal(out.items.filter((i) => i.source === "model").length, 1);
  assert.match(out.order[0].why, /hotspot/);
});

test("rejects a line that is not in the diff", () => {
  const res = annotate(tour(), { ...good, items: [{ ...good.items[0], line: 99 }] });
  assert.equal(res.ok, false);
  assert.match(res.err, /:99 is not/);
});

test("rejects a claim that is not a verbatim quote", () => {
  const res = annotate(tour(), { ...good, claims: [{ quote: "Refunds are idempotent." }] });
  assert.match(res.err, /not a verbatim quote/);
});

test("rejects verdicts", () => {
  for (const w of ["LGTM", "safe to merge", "This is exploitable"]) {
    const res = annotate(tour(), { ...good, whatItDoes: w });
    assert.equal(res.ok, false, w);
  }
});

test("no stated intent means no claims", () => {
  const r = tour(false);
  assert.equal(JSON.parse(readFileSync(r, "utf8")).intent.status, "UNKNOWN");
  assert.match(annotate(r, good).err, /states no intent/);
});
