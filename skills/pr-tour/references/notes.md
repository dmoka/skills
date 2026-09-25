# Writing `tour-<n>.notes.json`

The notes are the only place the model writes. `annotate.mjs` checks every
field against the diff and the author's text, and refuses the whole file on
any error — fix the notes and run it again (re-running on an annotated report
is safe; it replaces the previous notes).

## Shape

```json
{
  "attention": {
    "level": "high",
    "whatHappened": "Product prices are now cached for five minutes, and checkout reads the cache.",
    "why": "Customers can be charged a stale price; the PR says checkout always uses the live price.",
    "file": "src/cart/checkout.ts", "line": 41, "code": "getPrice(item.sku)"
  },
  "whatItDoes": "Two or three sentences: what the diff actually does.",
  "explains": [
    { "quote": "Cache product prices for five minutes", "files": ["src/catalog/prices.ts"] }
  ],
  "claims": [
    { "quote": "Checkout always charges the live price.",
      "file": "src/cart/checkout.ts", "line": 41,
      "code": "getPrice(item.sku)",
      "note": "Checkout now calls the cached getPrice. Check which price a cart pays after a price change." }
  ],
  "items": [
    { "severity": "high", "file": "src/cart/checkout.ts", "line": 41,
      "code": "getPrice(item.sku)",
      "title": "Checkout may charge a price up to five minutes old",
      "why": "getPrice is the cached function from prices.ts. The PR says checkout uses the live price." }
  ],
  "fileNotes": { "src/cart/checkout.ts": "One call changed; it decides what the customer pays." }
}
```

## Attention (how much of a reviewer's attention this PR needs)

Judge the change after you have read it, not from its title or size.

| Level | Use when |
|---|---|
| **critical** | on a path that runs today, it will very likely break money, access, or stored data — or it destroys data that cannot be restored (a dropped column, a deleting migration) |
| **high** | it can change money, access, stored data, or who gets a scarce thing; or it contradicts what the author says; or it hides a change (a skipped test that covers it, an unstated change of behaviour) |
| **medium** | a real behaviour change a reader should understand, with a contained impact; or a high-level risk in code nothing calls yet |
| **low** | mechanical or contained: renames, formatting, tests only, dependency bumps with nothing notable |

- **Code nothing calls yet** is judged one level lower than it would be when
  wired, and the `why` says what happens once it is.
- **A draft is judged like any PR.** Say it is a draft in `why`; do not lower
  the level for it.
- **Notable in a dependency bump:** a major version change (direct or in the
  lockfile), a raised `engines` floor, a new package, a new install script.

- `whatHappened`: one sentence, plain words, what the PR really does.
- `why`: one sentence, why it deserves this level. Name the risk, not a verdict.
- `file` / `line` / `code`: the one line that drives the judgement. Required for
  everything above **low**, allowed on low.
- Big is not heavy. A 900-line rename is **low**; a one-token change to a price
  is **critical**.

## Reading the diff

Read it as a diff — `gh pr diff <n>` or `git diff <base>...<head>` — in the
reading order from the JSON. The JSON's `files[].hunks[].lines[]` holds the
same lines as objects (`t` add/del/ctx, `s` text, `n` new line number, `o` old
line number); use it to look up a line number, not to read.

**Skim the noise, do not skip it.** Collapsed files are hidden from the human,
not from you. A lockfile can carry the real change (a transitive major bump,
a new install script). Items may point at noise files.

## Pointers: `line` + `code`

`line` is the **new-file** line number (`n`). For a removed line set
`"side": "old"` and use the old number (`o`). `code` is a verbatim fragment of
that line, 3+ characters; the gate checks the line contains it, which catches
the off-by-one a bare number cannot. Get both from the JSON, or from
`git show <head>:<file> | sed -n '<line>p'`.

## The intent map (`explains`)

Split the author's words into the things they say the PR does. Each `quote`
is verbatim (exact case, 4+ characters) from any intent source — title,
description, issue, commit, spec.

- Title "Gift cards: issue, redeem at checkout, expire after a year" → four
  entries: the part before the colon, and each listed action.
- Quotes may span a line break in the source; whitespace is normalised.
- Use the most specific words. When the description says it better than the
  title, map the description and let the title map to nothing — an unmatched
  title is fine.
- List **code files only**. A test inherits the explanation of the code it
  tests; list a test only when it has no changed code file to pair with.
  Noise never needs a reason; you may map it, and it never shows as ASK WHY.
- Map a file only when the quote explains **all of its change**. When a file
  does the stated thing *and* something unstated (a migration that adds the
  described column and drops another), leave it out so it shows as ASK WHY,
  and point an item at the unstated part.
- A PR whose every file is noise needs no intent map.
- A file with a small unstated extra (one added attribute) is still ASK WHY —
  that is honest; say it is small in its file note.
- A sentence that only describes tests maps to the test file.
- Quotes are verbatim: backticks, if the author wrote them, are part of it.
- A quote with no matching change: `"files": []`.
- A file nothing explains: leave it out. The gate lists it as ASK WHY.

## Claims

A claim is a **checkable promise** — a sentence that could turn out false:
"no behaviour change for X", "idempotent", "only formatting", "seats stay
sold", "the UI comes in a follow-up", "no new dependencies" — and a title
that promises an outcome ("Speed up booking tests"). Descriptive text
("adds gift cards") is intent-map material, not a claim. Point each claim at
the line where a reader can test it (`side: "old"` works here too); a claim
with no single line gets no `file`. No claims is a valid answer. When the
code contradicts a claim, also add a high item at that line.

## Items (LOOK HERE), at most 8 of yours

The eight counts only your items; FACT and ASK WHY items come on top. Do not
restate a FACT. To add what a FACT cannot know — the consequence — point
your item at where the consequence lands (the caller that loses the dropped
column), or at the same line with the connection in `why` ("the skipped test
is the one this change breaks").


| Severity | Use for |
|---|---|
| **high** | can change money, permissions, stored data, or who gets a scarce thing (seats, stock, quota); or contradicts a stated claim |
| **medium** | a behaviour change nobody mentioned, or one worth a test |
| **low** | worth a glance: cost, naming, a missing edge case with small impact |

Items may point at context lines as well as changed ones. Look for: a claim
the code contradicts; a risky decision nobody mentioned; a
missing security decision (a new input with no validation, a new action with
no authorization check, a secret reaching a log); an edge case the tests skip;
a code comment that promises something the code does not do (comments are not
intent, so they are items, never claims).

Phrase each as what to check. Skip what the typecheck, linter or CI already
catch.

**Dependency-only PRs:** CI runs the tests, so point at what CI does not
decide — transitive major bumps in the lockfile, changed `engines`, new
install scripts, packages that changed owner, a tool whose output (coverage,
mutation score) can shift silently.
