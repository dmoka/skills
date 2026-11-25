import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = fileURLToPath(new URL("../skills/property-testing/scripts/", import.meta.url));
const run = (script, cwd, ...args) => {
  const r = spawnSync("bash", [join(SCRIPTS, script), ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

// The repo is written at test time: committed test-shaped fixtures would be picked up by test runners.
function write(dir, files) {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
}
function repo(base) {
  const dir = mkdtempSync(join(tmpdir(), "pbt-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "test");
  write(dir, base);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  return dir;
}
const hatches = (dir) => run("escape-hatches.sh", dir, "main");
const count = (out) => Number(out.match(/escape hatches: (\d+)/)[1]);

const PY_BASE = `from hypothesis import given, settings, strategies as st
from bank.account import withdraw

@settings(derandomize=True, max_examples=100)
@given(st.integers(1, 10**9), st.data())
def test_withdraw(balance, data):
    amount = data.draw(st.integers(1, balance))
    assert withdraw(balance, amount) == balance - amount
`;

test("a clean change counts 0 and exits 0", () => {
  const dir = repo({ "tests/test_props.py": PY_BASE });
  write(dir, { "tests/test_props.py": PY_BASE + "\n# more docs\n" });
  const { code, out } = hatches(dir);
  assert.equal(code, 0);
  assert.equal(count(out), 0);
});

test("python: assume, filter, health-check suppression, deadline=None, low and lowered run counts", () => {
  const dir = repo({ "tests/test_props.py": PY_BASE });
  write(dir, {
    "tests/test_props.py": PY_BASE.replace("max_examples=100", "max_examples=50") +
      `
from hypothesis import assume, HealthCheck

@settings(max_examples=10, suppress_health_check=[HealthCheck.filter_too_much], deadline=None)
@given(st.integers().filter(lambda x: x != 0), st.integers())
def test_split(total, n):
    assume(n > 0)
    # assume(n < 100) is only a comment
    assert True
`,
  });
  const { code, out } = hatches(dir);
  assert.equal(code, 1);
  assert.match(out, /run count lowered 100->50/);
  assert.match(out, /run count 10 < 25/);
  assert.match(out, /health check suppressed/);
  assert.match(out, /deadline removed/);
  assert.match(out, /discard filter/);
  assert.match(out, /tests\/test_props\.py:\d+ +discard assume\(\) +assume\(n > 0\)/);
  assert.doesNotMatch(out, /only a comment/);
  assert.equal(count(out), 6);
});

test("rust: prop_assume!, prop_filter, low cases, #[ignore]", () => {
  const base = `use proptest::prelude::*;
proptest! {
    #[test]
    fn withdraw_ok(b in 1u64..1_000_000) { prop_assert!(b > 0); }
}
`;
  const dir = repo({ "src/lib.rs": "pub fn f() {}\n", "tests/props.rs": base });
  write(dir, {
    "tests/props.rs": `use proptest::prelude::*;
proptest! {
    #![proptest_config(ProptestConfig { cases: 5, ..ProptestConfig::default() })]
    #[test]
    #[ignore]
    fn withdraw_ok(b in (1u64..1_000_000).prop_filter("even", |b| b % 2 == 0), a in 1u64..10) {
        prop_assume!(a <= b);
        prop_assert!(b > 0);
    }
}
`,
  });
  const { code, out } = hatches(dir);
  assert.equal(code, 1);
  for (const kind of [/run count 5 < 25/, /property skipped/, /discard filter/, /discard prop_assume!/])
    assert.match(out, kind);
  assert.equal(count(out), 4);
});

test("typescript: fc.pre, .filter, numRuns, test.skip in a new untracked file", () => {
  const dir = repo({ "src/a.ts": "export const a = 1;\n" });
  write(dir, {
    "tests/params.property.test.ts": `import fc from "fast-check";
import { test } from "vitest";
test.skip("roundtrip", () => {
  fc.assert(fc.property(fc.string().filter((s) => !s.includes("%")), fc.nat(), (s, n) => {
    fc.pre(n > 3);
    return true;
  }), { seed: 42, numRuns: 10 });
});
`,
  });
  const { code, out } = hatches(dir);
  assert.equal(code, 1);
  for (const kind of [/property skipped/, /discard filter/, /discard fc\.pre/, /run count 10 < 25/])
    assert.match(out, kind);
  assert.match(out, /tests\/params\.property\.test\.ts:5 +discard fc\.pre/);
  assert.equal(count(out), 4);
});

test("jvm and .NET discards: Assume.that and the FsCheck ==> implication", () => {
  const dir = repo({ "README.md": "x\n" });
  write(dir, {
    "src/test/java/FeeProperties.java": `import net.jqwik.api.*;
class FeeProperties {
  @Property(tries = 1000)
  void fee(@ForAll int a) { Assume.that(a > 0); }
}
`,
    "tests/Props.fs": `open FsCheck
let prop (a: int) = a > 0 ==> (a + 0 = a)
`,
  });
  const { out } = hatches(dir);
  assert.equal((out.match(/discard assume \(jvm\/\.NET\)/g) ?? []).length, 2);
  assert.equal(count(out), 2);
});

test("files that use no property library are not scanned", () => {
  const dir = repo({ "src/list.ts": "export const xs = [1];\n" });
  write(dir, { "src/list.ts": "export const xs = [1].filter((x) => x > 0);\nexport const n = { numRuns: 1 };\n" });
  const { code, out } = hatches(dir);
  assert.equal(code, 0);
  assert.equal(count(out), 0);
});

test("a hatch already on the base is not counted again", () => {
  const withHatch = PY_BASE.replace("    assert", "    assume(amount != 7)\n    assert");
  const dir = repo({ "tests/test_props.py": withHatch });
  write(dir, { "tests/test_props.py": withHatch + "\n" });
  assert.equal(count(hatches(dir).out), 0);
});

test("a committed hatch on the branch is counted", () => {
  const dir = repo({ "tests/test_props.py": PY_BASE });
  git(dir, "checkout", "-qb", "feature");
  write(dir, { "tests/test_props.py": PY_BASE.replace("    assert", "    assume(amount != 7)\n    assert") });
  git(dir, "commit", "-qam", "hatch");
  const { code, out } = hatches(dir);
  assert.equal(code, 1);
  assert.match(out, /tests\/test_props\.py:8 +discard assume\(\)/);
});

test("bad usage and an unknown base ref exit 2", () => {
  const dir = repo({ "a.txt": "a\n" });
  assert.equal(run("escape-hatches.sh", dir).code, 2);
  assert.equal(run("escape-hatches.sh", dir, "no-such-ref").code, 2);
});

// plant-mutant.sh
const ACCOUNT = `def withdraw(balance, amount):
    if amount > balance:
        raise ValueError("insufficient")
    return balance - amount
`;
const checker = (assertion) =>
  `import sys; sys.path.insert(0, "."); from account import withdraw\n${assertion}\n`;

test("plant-mutant: a property that catches the mutant: KILLED, exit 0, file restored", () => {
  const dir = repo({ "account.py": ACCOUNT, "check.py": checker("assert withdraw(10, 10) == 0") });
  const { code, out } = run("plant-mutant.sh", dir, "account.py", "2", "amount > balance", "amount >= balance", "--", "python3", "check.py");
  assert.equal(code, 0, out);
  assert.match(out, /mutant: account\.py:2 'amount > balance' -> 'amount >= balance'  KILLED/);
  assert.equal(readFileSync(join(dir, "account.py"), "utf8"), ACCOUNT);
  assert.equal(git(dir, "status", "--porcelain", "--", "account.py").stdout, "");
});

test("plant-mutant: a vacuous property: SURVIVED, exit 1, file restored", () => {
  const dir = repo({ "account.py": ACCOUNT, "check.py": checker("assert withdraw(10, 3) == withdraw(10, 3)") });
  const { code, out } = run("plant-mutant.sh", dir, "account.py", "2", "amount > balance", "amount >= balance", "--", "python3", "check.py");
  assert.equal(code, 1, out);
  assert.match(out, /SURVIVED/);
  assert.equal(readFileSync(join(dir, "account.py"), "utf8"), ACCOUNT);
});

test("plant-mutant: the old text is not on the line: exit 2, nothing changed", () => {
  const dir = repo({ "account.py": ACCOUNT });
  const { code, err } = run("plant-mutant.sh", dir, "account.py", "3", "amount > balance", "x", "--", "true");
  assert.equal(code, 2);
  assert.match(err, /is not on account\.py:3/);
  assert.equal(readFileSync(join(dir, "account.py"), "utf8"), ACCOUNT);
});

test("plant-mutant: special characters in old and new are literal", () => {
  const src = "x = a.b[0] * 2  # $HOME \\n & |\n";
  const dir = repo({ "m.py": src });
  const { code, out } = run("plant-mutant.sh", dir, "m.py", "1", "a.b[0] * 2", "a.b[0] & $HOME", "--", "false");
  assert.equal(code, 0, out);
  assert.match(out, /after: +x = a\.b\[0\] & \$HOME  # \$HOME \\n & \|/);
  assert.equal(readFileSync(join(dir, "m.py"), "utf8"), src);
});

// freeze.sh
const sha = (s) => createHash("sha256").update(s).digest("hex");

test("freeze: a line range hashes only those lines; an edit inside changes it, outside does not", () => {
  const dir = repo({ "p.py": "a\nb\nc\nd\n" });
  const first = run("freeze.sh", dir, "p.py:2-3", "p.py");
  assert.equal(first.code, 0);
  assert.equal(first.out, `${sha("b\nc\n")}  p.py:2-3\n${sha("a\nb\nc\nd\n")}  p.py\n`);
  write(dir, { "p.py": "a\nb\nc\nd\ne\n" });
  assert.match(run("freeze.sh", dir, "p.py:2-3").out, new RegExp(sha("b\nc\n")));
  write(dir, { "p.py": "a\nB\nc\nd\n" });
  assert.doesNotMatch(run("freeze.sh", dir, "p.py:2-3").out, new RegExp(sha("b\nc\n")));
});

test("freeze: a range past the end and a missing file exit 2", () => {
  const dir = repo({ "p.py": "a\n" });
  assert.equal(run("freeze.sh", dir, "p.py:1-5").code, 2);
  assert.equal(run("freeze.sh", dir, "nope.py").code, 2);
});
