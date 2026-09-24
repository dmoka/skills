import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonc, globToRegex, matchAny, parseDiff, classify, computeFacts, prFacts, evalRule, readingOrder, stemOf } from "../shared/lib.mjs";

const diff = (path, body, header = "") => `diff --git a/${path} b/${path}\n${header}--- a/${path}\n+++ b/${path}\n${body}`;
const files = (text, cfg) => parseDiff(text).map((f) => ((f.meta = classify(f, cfg)), f));

test("jsonc: comments, trailing commas, // inside strings", () => {
  assert.deepEqual(parseJsonc(`{ // c\n "a": "http://x", /* b */ "b": [1,2,], }`), { a: "http://x", b: [1, 2] });
});

test("glob: **, *, braces, basename patterns", () => {
  assert.ok(globToRegex("src/domain/**").test("src/domain/a/b.ts"));
  assert.ok(globToRegex("**/*refund*").test("src/domain/refund.ts"));
  assert.ok(matchAny("package-lock.json", ["package-lock.json"]));
  assert.ok(matchAny("a/b/c.test.ts", ["*.{test,spec}.ts"]));
  assert.ok(!globToRegex("src/*.ts").test("src/a/b.ts"));
  assert.ok(globToRegex("drizzle/**").test("drizzle/0001_x.sql"));
});

test("stem pairs tests with sources", () => {
  assert.equal(stemOf("tests/domain/refund.rounding.property.test.ts"), "refund");
  assert.equal(stemOf("src/domain/refund.ts"), "refund");
  assert.equal(stemOf("pkg/test_refund.py"), "refund");
  assert.equal(stemOf("RefundTests.cs"), "refund");
});

test("diff: line numbers, renames, new files", () => {
  const t = diff("a.ts", "@@ -10,3 +10,3 @@ fn\n ctx\n-old\n+new\n ctx2\n") +
    "diff --git a/x.ts b/y.ts\nsimilarity index 100%\nrename from x.ts\nrename to y.ts\n";
  const [a, r] = parseDiff(t);
  assert.deepEqual(a.hunks[0].lines.map((l) => [l.t, l.o ?? null, l.n ?? null]), [["ctx", 10, 10], ["del", 11, null], ["add", null, 11], ["ctx", 12, 12]]);
  assert.equal(r.status, "renamed");
  assert.equal(r.path, "y.ts");
  assert.equal(r.oldPath, "x.ts");
});

test("noise: lockfile, pure rename, formatting only, imports only", () => {
  const fs = files(
    diff("package-lock.json", "@@ -1 +1 @@\n-a\n+b\n") +
    "diff --git a/x.ts b/y.ts\nsimilarity index 100%\nrename from x.ts\nrename to y.ts\n" +
    diff("app/p.tsx", "@@ -1,2 +1,4 @@\n-const a = f('x', b)\n-g(c)\n+const a = f(\n+  \"x\",\n+  b,\n+);g(c);\n") +
    diff("app/q.tsx", "@@ -1 +1 @@\n-import { a } from './orders-repo'\n+import { a } from './bookings-repo'\n"),
  );
  assert.deepEqual(fs.map((f) => f.meta.noise), ["lockfile", "pure rename", "formatting only", "imports only"]);
});

test("a real logic change is not noise", () => {
  const [f] = files(diff("src/a.ts", "@@ -1 +1 @@\n-return a >= b\n+return a > b\n"));
  assert.equal(f.meta.kind, "source");
});

test("facts: skipped test, focused test, destructive SQL, new dependency", () => {
  const fs = files(
    diff("tests/booking.test.ts", "@@ -5,2 +5,2 @@\n-  it('caps seats', () => {\n+  it.skip('caps seats', () => {\n   expect(1)\n") +
    diff("tests/pay.test.ts", "@@ -1 +1 @@\n-describe('x', () => {\n+describe.only('x', () => {\n") +
    diff("drizzle/0001.sql", "@@ -0,0 +1,2 @@\n+ALTER TABLE \"orders\" ADD COLUMN \"notes\" text;\n+ALTER TABLE \"orders\" DROP COLUMN \"discount_code\";\n") +
    diff("package.json", "@@ -3,2 +3,3 @@\n   \"dependencies\": {\n+    \"left-pad\": \"^1.3.0\",\n-    \"next\": \"^16.3.6\",\n+    \"next\": \"^16.4.0\",\n"),
  );
  const facts = computeFacts(fs, null);
  const got = facts.map((f) => [f.kind, f.severity, f.file, f.line]);
  assert.deepEqual(got.find((x) => x[0] === "skip-added"), ["skip-added", "high", "tests/booking.test.ts", 5]);
  assert.ok(got.some((x) => x[0] === "focus-added"));
  assert.deepEqual(got.find((x) => x[0] === "destructive-sql"), ["destructive-sql", "high", "drizzle/0001.sql", 2]);
  assert.ok(facts.some((f) => f.kind === "dependency-added" && f.text.includes("left-pad")));
  assert.ok(facts.some((f) => f.kind === "dependency-changed" && f.text.includes("^16.3.6 → ^16.4.0")));
});

test("facts: untested source is low, medium inside a configured area", () => {
  const cfg = { areas: { money: ["src/domain/refund.ts"] } };
  const fs = files(diff("src/domain/refund.ts", "@@ -1 +1 @@\n-a\n+b\n") + diff("src/lib/x.ts", "@@ -1 +1 @@\n-a\n+b\n"), cfg);
  const u = computeFacts(fs, cfg).filter((f) => f.kind === "untested-change");
  assert.deepEqual(u.map((f) => [f.file, f.severity]), [["src/domain/refund.ts", "medium"], ["src/lib/x.ts", "low"]]);
});

test("rules: all conditions must hold, evidence is returned", () => {
  const cfg = { areas: { money: ["src/domain/**"] } };
  const fs = files(diff("src/domain/refund.ts", "@@ -1 +1 @@\n-a\n+b\n"), cfg);
  const pr = { additions: 500, deletions: 10, changedFiles: 1, createdAt: new Date(Date.now() - 5 * 864e5).toISOString(), labels: [], author: { login: "x" } };
  const f = prFacts(pr, fs, cfg);
  assert.deepEqual(evalRule({ when: { areas: ["money"] } }, f), ["area money"]);
  assert.ok(evalRule({ when: { linesChanged: { gt: 400 }, ageDays: { gte: 5 } } }, f));
  assert.equal(evalRule({ when: { linesChanged: { gt: 400 }, draft: true } }, f), null);
  assert.ok(evalRule({ when: { onlyPaths: ["src/**"] } }, f));
  assert.ok(evalRule({ when: { srcWithoutTests: true } }, f));
});

test("reading order: hotspot first, test after its code, noise last", () => {
  const fs = files(
    diff("package-lock.json", "@@ -1 +1 @@\n-a\n+b\n") +
    diff("app/page.tsx", "@@ -1 +1 @@\n-a\n+b\n") +
    diff("src/domain/booking.ts", "@@ -1 +1 @@\n-a\n+b\n") +
    diff("tests/domain/booking.test.ts", "@@ -1 +1 @@\n-  it('x', f)\n+  it.skip('x', f)\n") +
    diff("src/domain/pricing.ts", "@@ -1 +1 @@\n-a\n+b\n"),
  );
  const order = readingOrder(fs, computeFacts(fs, null), null);
  assert.deepEqual(order.map((o) => [o.path, o.role]), [
    ["src/domain/booking.ts", "code"],
    ["tests/domain/booking.test.ts", "test"],
    ["src/domain/pricing.ts", "code"],
    ["app/page.tsx", "code"],
    ["package-lock.json", "noise"],
  ]);
});

test("mechanical rename: symbol swaps are noise, a swapped string literal is not", async () => {
  const { classifyAll } = await import("../shared/lib.mjs");
  const t = "diff --git a/src/db/orders-repo.ts b/src/db/bookings-repo.ts\nsimilarity index 82%\nrename from src/db/orders-repo.ts\nrename to src/db/bookings-repo.ts\n--- a/src/db/orders-repo.ts\n+++ b/src/db/bookings-repo.ts\n@@ -1 +1 @@\n-export type NewOrder = typeof orders.$inferInsert;\n+export type NewBooking = typeof orders.$inferInsert;\n" +
    diff("src/services/orders.ts", "@@ -1,2 +1,2 @@\n-import { insertOrder } from \"../db/orders-repo\";\n-  return insertOrder(tx, row);\n+import { insertBooking } from \"../db/bookings-repo\";\n+  return insertBooking(tx, row);\n") +
    diff("src/db/schema.ts", "@@ -1 +1 @@\n-export const orders = pgTable(\"orders\", {\n+export const orders = pgTable(\"bookings\", {\n");
  const fs = classifyAll(parseDiff(t), null);
  assert.deepEqual(fs.map((f) => f.meta.noise), ["mechanical rename", "mechanical rename", null]);
});

test("formatting only: a closing line aligned as context on one side", () => {
  const [f] = files(diff("app/t.tsx", "@@ -1,3 +1,4 @@\n-<a>{x}</a><b>\n+<a>{x}</a>\n+</c>\n+<b>\n </c>\n"));
  // old side: <a>{x}</a><b></c>   new side: <a>{x}</a></c><b></c> — NOT the same text
  assert.equal(f.meta.noise, null);
  const [g] = files(diff("app/u.tsx", "@@ -1,2 +1,3 @@\n-const a = f('x', b)\n+const a = f(\n+  \"x\", b,\n+)\n ;\n"));
  assert.equal(g.meta.noise, "formatting only");
});

test("intent: informative titles, issue refs, status by strongest source", async () => {
  const { isInformative, issueRefs, intentStatus, branchSlug } = await import("../shared/lib.mjs");
  assert.equal(isInformative("wip"), false);
  assert.equal(isInformative("fix: update"), false);
  assert.equal(isInformative("wip: invoice PDF"), true);
  assert.equal(isInformative("Speed up booking tests"), true);
  assert.deepEqual(issueRefs("Closes #12, see #7 and v2#x"), [12, 7]);
  assert.equal(branchSlug("feat/event-waitlist"), "event-waitlist");
  assert.equal(intentStatus([{ type: "title", text: "wip" }]), "UNKNOWN");
  assert.equal(intentStatus([{ type: "title", text: "Speed up booking tests" }]), "title only");
  assert.equal(intentStatus([{ type: "commits", text: "x" }, { type: "title", text: "wip" }]), "described");
  assert.equal(intentStatus([{ type: "spec", text: "x" }]), "spec");
});
