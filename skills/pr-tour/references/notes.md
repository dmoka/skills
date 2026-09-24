# Writing `tour-<n>.notes.json`

The notes are the only place the model writes. `annotate.mjs` checks every
field against the diff and the author's text, and refuses the whole file on
any error — fix the notes and run it again (re-running on an annotated report
is safe; it replaces the previous notes).

## Shape

```json
{
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
- List **code files only**. A test inherits the explanation of the code it
  tests; list a test only when it has no changed code file to pair with.
- Map a file only when the quote explains *its change*, not its folder.
- A quote with no matching change: `"files": []`.
- A file nothing explains: leave it out. The gate lists it as ASK WHY.

## Claims

A claim is a **checkable promise**: "no behaviour change for X", "idempotent",
"only formatting", "backwards compatible", "no new dependencies". Descriptive
text ("adds gift cards") is intent-map material, not a claim — do not repeat
it here. Point each claim at the line where a reader can test it.

## Items (LOOK HERE), at most 8

| Severity | Use for |
|---|---|
| **high** | can change money, permissions, stored data, or who gets a scarce thing (seats, stock, quota); or contradicts a stated claim |
| **medium** | a behaviour change nobody mentioned, or one worth a test |
| **low** | worth a glance: cost, naming, a missing edge case with small impact |

Look for: a claim the code contradicts; a risky decision nobody mentioned; a
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
