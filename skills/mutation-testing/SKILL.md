---
name: mutation-testing
description: Measure test quality with mutation testing and close the gaps it finds. Use when asked whether tests are any good, when coverage is high but confidence is low, after AI wrote or changed tests, or when the user mentions mutation testing, mutation score, or surviving mutants.
---

# Mutation testing

Coverage tells you code was executed. Mutation testing tells you whether the
tests would notice that code being wrong. A tool plants one small bug at a time
(a mutant: `>=` becomes `>`, `+` becomes `-`, a condition is deleted), reruns
the suite, and records the verdict. A test failure kills the mutant. A suite
that stays green let the bug through — every surviving mutant is a lie the
test suite tells.

Reference files sit beside this file. If you fetched this over HTTP instead of
from disk, fetch them from
`https://raw.githubusercontent.com/dmoka/skills/main/skills/mutation-testing/references/tools.md`
and `.../references/gotchas.md`.

## The loop

1. **Baseline.** Run the full test suite. If it is red or flaky, stop and
   report BLOCKED — mutation tools refuse red baselines, and flaky tests
   poison every verdict. Never exclude a failing test to get a number.
2. **Pick the tool** for the stack (table below). Install and configure it
   per [references/tools.md](references/tools.md).
3. **Scope the first run to one module** — the most business-critical file
   the user names, or the one where a silent bug costs the most (money math,
   permissions, data writes). A whole-repo first run on a real codebase takes
   hours and often dies; a one-module run finishes in minutes and proves the
   point. Widen the scope only after the first run succeeds.
4. **Run** the tool and parse the report.
5. **Explain every surviving mutant** in one sentence a non-tester
   understands: what the mutant changed, why the suite stayed green, and what
   real-world bug that blind spot allows. Example: "`Math.round` became
   `Math.floor` and no test noticed — the suite never checks cents, so a
   customer can be short-changed on every refund."
6. **Rank survivors by blast radius**: money and data-loss paths first,
   boundary conditions next, logging and formatting last.
7. **Separate killable from equivalent.** For each killable survivor, write
   the killing test and rerun the tool to confirm the kill. For equivalents:
   prove it, label it, move on — traps in
   [references/gotchas.md](references/gotchas.md).
8. **Report**: the score, ranked survivors with their one-sentence lies,
   equivalents with proofs, tests added, and what the score cannot see
   (below).

## Tools by stack

| Stack | Tool |
|---|---|
| JavaScript / TypeScript | StrykerJS |
| C# / .NET | Stryker.NET |
| Java / Kotlin | Pitest |
| Python | mutmut |
| Rust | cargo-mutants |
| PHP | Infection |
| Go, Ruby, others | see [references/tools.md](references/tools.md) |

Setup, config, and scoped-run commands for each: [references/tools.md](references/tools.md).

## Hard rules

- **Never change config to improve the score.** The score is the messenger.
  Excluding files, raising timeouts, disabling mutators, or skipping a test
  file to go green is the one move that is always forbidden.
- **Killing tests assert business outcomes, never mutant behavior.** If you
  cannot state in one sentence what the test protects for a user, you are
  writing a test to move a number — delete it.
- **One survivor on a critical path outranks any score.** A 95% score with a
  surviving mutant in payment code is red. Do not chase 100%: equivalent
  mutants make it unreachable, and demanding it makes the loop unable to
  converge.
- **Source code is read-only for you unless the user says otherwise.** Your
  lane is tests. If killing a mutant would require a source change, that is a
  finding to report, not an edit to make.

## What the score cannot see

Mutation testing grades the tests you have against the code that was written.
A business rule that was never implemented generates no mutants, so a
completely absent feature scores 100%. When you report a score, say plainly
which risks it does not cover — the missing-code blind spot and other limits
are in [references/gotchas.md](references/gotchas.md).

## Done means

- No surviving mutant can change an amount, a permission, or a stored record
  on the code in scope.
- Every remaining survivor is proven equivalent, with the proof written down.
- Every survivor is explained in one sentence a non-tester understands.
- Every test you added asserts a business outcome and was confirmed to kill
  its mutant in a rerun.

A high score with unexplained survivors is not done. A finished report with
three explained, ranked survivors the user chose to accept is.
