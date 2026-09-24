---
name: pr-tour
description: Turn one pull request into a guided reading tour — the author's intent and checkable claims first, then where to look and why (script-computed facts plus line-checked pointers), then the files in the order a reviewer should read them with each test next to its code, and noise (lockfiles, generated files, renames, formatting) collapsed last — rendered as one self-contained HTML page plus JSON that agents can read. Not GitHub stacked PRs. Use when the user asks to review, walk through, explain, or understand a PR or diff, asks what to read first or what to worry about in a PR, or mentions PR tour or reading order.
---

# PR tour

A reviewer who reads a diff top to bottom reads it in alphabetical order —
the order Git prints it, not the order that explains it. Labelling code as
AI-written does not make people read it more carefully; changing what they
read first is the lever. This skill changes it: WHY first, the files that
matter next, noise last.

The tour points attention. It never judges. It gives no merge verdict and no
security verdict, and "collapsed" means low reading value, never "checked".
It serves humans (the HTML) and agents (the JSON) with the same content — an
adversarial reviewer can start from its high-severity items.

Scripts sit in `scripts/` beside this file (Node ≥ 18, zero dependencies,
`gh` logged in). If you fetched this over HTTP, fetch `scripts/*.mjs` and
[references/config.md](references/config.md) as raw text with `curl -sSL`.

## The loop

1. **Compute.** `node scripts/tour.mjs <pr-number>` (add `--repo owner/name`
   outside the repo; `--diff-file x.diff --body-file notes.md` for a local
   diff). It writes `.pr-review/tour-<n>.json`: the author's words (PR body,
   linked issues), FACT items, per-file classification, and a reading order.
   It reads `.github/pr-review.jsonc` if present; without it, defaults apply.
2. **Read** the JSON, then every non-noise file's diff in the given order.
   Open surrounding source when a hunk is not enough to understand it.
3. **Write the WHY** to `.pr-review/tour-<n>.notes.json`:
   - `whatItDoes` — two or three sentences on what the diff actually does.
     It is shown as the model's reading, never as the author's intent.
   - `claims` — contract claims the author makes, **quoted verbatim** from
     the PR text ("no behaviour change for full refunds"), each pointed at
     the `file` and `line` where a reviewer can check it, with a `note` on
     what to check. No stated intent → no claims; the tour shows intent
     UNKNOWN and tells the reviewer to ask the author.
   - `items` — at most eight LOOK HERE pointers: `severity`, `file`, `line`
     (`side: "old"` for a removed line), a short `title`, and `why`. Look for
     a claim the code contradicts, a risky decision nobody mentioned, a
     missing security decision (a new input with no validation, a new action
     with no authorization check, a secret reaching a log), an edge case the
     tests skip. **high** = can change money, permissions or stored data, or
     contradicts a stated claim; **medium** = a behaviour change worth a
     test; **low** = worth a glance. Phrase each as what to check, not as a
     conclusion.
   - `fileNotes` — one line per non-noise file: what to look at in it.
4. **Gate.** `node scripts/annotate.mjs .pr-review/tour-<n>.json
   .pr-review/tour-<n>.notes.json`. It rejects a quote that is not in the
   PR text, a file or line that is not in the diff, and any verdict word,
   and it recomputes the reading order with your items. Fix the notes, never
   the check.
5. **Render.** `node scripts/render.mjs .pr-review/tour-<n>.json` writes
   `tour-<n>.html`: one file, no server, safe to publish as a CI artifact.
6. **Report** in chat: the HTML path, intent (stated or UNKNOWN), the high
   items with `file:line`, and how many lines sit in collapsed noise.

## Hard rules

- **Point, never judge.** No "LGTM", "safe", "approve", "exploitable",
  "no issues". The gate rejects them; do not reword around it.
- **Never invent intent.** Only the author's words are intent. Your summary
  goes in `whatItDoes`, where it is labelled as yours.
- **Facts come from the script.** Do not restate a FACT item as your own, and
  do not dismiss one — if a FACT is harmless in context, say why in an item
  or file note and let the reviewer decide.
- **Read-only.** Never comment on, approve, or change the PR, and never edit
  code. The output is two files in `.pr-review/`.

## What the tour cannot see

- **Whether the code works.** Run it; the tour does not.
- **Vulnerabilities.** It asks about missing security decisions. It is not a
  scanner — run a real one (Trivy, opengrep) in CI.
- **Noise that is not harmless.** A lockfile can carry a malicious package; a
  "formatting only" file is detected by a heuristic. Collapsed files stay one
  click away and are listed with their reason.
- **Tests outside the diff.** "No changed test shares its name" does not mean
  no test covers the file.

## For agents reading the JSON

`items[]` holds every pointer: `source` (`fact` = script, `model` =
line-checked), `severity`, `file`, `line`, `side`, `text`, `why`. `order[]` is
the reading order with a `why` per position; `files[]` holds the hunks. Start
from `severity: "high"`. `intent.status: "UNKNOWN"` means there is no spec to
review against — say so instead of guessing one. Schema:
[references/config.md](references/config.md#report-json).

## Done means

- `tour-<n>.json` passed `annotate.mjs` and `tour-<n>.html` exists.
- Every LOOK HERE item points at a real line of the diff, and every claim is
  a verbatim quote.
- The chat report names the high items and the intent status.
