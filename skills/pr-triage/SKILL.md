---
name: pr-triage
description: Rank a repo's open pull request queue by risk rules the user writes and can read — touched areas (money, auth, migrations), skipped tests, untested changes, size, age — and render the ranked queue as one self-contained HTML page plus JSON for agents. Use when the user asks which PR to review first, has too many open PRs, wants a review queue ordered, or mentions PR triage, review backlog, or review priority.
---

# PR triage

"Which PR should I review first?" has no answer a model can know. Priority
lives in the team: which folder moves money in this repo, which migrations
hurt, how long a PR may wait. So this skill does not guess priority. The user
writes the rule in `.github/pr-review.jsonc`, a script applies it to facts
pulled with `gh`, and the rule that produced every rank is printed next to
the PR. The model only explains.

Scripts sit in `scripts/` beside this file (Node ≥ 18, zero dependencies,
`gh` logged in). If you fetched this over HTTP, fetch `scripts/*.mjs` and
[references/config.md](references/config.md) as raw text with `curl -sSL`,
never through a summarizing fetch tool.

## The loop

1. **Check the ground.** Inside a git repo with a GitHub remote, `gh auth
   status` green. Otherwise report BLOCKED with the exact failing command.
2. **Config.** If `.github/pr-review.jsonc` is missing, write a starter one
   from [references/config.md](references/config.md) — but fill `areas` with
   this repo's real paths: read the README and the tree, find where money is
   computed, where auth is checked, where migrations live. Show the file to
   the user and say plainly: "these points are my proposal; the ranking is
   yours — edit them." Do not run step 3 until the user confirms or edits it.
   If the config exists, never edit it without being asked.
3. **Compute.** `node scripts/triage.mjs` (add `--repo owner/name` when not in
   the repo). It writes `.pr-review/triage.json` and prints the ranking with
   the score arithmetic. Exit 2 means the config is missing or has no rules.
4. **Explain.** Read `triage.json`. Write `.pr-review/triage.notes.json`:
   `{ "summary": "...", "prs": { "<number>": "one sentence" } }`. Each sentence
   says why this PR sits where it sits, in reviewer language, from its
   matched rules and facts: "Changes tax rounding and adds no test — the
   money rule and the untested rule fired." Where a rule scores a PR in a way
   the facts contradict (a 900-line PR that is all renames), say so — that is
   a rule worth changing.
5. **Gate.** `node scripts/annotate.mjs .pr-review/triage.json
   .pr-review/triage.notes.json`. It refuses unknown PR numbers, overlong
   text, and any verdict word. Fix the notes, never the check.
6. **Render.** `node scripts/render.mjs .pr-review/triage.json` writes
   `triage.html` next to it: one file, no server, safe to publish as a CI
   artifact.
7. **Report** in chat: the top five with their score arithmetic
   (`85 = money 40 + skips-test 35 + stale 10`), rules that never fired,
   and at most three proposed config changes, each with the PR that motivates
   it. Proposals only — the user edits the rule.

## Hard rules

- **The script ranks; you never do.** Do not reorder, re-score, or drop a PR
  in the notes, the chat, or the HTML. Disagree with a rank? Propose a rule
  change and show which PRs it would move.
- **No verdicts.** A rank is an order to read in. Never write "safe", "LGTM",
  "can be merged", or "nothing to review" about any PR — the lowest-ranked PR
  still gets read.
- **Read-only on GitHub.** Never comment, label, approve, request changes,
  assign, or merge. The output is two files in `.pr-review/`; suggest adding
  that folder to `.gitignore`.
- **Name the blind spots** (below) in the report whenever a rule depends on
  one.

## What the ranking cannot see

- **Coverage.** `gh` has no coverage data. `srcWithoutTests` is an honest
  proxy — "a source file changed and no test with its name changed" — not a
  coverage delta. A real delta needs CI to publish coverage per PR.
- **Business priority** outside the configured `areas`. A PR in an
  unlisted folder that breaks checkout scores zero on the area rules.
- **Intent.** Triage reads diffs and metadata, not descriptions. Whether a
  PR does what it claims is `pr-tour`'s question, then a reviewer's.
- **Age** counts from PR creation, not from the last push or review request.

## Done means

- `.pr-review/triage.json` and `.pr-review/triage.html` exist and every PR
  in them has an explanation that passed `annotate.mjs`.
- The chat report shows the score arithmetic for the top five, the rules
  that never fired, and any proposed config changes, clearly marked as
  proposals.
- Nothing on GitHub changed.
