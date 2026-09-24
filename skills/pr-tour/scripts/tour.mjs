#!/usr/bin/env node
// Computes the facts and the reading order for ONE pull request.
// Deterministic: no model involved. The model adds the WHY afterwards
// through annotate.mjs, which checks every claim it makes against this file.
//
//   node tour.mjs <pr-number> [--repo owner/name] [--config path] [--out dir]
//   node tour.mjs --diff-file changes.diff [--title "..."] [--body-file notes.md]
//
// Writes <out>/tour-<n>.json (default out: .pr-review).

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA_VERSION, CONFIG_PATH, gh, ghJson, resolveRepo, parseArgs, loadConfig, parseDiff, classify, computeFacts, readingOrder, DEFAULT_READING_ORDER } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const configPath = args.config ?? CONFIG_PATH;
const cfg = loadConfig(configPath); // optional: without it, built-in defaults apply
const outDir = args.out ?? ".pr-review";

let pr;
let diffText;
let repo = null;
if (args["diff-file"]) {
  diffText = readFileSync(args["diff-file"], "utf8");
  pr = {
    number: "local",
    title: args.title ?? "(local diff)",
    body: args["body-file"] ? readFileSync(args["body-file"], "utf8") : "",
    author: null, url: null, baseRefName: null, headRefName: null, createdAt: null, isDraft: false,
    closingIssuesReferences: [], additions: null, deletions: null,
  };
} else {
  const number = args._[0];
  if (!number) { console.error("usage: tour.mjs <pr-number> [--repo owner/name]"); process.exit(1); }
  repo = resolveRepo(args.repo);
  pr = ghJson(["pr", "view", String(number), "--json", "number,title,body,author,url,baseRefName,headRefName,createdAt,isDraft,additions,deletions,closingIssuesReferences,labels"], { repo });
  diffText = gh(["pr", "diff", String(number)], { repo });
}

// The author's intent, in the author's words only. Never paraphrased here.
const intentSources = [];
if (pr.body && pr.body.trim()) intentSources.push({ source: "PR description", text: pr.body.trim() });
for (const issue of pr.closingIssuesReferences ?? []) {
  try {
    const i = ghJson(["issue", "view", String(issue.number), "--json", "number,title,body"], { repo });
    intentSources.push({ source: `issue #${i.number}: ${i.title}`, text: (i.body || "").trim() || "(empty issue body)" });
  } catch { intentSources.push({ source: `issue #${issue.number}`, text: "(could not read the issue)" }); }
}

const files = parseDiff(diffText);
for (const f of files) f.meta = classify(f, cfg);
const facts = computeFacts(files, cfg);
const order = readingOrder(files, facts, cfg);

const out = {
  kind: "tour",
  schemaVersion: SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  repo,
  config: {
    path: cfg ? configPath : null,
    note: cfg ? undefined : "no config — built-in defaults for tests, noise and reading order",
    readingOrder: cfg?.tour?.readingOrder ?? DEFAULT_READING_ORDER,
  },
  pr: {
    number: pr.number, title: pr.title, url: pr.url, author: pr.author?.login ?? null, draft: !!pr.isDraft,
    base: pr.baseRefName, head: pr.headRefName, createdAt: pr.createdAt,
    additions: files.reduce((s, f) => s + f.additions, 0), deletions: files.reduce((s, f) => s + f.deletions, 0),
    filesChanged: files.length,
  },
  intent: {
    status: intentSources.length ? "stated" : "UNKNOWN",
    sources: intentSources,
  },
  // Filled by the model through annotate.mjs:
  whatItDoes: null, // the model's reading of the diff — labelled as such, never as the author's intent
  claims: [],       // contract claims the author makes, quoted, each with where it can be checked
  items: facts,     // FACT items now; LOOK HERE items get appended by annotate.mjs
  fileNotes: {},
  order,
  orderRule: "hotspots (any high-severity item) first, then by layer; each test right after the code it tests; tests with no changed source next; noise collapsed last",
  files: files.map((f) => ({
    path: f.path, oldPath: f.oldPath, status: f.status, similarity: f.similarity, binary: f.binary,
    additions: f.additions, deletions: f.deletions,
    kind: f.meta.kind, noise: f.meta.noise, areas: f.meta.areas,
    hunks: f.hunks,
  })),
};

mkdirSync(outDir, { recursive: true });
const file = join(outDir, `tour-${pr.number}.json`);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(file);
console.log(`intent: ${out.intent.status} · ${files.length} files (${files.filter((f) => f.meta.noise).length} noise) · ${facts.length} facts (${facts.filter((f) => f.severity === "high").length} high)`);
for (const f of facts.filter((x) => x.severity !== "low")) console.log(`  ${f.severity.padEnd(6)} ${f.file}${f.line ? ":" + f.line : ""}  ${f.text}`);
