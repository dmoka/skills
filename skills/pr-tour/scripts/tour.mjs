#!/usr/bin/env node
// Computes the facts and the reading order for ONE pull request.
// Deterministic: no model involved. The model adds the WHY afterwards
// through annotate.mjs, which checks every claim it makes against this file.
//
//   node tour.mjs <pr-number> [--repo owner/name] [--config path] [--out dir]
//   node tour.mjs --git main...feat/x [--title "..."] [--spec docs/specs/x.md]   (before a PR exists)
//   node tour.mjs --diff-file changes.diff [--title "..."] [--body-file notes.md] [--branch feat/x]
//
// Writes <out>/tour-<n>.json (default out: .pr-review).

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { SCHEMA_VERSION, CONFIG_PATH, gh, ghJson, resolveRepo, parseArgs, loadConfig, parseDiff, classifyAll, computeFacts, readingOrder, DEFAULT_READING_ORDER, isInformative, issueRefs, branchSlug, intentStatus, INTENT_RANK } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const configPath = args.config ?? CONFIG_PATH;
const cfg = loadConfig(configPath); // optional: without it, built-in defaults apply
const outDir = args.out ?? ".pr-review";

let pr;
let diffText;
let repo = null;
let commits = []; // [{ subject, body }]
if (args["diff-file"] || args.git) {
  // Local mode: review a branch before a PR exists, or a saved diff.
  const range = args.git; // "main...feat/x"
  diffText = range ? git(["diff", range]) : readFileSync(args["diff-file"], "utf8");
  if (range) {
    const [base, head] = range.split(/\.{2,3}/);
    commits = git(["log", `${base}..${head}`, "--format=%s%x1f%b%x1e"]).split("\x1e").map((c) => c.trim()).filter(Boolean)
      .map((c) => { const [subject, body = ""] = c.split("\x1f"); return { subject: subject.trim(), body: body.trim() }; });
  }
  pr = {
    number: args.number ?? "local",
    title: args.title ?? "",
    body: args["body-file"] ? readFileSync(args["body-file"], "utf8") : "",
    author: null, url: null, baseRefName: range ? range.split(/\.{2,3}/)[0] : null, headRefName: range ? range.split(/\.{2,3}/)[1] : args.branch ?? null,
    createdAt: null, isDraft: false, closingIssuesReferences: [],
  };
} else {
  const number = args._[0];
  if (!number) { console.error("usage: tour.mjs <pr-number> [--repo owner/name] | --git base...head | --diff-file x.diff"); process.exit(1); }
  repo = resolveRepo(args.repo);
  pr = ghJson(["pr", "view", String(number), "--json", "number,title,body,author,url,baseRefName,headRefName,createdAt,isDraft,closingIssuesReferences,commits"], { repo });
  commits = (pr.commits ?? []).map((c) => ({ subject: (c.messageHeadline || "").trim(), body: (c.messageBody || "").trim() }));
  diffText = gh(["pr", "diff", String(number)], { repo });
}

function git(a) {
  try { return execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }); }
  catch (e) { console.error(`git ${a.join(" ")} failed: ${(e.stderr || e.message).toString().trim()}`); process.exit(1); }
}

// The author's intent, in the author's words only, strongest source first.
const intentSources = [];
const add = (type, source, text) => { if (text && text.trim()) intentSources.push({ type, source, text: text.trim().slice(0, 20000) }); };

// 1. A spec or review contract: --spec <path>, else a markdown file in a spec
//    folder whose name contains the branch name.
const specPaths = [].concat(args.spec ?? []);
const slug = branchSlug(pr.headRefName);
if (!specPaths.length && slug.length >= 4) {
  for (const dir of cfg?.tour?.specDirs ?? ["docs", "specs", ".scratch", "contracts"]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir, { recursive: true })) {
      const name = String(f).toLowerCase();
      if (name.endsWith(".md") && name.split("/").pop().includes(slug)) specPaths.push(join(dir, String(f)));
    }
  }
}
for (const p of specPaths.slice(0, 3)) add("spec", `spec: ${p}`, readFileSync(p, "utf8"));

// 2. The PR description and every issue it or its commits point at.
add("description", "PR description", pr.body);
const issues = new Set((pr.closingIssuesReferences ?? []).map((i) => i.number));
for (const c of commits) for (const n of issueRefs(`${c.subject}\n${c.body}`)) issues.add(n);
for (const n of issues) {
  if (!repo) break;
  try {
    const i = ghJson(["issue", "view", String(n), "--json", "number,title,body"], { repo });
    add("issue", `issue #${i.number}: ${i.title}`, `${i.title}\n\n${i.body || ""}`);
  } catch { /* a PR number or an unreadable issue: skip, the commit text still counts */ }
}

// 3. Commit messages, when they say more than the title.
const commitText = commits.map((c) => (c.body ? `${c.subject}\n${c.body}` : c.subject)).filter((t) => t && t !== pr.title).join("\n\n");
if (commits.some((c) => isInformative(c.subject) || c.body)) add("commits", `${commits.length} commit message${commits.length === 1 ? "" : "s"}`, commitText);

// 4. The title — always there, rarely enough.
add("title", "PR title", pr.title);

intentSources.sort((a, b) => INTENT_RANK[b.type] - INTENT_RANK[a.type]);

const files = parseDiff(diffText);
if (!files.length) { console.error("The diff is empty — nothing to tour. Check the PR number or the range."); process.exit(1); }
classifyAll(files, cfg);
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
    number: pr.number, title: pr.title || commits[0]?.subject || "(local diff)", url: pr.url, author: pr.author?.login ?? null, draft: !!pr.isDraft,
    base: pr.baseRefName, head: pr.headRefName, createdAt: pr.createdAt,
    additions: files.reduce((s, f) => s + f.additions, 0), deletions: files.reduce((s, f) => s + f.deletions, 0),
    filesChanged: files.length,
  },
  intent: {
    status: intentStatus(intentSources),
    sources: intentSources,
  },
  explains: [],     // intent map: [{ quote, files }] — filled through annotate.mjs
  unexplained: [],  // non-noise files no quote explains — computed by annotate.mjs
  unmatched: [],    // quotes no file implements — computed by annotate.mjs
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
console.log(`intent: ${out.intent.status} (${intentSources.map((x) => x.type).join(", ") || "none"}) · ${files.length} files (${files.filter((f) => f.meta.noise).length} noise) · ${facts.length} facts (${facts.filter((f) => f.severity === "high").length} high)`);
for (const f of facts.filter((x) => x.severity !== "low")) console.log(`  ${f.severity.padEnd(6)} ${f.file}${f.line ? ":" + f.line : ""}  ${f.text}`);
