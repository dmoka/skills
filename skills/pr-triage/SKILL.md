---
name: pr-triage
description: Read every open pull request in a repo, judge how much of a reviewer's attention each one needs (critical, high, medium, low) from what the change actually does, and order the queue most-attention-first — each judgement pointing at the line that drives it, each PR linked to a full reading tour. Renders one self-contained HTML queue plus JSON for agents. Use when the user asks which PR to review first, what needs attention in the PR queue, has too many open PRs, or mentions PR triage, review backlog, or review priority.
---

# PR triage

A review queue sorted by age or size sends people to the wrong PR first. A
900-line rename is harmless; a one-token change to a price is not. This skill
reads every open PR, decides how heavy each change really is, and orders the
queue so the PRs that need real attention come first. Nobody configures
anything.

It points attention; it never approves. The last PR in the queue still gets
read. Every judgement names the line that drives it, and every PR links to a
reading tour built from the same data, so a reviewer can check the judgement
in one click.

Scripts sit in `scripts/` beside this file (Node ≥ 18, zero dependencies,
`gh` logged in). If you fetched this over HTTP, fetch `scripts/*.mjs` and
the files in `references/` as raw text with `curl -sSL`.

## The loop

1. **Check the ground.** Inside a git repo with a GitHub remote, `gh auth
   status` green. Otherwise report BLOCKED with the exact failing command.
2. **Compute.** `node scripts/triage.mjs` (add `--repo owner/name` outside
   the repo). For every open PR it writes `.pr-review/tour-<n>.json` — files,
   noise, FACT items, reading order, the author's words — and it writes
   `.pr-review/triage.json` listing them. No model is involved. Rerunning
   replaces everything, judgements included, so judge after the last run.
   More than 20 open PRs: say how many, and ask before judging them all.
3. **Judge each PR on its own.** For each `tour-<n>.json`, read that PR —
   `gh pr diff <n>`, noise skimmed, surrounding code at the PR head
   (`git fetch origin <head>` then `git show FETCH_HEAD:<path>`) — and write
   `.pr-review/tour-<n>.notes.json` in the format of
   [references/notes.md](references/notes.md), **with the `attention` block**.
   Then `node scripts/annotate.mjs .pr-review/tour-<n>.json
   .pr-review/tour-<n>.notes.json` and fix the notes until it passes.
   **Use one fresh sub-agent per PR when you can**, in parallel, each given
   only its PR number, this step, and the notes reference. A judge that has
   read the other PRs grades on a curve. Without sub-agents, judge them one
   by one and judge each on its own merits.
4. **Order the queue.** Read every PR's `attention`. Write
   `.pr-review/triage.notes.json`: `{ "summary": "...", "order": [7, 6, ...] }`
   — most attention first, by level, then by your judgement within a level
   (what breaks first, what blocks others). The summary is two or three
   sentences on the queue as a whole, including conflicts between PRs.
   `node scripts/annotate.mjs .pr-review/triage.json .pr-review/triage.notes.json`
   checks every PR is placed once, judged, and never below a lower level.
5. **Render.** `node scripts/render.mjs .pr-review/triage.json` writes
   `triage.html` and every `tour-<n>.html`, linked both ways: one folder, no
   server, safe to publish as a CI artifact. Look at the queue before you
   report — in a browser if you have one (`python3 -m http.server -d
   .pr-review` when `file://` is blocked), or at least confirm the JSON.
6. **Report** in chat: the path to `triage.html`, then the queue — level,
   PR, what happened, why — critical and high in full, the rest as one line
   each.

## Hard rules

- **Judge the change, not its size, title, or author.** Read the diff before
  you judge. A title can hide a change; that is a reason for more attention.
- **No verdicts.** Attention is an order to read in. Never call a PR "safe",
  "LGTM", "fine", "ready to merge", or "nothing to review". The gate refuses
  the common phrasings; the rule covers the rest.
- **Every level above low points at a line**, with a verbatim code fragment
  the gate checks. No line, no judgement.
- **Read-only on GitHub.** Never comment, label, approve, request changes,
  assign, or merge. Outputs live in `.pr-review/`; if neither `.gitignore`
  nor `.git/info/exclude` covers it, suggest adding it.

## What the ranking cannot see

- **Whether the code works.** Nobody ran it. A judge reads; tests run.
- **Everything a reader misses.** Models catch a minority of the issues a
  careful human finds. A low level means "nothing stood out to a reader",
  never "checked".
- **Context outside the repo:** deadlines, who is waiting, what the business
  cares about this week. Say so when it would change the order.
- **Stability.** Two runs can place PRs within a level differently. The
  levels themselves should not move; if they do, the evidence line says why.

## Done means

- `triage.json` passed `annotate.mjs`, and so did every tour's notes.
- `triage.html` and one `tour-<n>.html` per open PR exist and link to each
  other.
- The chat report gives the queue with levels and reasons, most attention
  first.
- Nothing on GitHub changed.

The intent map inside each tour, its search order for the author's intent,
and the fresh-session rule are adapted from Matt Pocock's
[`code-review`](https://github.com/mattpocock/skills) skill (MIT).
