# C, C++, Python, Java, Go and TypeScript

Read in steps 1, 4 and 5 of SKILL.md when the target is not Rust.

## C and C++: CBMC (tested), ESBMC (not tested)

Install: `brew install cbmc`, `apt install cbmc`, or use the copy Kani bundles at
`~/.kani/kani-<version>/bin/cbmc`. Check with `cbmc --version`. CBMC 6 turns on bounds,
pointer, division-by-zero, signed-overflow and unwinding checks by default (checked with
CBMC 6.11). Unsigned wraparound is legal C: add `--unsigned-overflow-check` when the rule
says a size or amount must not wrap.

One harness function per file (`bmc/<target>_<rule>_harness.c`, shared setup in a
header), production files untouched. CBMC reports the covers of every function it
loads; `bmc-run.sh` counts only the `--function` harness, but other harnesses' failed
asserts still fail the run:

```c
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
int read_tag(const uint8_t *buf, size_t n, uint8_t out[8]);
size_t nondet_size_t(void);                  /* undefined nondet_* functions return any value */

void harness(void) {
    size_t n = nondet_size_t();
    __CPROVER_assume(n <= 12);               /* bound: 3-byte header + 8-byte max tag + 1 */
    uint8_t *buf = malloc(n);                /* exactly n bytes: a read past n is out of bounds */
    __CPROVER_assume(buf != NULL);           /* ASSUMES: callers pass a real buffer (loader.c:41) */
    uint8_t out[8];
    int r = read_tag(buf, n, out);
    __CPROVER_assert(!(r == -1), "cover: rejected");   /* FAILURE = branch reached */
    __CPROVER_assert(!(r >= 0), "cover: accepted");
    __CPROVER_assert(r <= 8, "R1: tag fits out");
}
```

Run: `<skill>/scripts/bmc-run.sh .bmc/harness.log cbmc src/tag.c bmc/tag_harness.c --function harness --unwind 9`.

- Allocate symbolic buffers with `malloc(n)` of the symbolic size. A fixed `uint8_t buf[12]`
  hides every read between `n` and 12.
- Covers: CBMC has no cover assertion that works next to unwinding checks. Write
  `__CPROVER_assert(!(cond), "cover: <branch>")`; `bmc-run.sh` counts its FAILURE as
  reached and its SUCCESS as unreachable.
- Counterexample: run `cbmc` directly (not through `bmc-run.sh`, which refuses
  `--property`) with `--property <id> --trace --compact-trace` (the `[id]` from the failed
  line) into `.bmc/<harness>.trace.txt`, and read the input values. This run only reads a
  trace; it is never a verdict. Write a test
  in the project's C test framework; with none, a standalone `tests/test_<target>_bmc.c`
  with its build line in a comment. Build it with `-fsanitize=address,undefined`:
  without a sanitizer an out-of-bounds read passes silently.
  Keep it out of the default test target until the fix (the C stand-in for `#[ignore]`),
  and put its run command in the report.
- Mutants: `plant-mutant.sh` works unchanged; put the `cbmc` command after `--`.
- Harness files go in `bmc/`, rules in `verification/`, logs in `.bmc/`.
- ESBMC (not tested by this skill): `esbmc <files> --function harness --unwind 18 --overflow-check`.
  Same harness, with `__ESBMC_assume` or `__VERIFIER_assume`. `bmc-run.sh` reads its
  `VERIFICATION FAILED` line; per-property detail stays in the log.
- C++: CBMC reads C++ with limited STL models. Keep the target a function on plain
  arrays and integers.

## Python: CrossHair (not tested by this skill)

CrossHair runs the function on symbolic values with an SMT solver. It is symbolic
execution with a time limit, not bounded model checking: a pass means "no
counterexample found in the time", not "none exists up to a bound". Say this in the report.

- Install into the project's virtualenv: `pip install crosshair-tool`.
- Contracts: PEP 316 docstrings (`pre:` / `post:`), `icontract`, `deal`, or plain `assert`
  statements at the top of the function (`--analysis_kind=asserts`).
- Run: `crosshair check --analysis_kind=PEP316 --per_condition_timeout=30 mypkg.parser.parse`.
- Counterexample to test: `crosshair cover mypkg.parser.parse --example_output_format=pytest`.
- A `pre:` line is an assumption: it gets the same `ASSUMES:` reason and judge rule.

## Java and Kotlin: JBMC (experimental, not tested by this skill)

JBMC ships with CBMC (`jbmc --version`). It models only part of the Java library;
code that uses streams, reflection or most collections often gives UNKNOWN or a false
result. Before trusting a pass, plant a known bug and confirm JBMC finds it.

- Nondet inputs and assumptions: `org.cprover.CProver.nondetInt()`, `CProver.assume(...)`
  (from the `jbmc-core-models` jar).
- Run on compiled classes: `jbmc --classpath target/classes --function com.acme.Harness.check --unwind 10`.
- Report every JBMC result as "experimental".

## Go, TypeScript, JavaScript and others

No mature bounded model checker exists for these. Say so in one line and route to the
`property-testing` skill, or to the property tests in `legacy-testing`
(`fast-check`, `gopter`/`rapid`). A pure function ported to Rust or C only to verify it
proves the port, not the original.
