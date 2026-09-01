# Mutation tools by stack — setup and scoped runs

Every entry follows the same shape: install, minimal config, **scoped first
run** (one file or module — never the whole repo first), where the report
lands. Prefer the tool's incremental mode once it exists for the stack.

Never run a tool's interactive init wizard (`stryker init`, Infection's
first-run wizard, `mutmut browse`) — they hang a non-TTY session. Write the
config file yourself from the snippets below.

These tools drop output into the repo: `mutants/`, `.stryker-tmp/`,
`reports/`, `StrykerOutput/`, `target/pit-reports/`, `mutants.out/`,
`infection.log`. Gitignore or delete all of it before reporting.

Version numbers and flags drift. If a command below fails, check the tool's
current docs before improvising — do not switch tools because one flag moved.

## JavaScript / TypeScript — StrykerJS

```bash
npm install --save-dev @stryker-mutator/core @stryker-mutator/vitest-runner
# jest project: @stryker-mutator/jest-runner instead, "testRunner": "jest"
```

Write `stryker.config.json` yourself (do not run `stryker init` — it is an
interactive wizard):

```json
{
  "testRunner": "vitest",
  "mutate": ["src/billing/refund.ts"],
  "coverageAnalysis": "perTest",
  "ignorePatterns": ["coverage", "reports", "test-results"],
  "reporters": ["html", "clear-text", "progress"]
}
```

Scoped first run:

```bash
npx stryker run
```

- `"coverageAnalysis": "perTest"` is a large speedup — keep it. Keep
  generated folders in `ignorePatterns`: Stryker copies the project into a
  sandbox, and a concurrent process writing those folders crashes the copy.
- Report: `reports/mutation/mutation.html` plus console summary.
- Later runs: widen the `mutate` globs; `--incremental` reuses previous
  results and only retests what changed.

## C# / .NET — Stryker.NET

Install as a local tool, not globally:

```bash
dotnet new tool-manifest      # once per repo, if .config/dotnet-tools.json is missing
dotnet tool install dotnet-stryker
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

Maven — most modern projects use JUnit 5, which needs the extra plugin
dependency, so ship the full block:

```xml
<plugin>
  <groupId>org.pitest</groupId>
  <artifactId>pitest-maven</artifactId>
  <version>1.30.0</version> <!-- check Maven Central for latest -->
  <dependencies>
    <dependency>
      <groupId>org.pitest</groupId>
      <artifactId>pitest-junit5-plugin</artifactId>
      <version>1.2.3</version>
    </dependency>
  </dependencies>
</plugin>
```

Scoped first run:

```bash
mvn test-compile org.pitest:pitest-maven:mutationCoverage \
  -DtargetClasses=com.example.billing.* -DtargetTests=com.example.billing.*
```

- Gradle: plugin id `info.solidsoft.pitest`, same `targetClasses` idea.
- Report: `target/pit-reports/index.html`.
- Kotlin: expect noise — Pitest mutates compiler-generated code (null-check
  intrinsics), so many survivors are artifacts, not findings. Say so in the
  report instead of chasing them.

## Python — mutmut

Install into the project's virtualenv, never system-wide (bare `pip install`
hits PEP 668 on modern systems):

```bash
python -m pip install mutmut     # inside the venv; or: uv add --dev mutmut
```

Config in `pyproject.toml` — the value **must be an array**; a plain string
gets iterated character by character and mutates nothing:

```toml
[tool.mutmut]
source_paths = [ "src/billing/" ]   # mutmut 3 key; paths_to_mutate is the deprecated name
```

(In `setup.cfg` the section is INI-style `[mutmut]`, not `[tool.mutmut]`.)

Scoped first run — scope by pointing `source_paths` at one module:

```bash
mutmut run
mutmut results              # list survivors
mutmut show <mutant-name>   # diff of one mutant; names come from results
```

- Never open `mutmut browse` — it is an interactive TUI.
- The scope persists in `pyproject.toml`: widen or remove it when you finish.
- mutmut copies the source tree into a `mutants/` directory in the repo —
  gitignore or delete it before reporting.
- mutmut caches results; reruns only retest affected mutants. Tests must be
  runnable via `pytest` from the repo root.
- Windows: mutmut requires `fork`, so it runs only under WSL.

## Rust — cargo-mutants

```bash
cargo install cargo-mutants   # installs per-user (~/.cargo) — this is the global install to ask about
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
```

Write `infection.json5` yourself before the first run — without it Infection
starts an interactive wizard:

```json5
{ "source": { "directories": ["src"] }, "logs": { "text": "infection.log" } }
```

Scoped first run:

```bash
vendor/bin/infection --filter=src/Billing/RefundService.php --threads=4 --no-progress
```

- Report: console + `infection.log`.
- Needs Xdebug or PCOV for coverage; PCOV is much faster.

## Go, Ruby, and everything else

- **Go**: `gremlins` (github.com/go-gremlins/gremlins) — works but moves
  slowly; expect rough edges. Scope with `gremlins unleash ./billing/...`.
- **Ruby**: `mutant` (github.com/mbj/mutant) — mature and precise, but
  **free only for open source** (`--usage opensource`); commercial use needs
  a paid license, so say that before installing anything at work.
  `bundle add mutant-rspec --group development`, then
  `bundle exec mutant run --use rspec --usage opensource --require ./lib/billing 'Billing*'`.
- **Anything else**: search "<language> mutation testing tool", prefer the
  one with recent releases, and apply the same loop: baseline, scope to one
  module, run, explain survivors, kill or prove equivalent. If no maintained
  tool exists, say so — do not hand-mutate the codebase; the manual version
  of this loop (flip one operator, run the suite, revert) is a demonstration,
  not a practice.
