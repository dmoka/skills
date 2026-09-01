# Mutation tools by stack — setup and scoped runs

Every entry follows the same shape: install, minimal config, **scoped first
run** (one file or module — never the whole repo first), where the report
lands. Prefer the tool's incremental mode once it exists for the stack.

Version numbers and flags drift. If a command below fails, check the tool's
current docs before improvising — do not switch tools because one flag moved.

## JavaScript / TypeScript — StrykerJS

```bash
npm install --save-dev @stryker-mutator/core
npx stryker init          # detects the test runner, writes stryker.config.json
```

Scoped first run:

```bash
npx stryker run --mutate "src/billing/refund.ts"
```

- Config: `stryker.config.json`. Keep `"coverageAnalysis": "perTest"` (large
  speedup). Add generated folders (`coverage`, `test-results`, `reports`) to
  `ignorePatterns` — Stryker copies the project into a sandbox and a
  concurrent process writing those folders crashes the copy.
- Report: `reports/mutation/mutation.html` plus console summary.
- Later runs: `--incremental` reuses previous results and only retests what
  changed.

## C# / .NET — Stryker.NET

```bash
dotnet tool install -g dotnet-stryker
```

Run from the **test project** directory. Scoped first run:

```bash
dotnet stryker --mutate "**/RefundService.cs"
```

- Multi-project solutions: `--project MyLib.csproj` picks the source project
  under test.
- Report: `StrykerOutput/<timestamp>/reports/mutation-report.html`.
- Config file `stryker-config.json` is optional; flags cover the first run.

## Java / Kotlin — Pitest

Maven:

```xml
<plugin>
  <groupId>org.pitest</groupId>
  <artifactId>pitest-maven</artifactId>
  <version>1.17.1</version>
</plugin>
```

JUnit 5 needs the extra dependency `pitest-junit5-plugin` inside that plugin
block. Scoped first run:

```bash
mvn test-compile org.pitest:pitest-maven:mutationCoverage \
  -DtargetClasses=com.example.billing.* -DtargetTests=com.example.billing.*
```

- Gradle: plugin id `info.solidsoft.pitest`, same `targetClasses` idea.
- Report: `target/pit-reports/index.html`.

## Python — mutmut

```bash
pip install mutmut
```

Config in `setup.cfg` or `pyproject.toml`:

```toml
[tool.mutmut]
paths_to_mutate = "src/billing/"
```

Scoped first run: point `paths_to_mutate` at one module, then:

```bash
mutmut run
mutmut results          # list survivors
mutmut show <id>        # diff of one mutant
```

- mutmut caches results; reruns only retest affected mutants.
- Requires the tests runnable via `pytest` from the repo root.

## Rust — cargo-mutants

```bash
cargo install cargo-mutants
```

Scoped first run:

```bash
cargo mutants -f src/billing.rs
```

- Report and logs: `mutants.out/` (`caught.txt`, `missed.txt`,
  `unviable.txt`). "Missed" = survivor.
- On a PR: `cargo mutants --in-diff <(git diff main)` tests only changed
  code — the cheapest CI gate this list has.

## PHP — Infection

```bash
composer require --dev infection/infection
vendor/bin/infection --filter=src/Billing/RefundService.php --threads=4
```

- Config: `infection.json5` (generated on first run). Report: console +
  `infection.log`.
- Needs Xdebug or PCOV for coverage; PCOV is much faster.

## Go, Ruby, and everything else

- **Go**: `gremlins` (github.com/go-gremlins/gremlins) — works but moves
  slowly; expect rough edges. Scope with `gremlins unleash ./billing/...`.
- **Ruby**: `mutant` (github.com/mbj/mutant) — mature and precise;
  `bundle exec mutant run --include lib 'Billing*'`.
- **Anything else**: search "<language> mutation testing tool", prefer the
  one with recent releases, and apply the same loop: baseline, scope to one
  module, run, explain survivors, kill or prove equivalent. If no maintained
  tool exists, say so — do not hand-mutate the codebase; the manual version
  of this loop (flip one operator, run the suite, revert) is a demonstration,
  not a practice.
