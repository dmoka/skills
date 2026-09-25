#!/usr/bin/env node
// Layer 1 for the whole open PR queue: builds a tour-<n>.json for every open
// PR (files, noise, FACT items, reading order, the author's words) and a
// triage.json that lists them. Deterministic, no model involved. The model
// then judges each PR's attention level and orders the queue; annotate.mjs
// checks both.
//
//   node triage.mjs [--repo owner/name] [--out dir] [--limit 100] [--config path]
//
// Writes <out>/triage.json and <out>/tour-<n>.json (default out: .pr-review).
// Rerunning replaces them, model notes included — judge after the last run.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION, CONFIG_PATH, ghJson, resolveRepo, parseArgs, loadConfig } from "./lib.mjs";
import { buildTour, writeReport, summarize } from "./build.mjs";

const args = parseArgs(process.argv.slice(2));
const configPath = args.config ?? CONFIG_PATH;
const cfg = loadConfig(configPath); // optional
const repo = resolveRepo(args.repo);
const outDir = args.out ?? ".pr-review";
const now = Date.now();

const open = ghJson(["pr", "list", "--state", "open", "--limit", String(args.limit ?? 100), "--json", "number,createdAt,labels"], { repo });
if (!open.length) { console.log(`${repo} has no open pull requests.`); process.exit(0); }

// A rerun replaces the queue: pages and reports of PRs that are no longer open go.
const openSet = new Set(open.map((p) => p.number));
if (existsSync(outDir)) {
  for (const f of readdirSync(outDir)) {
    const m = f.match(/^tour-(\d+)\.(json|html|notes\.json)$/);
    if (m && !openSet.has(Number(m[1]))) rmSync(join(outDir, f));
  }
}

const prs = [];
const touches = new Map(); // path -> PR numbers, to find PRs that collide
for (const { number, createdAt, labels } of open.sort((a, b) => a.number - b.number)) {
  let report;
  try { report = buildTour({ number, repo }, cfg, configPath); }
  catch (e) { console.error(`  #${number}: ${e.message}`); continue; }
  writeReport(outDir, `tour-${number}.json`, report);
  for (const f of report.files) for (const p of new Set([f.path, f.oldPath].filter(Boolean))) touches.set(p, [...(touches.get(p) ?? []), number]);
  const s = summarize(report);
  prs.push({
    number,
    title: report.pr.title,
    url: report.pr.url,
    author: report.pr.author,
    draft: report.pr.draft,
    labels: (labels ?? []).map((l) => l.name),
    ageDays: Math.floor((now - Date.parse(createdAt)) / 86400000),
    createdAt,
    additions: report.pr.additions,
    deletions: report.pr.deletions,
    filesChanged: report.files.length,
    readLines: s.readLines,
    noiseLines: s.noiseLines,
    noiseFiles: s.noiseFiles,
    intent: report.intent.status,
    highFacts: s.highFacts.map((f) => ({ file: f.file, line: f.line, side: f.side, text: f.text })),
    tour: `tour-${number}.json`,
    attention: null, // copied from the tour's annotated attention by annotate.mjs
    rank: null,      // set by annotate.mjs from the model's order
  });
  console.log(`#${String(number).padEnd(4)} ${report.pr.title.slice(0, 56).padEnd(56)} read ${String(s.readLines).padStart(5)} · noise ${String(s.noiseLines).padStart(5)} · ${s.highFacts.length} high facts · intent ${report.intent.status}`);
}

const file = writeReport(outDir, "triage.json", {
  kind: "triage",
  schemaVersion: SCHEMA_VERSION,
  generatedAt: new Date(now).toISOString(),
  repo,
  config: { path: cfg ? configPath : null },
  ranking: "the model read every PR and judged how much attention it needs; each judgement points at the line that drives it",
  summary: null,
  // Files two or more open PRs change: merge order matters, and one may break the other.
  overlaps: [...touches].filter(([, n]) => n.length > 1).map(([file, prs]) => ({ file, prs })).sort((a, b) => b.prs.length - a.prs.length || a.file.localeCompare(b.file)),
  prs,
});
console.log(file);
// Render right away, so the pages never lag behind the JSON.
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "render.mjs"), file], { stdio: "inherit" });
console.log(`Next: judge each tour-<n>.json (attention + notes), then order the queue.`);
