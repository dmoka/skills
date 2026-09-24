# `.github/pr-review.jsonc` — the rule, written by you

One file configures both `pr-triage` and `pr-tour`. It is JSON with comments
and trailing commas allowed. Commit it: the ranking is a team decision, and a
diff to this file is a visible change to what the team reviews first.

## Starter

Replace every path with this repo's real ones. The points are a proposal.

```jsonc
{
  "version": 1,

  // Named parts of THIS repo. Both skills use them.
  "areas": {
    "money":      ["src/domain/refund.ts", "src/domain/fees.ts", "src/payments/**"],
    "auth":       ["middleware.ts", "src/auth/**", "app/admin/**/actions.ts"],
    "migrations": ["drizzle/**", "migrations/**"]
  },

  // Extra test globs (common layouts are built in).
  "tests": [],

  // Extra noise globs (lockfiles, snapshots, dist/, *.min.* are built in).
  "noise": ["drizzle/meta/**"],

  "triage": {
    // score = sum of points of every rule whose conditions ALL hold.
    // Highest score is reviewed first. Ties: the PR that waited longest.
    "rules": [
      { "id": "money",      "points": 40, "why": "touches money",
        "when": { "areas": ["money"] } },
      { "id": "auth",       "points": 35, "why": "touches authorization",
        "when": { "areas": ["auth"] } },
      { "id": "skips-test", "points": 35, "why": "adds a skipped or focused test",
        "when": { "skippedTestsAdded": { "gt": 0 } } },
      { "id": "migration",  "points": 30, "why": "changes the schema",
        "when": { "areas": ["migrations"] } },
      { "id": "drops-data", "points": 25, "why": "destructive SQL",
        "when": { "destructiveSql": { "gt": 0 } } },
      { "id": "untested",   "points": 20, "why": "source changed, no test changed",
        "when": { "srcWithoutTests": true } },
      { "id": "big",        "points": 15, "why": "over 400 changed lines",
        "when": { "linesChanged": { "gt": 400 } } },
      { "id": "stale",      "points": 10, "why": "waiting over 3 days",
        "when": { "ageDays": { "gt": 3 } } },
      { "id": "deps-only",  "points": -20, "why": "only dependency files changed",
        "when": { "onlyPaths": ["package.json", "package-lock.json"] } },
      { "id": "draft",      "points": -50, "why": "draft — not asking for review yet",
        "when": { "draft": true } }
    ]
  },

  "tour": {
    // Optional. Folders searched for a spec or review contract whose file
    // name contains the branch name (feat/event-waitlist -> *event-waitlist*.md).
    "specDirs": ["docs", "specs", ".scratch", "contracts"],
    // Optional. The order THIS team reads in; first match wins.
    // Omit to use the built-in order below.
    "readingOrder": [
      { "name": "schema & migrations", "paths": ["drizzle/**", "src/db/schema.ts"] },
      { "name": "domain",              "paths": ["src/domain/**"] },
      { "name": "services & data",     "paths": ["src/services/**", "src/db/**", "src/payments/**"] },
      { "name": "UI",                  "paths": ["app/**", "components/**"] }
    ]
  }
}
```

## Conditions

Every condition in a rule's `when` must hold. Numbers take a plain value or a
comparator object: `{ "gt": 3 }`, `gte`, `lt`, `lte`, `eq` (combine them for a
range: `{ "gte": 100, "lt": 400 }`).

| Condition | Holds when | Type |
|---|---|---|
| `areas` | any non-noise file is in one of these named areas | `["money"]` |
| `paths` | any changed file matches one of these globs | `["src/**"]` |
| `onlyPaths` | every changed file matches one of these globs | `["docs/**"]` |
| `linesChanged` | additions + deletions a human reads (noise excluded) | number |
| `linesChangedAll` | all additions + deletions, noise included | number |
| `filesChanged` | changed files | number |
| `ageDays` | whole days since the PR was opened | number |
| `draft` | the PR is a draft | boolean |
| `labels` | the PR has any of these labels | `["dependencies"]` |
| `author` | the PR author is one of these logins | `"bot"` or `[...]` |
| `skippedTestsAdded` | added `.skip` / `xit` / `@Disabled` / `.only` lines… | number |
| `srcWithoutTests` | a source file changed and no changed test shares its name | boolean |
| `destructiveSql` | added `DROP`, `TRUNCATE`, `RENAME`, `DELETE FROM` lines in SQL or migration files | number |
| `assertionsRemoved` | test files that remove more assertions than they add | number |
| `addedLinesMatch` | a regex matches an added, non-noise line (case-insensitive) | `"process\\.env\\."` |

Globs: `**` any depth, `*` within one folder, `?`, `{a,b}`. A glob without `/`
matches the file name anywhere (`"*.sql"`).

## Built-in defaults

- **Tests:** `test/`, `tests/`, `__tests__/`, `spec/`, `e2e/`, `*.test.*`,
  `*.spec.*`, `*_test.go`, `test_*.py`, `*_test.py`, `*Test(s).java|kt|cs`.
- **Noise:** lockfiles (npm, yarn, pnpm, bun, Cargo, Poetry, uv, Go, Composer,
  Bundler, NuGet, Gradle, Nix), snapshots, `dist/`, `build/`, `*.min.*`,
  files marked `@generated` or `DO NOT EDIT`, binaries, pure renames, and two
  heuristics: **formatting only** (the change disappears once whitespace,
  quotes, commas, semicolons and parentheses are ignored) and **imports only**.
- **Reading order:** contracts & schema → domain → services & data → UI &
  entry points → config & scripts → everything else. Hotspots (any file with
  a high-severity item, together with its tests) jump to the front.

## Report JSON

Both reports carry `kind` (`"triage"` or `"tour"`) and `schemaVersion: 1`.

**triage.json** — `repo`, `generatedAt`, `config` (`path`, `sha256`, `rules`
with `matchedPRs`), `scoring`, `summary` (model), and `prs[]`: `rank`,
`score`, `number`, `title`, `url`, `author`, `draft`, `labels`, `ageDays`,
`additions`, `deletions`, `filesChanged`, `noiseFiles`, `areas`, `matched[]`
(`id`, `points`, `why`, `evidence`), `facts[]` (high-severity facts), and
`explanation` (model).

**tour-<n>.json** — `pr` (metadata), `intent` (`status`: `spec` |
`described` | `title only` | `UNKNOWN`, `sources[]` of `{ type: spec |
description | issue | commits | title, source, text }`, strongest first),
`explains[]` (model: `quote`, `files`), `unexplained[]` (derived: non-noise
files no quote explains; a test inherits its code's explanation),
`unmatched[]` (derived: quotes with no file), `whatItDoes` (model),
`claims[]` (`quote`, `file`, `line`, `note`), `items[]` (`source`: `fact` |
`model` | `map`, `kind`, `severity`, `file`, `line`, `side`, `text`, `why`),
`fileNotes`, `order[]` (`path`, `role`: `code` | `test` | `noise`,
`pairedWith`, `why`), `orderRule`, and `files[]` (`path`, `oldPath`, `status`,
`kind`, `noise`, `areas`, `additions`, `deletions`, `hunks[]` with `lines[]`
of `{ t: "add"|"del"|"ctx", s, o, n }`).

## In CI

The deterministic half needs no model: `triage.mjs` or `tour.mjs`, then
`render.mjs`, gives a complete page with facts, ranks, and reading order —
the WHY panel just says "not annotated yet". Upload the `.html` as a build
artifact. Add the model step only where an agent runs in the pipeline.
