# Gotchas — the ways mutation results lie to you

The score exists to catch lying tests. These are the ways the score itself
lies, and how to not be fooled.

## Equivalent mutants

Some mutants change the code without changing behavior (`i < len` vs
`i != len` on a loop that only counts up). No test can kill them. Prove
equivalence, label it, move on — do not write tests chasing them, and do not
demand a 100% score anywhere, or the loop cannot converge.

Two traps when proving equivalence:

- **Use the language's strictest equality.** In JavaScript, `-0 !== 0` is
  `false`, so a differential check built on `!==` is blind to signed zero —
  while `expect().toBe()` uses `Object.is` and is not. A mutant "proven"
  equivalent with loose equality may be killable. Other languages have their
  own versions of this trap (NaN, negative zero, integer overflow wrapping).
- **Say which kind of equivalent it is.** Equivalent *in isolation* (no input
  can distinguish it) is a stronger claim than equivalent *in context*
  (distinguishable, but unreachable given every current caller). The second
  kind stops being equivalent when a new caller appears — label it so.

## Timeouts scored as kills

Most tools count a timed-out mutant as killed. If a run reports timeouts on
trivial expressions, suspect resource contention, not detection — especially
when tests use containers or real services. A parallel run against Docker
measures Docker. Rerun at concurrency 1 before believing the number.

## The missing-code blind spot

Mutation testing grades the tests you have against the code that was written.
A business rule that was never implemented generates no mutants, so a
completely absent feature cannot lower the score. A suite can score 95% on a
refund module that never checks the event date — the score is honest about
the code that exists and silent about the code that does not. Only reading
the spec against the behavior catches that. Say so in every report where it
applies.

## String and SQL mutants are shallow

Tools typically mutate a string literal by replacing the whole thing with
`""`. They will not produce a semantically altered SQL statement, so a score
says nothing about whether a `WHERE` guard is tested. When the scoped code
builds queries, name that gap in the report or the number tells exactly the
kind of lie you are here to catch.

## Flaky tests poison everything

A test that fails 1 run in 50 kills mutants it never checked and survives
mutants it should catch — in both directions the verdict is noise. Fix or
quarantine flaky tests before the first mutation run, and treat a suspicious
cluster of kills in one file as a flake signal, not a victory.

## Score-gaming moves, all forbidden

Each of these raises the number and lowers the truth. Recognize them in
existing config too — inherited exclusions are findings:

- excluding files or folders from mutation to hide survivors
- excluding or skipping a failing test to unblock the run
- raising timeouts until slow mutants count as killed
- disabling the mutator kinds that keep surviving
- asserting a mutant's exact behavior to force a kill (the test now protects
  nothing — it breaks on the next honest refactor)

## Keep runs affordable

Mutation testing is expensive by construction: mutants × suite runtime.

- First run: one module (see the loop). Never whole-repo on a first contact.
- Use per-test coverage analysis where the tool offers it — it runs only the
  tests that touch each mutant.
- In CI, test the diff, not the world: `--incremental` (StrykerJS),
  `--in-diff` (cargo-mutants), mutmut's cache, Pitest's `withHistory`.
- A nightly full run plus a per-PR diff run beats one heroic weekly run that
  everyone ignores.
