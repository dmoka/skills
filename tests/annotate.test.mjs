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

function tour(body = true, title = "wip", diffFile = "x.diff") {
  const args = ["skills/pr-tour/scripts/tour.mjs", "--diff-file", join(dir, diffFile), "--out", dir, "--title", title];
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
const good = { whatItDoes: "Subtracts the fee twice.", explains: [{ quote: "Rounds partial refunds.", files: ["src/domain/refund.ts"] }], claims: [{ quote: "No behaviour change for full refunds.", file: "src/domain/refund.ts", line: 11 }],
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
  // With no intent, every non-noise file is unexplained.
  assert.equal(annotate(r, { whatItDoes: "x" }).ok, true);
  assert.deepEqual(JSON.parse(readFileSync(r, "utf8")).unexplained, ["src/domain/refund.ts"]);
});

const DIFF2 = `diff --git a/src/domain/booking.ts b/src/domain/booking.ts
--- a/src/domain/booking.ts
+++ b/src/domain/booking.ts
@@ -1 +1 @@
-const cap = 10;
+const cap = 12;
diff --git a/tests/domain/booking.test.ts b/tests/domain/booking.test.ts
--- a/tests/domain/booking.test.ts
+++ b/tests/domain/booking.test.ts
@@ -1 +1 @@
-  it('caps seats', () => {
+  it.skip('caps seats', () => {
diff --git a/vitest.config.ts b/vitest.config.ts
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -1 +1 @@
-  pool: 'forks',
+  pool: 'threads',
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1 +1 @@
-a
+b
`;
writeFileSync(join(dir, "y.diff"), DIFF2);

test("title only: the title explains the config, nothing explains booking.ts", () => {
  const r = tour(false, "Speed up booking tests", "y.diff");
  assert.equal(JSON.parse(readFileSync(r, "utf8")).intent.status, "title only");
  const notes = { whatItDoes: "Raises the seat cap, skips the cap test, switches the test pool.",
    explains: [{ quote: "Speed up booking tests", files: ["vitest.config.ts"] }] };
  assert.equal(annotate(r, notes).ok, true);
  const out = JSON.parse(readFileSync(r, "utf8"));
  assert.deepEqual(out.unexplained, ["src/domain/booking.ts", "tests/domain/booking.test.ts"]);
  assert.ok(out.items.some((i) => i.source === "map" && i.file === "src/domain/booking.ts"));
});

test("intent map: a test inherits its code's explanation; noise and unknown files are refused", () => {
  const r = tour(false, "Raise the booking seat cap", "y.diff");
  const ok = annotate(r, { whatItDoes: "x", explains: [{ quote: "Raise the booking seat cap", files: ["src/domain/booking.ts", "vitest.config.ts"] }, { quote: "booking seat cap", files: [] }] });
  assert.equal(ok.ok, true);
  const out = JSON.parse(readFileSync(r, "utf8"));
  assert.deepEqual(out.unexplained, []);
  assert.deepEqual(out.unmatched, ["booking seat cap"]);
  assert.match(annotate(r, { whatItDoes: "x", explains: [{ quote: "Raise the booking seat cap", files: ["package-lock.json"] }] }).err, /is noise/);
  assert.match(annotate(r, { whatItDoes: "x", explains: [{ quote: "Raise the booking seat cap", files: ["src/nope.ts"] }] }).err, /not in this diff/);
  assert.match(annotate(r, { whatItDoes: "x" }).err, /intent map/);
});
