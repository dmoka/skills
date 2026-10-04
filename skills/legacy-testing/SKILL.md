---
name: legacy-testing
description: "Test legacy code: assess first, then propose a plan. Use when a codebase or module has few or no tests and you need to change it safely: adding tests to untested code, getting a safety net before a refactor, taking over code you did not write. Looks at the stack, the dependencies and the code no test touches, proposes which steps this repo needs (make it testable, characterize, approve, property tests, measure), waits for approval once, then runs every approved step without stopping. Refactoring comes last."
---

# Legacy testing

Legacy code is code without tests. The job is a **net** under the behaviour that carries the business, built before anyone refactors. Assess first, propose, wait for approval, then execute.

## Steps

1. **Assess.** Run `scripts/assess.sh [path]` from the repo root; the path is a file or a folder. It lists the tests anywhere in the repo that import the target, and the files no test imports. Read those tests and the three biggest untested areas, and name, for each, the **load-bearing** behaviour (money, permissions, data that must not be lost). Done when you can state, per area: what it does, what it depends on, which tests already touch it, and how a mistake there would hurt.
2. **Propose.** Write the plan with the template below: which steps this repo needs, in which order, and why each one. Choose from the menu; skip what the assessment says is not needed. Done when every chosen step names its target (files or functions) and its why.
3. **Stop for approval, once.** Show the plan and wait. The user judges two things: is it aimed at the load-bearing behaviour, and do the tests check behaviour rather than today's implementation? Done when the user approves or edits the plan.
4. **Execute the approved plan without stopping.** Do the steps in order: open the step's playbook, do it, run the suite, start the next step. Do not ask "shall I go ahead?" between steps; approving the plan approved every step in it. Stop and ask only to: mark a mutant equivalent, change CI or config the plan did not list, or fix a suspected bug instead of pinning it. Done when every step's own completion check passes and the suite is green.
5. **Report once, at the end:** the score before and after, the tests added, the suspected bugs, the open decisions. Delete every TEMPORARY file first.
6. **Refactor last**, only after the net holds, and in commits that change no behaviour.

## The menu

| Step | Use it when | Playbook |
|---|---|---|
| Make it testable | the code reaches a database, an API, a queue, the clock or the filesystem directly | `references/make-it-testable.md` |
| Characterize | nobody can say what the code does today | `references/characterize.md` |
| Approval tests | the output is big: JSON, HTML, reports | `references/approval-tests.md` |
| Property tests | rules with edge cases: money, dates, limits, parsing | `references/property-and-measure.md` |
| Measure | before calling the net done: coverage shows what never ran, mutation shows what was never checked | `references/property-and-measure.md` |
| Refactor | the net is in place and the mutation score on the area is where the user wants it | `references/refactor.md` |

## Plan template

```
Area: <files> — load-bearing: <behaviour>
1. <step> on <target> — why: <reason from the assessment>
2. ...
Skipped: <step> — why not needed here
Target: mutation score on <area> ≥ <n>% (coverage is a hint, not the goal)
```

## Gotchas

- Characterization tests **pin** today's behaviour, bugs included. When a pinned result looks wrong, pin it anyway, name the test `pins current behaviour — suspected bug: <what is wrong>`, and list it in the final report; fixing it is a separate, later change.
- A dependency that is fast, or that carries the business logic, stays real in the test (an in-memory or containerised database, the real rules engine). Use a test double only for slow or unreliable edges.
- Approval tests are scaffolding. Mark them as temporary in their file name or a comment, so they get deleted once functional tests cover the behaviour.
- A flaky test is not a net. When a test passes and fails without a change, quarantine it and report it before building on it.
- Long suites: run the narrowest command that covers the area while working (one file, one folder), and the full suite at the end of each step.
- Aim the mutation score at the load-bearing area, not the whole repo; a repo-wide number hides the money code in the average.
- Scope every mutation run twice: mutate only the target file (Stryker: `--mutate <file>`), and run only the tests that import it (`assess.sh <file>` lists them). Use a project script if one exists; otherwise see "Scoped runs" in `references/property-and-measure.md`. The repo's own config can run its whole suite as the dry run.

Last verified: 2026-10-04 with Claude Code 2.1.289 on TicketBay `src/db/admin-queries.ts`: mutation score 62.7% → 98.5%, four suspected bugs pinned. That trial drove this version: assess.sh took no file path and missed tests outside the target folder; the agent paused after every step; the unscoped dry run passed 10 minutes and never finished, the scoped one took 1.5 minutes. Earlier: 2026-09-29 with 2.1.284 (TicketBay with deleted tests, and a real untested MERN app).
