#!/usr/bin/env node
// The only door through which model-written text enters a report. It checks
// every claim against the deterministic facts and refuses what it cannot check.
// Source of truth: shared/annotate.mjs in github.com/dmoka/skills.
//
//   node annotate.mjs <report.json> <notes.json>
//
// Triage notes: { "summary": "...", "prs": { "<number>": "one sentence" } }
// Tour notes:   { "whatItDoes": "...",
//                 "claims": [{ "quote": "<verbatim from the PR text>", "file": "...", "line": 12, "code": "<fragment of that line>", "note": "..." }],
//                 "items":  [{ "severity": "high|medium|low", "file": "...", "line": 12, "code": "<fragment of that line>", "side": "new|old",
//                              "title": "...", "why": "..." }],
//                 "explains": [{ "quote": "<verbatim author words>", "files": ["<path>", ...] }],
//                 "fileNotes": { "<path>": "..." } }
// Exit 1 with a list of every problem; nothing is written unless all notes pass.

import { readFileSync, writeFileSync } from "node:fs";
import { readingOrder, stemOf } from "./lib.mjs";

const [reportPath, notesPath] = process.argv.slice(2);
if (!reportPath || !notesPath) { console.error("usage: annotate.mjs <report.json> <notes.json>"); process.exit(1); }
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const notes = JSON.parse(readFileSync(notesPath, "utf8"));
const errors = [];

// What these reports must never say. They point attention; they do not judge.
const VERDICT = /\b(LGTM|looks good|looks (?:safe|fine|correct|harmless)|(?:is|are|seems|seem) (?:safe|fine|harmless)|safe to merge|ready to merge|approve[ds]?|good to go|ship it|no issues|nothing to worry|exploitable|is secure|verified safe)\b/i;
function checkText(where, text, { required = false, max = 600 } = {}) {
  if (text == null || text === "") { if (required) errors.push(`${where}: missing`); return; }
  if (typeof text !== "string") { errors.push(`${where}: must be a string`); return; }
  if (text.length > max) errors.push(`${where}: ${text.length} chars, max ${max} — say less`);
  const v = text.match(VERDICT);
  if (v) errors.push(`${where}: contains "${v[0]}" — this report points attention, it never gives a verdict`);
}

if (report.kind === "triage") {
  const numbers = new Set(report.prs.map((p) => String(p.number)));
  checkText("summary", notes.summary, { max: 800 });
  for (const [n, text] of Object.entries(notes.prs ?? {})) {
    if (!numbers.has(n)) errors.push(`prs.${n}: no open PR #${n} in this report`);
    checkText(`prs.${n}`, text, { required: true, max: 300 });
  }
  if (!errors.length) {
    report.summary = notes.summary ?? null;
    for (const p of report.prs) p.explanation = notes.prs?.[String(p.number)] ?? null;
  }
} else if (report.kind === "tour") {
  const files = new Map(report.files.map((f) => [f.path, f]));
  // A pointer is a file, a line, and a fragment of the code on that line. The
  // fragment catches the off-by-one that a bare line number cannot: in a new
  // file every line number is "in the diff".
  const ws = (s) => String(s).replace(/\s+/g, " ").trim();
  const lineIn = (path, line, side, code) => {
    const f = files.get(path);
    if (!f) return `file "${path}" is not in this diff`;
    if (line == null) return null;
    const key = side === "old" ? "o" : "n";
    const hit = f.hunks.flatMap((h) => h.lines).find((l) => l[key] === line && (side === "old" ? l.t !== "add" : l.t !== "del"));
    if (!hit) return `${path}:${line} is not an ${side === "old" ? "old-side (removed or context)" : "new-side (added or context)"} line of this diff`;
    if (!code || ws(code).length < 3) return `${path}:${line}: add "code" — a verbatim fragment (3+ chars) of that line, so the pointer can be checked`;
    if (!ws(hit.s).includes(ws(code))) return `${path}:${line} does not contain "${ws(code).slice(0, 50)}" — that line is: ${ws(hit.s).slice(0, 90)}`;
    return null;
  };
  // Verbatim means verbatim: only whitespace is normalised, case is not.
  const norm = (s) => ws(s);
  const quoteOk = (q) => ws(q).length >= 4 && intentText.includes(norm(q));
  const intentText = norm(report.intent.sources.map((s) => s.text).join("\n"));

  checkText("whatItDoes", notes.whatItDoes, { required: true, max: 600 });
  for (const [i, c] of (notes.claims ?? []).entries()) {
    if (!c.quote) { errors.push(`claims[${i}]: missing "quote"`); continue; }
    if (!quoteOk(c.quote)) errors.push(`claims[${i}]: "${c.quote.slice(0, 60)}" is not a verbatim quote (4+ chars, exact case) from the author's text`);
    if (c.file) { const e = lineIn(c.file, c.line, c.side, c.code); if (e) errors.push(`claims[${i}]: ${e}`); }
    checkText(`claims[${i}].note`, c.note, { max: 400 });
  }
  if (report.intent.status === "UNKNOWN" && (notes.claims ?? []).length) errors.push("claims: the PR states no intent, so there is nothing to quote — leave claims empty");

  // Intent map: which of the author's words explain which files.
  const needsReason = new Set(report.files.filter((f) => f.kind !== "noise").map((f) => f.path));
  for (const [i, e] of (notes.explains ?? []).entries()) {
    if (!e.quote) { errors.push(`explains[${i}]: missing "quote"`); continue; }
    if (!quoteOk(e.quote)) errors.push(`explains[${i}]: "${e.quote.slice(0, 60)}" is not a verbatim quote (4+ chars, exact case) from the author's text`);
    if (!Array.isArray(e.files)) { errors.push(`explains[${i}]: "files" must be an array (empty = stated but not in this diff)`); continue; }
    for (const p of e.files) {
      if (!files.has(p)) errors.push(`explains[${i}]: "${p}" is not in this diff`);
      else if (!needsReason.has(p)) errors.push(`explains[${i}]: "${p}" is noise — noise needs no explanation, leave it out`);
    }
  }
  if (report.intent.status !== "UNKNOWN" && !(notes.explains ?? []).length) errors.push('explains: the author stated an intent, so map it — one entry per thing they say the PR does; use "files": [] for a quote with no matching change');
  if ((notes.items ?? []).length > 8) errors.push(`items: ${notes.items.length} LOOK HERE items, max 8 — keep the ones a reader must not miss`);
  for (const [i, it] of (notes.items ?? []).entries()) {
    if (!["high", "medium", "low"].includes(it.severity)) errors.push(`items[${i}]: severity must be high, medium or low`);
    if (!it.file) errors.push(`items[${i}]: every LOOK HERE item needs a "file"`);
    else if (it.line == null) errors.push(`items[${i}]: every LOOK HERE item needs a "line" — point at the exact place`);
    else { const e = lineIn(it.file, it.line, it.side, it.code); if (e) errors.push(`items[${i}]: ${e}`); }
    checkText(`items[${i}].title`, it.title, { required: true, max: 140 });
    checkText(`items[${i}].why`, it.why, { required: true, max: 500 });
  }
  for (const [path, text] of Object.entries(notes.fileNotes ?? {})) {
    if (!files.has(path)) errors.push(`fileNotes: "${path}" is not in this diff`);
    checkText(`fileNotes[${path}]`, text, { max: 300 });
  }

  if (!errors.length) {
    report.whatItDoes = notes.whatItDoes;
    report.claims = notes.claims ?? [];
    report.items = [
      ...report.items.filter((x) => x.source === "fact"),
      ...(notes.items ?? []).map((it) => ({ source: "model", kind: "look-here", severity: it.severity, file: it.file, line: it.line, side: it.side ?? "new", text: it.title, why: it.why })),
    ];
    report.fileNotes = notes.fileNotes ?? {};
    report.explains = (notes.explains ?? []).map((e) => ({ quote: e.quote, files: e.files }));
    // Derived, not written by the model: a test counts as explained when the
    // code it pairs with is explained.
    const explained = new Set(report.explains.flatMap((e) => e.files));
    const pairs = new Map();
    for (const f of report.files) if (f.kind === "test") {
      const src = report.files.find((c) => c.kind !== "test" && c.kind !== "noise" && stemOf(c.path) === stemOf(f.path));
      if (src) pairs.set(f.path, src.path);
    }
    report.unexplained = [...needsReason].filter((p) => !explained.has(p) && !(pairs.has(p) && explained.has(pairs.get(p))));
    report.unmatched = report.explains.filter((e) => !e.files.length).map((e) => e.quote);
    const areaOf = new Map(report.files.map((f) => [f.path, f.areas]));
    for (const p of report.unexplained) {
      report.items.push({ source: "map", kind: "unexplained", severity: areaOf.get(p)?.length ? "high" : "medium", file: p, line: null,
        text: report.intent.status === "UNKNOWN" ? "No stated intent covers this change — ask the author why it is here." : "Nothing the author wrote explains this change — ask why it is here." });
    }
    const asFiles = report.files.map((f) => ({ path: f.path, meta: { kind: f.kind, noise: f.noise, stem: stemOf(f.path) } }));
    const cfg = report.config?.readingOrder ? { tour: { readingOrder: report.config.readingOrder } } : null;
    report.order = readingOrder(asFiles, report.items, cfg);
  }
} else {
  errors.push(`unknown report kind "${report.kind}"`);
}

if (errors.length) {
  console.error(`annotate: ${errors.length} problem(s), nothing written:\n` + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`annotated ${reportPath}`);
