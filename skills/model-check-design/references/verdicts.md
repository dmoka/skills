# Verdicts

Read this in step 5. `scripts/model-check-design.sh` prints exactly one
`VERDICT:` line. Only PASS exits 0.

| Verdict | Exit | What happened | What to do |
|---|---|---|---|
| PASS | 0 | TLC explored every reachable state (distinct states > 0, 0 left on the queue), every named action was enabled at least once, and every INVARIANT/PROPERTY held | Step 6: prove each invariant can fail. Report the state count and the constants: the PASS holds for that size only. |
| VIOLATION | 1 | An invariant or property is false in a reachable state. The runner prints the trace | Step 7: replay the trace against the code. Never call it a bug before that. |
| DEADLOCK | 3 | A reachable state has no next step | A finished flow without a `Done` action: add one (modeling.md). A state where the flow is stuck before finishing (a lock never released, a message never delivered): that is a finding, replay it like a VIOLATION. |
| EMPTY | 4 | Nothing was checked: Init admits no state (0 distinct states), the config lists no INVARIANT/PROPERTY, or states were left on the queue | Fix Init or the config. An EMPTY model "passes" every invariant; it is never a pass. |
| COVERAGE_MISSING | 5 | TLC finished, but at least one named action was never enabled, or there was no action coverage at all | The model cannot reach that step: a guard is too strict, Init is wrong, or a constant is too small. Fix the model and rerun. If the action really is unreachable in the code, delete it from the model and say so in the report. |
| TIME_LIMIT | 6 | TLC was still running at the limit (default 600 s) | The model is too big or unbounded (a counter with no upper limit, an unbounded queue). Bound the counter by the flow's own end (at most N retries), split the model per flow, or ask for a longer `--time-limit`. Shrinking constants or adding a CONSTRAINT is an escape hatch (step 8). |
| ERROR | 7 | Java, the jar, the config, or the spec is wrong (parse or semantic error, unknown operator) | Read the reason and the log path the runner prints. Fix and rerun. |

Facts behind the fail-closed rules:

- TLC prints `Model checking completed. No error has been found.` for a
  model whose Init is `FALSE` (0 states). The runner calls that EMPTY.
- TLC prints coverage `<Action ...>: 0:0` for an action that was never
  enabled. A PASS on such a model says nothing about that step.
- `-simulate` samples random behaviours; `-depth` and `-dfid` bound the
  search. Both can find bugs; neither proves their absence. The runner
  refuses both flags.
- A `CONSTRAINT` in the config cuts the state space: the PASS holds only for
  states inside it. The runner prints it on every run, and step 8 needs the
  user's approval for it.
- The runner keeps TLC's log and its `states/` metadata under
  `${TMPDIR:-/tmp}/model-check-design/`, so the repo stays clean. It refuses
  a `tla2tools.jar` whose SHA-256 does not match v1.7.4.
