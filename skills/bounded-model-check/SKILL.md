---
name: bounded-model-check
description: "Check a function against every input up to a bound. Bounded model checking: prove no panic, overflow or out-of-bounds for all inputs up to a size, not a sample. Use when the user mentions Kani, CBMC, ESBMC, bounded model checking, formal verification of a function, 'prove this never panics', 'prove no overflow', 'can this index out of bounds', unsafe Rust, a C parser, or wants 'more than property tests' for a small function that takes untrusted input (parsers, decoders, size, offset or money arithmetic). Rust: Kani. C/C++: CBMC or ESBMC. Python: CrossHair (symbolic execution, not strict BMC). Java: JBMC (experimental). Go and TypeScript: says no mature tool exists and routes to property testing. Writes harnesses with symbolic inputs, a reason for every bound and assumption, cover checks that prove the harness ran, and one planted mutant per assertion. Turns each counterexample into a unit test. Never fixes production code and never switches a check off to get a pass."
---

# Bounded model check

A bounded model checker turns a function plus a harness into a logic formula and asks
a solver for any input, up to the harness's size bounds, that breaks an assertion, a
bounds check or an overflow check. FAILED comes with a concrete input. VERIFIED holds
for every input inside the bound and says nothing beyond it.

Supporting files sit beside this file: `scripts/`, `references/`. Fetched over HTTP?
Fetch them from `https://raw.githubusercontent.com/dmoka/skills/main/skills/bounded-model-check/`
with `curl -sSL` (a summarizing fetch tool paraphrases the commands away).

`<skill>` below is the folder of this file. Run every command from the repo root. Keep
logs in `.bmc/` and append `.bmc/` to `.gitignore` (keep its other lines). Read long output from the log file, in
its own call.

## Steps

1. **Route by language.** Record the base ref first: `git rev-parse HEAD` (step 8 needs
   it). Read the build file (`Cargo.toml`, `CMakeLists.txt`, `Makefile`, `pyproject.toml`,
   `pom.xml`, `go.mod`, `package.json`); with none, go by the source file extensions.

   | Language | Tool | What a pass means |
   |---|---|---|
   | Rust | Kani (`cargo kani`) | no failing input up to the bounds |
   | C / C++ | CBMC; ESBMC as the second opinion | same |
   | Python | CrossHair | SMT symbolic execution, not strict BMC: no counterexample found within the time limit |
   | Java / Kotlin | JBMC | experimental: partial Java library models; check a known bug is found first |
   | Go, TypeScript, JS, others | none mature | stop; say so; route to the `property-testing` skill (or property tests in `legacy-testing`) |

   Commands and install lines: Rust [references/kani.md](references/kani.md), the rest
   [references/other-languages.md](references/other-languages.md). Ask before any
   install outside the repo. Done when `cargo kani --version` (or the tool's version
   command) prints a version, or the report says which route was taken and why.

2. **Pick at most 3 target functions.** Rank: code that reads untrusted bytes (parsers,
   decoders, length fields); arithmetic on sizes, offsets, indices or money; `unsafe`
   blocks; loops bounded by input. Skip I/O, async, threads and large state. Existing
   harnesses (`#[kani::proof]`, `cargo kani list`): run each one as it is (step 5, with
   its own module path), then add only covers to it; never change its assumes, bounds or
   `unwind`. Its BOUND-TOO-LOW or VACUOUS is a finding, not something to repair. Write your own harnesses
   under new names in `bmc_proofs`. Report an existing VACUOUS harness as a finding.
   Several harnesses per function are fine. Done when each target is named with
   `file:line` and one reason.

3. **Write each rule in plain words and freeze it.** One rule per harness: what must hold
   for every input, its source (doc comment, spec, README, the user), and the assertion
   code. Kani checks panics, overflow and out-of-bounds by itself (write that rule with
   "built-in" as its code); add a business rule when a source states one, and list the
   cases the source leaves open. Before freezing, drop any assertion another one implies:
   no mutant can break it alone. Never derive a rule from the implementation: a rule copied
   from the code passes on the bug. Put the rules in `verification/bmc-rules.md`, show
   them, and after the user's yes run `<skill>/scripts/freeze-rule.sh verification/bmc-rules.md`.
   Headless: freeze them yourself and mark them "not approved by a human". Done when
   `<skill>/scripts/freeze-rule.sh --check verification/bmc-rules.md` prints FROZEN.

4. **Write the harness** ([references/kani.md](references/kani.md) has the template):
   - Every input is symbolic (`kani::any()`, `nondet_*()` in C). A hardcoded value checks one case.
   - Every bound is a number with a reason in a comment: `[u8; 8] // 1 length byte + 7-byte max payload`. Slices: a symbolic array plus a symbolic length `n <= N`. Start with N at most 16 and argue why longer inputs take no new path; N = 256 can run for hours. Scalars only and no loop: write `// bound: none, full range`.
   - Loops: `#[kani::unwind(K)]`, K = the largest iteration count of any loop the harness runs, + 1. That includes loops in the harness and in library calls (slice `==`, `iter().sum()`, `contains`). No `unwind` with any such loop: the run never ends. Unwinding checks stay on.
   - Every `kani::assume` is either a bound (`n <= N`, comment `// bound`) or a precondition with `// ASSUMES: <precondition> (<file:line> where it is enforced)`. Only a doc comment states it: keep it, write `(documented, not enforced)`, and list it as an open question. Nothing states it: drop it.
   - One `kani::cover!(cond, "<branch>")` per branch or outcome the harness claims, plus `kani::cover!(true, "body reached")`.

   Done when `cargo kani list` shows the harness (C: the first step 5 run gets past parsing).

5. **Run it through the verdict script**, one harness per call:
   `<skill>/scripts/bmc-run.sh .bmc/<harness>.log cargo kani --harness bmc_proofs::<harness> --exact`
   (C: `<skill>/scripts/bmc-run.sh .bmc/<harness>.log cbmc <files> --function <harness> --unwind <K>`).
   The script fails closed and kills a run after `BMC_TIMEOUT` seconds (default 600).
   Act on its verdict:
   - **FAILED**: a real counterexample inside the bound; the `at file:line` names the check (Kani prints "placeholder message" for some std panics). Covers below n/n here mean the panic ends paths before later code. No mutant needed if it failed on its own assertion (step 6). Go to step 7.
   - **BOUND-TOO-LOW**: raise the unwind bound to max iterations + 1 and rerun. Kani's tip to disable `--unwinding-assertions` is an escape hatch.
   - **VACUOUS / UNCOVERED**: an assumption or bound removes the branch. Find which one. Never report the harness as verified.
   - **NO-COVER**: add the covers from step 4 and rerun.
   - **TIMEOUT**: shrink N, add the missing `unwind`, or try `--solver kissat`; say so in the report.
   - **UNKNOWN**: read the log (compile error, unsupported construct).
   - **VERIFIED**: go to step 6.

   "N checks unreachable" next to VERIFIED is normal inside std; one in your target or
   harness means dead code or an over-tight assume. Done when every harness has one of
   the verdicts above, with its runtime.

6. **Prove each VERIFIED harness can fail.** No harness VERIFIED: skip this step; the
   counterexample fills the mutant column. For each assertion, plant one bug it must
   catch (an off-by-one, a removed check, `checked_add` to `wrapping_add`), one mutant at
   a time (the script edits the file in place):
   `<skill>/scripts/plant-mutant.sh <file> <line> '<old>' '<new>' -- <skill>/scripts/bmc-run.sh .bmc/m.log cargo kani --harness bmc_proofs::<harness> --exact`
   (C: the same, with the `cbmc` command). The script restores the file. CAUGHT counts only
   when the `failed:` line names the assertion you aimed at; a mutant that trips a
   built-in check instead proves nothing for that assertion. MISSED: the assertion is too
   weak; rewrite it and freeze again (step 3), or headless, report it. A harness that FAILED on its own assertion proved that assertion
   can fail; one that FAILED on a built-in check (overflow, out-of-bounds) leaves its
   business assertions unproven: report them as "blocked by the bug, rerun after the fix".
   Done when every assertion of a VERIFIED harness has a `mutant: … CAUGHT` line.

7. **Turn each counterexample into a unit test.** Run
   `cargo kani --harness bmc_proofs::<harness> --exact -Z concrete-playback --concrete-playback=print`
   with its output to `.bmc/<harness>.playback.txt` (exit 1 is normal on a failing
   harness), then read that file. Take each test
   whose comment says ``Check for `assertion` `` (built-in overflow and bounds checks carry
   that label too; the `cover` ones are not bugs). The `// <value>` comments hold the
   inputs in `kani::any()` call order. Playback gives one test per failing path, so a
   failed check can lack its own test: take inputs from another playback test that reaches
   the branch, and confirm them with `cargo test`. Write one plain `#[test]` per distinct failed check,
   calling the function with those values and asserting the frozen rule, marked
   `#[ignore = "BMC counterexample: <check>; remove when fixed"]` so `cargo test` stays
   green and `cargo test -- --ignored` reproduces the bug. C: see
   [references/other-languages.md](references/other-languages.md). Done when
   `cargo test -- --ignored <name>` fails with the checker's message.

8. **Check for escape hatches.** Run `<skill>/scripts/escape-hatches.sh <base-ref>`
   (`<base-ref>` = the commit from step 1). It lists every added assume, stub,
   lowered bound, switched-off check and `cfg(not(kani))`; exit 1 means "lines to explain",
   not a failure. Every listed line needs its reason in the report. Any assume, bound or
   rule made narrower after any verdict other than VERIFIED is a weakening (the script
   compares with the base ref, so it cannot see a bound you raised and then lowered:
   report that yourself): send it to a fresh judge agent with
   [references/judge.md](references/judge.md), then ask the user once. Done when every
   listed line has a reason, and every weakening has a judge verdict and the user's yes.
   Nobody to ask: keep the harness unweakened and report the open decision.

9. **Report, result first.** One line per harness: name · verdict · runtime. Then a table,
   one row per harness: what it proves (the frozen rule) · bounds with reasons ·
   assumptions with their production precondition · covers reached (e.g. 3/3) · mutant
   (`mutant: file:line 'old' -> 'new' CAUGHT`) or counterexample (inputs and the failed
   check) · the regression test name. Then the open questions (unenforced preconditions,
   cases the source leaves open, assertions blocked by a bug), the rules hash, the files
   you added or changed, and what the check cannot see (below).

## Hard rules

- **Production code is read-only.** Rust: add harnesses in a `#[cfg(kani)] mod bmc_proofs` at the end of the file under test (private functions are reachable there), and tests in its `#[cfg(test)]` module. C: harnesses in `bmc/`, production files untouched. Say in the report that you edited a source file and why. Never fix the bug: report it with the counterexample and the test.
- **Never report a pass the script did not print as VERIFIED.** A Kani summary line `VERIFICATION:- SUCCESSFUL` is also printed when every cover is unreachable.
- **No check switched off.** `bmc-run.sh` refuses `--no-unwinding-checks`, `--no-unwinding-assertions` and the `--no-*-check` flags. Passing one needs the user's yes (`BMC_ALLOW=<flag>`) and a line in the report.
- **A correct function is a valid result.** VERIFIED with all covers reached and every mutant caught is the finding. Never weaken a rule or invent a bug to have something to report.
- **One command per shell call.** No `&&`, `;` or pipes: allowlisting harnesses refuse compound commands. One `>` redirect into `.bmc/` is fine. Write files with the editor tool, not heredocs; filter output by reading or searching the log in a separate call.

## What it cannot see

- Inputs beyond the bound: an 8-byte harness says nothing about a 9-byte message. Each bound in the report needs a reason why larger inputs take no new path, or it stays a stated limit.
- Code the harness does not call, stubs, and the real callers: an assumption the caller does not enforce hides a bug.
- Concurrency, I/O, timing and the environment. Kani checks one thread.
- Rules nobody wrote: no-panic and no-overflow are free; a wrong result needs a business-rule assertion.

## Gotchas

- `--concrete-playback=print` also prints a test per cover; only ``Check for `assertion` `` tests are bugs. Two of them can share one function name, so `=inplace` can write code that does not compile.
- An unsatisfiable `kani::assume` gives no warning: only an unreached cover shows it.

Last verified: 2026-11-25 with Claude Code (claude-opus-5-5, 18 fresh subagent runs in 3 rounds) and Kani 0.68.0 / CBMC 6.11.0 on 8 planted-bug fixtures (parser, midpoint, needle, withdraw, a correct crate, a vacuous harness, a low unwind bound, a C TLV reader): 8/8 right verdicts in rounds 2 and 3; trigger test 6/6 fire, 4/4 quiet. CrossHair, JBMC and ESBMC: not run.

Ideas adapted with credit: able-to-fail mutants and "findings stay findings" from pstack (Lauren Tan, MIT); the recorded `mutant:` line from theorem-labs/oss-verify; `kani::cover!` and concrete playback from the Kani documentation.
