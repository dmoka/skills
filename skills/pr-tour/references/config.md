# `.github/pr-review.jsonc` — optional tuning

Neither skill needs this file. Without it, built-in defaults decide what is a
test, what is noise, and the reading order, and the model judges attention on
its own. Add the file only when the defaults get this repo wrong. It is JSON
with comments and trailing commas allowed. Nothing in it ranks PRs.

```jsonc
{
  "version": 1,

  // Named parts of THIS repo. Shown as tags on files and given to the model
  // as hints — a change in "money" is read with extra care. They never score.
  "areas": {
    "money":      ["src/domain/refund.ts", "src/payments/**"],
    "auth":       ["middleware.ts", "**/actions.ts"],
    "migrations": ["drizzle/**"]
  },

  // Extra test globs (common layouts are built in).
  "tests": [],

  // Extra noise globs (lockfiles, snapshots, dist/, *.min.* are built in).
  "noise": ["drizzle/meta/**"],

  "tour": {
    // Folders searched for a spec or review contract whose file name
    // contains the branch name (feat/gift-cards -> *gift-cards*.md).
    "specDirs": ["docs", "specs", ".scratch", "contracts"],
    // The order THIS team reads in; first match wins.
    "readingOrder": [
      { "name": "schema & migrations", "paths": ["drizzle/**", "src/db/schema.ts"] },
      { "name": "domain",              "paths": ["src/domain/**"] },
      { "name": "services & data",     "paths": ["src/services/**", "src/db/**"] },
      { "name": "UI",                  "paths": ["app/**", "components/**"] }
    ]
  }
}
```

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

**triage.json** — `repo`, `generatedAt`, `ranking`, `summary` (model), and
`prs[]` in queue order: `rank`, `attention` (copied from the PR's tour),
`number`, `title`, `url`, `author`, `draft`, `labels`, `ageDays`,
`additions`, `deletions`, `filesChanged`, `readLines`, `noiseLines`,
`noiseFiles`, `intent`, `highFacts[]`, and `tour` (the file name of its tour).

**tour-<n>.json** — `pr` (metadata), `attention` (model: `level`: `critical` |
`high` | `medium` | `low`, `whatHappened`, `why`, `file`, `line`, `side`),
`intent` (`status`: `spec` | `described` | `title only` | `UNKNOWN`,
`sources[]` of `{ type: spec | description | issue | commits | title, source,
text }`, strongest first), `explains[]` (model: `quote`, `files`),
`unexplained[]` (derived: non-noise files no quote explains; a test inherits
its code's explanation), `unmatched[]` (derived: quotes with no file),
`whatItDoes` (model), `claims[]` (`quote`, `file`, `line`, `note`), `items[]`
(`source`: `fact` | `model` | `map`, `kind`, `severity`, `file`, `line`,
`side`, `text`, `why`), `fileNotes`, `order[]` (`path`, `role`: `code` |
`test` | `noise`, `pairedWith`, `why`), `orderRule`, and `files[]` (`path`,
`oldPath`, `status`, `kind`, `noise`, `areas`, `additions`, `deletions`,
`hunks[]` with `lines[]` of `{ t: "add"|"del"|"ctx", s, o, n }`), `changeMap`
(computed: `nodes[]` of `{ path, layer }`, `edges[]` of `{ from, to }`, or
null), `diagrams[]` (model: `title`, `kind`, `mermaid`, `caption`), plus the
model's `why`, `points[]`, `shape[]` (`title`, `kind`, `lang`, `code`) and
`chapters[]` (`title`, `description`, `files`, tests placed after their code).

## In CI

The deterministic half needs no model: `triage.mjs` (or `tour.mjs`), then
`render.mjs`, gives the queue and every tour with facts, noise, and reading
order — attention shows "not judged" and the WHY panel "not annotated yet".
Upload `.pr-review/review.html` as the build artifact: one file with the
queue and every tour. Add the model step only where an agent runs in the
pipeline.
