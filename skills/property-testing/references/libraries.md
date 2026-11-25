# Libraries

One table to pick the library, then one section per stack with the five things every
property needs: the fixed seed and run count, the generator statistics (the proof it ran),
the replay of a failure, the strict expected-failure marker for a pinned suspected bug,
and the discards to avoid.

| Stack | Library | Install (dev dependency) | Fixed seed and run count |
|---|---|---|---|
| JavaScript / TypeScript | fast-check https://fast-check.dev/ | `npm i -D fast-check` | `fc.assert(prop, { seed: 42, numRuns: 100 })` |
| Python | Hypothesis https://hypothesis.readthedocs.io/ | `pip install hypothesis` (add to the dev extras) | `@settings(derandomize=True, max_examples=100)` |
| Java / Kotlin | jqwik https://jqwik.net/ | `testImplementation("net.jqwik:jqwik:1.9.2")` | `@Property(seed = "42", tries = 100)` |
| .NET | FsCheck https://fscheck.github.io/FsCheck/ or CsCheck https://github.com/AnthonyLloyd/CsCheck | `dotnet add package FsCheck.Xunit` / `CsCheck` | FsCheck `[Property(MaxTest = 100, Replay = "(1,2)")]`; CsCheck `.Sample(..., iter: 100, seed: "...")` |
| Rust | proptest https://proptest-rs.github.io/proptest/ | `cargo add --dev proptest` | `ProptestConfig { cases: 100, rng_seed: RngSeed::Fixed(42), ..ProptestConfig::default() }` |
| Go | rapid https://pkg.go.dev/pgregory.net/rapid | `go get pgregory.net/rapid` | `go test -rapid.seed=42 -rapid.checks=100` |
| Haskell | QuickCheck | `QuickCheck` in the test deps | `quickCheckWith stdArgs { maxSuccess = 100, replay = ... }` |

Hunt with about 1,000 runs (the same knob, raised for the local run, or an environment
variable: `HYPOTHESIS` profile, `PROPTEST_CASES=1000`, `-rapid.checks=1000`). Commit 25-100.

## Python: Hypothesis

- Generators: `st.integers(min_value=, max_value=)`, `st.text()`, `st.lists(..., max_size=)`, `st.builds(Model, ...)`, `st.data()` with `data.draw(st.integers(1, balance))` for a range that depends on another draw. Stateful: `hypothesis.stateful.RuleBasedStateMachine` with `@rule` and `@invariant`.
- Statistics: `pytest --hypothesis-show-statistics -k <property>` prints the passing, failing and invalid (discarded) example counts per test. `hypothesis.event("hit the limit")` labels inputs, `hypothesis.target(x)` steers toward large values.
- Replay: the failure prints `@example(...)`-ready values; add `@example(balance=10, amount=10)` above the property. With `derandomize=True` the `.hypothesis/` database is not used.
- Pinned suspected bug: `@pytest.mark.xfail(strict=True, reason="suspected bug: ...")` on a plain test.
- Discards to avoid: `assume(...)`, `.filter(...)`. Health checks (`filter_too_much`, `too_slow`) exist to catch them; never suppress them.

## TypeScript / JavaScript: fast-check

- Generators: `fc.integer({ min, max })`, `fc.string({ unit: "grapheme" })` for unicode, `fc.array(arb, { maxLength })`, `fc.record({...})`, `fc.integer({min:1}).chain(b => fc.tuple(fc.constant(b), fc.integer({min:1, max:b})))` for a dependent range. Stateful: `fc.commands([...])` with `fc.modelRun`.
- Statistics: `fc.statistics(arb, v => label, { numRuns: 1000, seed: 42 })` prints the share of each label; run it once while hunting and quote it. `verbose: 2` prints every run.
- Replay: a failure prints `{ seed, path }`; pass both to `fc.assert` to replay, and add the shrunk value to `examples: [[...]]`.
- Pinned suspected bug: vitest `test.fails("suspected bug: ...", ...)`, Jest `test.failing(...)`.
- Discards to avoid: `.filter(...)`, `fc.pre(...)`.

## Rust: proptest

- Generators: ranges (`1u64..=1_000_000`), `any::<String>()`, `"[a-z]{0,8}"` regex strategies, `prop::collection::vec(s, 0..50)`, `(1u64..1000).prop_flat_map(|b| (Just(b), 1..=b))` for a dependent range. Stateful: the `proptest-state-machine` crate.
- Config: `#![proptest_config(ProptestConfig { cases: 100, rng_seed: RngSeed::Fixed(42), ..ProptestConfig::default() })]` inside `proptest! { }`; `PROPTEST_CASES=1000` overrides `cases` for the hunt only when the config does not set it.
- Statistics: proptest prints none. Count with a `static RUNS: AtomicUsize`, classify the interesting region in a second counter, and print both with `cargo test -- --nocapture`; or quote the `cases` from the config plus a `prop_assert!` that fails if the region is never hit.
- Replay: failures go to `proptest-regressions/<module>.txt` automatically; commit that file.
- Pinned suspected bug: a plain `#[test]` with `#[should_panic(expected = "...")]` around the assert of the rule.
- Discards to avoid: `prop_assume!`, `.prop_filter(...)`, `prop_filter_map`. proptest aborts after too many global rejects; a filter that drops 40% passes silently.

## Java / Kotlin: jqwik

- Generators: `@ForAll @IntRange(min = 1, max = 1000) int amount`, `Arbitraries.integers().between(1, b)`, `@Provide` methods, `Combinators.combine(...)`, `flatMap` for dependent ranges. Stateful: `ActionChain` / `Actions`.
- Statistics: `Statistics.collect(label)` per try; the report prints the share per label, and jqwik's summary shows `tries` vs `checks` (checks below tries = discards).
- Replay: `@Property(seed = "...")` with the printed seed; pin the shrunk value as an `@Example` method.
- Pinned suspected bug: a JUnit test that wraps the assert of the rule in `assertThrows(AssertionError.class, ...)`, named `suspected bug ...`.
- Discards to avoid: `Assume.that(...)`, `.filter(...)`.

## Go: rapid

- Generators: `rapid.IntRange(1, b).Draw(t, "amount")`, `rapid.String()`, `rapid.SliceOfN(...)`, `rapid.Custom(...)`. Stateful: `t.Repeat(map[string]func(*rapid.T){...})`.
- Statistics: `go test -run TestX -rapid.v` prints each draw; count labels yourself with a map printed in `t.Cleanup`.
- Replay: a failure writes `testdata/rapid/<Test>/<file>.fail`; `-rapid.failfile=<file>` replays it.
- Pinned suspected bug: Go has no expected-failure marker. Write the plain test with the shrunk input, assert the rule, and call `t.Skip("suspected bug: ... (remove when fixed)")` only with the user's yes; otherwise leave it red.
- Discards to avoid: `.Filter(...)`, `t.Skip` inside a property.

## .NET: FsCheck / CsCheck

- Generators: FsCheck `Gen.Choose(1, b)`, `Arb.From(...)`, `Gen.SelectMany` for dependent ranges; CsCheck `Gen.Int[1, b]`, `Gen.Select`. Stateful: FsCheck `Command`/`ICommandGenerator`, CsCheck `SampleModelBased`.
- Statistics: FsCheck `Prop.Classify(cond, label)` / `Prop.Collect(v)` print shares; CsCheck prints counts with `Sample(..., print: ...)`.
- Replay: FsCheck `Replay = "(seed,gamma)"`; CsCheck `seed: "..."` printed on failure.
- Pinned suspected bug: xUnit `Assert.Throws<...>` around the assert of the rule, or `[Fact(Skip = ...)]` only with the user's yes.
- Discards to avoid: FsCheck `==>` (implication), `Gen.Where`/`Arb.Filter`; CsCheck `.Where(...)`.
