---
name: mutation-testing
description: Measure test quality with mutation testing and close the gaps it finds. Use when asked whether tests are any good, when coverage is high but confidence is low, after AI wrote or changed tests, or when the user mentions mutation testing, mutation score, surviving mutants, or names a mutation tool (Stryker, Pitest, mutmut, Infection, cargo-mutants).
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
and
`https://raw.githubusercontent.com/dmoka/skills/main/skills/mutation-testing/references/gotchas.md`.

**Fetch raw text, not a summary.** Many agents have a fetch tool that runs a
page through a summarizing model. It will paraphrase this file, drop the
numbered steps, and mangle the config snippets you are about to copy. If your
fetch returns prose rather than the literal markdown below, refetch with
`curl -sSL <url>` and work from that.

## The loop

1. **Baseline.** Run the full test suite twice. Red: report BLOCKED —
   mutation tools refuse red baselines. A verdict that changes between the
   two runs is a flaky test, and every mutant verdict downstream of it is
   noise. Quarantine it (skip it, with a comment saying why and what a human
   must decide) unless you can see the actual defect and the fix is in the
   test — never invent a spec to "fix" a test toward. If the only tests are
   e2e/CI-only, or the suite takes
   more than a few minutes locally, report BLOCKED too — mutation testing
   needs a fast local unit suite, and that gap is the finding. In a monorepo,
   work inside the package that owns the target module. Never exclude a
   failing test to get a number.
2. **Pick the tool** for the stack (table below). Install it project-local
   and configure it per [references/tools.md](references/tools.md) — never
   run a tool's interactive init wizard; write the config file yourself. Ask
   before any global install.
3. **Scope the first run to one module** — the most business-critical file
   the user names, or the one where a silent bug costs the most (money math,
   permissions, data writes). If nobody names one, pick it yourself: the
   README or package layout usually says where the business logic lives, and
   the money math is the file to start on. Say which file you chose and why.
   A whole-repo first run on a real codebase takes hours and often dies; a
   one-module run finishes in minutes and proves the point. Widen the scope
   only after the first run succeeds. On a project small enough that one
   module *is* the whole codebase, say so and move on — do not invent a
   narrower scope to satisfy this step.
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
8. **Report**, in this order: score; ranked survivors with their
   one-sentence lies; equivalents with proofs; tests added, each with its
   confirmed kill; what the score cannot see (below); every file you added
   or changed, including tool output you cleaned up.

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
- **Scope may widen between runs, never narrow.** Re-scoping away from hard
  survivors is score-gaming. If a tool scopes through a persistent config
  file, widen or remove that scope when you finish — a leftover narrow scope
  is an inherited exclusion for the next person.
- **Production source is read-only.** Tests, build files, and tool config are
  yours to add and change — the report lists every file you touched. If
  killing a mutant would require a source change, that is a finding to
  report, not an edit to make. Where a language keeps unit tests inside the
  source file (Rust's `#[cfg(test)] mod tests`, Python doctests), you may add
  tests to that file — never touch the code above them, and say in the report
  that you edited a source file and why.
- **Stay inside the repo.** Scratch scripts, downloaded copies of this skill,
  and equivalence checks belong in the project's own ignored scratch space or
  your agent workspace — not a sibling directory, not the system temp dir. Do
  not delete or rewrite machine state outside the repo to make a test
  deterministic; if a test depends on such state, that is a finding.

## What the score cannot see

Mutation testing grades the tests you have against the code that was written.
A business rule that was never implemented generates no mutants, so a
completely absent feature scores 100%. When you report a score, say plainly
which risks it does not cover — the missing-code blind spot and other limits
are in [references/gotchas.md](references/gotchas.md).

**A score is only as strong as the tool's mutators.** These tools are not
equivalent: some rewrite operators one boundary at a time, others only
replace whole function bodies. A 100% from a weak mutator set can sit on top
of an untested off-by-one. Report the score with the tool's name and its
known blind spots, never as a bare percentage — the per-tool limits are in
[references/gotchas.md](references/gotchas.md).

There is no universal good score. Gate on "no new survivors in changed
code", not on an absolute number.

## Done means

- No surviving mutant can change an amount, a permission, or a stored record
  on the code in scope.
- Every remaining survivor is proven equivalent, with the proof written down.
- Every survivor is explained in one sentence a non-tester understands.
- Every test you added asserts a business outcome and was confirmed to kill
  its mutant in a rerun.
- The repo is clean: tool output directories are deleted or gitignored, any
  scope you wrote into config is widened or removed, and the report lists
  every file you added or changed. Check this on the filesystem, not with
  `git status` — some tools write their own `.gitignore` into their output
  directory, so `git status` reports clean while hundreds of megabytes
  accumulate. Name any output you chose to keep, and where it is.

A high score with unexplained survivors is not done. A finished report with
three explained, ranked survivors the user chose to accept is.
