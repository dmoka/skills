#!/usr/bin/env node
// Ranks the open PR queue by the rules in .github/pr-review.jsonc.
// Deterministic: same PRs + same config = same ranking. No model involved.
//
//   node triage.mjs [--repo owner/name] [--config path] [--out dir] [--limit 100]
//
// Writes <out>/triage.json (default out: .pr-review). Exit 2 = no config.

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { SCHEMA_VERSION, CONFIG_PATH, gh, ghJson, resolveRepo, parseArgs, loadConfig, parseDiff, classifyAll, prFacts, evalRule } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const configPath = args.config ?? CONFIG_PATH;
const cfg = loadConfig(configPath);
if (!cfg) {
  console.error(`No config at ${configPath}. Write one first (see references/config.md), then rerun.`);
  process.exit(2);
}
const rules = cfg.triage.rules ?? [];
if (rules.length === 0) {
  console.error(`${configPath} has no "triage.rules". Without rules there is no ranking, only a list.`);
  process.exit(2);
}

const repo = resolveRepo(args.repo);
const outDir = args.out ?? ".pr-review";
const limit = String(args.limit ?? 100);
const now = Date.now();

const prs = ghJson([
  "pr", "list", "--state", "open", "--limit", limit,
  "--json", "number,title,author,createdAt,isDraft,labels,additions,deletions,changedFiles,url,headRefName,baseRefName,reviewDecision",
], { repo });

const ranked = [];
for (const pr of prs) {
  process.stderr.write(`  #${pr.number} ${pr.title.slice(0, 60)}\n`);
  const files = parseDiff(gh(["pr", "diff", String(pr.number)], { repo }));
  classifyAll(files, cfg);
  const facts = prFacts(pr, files, cfg, now);
  const matched = [];
  for (const rule of rules) {
    const evidence = evalRule(rule, facts, cfg);
    if (evidence) matched.push({ id: rule.id, points: rule.points, why: rule.why ?? rule.id, evidence });
  }
  ranked.push({
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: facts.author,
    draft: facts.draft,
    labels: facts.labels,
    reviewDecision: pr.reviewDecision || null,
    ageDays: facts.ageDays,
    createdAt: pr.createdAt,
    additions: pr.additions,
    deletions: pr.deletions,
    filesChanged: facts.filesChanged,
    noiseFiles: facts.noiseFiles,
    areas: facts.areas,
    score: matched.reduce((s, m) => s + m.points, 0),
    matched,
    facts: facts.facts.filter((f) => f.severity === "high").slice(0, 5),
    explanation: null,
  });
}

// Highest score first; ties go to the PR that has waited longest.
ranked.sort((a, b) => b.score - a.score || Date.parse(a.createdAt) - Date.parse(b.createdAt));
ranked.forEach((p, i) => (p.rank = i + 1));

const configText = readFileSync(configPath, "utf8");
const out = {
  kind: "triage",
  schemaVersion: SCHEMA_VERSION,
  generatedAt: new Date(now).toISOString(),
  repo,
  config: {
    path: configPath,
    sha256: createHash("sha256").update(configText).digest("hex").slice(0, 12),
    rules: rules.map((r) => ({ id: r.id, points: r.points, why: r.why ?? r.id, when: r.when, matchedPRs: ranked.filter((p) => p.matched.some((m) => m.id === r.id)).map((p) => p.number) })),
    areas: cfg.areas,
  },
  scoring: "score = sum of points of every rule whose conditions ALL hold; ties: oldest PR first",
  prs: ranked,
  summary: null,
};

mkdirSync(outDir, { recursive: true });
const file = join(outDir, "triage.json");
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(file);
for (const p of ranked) {
  console.log(`${String(p.rank).padStart(2)}. ${String(p.score).padStart(4)}  #${p.number} ${p.title}  [${p.matched.map((m) => `${m.id} ${m.points > 0 ? "+" : ""}${m.points}`).join(", ") || "no rule matched"}]`);
}
