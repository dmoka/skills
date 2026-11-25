# Property kinds, strongest first

A property is strong when a wrong implementation almost never passes it. Write the rule in
words, then pick the first kind on this list that the rule supports.

## 1. Roundtrip

Two functions undo each other: `decode(encode(x)) == x`, `parse(format(d)) == d`,
`deserialize(serialize(o)) == o`, `fromCents(toCents(m)) == m`.

- Generate the *decoded* side with every value the type allows: separators, escape
  characters, empty strings, unicode, the largest number. An encoder bug hides in exactly
  the characters the format uses itself (`;`, `=`, `%`, `"`, `\`).
- A roundtrip alone passes when both functions are the identity. Add one fixed example of
  the encoded form, or an oracle on the encoded side, when the format is specified.

## 2. Oracle (differential)

A second implementation computes the same answer by a different route: a brute-force
loop for an optimised algorithm, the old version before a rewrite, the standard library
(`sorted`, `Decimal`, `BigInt`), or the rule computed directly from its definition.

- **Oracle independence.** The oracle shares no code with the function under test: not the
  same helper, not the same rounding function, not a constant imported from the same module.
  `expect(fee(x)).toBe(fee(x))` and an oracle that calls the same `roundHalfUp` pass on any
  bug in it. Compute the expected value from the rule.
- Money: compare against integer cents or an arbitrary-precision decimal, never floats.

## 3. Idempotence and other algebra

`normalize(normalize(s)) == normalize(s)`, `dedupe(dedupe(xs)) == dedupe(xs)`, a retry of the
same request changes nothing; commutativity (`merge(a, b) == merge(b, a)`), an identity
element (`add(x, 0) == x`). Strong for normalisers, mergers and retries; weak alone for
arithmetic (a function that returns a constant is idempotent).

## 4. Invariant

A fact about the output that holds whatever the input: the parts of a split add up to the
total, a sorted output is ordered and is a permutation of the input, a balance is never
negative, a refund never exceeds what was paid, seats sold never exceed seats available,
a bigger order never pays a smaller fee when the rule says so (a metamorphic relation:
change the input in a known way, check the known effect on the output).

- One invariant rarely pins the function down. Combine two (ordered AND a permutation).

## 5. No-crash

For any input, the function returns a value or throws its documented error type. The
weakest kind: it checks no answer. Use it for every entry point outside input can reach
(parsers, HTTP handlers, CLI argument parsing), and as the only property when the code has
no stated rule.

## Model-based (stateful)

For an object with state (an account, a cart, a cache, a queue, a connection pool):

1. Write a tiny model: a plain value that holds what the state must be (a balance as an
   integer, a cart as a dictionary of quantities).
2. Generate a random sequence of commands (`deposit(n)`, `withdraw(n)`, `add(item)`).
3. Apply each command to the real object and to the model; after each one, compare what
   the real object reports with the model, and check the invariants.

The library shrinks a failing sequence to the shortest one. Libraries: Hypothesis
`RuleBasedStateMachine`, fast-check `fc.commands` + `fc.modelRun`, `proptest-state-machine`,
jqwik `ActionChain`, rapid `t.Repeat`, FsCheck `Command`, CsCheck `SampleModelBased`.

## Generators

- Constraints go into the generator: `st.integers(1, balance)`, `fc.integer({min:1, max:b})`,
  `1..=b`. A filter or `assume` throws inputs away; the run reports the same count while
  checking fewer inputs, and a filter can drop the exact region where the bug is.
- Ranges come from the rule, never from the code: if the rule says `amount <= balance`,
  generate up to `balance`, even when the code checks `amount < balance`.
- Bias toward edges: libraries already try 0, empty and the extremes; add the limits the
  rule names with `oneof` (`st.just(balance)`, `fc.constant(limit)`).
- Mix valid and invalid inputs on entry points, so most runs pass validation and reach the
  logic.

## When there is no good property

Say so, with the reason, and write nothing: code whose only rule is a lookup table, a UI
string, a thin wrapper over one library call, or a function whose expected output nobody
can state without re-implementing it line by line. A property that restates the code is a
tautology: it passes on every bug.

## What property tests cannot see

- **Needles.** A bug at one value (`if amount == 7_777_777`) or one date is hit with a
  probability near zero by random generation. fast-check, proptest, jqwik and rapid bias
  toward small and boundary values, not toward arbitrary constants in the code. Recent
  Hypothesis versions also feed literals from the code under test into generation, so a
  needle like `== 3_133_700` can be found there (verified with Hypothesis 6.170); do not
  count on it in other libraries, or for a needle computed at run time. Read the code for
  `==` against a literal, lookup tables and special dates, and name each in the report as
  found or unseen; an example test covers an unseen one, a property does not.
- **Unwritten rules.** A property checks only the rule it states.
- **Generator blind spots.** Inputs outside the generator's range or shape: sizes beyond
  `max_size`, characters the string strategy excludes, states the command generator never
  reaches.
- **I/O and time.** Code behind a database, a network call or the clock is not exercised
  unless the property calls through it.
