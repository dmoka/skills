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
const good = { whatItDoes: "Subtracts the fee twice.", explains: [{ quote: "Rounds partial refunds.", files: ["src/domain/refund.ts"] }], claims: [{ quote: "No behaviour change for full refunds.", file: "src/domain/refund.ts", line: 11, code: "fee - fee" }],
  items: [{ severity: "high", file: "src/domain/refund.ts", line: 11, code: "total - fee - fee", title: "Fee subtracted twice", why: "Contradicts the claim." }] };

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
  // Noise may be mapped (it never needs to be), and does not make a quote "unmatched".
  assert.equal(annotate(r, { whatItDoes: "x", explains: [{ quote: "Raise the booking seat cap", files: ["src/domain/booking.ts", "vitest.config.ts", "package-lock.json"] }] }).ok, true);
  assert.match(annotate(r, { whatItDoes: "x", explains: [{ quote: "Raise the booking seat cap", files: ["src/nope.ts"] }] }).err, /not in this diff/);
  assert.match(annotate(r, { whatItDoes: "x" }).err, /so map it/);
});

test("the code fragment catches an off-by-one line", () => {
  const res = annotate(tour(), { ...good, items: [{ ...good.items[0], line: 10 }] });
  assert.match(res.err, /:10 does not contain "total - fee - fee" — that line is: const fee = order.feeCents;/);
  assert.match(annotate(tour(), { ...good, items: [{ ...good.items[0], code: undefined }] }).err, /add "code"/);
});

test("quotes are case-sensitive and at least 4 chars; at most 8 items; soft verdicts refused", () => {
  assert.match(annotate(tour(), { ...good, explains: [{ quote: "rounds partial refunds.", files: [] }] }).err, /not a verbatim quote/);
  assert.match(annotate(tour(), { ...good, explains: [{ quote: "R", files: [] }] }).err, /not a verbatim quote/);
  assert.match(annotate(tour(), { ...good, items: Array(9).fill(good.items[0]) }).err, /max 8/);
  assert.match(annotate(tour(), { ...good, whatItDoes: "This change looks safe." }).err, /never gives a verdict/);
});

test("an all-noise PR needs no intent map", () => {
  writeFileSync(join(dir, "z.diff"), "diff --git a/x.ts b/y.ts\nsimilarity index 100%\nrename from x.ts\nrename to y.ts\n");
  const r = tour(false, "Rename x to y", "z.diff");
  assert.equal(annotate(r, { whatItDoes: "Renames x.ts to y.ts." }).ok, true);
  assert.deepEqual(JSON.parse(readFileSync(r, "utf8")).unexplained, []);
});

test("a test left unexplained with its code gets no second ASK WHY item", () => {
  const r = tour(false, "Speed up booking tests", "y.diff");
  annotate(r, { whatItDoes: "x", explains: [{ quote: "Speed up booking tests", files: ["vitest.config.ts"] }] });
  const out = JSON.parse(readFileSync(r, "utf8"));
  assert.deepEqual(out.unexplained, ["src/domain/booking.ts", "tests/domain/booking.test.ts"]);
  assert.deepEqual(out.items.filter((i) => i.source === "map").map((i) => i.file), ["src/domain/booking.ts"]);
});

test("attention: a level above low needs a checked line; verdicts refused", () => {
  const r = tour();
  const at = { level: "critical", whatHappened: "Refund payout subtracts the fee twice.", why: "Every full refund pays the customer less than it should.", file: "src/domain/refund.ts", line: 11, code: "fee - fee" };
  assert.equal(annotate(r, { ...good, attention: at }).ok, true);
  assert.equal(JSON.parse(readFileSync(r, "utf8")).attention.level, "critical");
  assert.match(annotate(r, { ...good, attention: { ...at, file: undefined } }).err, /needs "file", "line" and "code"/);
  assert.match(annotate(r, { ...good, attention: { ...at, level: "urgent" } }).err, /must be one of/);
  assert.match(annotate(r, { ...good, attention: { ...at, why: "Looks good otherwise." } }).err, /never gives a verdict/);
  assert.equal(annotate(r, { ...good, attention: { level: "low", whatHappened: "Tiny tweak.", why: "Contained to one line." } }).ok, true);
});

test("triage order: complete, judged, and never a lower level above a higher one", () => {
  const q = join(dir, "q");
  execFileSync("mkdir", ["-p", q]);
  const mk = (n, level) => writeFileSync(join(q, `tour-${n}.json`), JSON.stringify({ kind: "tour", attention: level && { level, whatHappened: "x", why: "y" } }));
  mk(1, "low"); mk(2, "critical"); mk(3, null);
  const triage = join(q, "triage.json");
  writeFileSync(triage, JSON.stringify({ kind: "triage", prs: [1, 2, 3].map((n) => ({ number: n, tour: `tour-${n}.json` })) }));
  const run = (notes) => annotate(triage, notes);
  assert.match(run({ order: [2, 1] }).err, /#3 is missing/);
  assert.match(run({ order: [2, 1, 3] }).err, /#3: tour-3.json has no attention yet/);
  mk(3, "high");
  assert.match(run({ order: [1, 2, 3] }).err, /#2 is "critical" but sits below a "low" PR/);
  assert.equal(run({ order: [2, 3, 1], summary: "Two need attention." }).ok, true);
  const out = JSON.parse(readFileSync(triage, "utf8"));
  assert.deepEqual(out.prs.map((p) => [p.number, p.rank, p.attention.level]), [[2, 1, "critical"], [3, 2, "high"], [1, 3, "low"]]);
});

test("why, points, chapters, shape: checked against the author's text and the diff", () => {
  const r = tour(false, "Speed up booking tests", "y.diff");
  const ok = { whatItDoes: "x", explains: [{ quote: "Speed up booking tests", files: ["vitest.config.ts"] }] };
  const run = (extra) => annotate(r, { ...ok, ...extra });
  assert.equal(run({ why: "Speed up booking tests", points: ["the cap moves in [bookTickets](src/domain/booking.ts)"],
    chapters: [{ title: "The cap", files: ["src/domain/booking.ts"] }, { title: "Config", files: ["vitest.config.ts"] }],
    shape: [{ title: "reserve", kind: "pseudocode", lang: "diff", code: " reserve\n-  cap = 10\n+  cap = 12" }] }).ok, true);
  const out = JSON.parse(readFileSync(r, "utf8"));
  // The unlisted test follows its code inside the chapter.
  assert.deepEqual(out.chapters[0].files, ["src/domain/booking.ts", "tests/domain/booking.test.ts"]);
  assert.match(run({ why: "we wanted speed" }).err, /why: .* not a verbatim quote/);
  assert.match(run({ points: ["see [here](src/nope.ts)"] }).err, /not a file in this diff/);
  assert.match(run({ points: ["see [here](src/domain/booking.ts:99)"] }).err, /not a new-side line/);
  assert.match(run({ chapters: [{ title: "A", files: ["src/domain/booking.ts"] }] }).err, /"vitest.config.ts" is in no chapter/);
  assert.match(run({ chapters: [{ title: "A", files: ["src/domain/booking.ts", "vitest.config.ts", "package-lock.json"] }] }).err, /is noise/);
  assert.match(run({ shape: [{ title: "x", kind: "poem", code: "a" }] }).err, /kind: one of/);
  assert.match(run({ shape: [{ title: "x", kind: "types", code: Array(31).fill("a").join("\n") }] }).err, /max 30/);
});

test("render packs the viewer and the data into one HTML file", () => {
  const r = tour(false, "Speed up booking tests", "y.diff");
  execFileSync("node", ["skills/pr-tour/scripts/render.mjs", r]);
  const html = readFileSync(r.replace(/\.json$/, ".html"), "utf8");
  assert.match(html, /<script type="application\/json" id="data">\{"tours":\{"local":/);
  assert.match(html, /function renderTour/);
  assert.ok(!/<\/script>[^]*<script type="application\/json"/.test(html.split('id="data">')[1].split("</script>")[0]), "data never closes its own tag");
});
