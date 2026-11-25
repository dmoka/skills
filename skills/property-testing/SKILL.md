---
name: property-testing
description: "Write property tests that find bugs examples miss. Use when asked for property-based tests, generative or fuzz-style tests, tests 'for all inputs', or when the user names Hypothesis, fast-check, proptest, jqwik, FsCheck, CsCheck, rapid or QuickCheck; and for code whose rules must hold for every input: parsers, money math, encode/decode pairs, sorting, state machines. Finds the load-bearing rules, picks the strongest property for each (roundtrip or oracle first), proves each property can fail with a planted mutant, pins every shrunk counterexample as a 'suspected bug' unit test, and counts escape hatches (assume, filter, lowered run counts) so none slips in unapproved. Never fixes production code. Not for single example-based unit tests or for mutation testing a suite."
---

# Property testing

A property test states a rule that must hold for every input, generates hundreds of
inputs, and shrinks a failure to the smallest input that breaks the rule. It is only
as good as three things: the rule (weak rules pass on broken code), the generator
(inputs it never produces are never checked) and the proof that it ran and can fail.

Reference files sit beside this file. Fetched over HTTP instead of from disk: fetch
them raw with `curl -sSL` from
`https://raw.githubusercontent.com/dmoka/skills/main/skills/property-testing/`
(`references/libraries.md`, `references/properties.md`, `references/judge.md`,
`scripts/escape-hatches.sh`, `scripts/plant-mutant.sh`, `scripts/freeze.sh`).

## Steps

1. **Detect the stack and the library.** Read the build file (`package.json`, `pyproject.toml`, `Cargo.toml`, `pom.xml`/`build.gradle`, `go.mod`, `*.csproj`) and grep the tests for an existing property library ([references/libraries.md](references/libraries.md)). Use the one the repo already has. None installed: ask once before adding it as a dev dependency, with the exact command. Nobody to answer (a headless run): do not install; report BLOCKED with that command. Run the existing suite once. Done when you name the library, its version, the test command, and the suite is green (red: report BLOCKED).
2. **Find the load-bearing rules.** Read the target code (the files the user names; else the money, parsing, encoding and permission code), its callers, its tests, and the docs or comments that state rules. Write each rule as one plain sentence about all inputs: "for every balance and amount with 0 < amount ≤ balance, withdraw returns balance − amount". Done when you have a list of rules, each with the function it covers and the source of the rule (doc, comment, test name, or "inferred from the code: confirm"). A target with no rule beyond "it returns something" gets the no-crash property only; say so.
3. **Pick the strongest property kind per rule**, in this order: roundtrip (`decode(encode(x)) == x`) or oracle (a simpler, independent implementation) > idempotence (`f(f(x)) == f(x)`) > invariant (sum preserved, output sorted, never negative) > no-crash. For code with state (a cart, an account, a connection), write a model-based property: random command sequences run against the real object and a tiny model. Details and examples: [references/properties.md](references/properties.md). **Oracle independence:** the expected value never comes from the function under test or from code it calls; compute it from the rule. "No good property here" is a valid outcome; report it with the reason. Done when every rule has a kind, or a stated reason it has none.
4. **Write the generators.** Build constraints into the generator (`st.integers(min_value=1, max_value=balance)`, `fc.integer({min: 1, max: balance})`, `1..=balance`), never generate-then-discard with `assume`, `.filter`, `fc.pre` or `prop_assume!`. Include the edges the rule names (zero, the exact limit, empty, unicode, the maximum). Done when no property uses a discard, or each discard is listed for step 9.
5. **Freeze each property.** Show the user each rule in words with its code. Then run `scripts/freeze.sh <test-file>[:<first>-<last>] ...` and put the hashes in your notes. Keep the frozen line range free of later additions: pinned tests go below it or in another file. Done when every property has a recorded SHA-256. Any later change to a frozen property is reported as a diff with its reason.
6. **Run it: hunt, then CI.** Fixed seed, about 1,000 runs per property while hunting, then the CI count (25-100) in the committed test (syntax per library: [references/libraries.md](references/libraries.md)). Read the generator statistics (Hypothesis `--hypothesis-show-statistics`, fast-check `fc.statistics`, jqwik's tries/checks, a counter in proptest): they are the proof it ran. Done when you can quote, per property, the number of runs and that the generated inputs reach the interesting region (the limit, the empty case); discards stay under 10%.
7. **Prove each property can fail.** For every property that passes, plant one mutant in the code it covers (flip `<=` to `<`, drop a `+ 1`, return the input unchanged) with `scripts/plant-mutant.sh <file> <line> '<old>' '<new>' -- <test command for this property>`. The script restores the file in every case. Exit 0 (property went red): record the `mutant:` line it prints. Exit 1 (still green): the property is vacuous; strengthen it and repeat. A mutant that does not compile proves nothing: pick another. Done when every passing property has a `mutant: file:line 'old' -> 'new'` record that turned it red, and `git status` shows no production file changed.
8. **Pin each counterexample.** A property that fails on today's code found a suspected bug. Take the shrunk input and write one plain unit test that calls the public function with it, asserts what the rule says it must return, and is marked expected-to-fail in strict mode (pytest `@pytest.mark.xfail(strict=True)`, vitest `test.fails`, Rust `#[should_panic]`, per library in [references/libraries.md](references/libraries.md)). Name it `suspected bug: <input> gives <actual>, rule says <expected>`. Also store the library's replay data (Hypothesis `@example`, `proptest-regressions/`, the fast-check seed and path). Leave the property itself unchanged and red. Do not fix production code: the user decides on the fix. Done when every failing property has a pinned test and a line in the report.
9. **Count the escape hatches.** Run `scripts/escape-hatches.sh <base-ref>` (the branch point, e.g. `origin/main`). It counts every new `assume(`, `prop_assume!`, `fc.pre`, `.filter(`, `Assume.that`, health-check suppression, skip marker, and run count below 25 or lowered. Done when it prints `escape hatches: 0`, or the user approved each one listed. Nobody to ask: keep each hatch out of the change (rewrite the generator), or leave it in and report it as an open decision.
10. **Judge every weakening claim in a fresh agent.** Before you add an approved hatch, narrow a generator, lower a run count, or edit a frozen property, write the claim (why the excluded inputs cannot occur or do not matter) and hand it to a new agent with [references/judge.md](references/judge.md) verbatim plus only the property, the change, the claim and the test command. One judge per claim; never judge in your own context. REJECTED: drop the weakening and keep the judge's test. STANDS: ask the user, with the judge's note. Done when every weakening has a verdict.
11. **Report, result first**, in at most 250 words:
    - Line 1: `N properties, M suspected bugs` (or `no good property here: <reason>`), with the library and runs per property.
    - A table, one row per property: the rule in words · kind · runs (hunt / CI) · `mutant:` record · result (passes, or the suspected bug with the shrunk input).
    - Escape hatches: the count from step 9, and each approved one with its judge verdict.
    - **What it cannot see**, one or two sentences naming this code's blind spots: inputs the generators rarely or never produce (a single magic value, one date, a huge size), rules nobody wrote, code behind I/O the properties never call. Name any `==` on a constant or a lookup in the code the generator cannot hit by chance.
    - The files added or changed, and the frozen hashes.

## Hard rules

- **Production code is read-only.** The planted mutant is the one temporary edit, and `plant-mutant.sh` reverts it. A found bug becomes a pinned test, never a fix.
- **The expected value never comes from the code under test.** `assert f(x) == f(x)` or an oracle that imports the same helper passes on any bug.
- **A property no mutant breaks is not a test.** Rewrite it before you report it.
- **No escape hatch without the user's yes.** The agent that wants the run green is the one most likely to filter out the failing inputs.
- **Fixed seed, printed on failure.** A failure nobody can replay is a rumour.

## Gotchas

- `.filter` and `assume` hide the input space silently: Hypothesis fails a health check only when most inputs are discarded, so a filter that drops 40% of inputs still passes. Read the statistics.
- A generator range taken from today's code (`max_value=balance - 1`) bakes the bug into the test. Take ranges from the rule.
- Shrinking can move a failure to a different bug. Pin the shrunk input, and rerun the property after pinning: a second failure is a second bug.
- Hypothesis's database (`.hypothesis/`) replays old failures across runs; with `derandomize=True` it is not used. Do not commit `.hypothesis/`; do commit `proptest-regressions/`.
- One command per shell call, and run each test command in the foreground; a background run is never read.

Last verified: 2026-11-25 with Claude Code (claude-opus-5-5), trigger only: 6 of 6 requests fired and 4 of 4 near misses stayed quiet (`tests/property-testing.eval.sh autopick`), with every installed skill and with project skills only. Scripts: 15 unit tests in `tests/property-testing-scripts.test.mjs`. Full runs on the fixtures and TicketBay: pending.

Ideas from pstack's formal-verification skills (Cursor, MIT: a broken variant per property, findings stay findings) and theorem-labs/oss-verify (Apache-2.0: oracle independence, a recorded breakage per property), in our own words.
