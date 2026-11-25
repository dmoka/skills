import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const SCRIPTS = here("../skills/bounded-model-check/scripts/");
const LOGS = here("./fixtures/bounded-model-check/");

function run(script, args, opts = {}) {
  const r = spawnSync("bash", [join(SCRIPTS, script), ...args], { encoding: "utf8", ...opts });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const verdict = (log) => run("bmc-run.sh", ["--parse", join(LOGS, log)]);

function tmpFile(name, body) {
  const dir = mkdtempSync(join(tmpdir(), "bmc-"));
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

// ---------- bmc-run.sh: fail-closed verdicts from real Kani 0.68 / CBMC 6.11 output ----------

test("kani: a harness with no cover is NO-COVER, not a pass", () => {
  const { code, out } = verdict("kani-no-cover.log");
  assert.equal(code, 12);
  assert.match(out, /^NO-COVER +proofs::parse_never_panics/m);
});

test("kani: SUCCESSFUL with every cover unreachable is VACUOUS", () => {
  const { code, out } = verdict("kani-vacuous.log");
  assert.match(readFileSync(join(LOGS, "kani-vacuous.log"), "utf8"), /VERIFICATION:- SUCCESSFUL/);
  assert.equal(code, 12);
  assert.match(out, /^VACUOUS +proofs::parse_never_panics \(covers 0\/3 reached\)/m);
});

test("kani: a failed unwinding assertion is BOUND-TOO-LOW, not a bug and not a pass", () => {
  const { code, out } = verdict("kani-bound-too-low.log");
  assert.equal(code, 11);
  assert.match(out, /^BOUND-TOO-LOW +proofs::decode_never_panics/m);
  assert.doesNotMatch(out, /failed:/);
});

test("kani: a real failed check is FAILED with the check named", () => {
  const { code, out } = verdict("kani-failed.log");
  assert.equal(code, 10);
  assert.match(out, /^FAILED +proofs::decode_never_panics/m);
  assert.match(out, /failed: index out of bounds/);
});

test("kani: FAILED keeps the cover count", () => {
  const { code, out } = verdict("kani-failed-covered.log");
  assert.equal(code, 10);
  assert.match(out, /FAILED +proofs::never_more_than_balance \(covers 2\/2 reached\)/);
});

test("kani: two harnesses get one line each; the exit code is the worst verdict", () => {
  const { code, out } = verdict("kani-two-harnesses.log");
  assert.match(out, /^NO-COVER +proofs::mid_ok/m);
  assert.match(out, /^VERIFIED +proofs::payload_ok \(covers 2\/2 reached\)/m);
  assert.equal(code, 12);
});

test("kani: all covers reached and nothing failed is VERIFIED, exit 0", () => {
  const log = tmpFile("ok.log", [
    "Checking harness bmc_proofs::add_fee_ok...",
    "VERIFICATION RESULT:",
    " ** 0 of 12 failed",
    " ** 3 of 3 cover properties satisfied",
    "VERIFICATION:- SUCCESSFUL",
  ].join("\n"));
  const { code, out } = run("bmc-run.sh", ["--parse", log]);
  assert.equal(code, 0);
  assert.match(out, /^VERIFIED +bmc_proofs::add_fee_ok \(covers 3\/3 reached\)/m);
});

test("kani: some covers unreached is UNCOVERED", () => {
  const log = tmpFile("partial.log", [
    "Checking harness p::h...",
    " ** 0 of 12 failed (1 unreachable)",
    " ** 2 of 3 cover properties satisfied (1 unreachable)",
    "VERIFICATION:- SUCCESSFUL",
  ].join("\n"));
  const { code, out } = run("bmc-run.sh", ["--parse", log]);
  assert.equal(code, 12);
  assert.match(out, /^UNCOVERED +p::h \(covers 2\/3 reached\)/m);
});

test("kani: a harness that started but printed no verdict (compile error, timeout) is UNKNOWN", () => {
  const log = tmpFile("crash.log", "Checking harness p::h...\nerror: could not compile\n");
  const { code, out } = run("bmc-run.sh", ["--parse", log]);
  assert.equal(code, 2);
  assert.match(out, /^UNKNOWN +p::h/m);
});

test("a log with no harness at all is UNKNOWN", () => {
  const { code, out } = run("bmc-run.sh", ["--parse", tmpFile("empty.log", "error[E0425]: cannot find function\n")]);
  assert.equal(code, 2);
  assert.match(out, /no harness result/);
});

test("cbmc: 'cover:' asserts count as covers (FAILURE = reached); the real failure is FAILED", () => {
  const { code, out } = verdict("cbmc-failed.log");
  assert.equal(code, 10);
  assert.match(out, /^FAILED +main \(covers 2\/2 reached\)/m);
  assert.match(out, /pointer outside object bounds/);
  assert.doesNotMatch(out, /failed: .*cover:/);
});

test("cbmc: a real failure plus a failed unwinding assertion is FAILED with a note", () => {
  const { code, out } = verdict("cbmc-failed-and-unwind.log");
  assert.equal(code, 10);
  assert.match(out, /an unwinding assertion failed too/);
});

test("cbmc: VERIFICATION FAILED caused only by reached covers is VERIFIED", () => {
  const log = tmpFile("c-ok.log", [
    "[harness.assertion.1] line 14 cover: rejected: FAILURE",
    "[harness.assertion.2] line 15 cover: accepted: FAILURE",
    "[harness.assertion.3] line 16 R1: length fits out: SUCCESS",
    "[read_record.unwind.0] line 11 unwinding assertion loop 0: SUCCESS",
    "** 2 of 4 failed (3 iterations)",
    "VERIFICATION FAILED",
  ].join("\n"));
  const { code, out } = run("bmc-run.sh", ["--parse", log]);
  assert.equal(code, 0);
  assert.match(out, /^VERIFIED +main \(covers 2\/2 reached\)/m);
});

test("cbmc: a cover assert that holds (SUCCESS) is an unreached branch", () => {
  const log = tmpFile("c-vac.log", [
    "[harness.assertion.1] line 14 cover: rejected: SUCCESS",
    "[harness.assertion.2] line 15 R1: length fits out: SUCCESS",
    "VERIFICATION SUCCESSFUL",
  ].join("\n"));
  const { code, out } = run("bmc-run.sh", ["--parse", log]);
  assert.equal(code, 12);
  assert.match(out, /^VACUOUS +main/m);
});

test("cbmc: an unwinding failure alone is BOUND-TOO-LOW", () => {
  const log = tmpFile("c-unw.log", [
    "[harness.assertion.1] line 14 cover: rejected: FAILURE",
    "[read_record.unwind.0] line 11 unwinding assertion loop 0: FAILURE",
    "VERIFICATION FAILED",
  ].join("\n"));
  assert.equal(run("bmc-run.sh", ["--parse", log]).code, 11);
});

test("esbmc-style output (no per-property lines): VERIFICATION FAILED is FAILED", () => {
  const log = tmpFile("esbmc.log", "Violated property:\n  array bounds violated\n\nVERIFICATION FAILED\n");
  assert.equal(run("bmc-run.sh", ["--parse", log]).code, 10);
});

test("run mode: names the CBMC harness after --function and writes the log", () => {
  const dir = mkdtempSync(join(tmpdir(), "bmc-"));
  const fake = join(dir, "fakecbmc.sh");
  writeFileSync(fake, "#!/usr/bin/env bash\necho '[check_record.assertion.1] line 3 cover: x: FAILURE'\necho 'VERIFICATION FAILED'\nexit 10\n");
  const log = join(dir, "logs/out.log");
  const r = run("bmc-run.sh", [log, "bash", fake, "--function", "check_record"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^VERIFIED +check_record \(covers 1\/1 reached\)/m);
  assert.match(readFileSync(log, "utf8"), /VERIFICATION FAILED/);
});

for (const flag of ["--no-unwinding-checks", "--no-unwinding-assertions", "--no-bounds-check", "--no-standard-checks"]) {
  test(`refuses ${flag} without approval (exit 3, nothing runs)`, () => {
    const dir = mkdtempSync(join(tmpdir(), "bmc-"));
    const marker = join(dir, "ran");
    const r = run("bmc-run.sh", [join(dir, "x.log"), "bash", "-c", `touch ${marker}`, flag]);
    assert.equal(r.code, 3);
    assert.match(r.err, /REFUSED/);
    assert.equal(spawnSync("test", ["-e", marker]).status, 1);
  });
}

test("BMC_ALLOW lets exactly the approved flag through", () => {
  const dir = mkdtempSync(join(tmpdir(), "bmc-"));
  const ok = run("bmc-run.sh", [join(dir, "x.log"), "bash", "-c", "echo 'VERIFICATION SUCCESSFUL'", "--no-unwinding-checks"],
    { env: { ...process.env, BMC_ALLOW: "--no-unwinding-checks" } });
  assert.notEqual(ok.code, 3);
  const other = run("bmc-run.sh", [join(dir, "y.log"), "true", "--no-bounds-check"],
    { env: { ...process.env, BMC_ALLOW: "--no-unwinding-checks" } });
  assert.equal(other.code, 3);
});

// ---------- escape-hatches.sh: every planted hatch in a diff is listed ----------

function gitRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), "hatch-"));
  const git = (...a) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...a], { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  git("add", "-A");
  git("commit", "-qm", "base");
  return { dir, git };
}
const hatches = (dir, ref = "HEAD") => run("escape-hatches.sh", [ref], { cwd: dir });

const lib = `pub fn f(x: u8) -> u8 { x }

#[cfg(kani)]
mod bmc_proofs {
    use super::*;
    #[kani::proof]
    #[kani::unwind(9)]
    fn h() {
        let x: u8 = kani::any();
        let _ = f(x);
    }
}
`;

test("a clean diff has 0 hatches and exits 0", () => {
  const { dir } = gitRepo({ "src/lib.rs": lib });
  appendFileSync(join(dir, "src/lib.rs"), "// a comment\n");
  const r = hatches(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /^0 new escape hatch\(es\) since HEAD/m);
});

const planted = [
  ["assume", "        kani::assume(x < 10);", /src\/lib\.rs:\d+ +assume +kani::assume\(x < 10\);/],
  ["any_where", "        let y: u8 = kani::any_where(|v| *v > 3);", /assume +let y: u8 = kani::any_where/],
  ["stub", "    #[kani::stub(f, g)]", /stub +#\[kani::stub\(f, g\)\]/],
  ["should_panic", "    #[kani::should_panic]", /expect-panic +#\[kani::should_panic\]/],
  ["cfg(not(kani))", "#[cfg(not(kani))]", /hidden +#\[cfg\(not\(kani\)\)\]/],
];
for (const [name, line, re] of planted) {
  test(`lists a planted ${name}`, () => {
    const { dir } = gitRepo({ "src/lib.rs": lib });
    const body = readFileSync(join(dir, "src/lib.rs"), "utf8").replace("        let _ = f(x);", `${line}\n        let _ = f(x);`);
    writeFileSync(join(dir, "src/lib.rs"), body);
    const r = hatches(dir);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, re);
    assert.match(r.out, /^1 new escape hatch\(es\)/m);
  });
}

test("a lowered #[kani::unwind] is listed; a raised one is not", () => {
  const { dir } = gitRepo({ "src/lib.rs": lib });
  writeFileSync(join(dir, "src/lib.rs"), lib.replace("unwind(9)", "unwind(3)"));
  const low = hatches(dir);
  assert.equal(low.code, 1);
  assert.match(low.out, /lowered-bound +#\[kani::unwind\(3\)\]/);
  writeFileSync(join(dir, "src/lib.rs"), lib.replace("unwind(9)", "unwind(12)"));
  assert.equal(hatches(dir).code, 0);
});

test("C hatches: __CPROVER_assume and a lowered --unwind in a Makefile", () => {
  const { dir } = gitRepo({ "bmc/h.c": "void harness(void) {\n}\n", Makefile: "bmc:\n\tcbmc h.c --function harness --unwind 18\n" });
  writeFileSync(join(dir, "bmc/h.c"), "void harness(void) {\n  __CPROVER_assume(n < 4);\n}\n");
  writeFileSync(join(dir, "Makefile"), "bmc:\n\tcbmc h.c --function harness --unwind 4\n");
  const r = hatches(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /bmc\/h\.c:2 +assume +__CPROVER_assume\(n < 4\);/);
  assert.match(r.out, /Makefile:2 +lowered-bound/);
});

test("switched-off checks on a command line and in Cargo.toml", () => {
  const { dir } = gitRepo({ "Cargo.toml": "[package]\nname = \"x\"\n", "ci.sh": "cargo kani\n" });
  appendFileSync(join(dir, "Cargo.toml"), "\n[package.metadata.kani.flags]\nunwinding-checks = false\n");
  writeFileSync(join(dir, "ci.sh"), "cargo kani --no-unwinding-checks\ncbmc a.c --no-bounds-check\n");
  const r = hatches(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /Cargo\.toml:\d+ +check-off +unwinding-checks = false/);
  assert.match(r.out, /ci\.sh:1 +check-off +cargo kani --no-unwinding-checks/);
  assert.match(r.out, /ci\.sh:2 +check-off/);
  assert.match(r.out, /^3 new escape hatch\(es\)/m);
});

test("hatches in untracked files and in commits after the base are listed", () => {
  const { dir, git } = gitRepo({ "src/lib.rs": lib });
  writeFileSync(join(dir, "src/lib.rs"), lib.replace("        let _ = f(x);", "        kani::assume(x != 0);\n        let _ = f(x);"));
  git("commit", "-qam", "harness tweak");
  writeFileSync(join(dir, "src/proofs.rs"), "fn p() { kani::assume(true); }\n");
  const r = hatches(dir, "HEAD~1");
  assert.match(r.out, /src\/lib\.rs:\d+ +assume +kani::assume\(x != 0\);/);
  assert.match(r.out, /src\/proofs\.rs:1 +assume/);
  assert.match(r.out, /^2 new escape hatch\(es\) since HEAD~1/m);
});

test("a removed assume is not a new hatch", () => {
  const withAssume = lib.replace("        let _ = f(x);", "        kani::assume(x < 10);\n        let _ = f(x);");
  const { dir } = gitRepo({ "src/lib.rs": withAssume });
  writeFileSync(join(dir, "src/lib.rs"), lib);
  assert.equal(hatches(dir).code, 0);
});

test("python preconditions (CrossHair pre:) are listed", () => {
  const { dir } = gitRepo({ "app/p.py": 'def f(x):\n    """Parse.\n    """\n    return x\n' });
  writeFileSync(join(dir, "app/p.py"), 'def f(x):\n    """Parse.\n\n    pre: len(x) > 2\n    """\n    return x\n');
  const r = hatches(dir);
  assert.match(r.out, /app\/p\.py:4 +precondition +pre: len\(x\) > 2/);
});

test("an unknown base ref exits 2", () => {
  const { dir } = gitRepo({ "a.txt": "a\n" });
  assert.equal(hatches(dir, "no-such-ref").code, 2);
});

// ---------- plant-mutant.sh ----------

const fakeChecker = (dir) => {
  // exits 10 (FAILED) when the mutant marker is in the file, 0 (VERIFIED) otherwise
  const p = join(dir, "checker.sh");
  writeFileSync(p, '#!/usr/bin/env bash\nif grep -q "wrapping_add" "$1"; then exit 10; fi\nexit 0\n');
  return p;
};

test("plant-mutant: CAUGHT when the checker fails; the file is restored byte for byte", () => {
  const dir = mkdtempSync(join(tmpdir(), "mut-"));
  const src = join(dir, "lib.rs");
  const body = "pub fn add(a: u64, b: u64) -> Option<u64> {\n    a.checked_add(b)\n}\n";
  writeFileSync(src, body);
  const r = run("plant-mutant.sh", [src, "2", "a.checked_add(b)", "Some(a.wrapping_add(b))", "--", "bash", fakeChecker(dir), src]);
  assert.equal(r.code, 0);
  assert.match(r.out, /mutant: .*lib\.rs:2 'a\.checked_add\(b\)' -> 'Some\(a\.wrapping_add\(b\)\)' +CAUGHT/);
  assert.equal(readFileSync(src, "utf8"), body);
});

test("plant-mutant: MISSED when the checker still verifies; exit 1; file restored", () => {
  const dir = mkdtempSync(join(tmpdir(), "mut-"));
  const src = join(dir, "lib.rs");
  const body = "fn f(x: u8) -> u8 {\n    x + 1\n}\n";
  writeFileSync(src, body);
  const r = run("plant-mutant.sh", [src, "2", "x + 1", "x + 2", "--", "bash", fakeChecker(dir), src]);
  assert.equal(r.code, 1);
  assert.match(r.out, /MISSED/);
  assert.equal(readFileSync(src, "utf8"), body);
});

test("plant-mutant: any other exit (a compile error) is INVALID, not CAUGHT", () => {
  const dir = mkdtempSync(join(tmpdir(), "mut-"));
  const src = tmpFile("lib.rs", "fn f() {\n    1\n}\n");
  const r = run("plant-mutant.sh", [src, "2", "1", "(", "--", "bash", "-c", "exit 2"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /INVALID \(exit 2\)/);
  assert.equal(readFileSync(src, "utf8"), "fn f() {\n    1\n}\n");
  void dir;
});

test("plant-mutant: refuses when <old> is missing or occurs twice on the line", () => {
  const src = tmpFile("lib.rs", "let y = x + x;\n");
  assert.equal(run("plant-mutant.sh", [src, "1", "x", "z", "--", "true"]).code, 2);
  assert.equal(run("plant-mutant.sh", [src, "1", "q", "z", "--", "true"]).code, 2);
  assert.equal(readFileSync(src, "utf8"), "let y = x + x;\n");
});

test("plant-mutant: special characters in old/new are literal, not regex", () => {
  const dir = mkdtempSync(join(tmpdir(), "mut-"));
  const src = join(dir, "lib.rs");
  writeFileSync(src, "    &buf[1..1 + len]\n");
  const seen = join(dir, "seen.txt");
  const r = run("plant-mutant.sh", [src, "1", "&buf[1..1 + len]", "&buf[1..=1 + len]", "--", "bash", "-c", `cp "${src}" "${seen}"; exit 10`]);
  assert.equal(r.code, 0);
  assert.equal(readFileSync(seen, "utf8"), "    &buf[1..=1 + len]\n");
  assert.equal(readFileSync(src, "utf8"), "    &buf[1..1 + len]\n");
});

// ---------- freeze-rule.sh ----------

test("freeze-rule: freeze, check FROZEN, edit, check CHANGED", () => {
  const rules = tmpFile("bmc-rules.md", "R1: payload never panics.\n");
  const f = run("freeze-rule.sh", [rules]);
  assert.equal(f.code, 0);
  assert.match(f.out, /sha256 [0-9a-f]{64}/);
  assert.match(readFileSync(rules + ".sha256", "utf8"), /^[0-9a-f]{64}  bmc-rules\.md\n$/);
  assert.equal(run("freeze-rule.sh", ["--check", rules]).code, 0);
  appendFileSync(rules, "R2: weaker.\n");
  const c = run("freeze-rule.sh", ["--check", rules]);
  assert.equal(c.code, 1);
  assert.match(c.out, /^CHANGED/);
});

test("run mode: a checker that runs past BMC_TIMEOUT is killed and reported as TIMEOUT", () => {
  const dir = mkdtempSync(join(tmpdir(), "bmc-"));
  const t0 = Date.now();
  const r = run("bmc-run.sh", [join(dir, "t.log"), "bash", "-c", "echo 'Checking harness p::slow...'; sleep 30"],
    { env: { ...process.env, BMC_TIMEOUT: "1" } });
  assert.equal(r.code, 2);
  assert.match(r.out, /^TIMEOUT +p::slow/m);
  assert.ok(Date.now() - t0 < 15000, "the checker was not killed");
});

test("kani: the failed check carries its File line (the placeholder message hides the real check)", () => {
  const log = tmpFile("ph.log", [
    "Checking harness bmc_proofs::parse_any_frame...",
    " ** 2 of 40 failed",
    " ** 5 of 5 cover properties satisfied",
    "Failed Checks: This is a placeholder message; Kani doesn't support message formatted at runtime",
    ' File: "library/core/src/slice/index.rs", line 50, in core::slice::index::slice_index_fail::do_panic::runtime',
    "Failed Checks: index out of bounds: the length is less than or equal to the given index",
    ' File: "src/lib.rs", line 9, in parse',
    "VERIFICATION:- FAILED",
  ].join("\n"));
  const { code, out } = run("bmc-run.sh", ["--parse", log]);
  assert.equal(code, 10);
  assert.match(out, /placeholder message.*at library\/core\/src\/slice\/index\.rs:50 in core::slice::index::slice_index_fail/);
  assert.match(out, /index out of bounds.*at src\/lib\.rs:9 in parse/);
});

test("kani: a killed solver prints 'VERIFICATION:- FAILED' with no failed check; that is UNKNOWN, not FAILED", () => {
  const { code, out } = verdict("kani-solver-killed.log");
  assert.equal(code, 2);
  assert.match(out, /^UNKNOWN +bmc_proofs::checksum_never_panics \(the solver was killed/m);
});

test("refuses --property (a subset run drops the unwinding and built-in checks)", () => {
  const dir = mkdtempSync(join(tmpdir(), "bmc-"));
  assert.equal(run("bmc-run.sh", [join(dir, "p.log"), "true", "--property", "h.assertion.1"]).code, 3);
  assert.equal(run("bmc-run.sh", [join(dir, "q.log"), "true", "--property=h.assertion.1"]).code, 3);
});

test("cbmc: covers of other harnesses in the same files are not counted", () => {
  const dir = mkdtempSync(join(tmpdir(), "bmc-"));
  const fake = join(dir, "fake.sh");
  writeFileSync(fake, [
    "#!/usr/bin/env bash",
    "echo '[harness_a.assertion.1] line 3 cover: a reached: FAILURE'",
    "echo '[harness_b.assertion.1] line 9 cover: b reached: SUCCESS'",
    "echo 'VERIFICATION FAILED'",
    "exit 10",
  ].join("\n"));
  const r = run("bmc-run.sh", [join(dir, "o.log"), "bash", fake, "--function", "harness_a"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^VERIFIED +harness_a \(covers 1\/1 reached\)/m);
});

test("escape-hatches: a --property subset run in a script is listed", () => {
  const { dir } = gitRepo({ "bmc.sh": "cbmc a.c --function h\n" });
  writeFileSync(join(dir, "bmc.sh"), "cbmc a.c --function h --property h.assertion.2\n");
  assert.match(hatches(dir).out, /bmc\.sh:1 +check-off/);
});

test("escape-hatches: untracked build output (target/) and binary files are skipped", () => {
  const { dir } = gitRepo({ "src/lib.rs": lib });
  mkdirSync(join(dir, "target/kani"), { recursive: true });
  writeFileSync(join(dir, "target/kani/pretty_name_map.json"), '{"a": "kani::assume"}\n');
  writeFileSync(join(dir, "blob.o"), Buffer.from([0, 1, 2, 0x6b, 0x61, 0x6e, 0x69, 0, 255, 254]));
  const r = hatches(dir);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(r.err, "");
});
