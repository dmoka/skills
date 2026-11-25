import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = fileURLToPath(new URL("../skills/model-check-design/scripts/", import.meta.url));
const run = (script, args, opts = {}) => {
  const r = spawnSync("bash", [join(SCRIPTS, script), ...args], { encoding: "utf8", ...opts });
  return { code: r.status, out: r.stdout + r.stderr };
};
const tla = (args, opts) => {
  const r = spawnSync("perl", [join(SCRIPTS, "tla.pl"), ...args], { encoding: "utf8", ...opts });
  return r.stdout;
};

function dir(files) {
  const d = mkdtempSync(join(tmpdir(), "mcd-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(d, path)), { recursive: true });
    writeFileSync(join(d, path), body);
  }
  return d;
}
const git = (cwd, ...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd, encoding: "utf8" });
function repo(files) {
  const d = dir(files);
  git(d, "init", "-q");
  git(d, "add", "-A");
  git(d, "commit", "-qm", "base");
  return d;
}
const head = (d) => git(d, "rev-parse", "--short", "HEAD").stdout.trim();

// The payment-retry model: split mode charges twice, atomic mode does not.
const PAYMENT = `---- MODULE Pay ----
\\* sync: SYNC
EXTENDS Naturals
CONSTANT Mode
Reqs == {1, 2}
\\* anchor client: client.ts:3@SYNC
\\* anchor req: model-only — where each request is
\\* anchor charges: pay.ts:2@SYNC
\\* anchor stored: pay.ts:3@SYNC
VARIABLES client, req, charges, stored
vars == <<client, req, charges, stored>>
Init == /\\ client = "send" /\\ req = [r \\in Reqs |-> "none"] /\\ charges = 0 /\\ stored = FALSE
\\* anchor Send: client.ts:1@SYNC
Send == /\\ client = "send" /\\ req' = [req EXCEPT ![1] = "sent"] /\\ client' = "wait" /\\ UNCHANGED <<charges, stored>>
\\* anchor Retry: client.ts:2@SYNC
Retry == /\\ client = "wait" /\\ req' = [req EXCEPT ![2] = "sent"] /\\ client' = "retried" /\\ UNCHANGED <<charges, stored>>
\\* anchor Check: pay.ts:1@SYNC
Check(r) == /\\ req[r] = "sent" /\\ Mode = "split"
            /\\ req' = [req EXCEPT ![r] = IF stored THEN "done" ELSE "checked"]
            /\\ UNCHANGED <<client, charges, stored>>
\\* anchor Charge: pay.ts:2@SYNC
Charge(r) == /\\ req[r] = "checked" /\\ charges' = charges + 1 /\\ req' = [req EXCEPT ![r] = "charged"] /\\ UNCHANGED <<client, stored>>
\\* anchor Store: pay.ts:3@SYNC
Store(r) == /\\ req[r] = "charged" /\\ stored' = TRUE /\\ req' = [req EXCEPT ![r] = "done"] /\\ UNCHANGED <<client, charges>>
\\* anchor Atomic: pay.ts:1-3@SYNC
Atomic(r) == /\\ req[r] = "sent" /\\ Mode = "atomic"
             /\\ charges' = (IF stored THEN charges ELSE charges + 1)
             /\\ stored' = TRUE
             /\\ req' = [req EXCEPT ![r] = "done"] /\\ UNCHANGED client
\\* anchor Done: model-only — both requests answered
Done == /\\ \\A r \\in Reqs : req[r] \\in {"none", "done"} /\\ client # "send" /\\ UNCHANGED vars
Next == Send \\/ Retry \\/ Done \\/ \\E r \\in Reqs : Check(r) \\/ Charge(r) \\/ Store(r) \\/ Atomic(r)
Limit == 1
ChargedOnce == charges <= Limit
====
`;
const CFG = (mode, extra = "") => `CONSTANT Mode = "${mode}"\nINIT Init\nNEXT Next\nINVARIANT ChargedOnce\n${extra}`;

test("tla.pl reads variables, actions, Next, checks and constants", () => {
  const d = dir({ "Pay.tla": PAYMENT, "Pay.cfg": CFG("split", "CONSTANTS N = 3 W = {a, b}\nCHECK_DEADLOCK FALSE\n") });
  assert.equal(tla(["vars", join(d, "Pay.tla")]), "client\nreq\ncharges\nstored\n");
  assert.equal(tla(["actions", join(d, "Pay.tla")]), "Send\nRetry\nCheck\nCharge\nStore\nAtomic\nDone\n");
  assert.match(tla(["next", join(d, "Pay.tla")]), /^Atomic\nCharge\nCheck\nDone\nReqs\nRetry\nSend\nStore\n$/);
  assert.equal(tla(["checks", join(d, "Pay.cfg")]), "ChargedOnce\n");
  assert.equal(tla(["consts", join(d, "Pay.cfg")]), 'Mode\t"split"\nN\t3\nW\t{a, b}\n');
  assert.equal(tla(["sizes", join(d, "Pay.tla")]), "Limit\t1\nReqs\t2\n");
});

test("freeze: comments and whitespace do not count, every weakening does", () => {
  const d = dir({ "Pay.tla": PAYMENT, "Pay.cfg": CFG("split", "CONSTANTS N = 3\n") });
  const spec = join(d, "Pay.tla"), cfg = join(d, "Pay.cfg");
  assert.equal(run("freeze.sh", ["record", spec, "--config", cfg]).code, 0);
  assert.ok(existsSync(join(d, "Pay.frozen")));
  assert.equal(run("freeze.sh", ["check", spec, "--config", cfg]).code, 0);

  writeFileSync(spec, PAYMENT.replace("ChargedOnce == charges <= Limit", "ChargedOnce ==   charges <=   Limit \\* same"));
  assert.equal(run("freeze.sh", ["check", spec, "--config", cfg]).code, 0, "a reformat is not a change");

  const cases = [
    [PAYMENT.replace("charges <= Limit", "charges <= Limit + 1"), CFG("split", "CONSTANTS N = 3\n"), /ChargedOnce: its definition/],
    [PAYMENT.replace("Limit == 1", "Limit == 2"), CFG("split", "CONSTANTS N = 3\n"), /ChargedOnce: its definition/],
    [PAYMENT.replace("Reqs == {1, 2}", "Reqs == {1}"), CFG("split", "CONSTANTS N = 3\n"), /size Reqs shrunk: 2 -> 1/],
    [PAYMENT, CFG("split", "CONSTANTS N = 2\n"), /const N shrunk: 3 -> 2/],
    [PAYMENT, CFG("atomic", "CONSTANTS N = 3\n"), /const Mode changed/],
    [PAYMENT.replace(" \\/ Store(r)", ""), CFG("split", "CONSTANTS N = 3\n"), /action Store dropped from Next/],
    [PAYMENT, CFG("split", "CONSTANTS N = 3\nCHECK_DEADLOCK FALSE\n"), /deadlock check turned off/],
    [PAYMENT, CFG("split", "CONSTANTS N = 3\nCONSTRAINT Small\n"), /new limit: CONSTRAINT Small/],
    [PAYMENT, 'CONSTANT Mode = "split"\nCONSTANTS N = 3\nINIT Init\nNEXT Next\nINVARIANT Other\n', /ChargedOnce: no longer listed/],
  ];
  for (const [s, c, want] of cases) {
    writeFileSync(spec, s);
    writeFileSync(cfg, c);
    const r = run("freeze.sh", ["check", spec, "--config", cfg]);
    assert.equal(r.code, 1, `expected a change: ${want}\n${r.out}`);
    assert.match(r.out, want);
  }
  writeFileSync(spec, PAYMENT);
  writeFileSync(cfg, CFG("split", "CONSTANTS N = 4\n"));
  const grown = run("freeze.sh", ["check", spec, "--config", cfg]);
  assert.equal(grown.code, 0, grown.out);
  assert.match(grown.out, /const N grew: 3 -> 4/);
});

test("anchors: every variable and action needs one, at the sync commit, on a real line", () => {
  const code = { "pay.ts": "check\ncharge\nstore\n", "client.ts": "send\nretry\nwait\n" };
  const d = repo(code);
  const c = head(d);
  writeFileSync(join(d, "Pay.tla"), PAYMENT.replaceAll("SYNC", c));
  const ok = run("anchors.sh", [join(d, "Pay.tla"), "--repo", d]);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /ok +action Charge: pay\.ts:2  charge/);

  writeFileSync(join(d, "Pay.tla"), PAYMENT.replaceAll("SYNC", c).replace(/\\\* anchor Store:.*\n/, ""));
  assert.match(run("anchors.sh", [join(d, "Pay.tla"), "--repo", d]).out, /MISSING  action Store/);

  writeFileSync(join(d, "Pay.tla"), PAYMENT.replaceAll("SYNC", c).replace("pay.ts:3@" + c, "pay.ts:9@" + c));
  assert.match(run("anchors.sh", [join(d, "Pay.tla"), "--repo", d]).out, /BROKEN .*pay\.ts has 3 lines/);

  writeFileSync(join(d, "Pay.tla"), PAYMENT.replaceAll("SYNC", c).replace("client.ts:3@" + c, "client.ts:3@abcdef1"));
  assert.match(run("anchors.sh", [join(d, "Pay.tla"), "--repo", d]).out, /STALE    variable client/);

  writeFileSync(join(d, "Pay.tla"), PAYMENT.replaceAll("SYNC", c).replace(/\\\* sync:.*\n/, ""));
  const nosync = run("anchors.sh", [join(d, "Pay.tla")]);
  assert.equal(nosync.code, 1);
  assert.match(nosync.out, /MISSING  header/);
});

test("escape hatches: a clean diff exits 0, each weakening is one HATCH line", () => {
  const d = repo({ "specs/Pay.tla": PAYMENT, "specs/Pay.cfg": CFG("split", "CONSTANTS N = 3 W = {a, b}\nINVARIANT Other\n"), "run.sh": "echo hi\n" });
  const clean = run("escape-hatches.sh", ["HEAD"], { cwd: d });
  assert.equal(clean.code, 0, clean.out);
  assert.match(clean.out, /escape hatches: 0/);

  writeFileSync(join(d, "specs/Pay.cfg"), CFG("split", "CONSTANTS N = 2 W = {a}\nCONSTRAINT Small\nCHECK_DEADLOCK FALSE\n"));
  writeFileSync(join(d, "specs/Pay.tla"), PAYMENT.replace("Reqs == {1, 2}", "Reqs == {1}").replace(" \\/ Retry", ""));
  writeFileSync(join(d, "run.sh"), "echo hi\njava -cp tla2tools.jar tlc2.TLC -simulate -depth 30 Pay.tla\n");
  writeFileSync(join(d, "specs/New.cfg"), "INIT Init\nNEXT Next\nINVARIANT X\nVIEW v\n");
  const r = run("escape-hatches.sh", ["HEAD"], { cwd: d });
  assert.equal(r.code, 1, r.out);
  for (const want of [
    /removed check: Other/,
    /shrunk constant: N 3 -> 2/,
    /shrunk constant: W \{a, b\} -> \{a\}/,
    /Pay\.cfg:\d+  added state constraint/,
    /deadlock check turned off/,
    /shrunk model value: Reqs has 1 \(was 2\)/,
    /action dropped from Next: Retry/,
    /run\.sh:2  added a run that cannot PASS/,
    /New\.cfg:4  added VIEW/,
  ]) assert.match(r.out, want);
  assert.match(r.out, /escape hatches: 9/);
});

test("escape hatches: a frozen invariant reworded after the freeze is a HATCH even when uncommitted", () => {
  const d = repo({ "README.md": "x\n" });
  writeFileSync(join(d, "Pay.tla"), PAYMENT);
  writeFileSync(join(d, "Pay.cfg"), CFG("split"));
  assert.equal(run("freeze.sh", ["record", join(d, "Pay.tla"), "--config", join(d, "Pay.cfg")]).code, 0);
  assert.equal(run("escape-hatches.sh", ["HEAD"], { cwd: d }).code, 0);
  writeFileSync(join(d, "Pay.tla"), PAYMENT.replace("charges <= Limit", "charges <= 2"));
  const r = run("escape-hatches.sh", ["HEAD"], { cwd: d });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /HATCH Pay\.frozen  frozen: ChargedOnce: its definition/);
});

test("escape hatches: a Quint assume and a lowered --max-steps are flagged", () => {
  const d = repo({ "m.qnt": "module m {\n  val inv = true\n}\n", "check.sh": "quint verify --max-steps 20 m.qnt\n" });
  writeFileSync(join(d, "m.qnt"), "module m {\n  assume a = true\n  val inv = true\n}\n");
  writeFileSync(join(d, "check.sh"), "quint verify --max-steps 5 m.qnt\n");
  const r = run("escape-hatches.sh", ["HEAD"], { cwd: d });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /m\.qnt:2  added Quint assume/);
  assert.match(r.out, /lowered --max-steps 20 -> 5/);
});

// TLC runs: need Java and the pinned jar (scripts/setup.sh), or JAVA + TLA2TOOLS_JAR.
const JAR = process.env.TLA2TOOLS_JAR ?? join(homedir(), ".cache/model-check-design/tla2tools-1.7.4.jar");
const javaOk = spawnSync(process.env.JAVA ?? "java", ["-version"]).status === 0;
const tlc = { skip: !(existsSync(JAR) && javaOk) && "needs Java and tla2tools.jar (run scripts/setup.sh)" };
const env = (d) => ({ ...process.env, TLA2TOOLS_JAR: JAR, TMPDIR: join(d, "tmp") });
const check = (d, name, extra = []) => run("model-check-design.sh", [join(d, `${name}.tla`), "--time-limit", "60", ...extra], { env: env(d) });
const verdict = (r) => (r.out.match(/^VERDICT: (\w+)/m) ?? [])[1];

test("runner: split mode is a VIOLATION with a trace, atomic mode is a PASS", tlc, () => {
  const d = dir({ "Pay.tla": PAYMENT, "Split.cfg": CFG("split"), "Atomic.cfg": CFG("atomic") });
  const split = run("model-check-design.sh", [join(d, "Pay.tla"), "--config", join(d, "Split.cfg")], { env: env(d) });
  assert.equal(verdict(split), "VIOLATION", split.out);
  assert.equal(split.code, 1);
  assert.match(split.out, /Invariant ChargedOnce is violated/);
  assert.match(split.out, /trace:\n  1: <Initial predicate>/);
  const atomic = run("model-check-design.sh", [join(d, "Pay.tla"), "--config", join(d, "Atomic.cfg")], { env: env(d) });
  // Check, Charge and Store are never enabled in atomic mode: the runner refuses to call that a PASS.
  assert.equal(verdict(atomic), "COVERAGE_MISSING", atomic.out);
  assert.match(atomic.out, /never enabled: Charge Check Store/);
  assert.equal(existsSync(join(d, "states")), false, "TLC metadata stays out of the spec folder");
});

const COUNTER = (init, next, extra = "") => `---- MODULE C ----
EXTENDS Naturals
VARIABLES x
Init == ${init}
Inc == x < 3 /\\ x' = x + 1
${extra}
Next == ${next}
Small == x <= 3
====
`;
const CCFG = "INIT Init\nNEXT Next\nINVARIANT Small\n";

test("runner: the fail-closed verdicts", tlc, () => {
  const cases = [
    ["PASS", COUNTER("x = 0", "Inc \\/ Done", "Done == x = 3 /\\ UNCHANGED x"), CCFG, 0, /4 distinct states/],
    ["DEADLOCK", COUNTER("x = 0", "Inc"), CCFG, 3, /no next step/],
    ["EMPTY", COUNTER("x = 0 /\\ x = 1", "Inc"), CCFG, 4, /0 distinct states/],
    ["EMPTY", COUNTER("x = 0", "Inc \\/ Done", "Done == x = 3 /\\ UNCHANGED x"), "INIT Init\nNEXT Next\n", 4, /lists no INVARIANT/],
    ["COVERAGE_MISSING", COUNTER("x = 0", "Inc \\/ Done \\/ Never", "Done == x = 3 /\\ UNCHANGED x\nNever == x > 5 /\\ x' = 0"), CCFG, 5, /never enabled: Never/],
    ["VIOLATION", COUNTER("x = 0", "Inc \\/ Done", "Done == x = 3 /\\ UNCHANGED x").replace("x <= 3", "x <= 2"), CCFG, 1, /Small is violated/],
    ["ERROR", COUNTER("x = ", "Inc"), CCFG, 7, /Parse Error|parsing/i],
  ];
  for (const [want, spec, cfg, code, reason] of cases) {
    const d = dir({ "C.tla": spec, "C.cfg": cfg });
    const r = check(d, "C");
    assert.equal(verdict(r), want, r.out);
    assert.equal(r.code, code, r.out);
    assert.match(r.out, reason);
  }
});

test("runner: TIME_LIMIT on an unbounded model, ERROR on a jar with the wrong hash", tlc, () => {
  const d = dir({ "C.tla": COUNTER("x = 0", "x' = x + 1"), "C.cfg": CCFG.replace("Small", "Pos").concat("") });
  writeFileSync(join(d, "C.tla"), readFileSync(join(d, "C.tla"), "utf8").replace("Small == x <= 3", "Pos == x >= 0"));
  const r = run("model-check-design.sh", [join(d, "C.tla"), "--time-limit", "3"], { env: env(d) });
  assert.equal(verdict(r), "TIME_LIMIT", r.out);
  writeFileSync(join(d, "fake.jar"), "not a jar");
  const bad = run("model-check-design.sh", [join(d, "C.tla")], { env: { ...env(d), TLA2TOOLS_JAR: join(d, "fake.jar") } });
  assert.equal(verdict(bad), "ERROR");
  assert.match(bad.out, /SHA-256 .* pinned/);
  assert.match(run("model-check-design.sh", [join(d, "C.tla"), "-simulate"], { env: env(d) }).out, /never a pass/);
});

test("able-to-fail: removing the guard gives VIOLATION, the original file is untouched", tlc, () => {
  const d = dir({ "Pay.tla": PAYMENT, "Pay.cfg": CFG("atomic") });
  const line = PAYMENT.split("\n").findIndex((l) => l.includes("IF stored THEN charges")) + 1;
  const r = run("able-to-fail.sh", [join(d, "Pay.tla"), "--line", String(line), "--from", "IF stored", "--to", "IF FALSE"], { env: env(d) });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`mutant: Pay\\.tla:${line} 'IF stored' -> 'IF FALSE' : VIOLATION`));
  assert.equal(readFileSync(join(d, "Pay.tla"), "utf8"), PAYMENT);
  const blind = run("able-to-fail.sh", [join(d, "Pay.tla"), "--line", "5", "--from", "{1, 2}", "--to", "{1, 2}"], { env: env(d) });
  assert.equal(blind.code, 1);
  assert.match(blind.out, /NOT ABLE TO FAIL/);
});

test("runner: relative spec and config paths work from another folder", tlc, () => {
  const d = dir({ "specs/Pay.tla": PAYMENT, "specs/Split.cfg": CFG("split") });
  const r = run("model-check-design.sh", ["specs/Pay.tla", "--config", "specs/Split.cfg"], { cwd: d, env: env(d) });
  assert.equal(verdict(r), "VIOLATION", r.out);
});
