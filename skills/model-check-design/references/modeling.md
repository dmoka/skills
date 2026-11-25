# Writing the model

Read this in step 3. The model is a small TLA+ module plus a TLC config. It
describes the flow's shared state and the atomic steps that change it, nothing
else: no HTTP, no JSON, no amounts unless an invariant is about the amount.

## The skeleton

```tla
---- MODULE JobQueue ----
\* sync: 3f9c2e1
\* Promise: a job runs at most once, even with two workers polling.
EXTENDS Naturals
Workers == {"w1", "w2"}

\* anchor status: src/queue.py:14@3f9c2e1
\* anchor runs: src/queue.py:31@3f9c2e1
\* anchor pc: model-only — where each worker is inside poll_once()
VARIABLES status, runs, pc
vars == <<status, runs, pc>>

Init == /\ status = "pending" /\ runs = 0 /\ pc = [w \in Workers |-> "check"]

\* anchor Check: src/queue.py:22@3f9c2e1
Check(w) == /\ pc[w] = "check"
            /\ pc' = [pc EXCEPT ![w] = IF status = "pending" THEN "claim" ELSE "done"]
            /\ UNCHANGED <<status, runs>>

\* anchor Claim: src/queue.py:27-31@3f9c2e1
Claim(w) == /\ pc[w] = "claim"
            /\ status' = "taken" /\ runs' = runs + 1
            /\ pc' = [pc EXCEPT ![w] = "done"]

\* anchor Done: model-only — every worker finished; lets TLC tell "finished" from "stuck"
Done == /\ \A w \in Workers : pc[w] = "done"
        /\ UNCHANGED vars

Next == \/ \E w \in Workers : Check(w) \/ Claim(w)
        \/ Done
Spec == Init /\ [][Next]_vars

AtMostOnce == runs <= 1
====
```

```
INIT Init
NEXT Next
INVARIANT AtMostOnce
```

Rules that make the model mean something:

- **One action = one atomic step in the code.** A single SQL statement, one
  transaction, one compare-and-swap, one `INSERT … ON CONFLICT` is atomic. A
  read and a later write with code, an `await`, a network call or a second
  statement between them are two actions. When the code holds a lock or a
  `SELECT … FOR UPDATE` across both, model the lock as a variable (a holder or
  `NULL`) and make the second action wait for it, or merge the two actions
  and anchor the merged action to the lock line.
- **Event loops (Node, asyncio):** synchronous code between two `await`s
  runs without interruption from other requests in the same process, so it
  is one action. Requests on other processes or servers still interleave:
  model one process per actor when the app runs more than one.
- **Every actor is an index.** Workers, requests, retries and webhook
  deliveries are elements of a small set; the per-actor program counter `pc`
  says where each one is. The scheduler is TLC: it tries every order.
- **One spec per design variant.** An action switched off by a mode constant
  (`Mode = "atomic"`) is never enabled, and the runner calls the run
  COVERAGE_MISSING. Write `<Flow>Split.tla` and `<Flow>Atomic.tla` instead.
- **Name every action.** TLC reports coverage per named action; an action
  written inline in Next has no name to report.
- **Finish with a Done action**, never with `CHECK_DEADLOCK FALSE` (see the
  gotchas in SKILL.md).
- **Invariants are state predicates in the promise's words**: `runs <= 1`,
  `charges <= 1`, `seatsSold <= Capacity`, `status = "refunded" => paidOut`.
  A promise about a whole run ("every paid order is eventually shipped") is a
  temporal `PROPERTY` and needs fairness (`WF_vars(Action)`); start with
  safety invariants.
- **Model only what the invariant needs.** An amount becomes a counter of
  charges; a seat map becomes a number of seats sold; a user becomes an index.

## Failure patterns

| What the code does | Model it as |
|---|---|
| Check-then-act (read status, then update) | `Check` and `Act` as two actions per actor |
| Read-modify-write (`balance = read(); write(balance + x)`) | `Read(a)` stores a local copy in `tmp[a]`; `Write(a)` writes `tmp[a] + x` |
| Client timeout and retry | a `Timeout` action that sends request 2 while request 1 is still in flight |
| Idempotency key stored after the side effect | `CheckKey`, `Charge`, `StoreKey` as three actions; atomic version: one action |
| Process crash between steps | a `Crash(a)` action enabled at each step that resets `pc[a]` and keeps the shared state |
| At-least-once delivery (queues, webhooks) | a message bag (a function message -> count) where `Deliver` does not remove the message, or a `Redeliver` action |
| Out-of-order webhooks | a set of pending events; `Deliver(e)` for any `e` in the set, in any order |
| Lease or lock with expiry | `holder` and an `Expire` action that clears it while the holder still works |
| Cache in front of a database | `db` and `cache` variables; `Read` fills the cache from a possibly stale `db` copy |

## Constants

Choose the smallest numbers that can show the failure: 2 actors for a race,
1 retry for a duplicate, 2 events for a reordering, capacity 1 for an
oversell. Then step 5 runs once more with each one larger. Put them in the
config as `CONSTANTS Workers = {w1, w2}` (model values) or as plain
definitions in the module; `freeze.sh` pins both.

## PlusCal

PlusCal reads like pseudocode and translates to TLA+. Each label is one atomic
step, so the labels are where the race windows go:

```
(* --algorithm queue
variables status = "pending", runs = 0;
process w \in {"w1", "w2"}
begin
  Check: if status = "pending" then
  Claim:   status := "taken"; runs := runs + 1;
         end if;
end process;
end algorithm; *)
```

Translate with `java -cp tla2tools.jar pcal.trans Flow.tla`, then anchor the
generated actions (one per label) and run the runner on the translated file.

## Quint

Quint (quint-lang) is TLA+ semantics in a typed, programmer-style syntax.
Use it when the team prefers it. `quint run` samples random traces: it can
find a bug but never proves its absence. `quint verify` runs Apalache, a
bounded checker: report the bound (`--max-steps`). `quint compile --target tlaplus`
gives a TLA+ module the runner can check exhaustively.
