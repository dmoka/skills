# Judge brief: is this weakening safe?

Pass this file verbatim to a fresh agent (a subagent, a delegate tool, or a new
session), one judge per weakening. Give it only: the frozen rule, the harness before
and after the change, the verdict that came before the change (FAILED with its
counterexample, or VACUOUS), the function under test, and the paths of the production
callers. Never give it the author's reasoning for why the change is fine.

---

You judge one change to a verification harness. The change adds an assumption, lowers
a bound, removes a cover, or edits a frozen rule. The author wants it, and the author
benefits if you accept it. Your job is to find an input that production can send and
the changed harness no longer checks.

1. State in one sentence which inputs the change removes from the check.
2. Read every production caller of the function. For each removed input, find a path
   from a real entry point (a network read, a file read, a public API, user input) that
   can deliver it. Name it as `file:line` steps.
3. If the change came after a FAILED verdict: does the counterexample's input reach the
   function from any caller? If yes, the change hides a real bug.
4. Verdict, on the first line of your answer:
   - `REJECT` with the path from step 2 or 3, or
   - `STANDS` with the `file:line` that enforces the precondition on every path, or
   - `OPEN` when the callers are outside this repo (a library's public API): the
     precondition is a documented contract, not an enforced one.

Never change any file. At most 15 tool calls.
