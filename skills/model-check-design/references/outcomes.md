# Outcomes and the final message

Read this in step 9. At most 300 words plus the traces. Result first.

```
model-check-design: <flow> at <sync commit> — <N> invariants: <k> sync, <k> updated, <k> bug, <k> blocked
```

Then one row per invariant:

| Invariant (plain words) | Outcome | Evidence |
|---|---|---|
| A job runs at most once | **bug** | VIOLATION in 5 steps (trace below); trigger: two workers poll within one claim's latency |
| A charge is never refunded twice | **sync** | PASS, 1,204 states, 2 and 3 requests; mutant `Refund.tla:41 'refunded = FALSE' -> 'TRUE'` : VIOLATION |

Outcomes:

- **sync** — PASS at both sizes, every action covered, the mutant violated,
  the model's anchors match the sync commit.
- **updated** — PASS after a model error was fixed in step 7; say what the
  model got wrong.
- **bug** — VIOLATION (or a stuck DEADLOCK) replayed against the code, each
  step allowed.
- **blocked** — TIME_LIMIT, ERROR, a hatch the user has not approved, or a
  trace step you could not map to code. Say what would unblock it.

## Each bug

1. The trace as numbered steps in the code's own words, one line per step,
   with the anchor:

   ```
   1. worker A runs `SELECT status FROM jobs WHERE id = 7` and sees 'pending'   (src/queue.py:22)
   2. worker B runs the same SELECT and also sees 'pending'                      (src/queue.py:22)
   3. worker A sets status = 'taken' and runs the job                            (src/queue.py:27)
   4. worker B sets status = 'taken' and runs the job a second time              (src/queue.py:27)
   ```

2. The trigger: the real-world timing or failure that produces this order.
3. A sequence or integration test sketch that forces the order with the
   project's own test tools: two calls held at the race point with a barrier,
   a fake provider that answers after the client timeout, two webhook
   deliveries in reverse order. Name the file it would go in.
4. The fix, as a recommendation: the atomic statement, lock or constraint
   that closes the window. If the fix was modeled, its verdict (PASS).

## Footer

- The escape-hatch result (`escape hatches: 0`, or each HATCH line with the
  judge's verdict and the user's answer, or "open decision").
- "Invariants not approved" when nobody approved them in step 2.
- Files added: the model, its config, the `.frozen` file, any test.
- What the model does not cover: actors, retries or failures it leaves out,
  and that a PASS holds only at the checked sizes.
