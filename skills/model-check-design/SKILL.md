---
name: model-check-design
description: "Model-check a design for race and ordering bugs. Use when a flow has steps that can interleave, repeat, crash halfway or arrive out of order: retries, timeouts, idempotency keys, webhooks, queues and workers, locks and leases, sagas, caches, state machines, double submits, check-then-act, read-modify-write; when someone asks 'can these steps happen in a bad order', 'can this charge twice', 'model-check this', or mentions TLA+, PlusCal, TLC or Quint, even if they never say 'spec'. Reads the real code, writes a small TLA+ model anchored to it, runs TLC with a fail-closed verdict (PASS needs states, an empty queue and every action covered), proves each invariant can fail, and replays a counterexample against the code before it calls it a bug. Language-agnostic. Never weakens an invariant or shrinks the model without the user's approval and a fresh judge."
---

# Model-check a design

Tests check the orderings someone thought of. A model checker tries every
ordering of the steps you model: two workers, a timeout and a retry, a webhook
that arrives before the one it depends on. TLC (the TLA+ model checker) lists
every reachable state and stops at the first one that breaks an invariant,
with the exact steps that led there.

Reference files sit beside this file. Fetched over HTTP: fetch them with
`curl -sSL` from `https://raw.githubusercontent.com/dmoka/skills/main/skills/model-check-design/`
(`references/*.md`, `scripts/*`), never through a summarizing fetch tool.

## Steps

1. **Install TLC once.** Run `scripts/setup.sh`. It checks for Java 11+ and
   downloads `tla2tools.jar` v1.7.4, pinned by SHA-256. It never installs Java:
   it prints the command for the OS. Done when it prints `READY`.
2. **Name the promise.** Read the code of the flow end to end. List each step
   that touches shared state (a query, a transaction, a network call, a
   queue message), who runs it concurrently, and what can go wrong between
   steps (crash, timeout, retry, duplicate or reordered delivery). Write each
   invariant as one plain sentence the business cares about ("a job runs at
   most once", "a customer is charged at most once per checkout") plus the
   code that is meant to keep it. Show the list to the user and ask for
   approval. Nobody to ask: write the list as assumptions, mark the report
   "invariants not approved", and continue. Done when every invariant is one
   sentence with its file:line.
3. **Write the model** from the code, per [references/modeling.md](references/modeling.md).
   One action per atomic step in the code: a single statement or one
   transaction is one action; anything with an `await`, a network call or a
   second statement between the check and the act is two actions. Put the
   model in `specs/tla/<Flow>.tla` + `<Flow>.cfg` unless the repo already has a
   place for specs. Start with the header `\* sync: <commit>` (the commit you
   read) and one `\* anchor <Name>: <path>:<line>@<commit>` line per variable
   and per action (`model-only — <why>` for a program counter). Use the
   smallest constants that can show the failure: 2 workers, 1 job, 1 retry.
   Run `scripts/anchors.sh <Flow>.tla --repo <repo>`. Done when it prints
   `ANCHORS OK`.
4. **Freeze.** After approval, run `scripts/freeze.sh record <Flow>.tla --config <Flow>.cfg`.
   It pins each invariant's SHA-256, the constants, the set sizes, the
   actions in Next and the deadlock setting in `<Flow>.frozen`. Done when the
   file exists; it is checked in step 8.
5. **Run TLC.** `scripts/model-check-design.sh <Flow>.tla --config <Flow>.cfg`.
   It prints one verdict: PASS, VIOLATION, DEADLOCK, EMPTY, COVERAGE_MISSING,
   TIME_LIMIT or ERROR, and exits 0 only on PASS. Read
   [references/verdicts.md](references/verdicts.md) for what each one means
   and what to do. Never report TLC's own "No error has been found" as a pass:
   TLC prints it for a model with 0 states too. Then run once more with each
   constant one larger (3 workers, 2 retries); a PASS that only holds at the
   smallest size is a finding. Done when the verdict is PASS, VIOLATION or
   DEADLOCK at both sizes, or the time limit is reported as TIME_LIMIT.
6. **Prove each invariant can fail.** For each invariant that passed, pick
   the one guard the code relies on (the status check, the unique key, the
   lock, the transaction that keeps two writes together) and remove it in a
   copy: `scripts/able-to-fail.sh <Flow>.tla --config <Flow>.cfg --line <n> --from '<guard>' --to '<removed>'`.
   The original file is never touched. It prints
   `mutant: <Flow>.tla:<n> '<old>' -> '<new>' : VIOLATION` and `ABLE TO FAIL`.
   `NOT ABLE TO FAIL` means the invariant cannot see that guard: rewrite the
   invariant or the model, and get the new wording approved. Done when every
   passing invariant has one mutant line with VIOLATION.
7. **Replay every counterexample against the code.** Walk the trace one step
   at a time and name the code line each step runs (the anchors give it).
   For each step ask: does the code allow this here? A database constraint,
   a lock, a `SELECT … FOR UPDATE`, a queue's visibility timeout or a
   framework guarantee may forbid it. A step the code forbids is a model
   error: fix the model, say what changed, and go back to step 5. Every step
   allowed is a bug: write the concrete trigger ("two workers poll within
   the same 50 ms", "the provider answers after the 10 s client timeout").
   Findings stay findings: never edit the model or the invariant to make a
   confirmed bug go away. Done when each counterexample is labeled
   **bug** (with the trigger) or **model error** (with the fix).
8. **Check for escape hatches.** Run `scripts/escape-hatches.sh <base-ref>` in
   the repo (base = the commit before this session). It lists every removed
   INVARIANT, shrunk or changed constant, added CONSTRAINT, VIEW or
   `CHECK_DEADLOCK FALSE`, smaller model set, action dropped from Next,
   simulation run, and anything a `.frozen` file pins that changed. Exit 0
   needs no approval. For each HATCH line: write why it is safe, hand it to a
   fresh judge agent with [references/judge.md](references/judge.md), and ask
   the user once, with the judge's verdict. Nobody to ask: keep the stronger
   model and report the hatch as an open decision. Done when the script
   exits 0 or every HATCH line has a judge verdict and the user's answer.
9. **Report**, per [references/outcomes.md](references/outcomes.md): one outcome
   per invariant — **sync** (PASS, model matches the code at the sync
   commit), **updated** (PASS after a model error was fixed), **bug**
   (VIOLATION replayed against the code), **blocked** (TIME_LIMIT, ERROR, or a
   step you could not map to code). A bug comes with the trace as numbered
   steps in the code's own words and a sequence-test sketch that forces that
   order. Done when the report has every invariant, the sync commit, the
   mutant per PASS, and the files you added.

## Hard rules

- **Production code is read-only.** You write the model, its config, the
  freeze file and, if the user asks, a test. A fix is a recommendation in the
  report, not an edit.
- **Only the runner's PASS is a pass.** Simulation (`-simulate`, `quint run`),
  a depth bound (`-depth`), a state constraint or a 0-state run is never
  reported as verified.
- **Never weaken silently.** Shrinking constants, deleting an INVARIANT
  line, adding a CONSTRAINT or `CHECK_DEADLOCK FALSE`, or rewording a frozen
  invariant needs a judge and the user's yes (step 8).
- **A bug needs a replay.** A trace is reported as a bug only after step 7
  mapped every step to code the code allows.
- **The model follows the code, not the design doc.** Where they differ,
  model the code and report the difference.

## Gotchas

- TLC reports `Deadlock reached` on a flow that simply finishes. Add a
  `Done` action (`AllDone /\ UNCHANGED vars`) to Next instead of
  `CHECK_DEADLOCK FALSE`: the deadlock check then still finds stuck flows.
- TLC's `-deadlock` flag turns deadlock checking **off**. The runner never passes it.
- One `await` between a read and a write is a race window. Modeling the read
  and the write as one action hides exactly the bug you are looking for.
- An action that is never enabled is dead code in the model. The runner calls
  it COVERAGE_MISSING; usually a guard is too strict or Init is wrong.
- PlusCal is fine: translate it (`java -cp tla2tools.jar pcal.trans <Flow>.tla`)
  and run the runner on the translated file. Quint is an alternative syntax;
  `quint run` is random simulation and never a pass, `quint verify` (Apalache)
  is bounded: report its bound.
- TLC stops at the first violated invariant. When one invariant is a bug,
  check each other invariant in its own config so a PASS is not hidden.
- Parallel runs (judges) are safe: each run gets its own log folder.
- Stay small: a model with more than about 10 variables or a run longer than
  10 minutes models too much. Split it per flow.

Last verified: 2026-11-25 with Claude Code (claude-opus-5-5, fresh subagents,
TLC 2.19 from tla2tools.jar v1.7.4) on TicketBay at 0603b04 (checkout and
refund: 4 sync, 1 bug) and five fixture designs (job queue, payment retry,
lost update, out-of-order webhooks, an over-tight existing model).

Ideas adapted with credit: pstack by Lauren Tan (MIT: able-to-fail variants,
findings stay findings, sync commit, sync/updated/bug/blocked outcomes,
replaying the counterexample), vstack by hao-ai-lab (MIT: hash-pinned
invariants, `file:line@commit` anchors, a fail-closed TLC verdict), and
Specular (a counterexample must map to a real, triggerable scenario).
