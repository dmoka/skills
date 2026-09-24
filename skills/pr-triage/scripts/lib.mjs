// Shared by pr-triage and pr-tour. Source of truth: shared/lib.mjs in
// github.com/dmoka/skills — each skill folder carries an identical copy so it
// installs with one `cp -r`. Zero dependencies; Node >= 18.
//
// Everything in this file is deterministic. It turns `gh` output into facts.
// The model never computes a fact; it only explains them.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export const SCHEMA_VERSION = 1;

// ---------- gh ----------

export function gh(args, { repo } = {}) {
  const full = repo ? [...args, "--repo", repo] : args;
  try {
    return execFileSync("gh", full, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  } catch (err) {
    const msg = (err.stderr || err.message || "").toString().trim();
    throw new Error(`gh ${full.join(" ")} failed: ${msg}`);
  }
}

export function ghJson(args, opts) {
  return JSON.parse(gh(args, opts));
}

export function resolveRepo(repo) {
  if (repo) return repo;
  return ghJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
}

// ---------- args ----------

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

// ---------- JSONC ----------

// Strips // and /* */ comments outside strings, then trailing commas.
export function parseJsonc(text) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") { out += n ?? ""; i++; }
      else if (c === '"') inStr = false;
    } else if (c === '"') { inStr = true; out += c; }
    else if (c === "/" && n === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; }
    else if (c === "/" && n === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i++; }
    else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

// ---------- config ----------

export const CONFIG_PATH = ".github/pr-review.jsonc";

export function loadConfig(path = CONFIG_PATH) {
  if (!existsSync(path)) return null;
  const cfg = parseJsonc(readFileSync(path, "utf8"));
  if (cfg.version !== 1) throw new Error(`${path}: unsupported "version" ${cfg.version} (expected 1)`);
  cfg.areas ??= {};
  cfg.tests ??= [];
  cfg.noise ??= [];
  cfg.triage ??= { rules: [] };
  cfg.tour ??= {};
  for (const r of cfg.triage.rules ?? []) {
    if (!r.id || typeof r.points !== "number" || !r.when) {
      throw new Error(`${path}: every triage rule needs "id", numeric "points" and "when" — got ${JSON.stringify(r)}`);
    }
    for (const k of Object.keys(r.when)) {
      if (!CONDITIONS.includes(k)) throw new Error(`${path}: rule "${r.id}" uses unknown condition "${k}". Known: ${CONDITIONS.join(", ")}`);
    }
    for (const a of r.when.areas ?? []) {
      if (!cfg.areas[a]) throw new Error(`${path}: rule "${r.id}" names area "${a}", which is not defined under "areas"`);
    }
  }
  return cfg;
}

// ---------- glob ----------

const globCache = new Map();

// Supports **, *, ?, {a,b}. A pattern without "/" matches the basename anywhere.
export function globToRegex(glob) {
  if (globCache.has(glob)) return globCache.get(glob);
  let g = glob.includes("/") ? glob.replace(/^\.?\//, "") : `**/${glob}`;
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      if (g[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i++; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = g.indexOf("}", i);
      re += "(?:" + g.slice(i + 1, end).split(",").map(escapeRe).join("|") + ")";
      i = end;
    } else re += escapeRe(c);
  }
  const rx = new RegExp(`^${re}$`);
  globCache.set(glob, rx);
  return rx;
}

function escapeRe(s) { return s.replace(/[.+^${}()|[\]\\]/g, "\\$&"); }

export function matchAny(path, globs = []) {
  return globs.some((g) => globToRegex(g).test(path));
}

// ---------- diff ----------

// Parses `git diff` / `gh pr diff` output into files with hunks and line numbers.
export function parseDiff(text) {
  const files = [];
  let f = null;
  let h = null;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m = raw.match(/^diff --git a\/(.*) b\/(.*)$/);
      f = { path: m ? m[2] : raw, oldPath: m ? m[1] : null, status: "modified", similarity: null, binary: false, hunks: [], additions: 0, deletions: 0 };
      files.push(f);
      h = null;
      continue;
    }
    if (!f) continue;
    if (!h) {
      if (raw.startsWith("new file mode")) f.status = "added";
      else if (raw.startsWith("deleted file mode")) f.status = "deleted";
      else if (raw.startsWith("rename from ")) { f.status = "renamed"; f.oldPath = raw.slice(12); }
      else if (raw.startsWith("rename to ")) f.path = raw.slice(10);
      else if (raw.startsWith("similarity index ")) f.similarity = parseInt(raw.slice(17), 10);
      else if (raw.startsWith("Binary files ")) f.binary = true;
      else if (raw.startsWith("+++ ") && raw !== "+++ /dev/null") f.path = raw.slice(6);
    }
    const hm = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hm) {
      oldNo = +hm[1];
      newNo = +hm[2];
      h = { header: raw, context: hm[3].trim(), lines: [] };
      f.hunks.push(h);
      continue;
    }
    if (!h) continue;
    const c = raw[0];
    if (c === "+") { h.lines.push({ t: "add", s: raw.slice(1), n: newNo++ }); f.additions++; }
    else if (c === "-") { h.lines.push({ t: "del", s: raw.slice(1), o: oldNo++ }); f.deletions++; }
    else if (c === " ") h.lines.push({ t: "ctx", s: raw.slice(1), o: oldNo++, n: newNo++ });
    // "\ No newline at end of file" and blank trailing lines are ignored.
  }
  for (const file of files) if (file.status !== "renamed") file.oldPath = file.status === "added" ? null : file.oldPath;
  return files;
}

export const added = (f) => f.hunks.flatMap((h) => h.lines.filter((l) => l.t === "add"));
export const removed = (f) => f.hunks.flatMap((h) => h.lines.filter((l) => l.t === "del"));

// ---------- classification ----------

const LOCKFILES = [
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb",
  "Cargo.lock", "poetry.lock", "Pipfile.lock", "uv.lock", "go.sum", "composer.lock", "Gemfile.lock",
  "packages.lock.json", "gradle.lockfile", "flake.lock",
];
const GENERATED = ["**/*.snap", "**/__snapshots__/**", "dist/**", "build/**", "**/*.min.js", "**/*.min.css", "**/*.generated.*", "**/*.g.cs", "**/*.pb.go"];
const DEFAULT_TESTS = [
  "**/test/**", "**/tests/**", "**/__tests__/**", "**/spec/**", "**/e2e/**",
  "**/*.test.*", "**/*.spec.*", "**/*_test.go", "**/*_test.py", "**/test_*.py",
  "**/*Test.java", "**/*Tests.java", "**/*Test.kt", "**/*Tests.cs", "**/*Test.cs",
];
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|swift|scala|vue|svelte)$/;

export function isTest(path, cfg) {
  return matchAny(path, [...DEFAULT_TESTS, ...(cfg?.tests ?? [])]);
}

// "tests/domain/refund.rounding.property.test.ts" -> "refund"
export function stemOf(path) {
  const base = path.split("/").pop();
  return base
    .replace(/^test_/, "")
    .replace(/(_test|Tests?)(?=\.[^.]+$)/, "")
    .split(".")[0]
    .toLowerCase();
}

export function areasOf(path, cfg) {
  return Object.entries(cfg?.areas ?? {}).filter(([, globs]) => matchAny(path, globs)).map(([name]) => name);
}

// Whitespace, quotes, commas, semicolons and parens only: prettier-style churn.
function normalizeFormat(lines) {
  return lines.map((l) => l.s).join("").replace(/[\s,;()]/g, "").replace(/['`]/g, '"');
}

const IMPORT_LINE = /^\s*(import\b|export\s+(\*|\{[^}]*\})\s+from\b|from\s+\S+\s+import\b|using\s+[\w.]+;|use\s+[\w:]+|require\(|const\s+\w+\s*=\s*require\(|\}\s*from\s+["'])/;

export function classify(f, cfg) {
  const path = f.path;
  const a = added(f);
  const r = removed(f);
  const base = path.split("/").pop();
  let noise = null;
  if (LOCKFILES.includes(base)) noise = "lockfile";
  else if (matchAny(path, cfg?.noise ?? [])) noise = "configured noise";
  else if (matchAny(path, GENERATED) || a.slice(0, 5).some((l) => /@generated|DO NOT EDIT|auto-generated/i.test(l.s))) noise = "generated";
  else if (f.binary) noise = "binary";
  else if (f.status === "renamed" && a.length === 0 && r.length === 0) noise = "pure rename";
  else if (a.length + r.length > 0 && normalizeFormat(a) === normalizeFormat(r)) noise = "formatting only";
  else if (a.length + r.length > 0 && [...a, ...r].every((l) => l.s.trim() === "" || IMPORT_LINE.test(l.s))) noise = "imports only";
  const test = isTest(path, cfg);
  const kind = noise ? "noise" : test ? "test" : CODE_EXT.test(path) ? "source" : "other";
  return { kind, noise, test, stem: stemOf(path), areas: areasOf(path, cfg) };
}

// ---------- facts ----------
// A fact is something a script can prove from the diff. Each one carries the
// file and line it came from, so a reader can check it in one click.

const SKIP = /\b(?:it|test|describe|context|suite)\.(?:skip|todo)\s*\(|\bx(?:it|describe|test)\s*\(|@Disabled\b|@Ignore\b|pytest\.mark\.skip|unittest\.skip|\bt\.Skip\(|\[(?:Fact|Theory)\s*\(\s*Skip\s*=|#\[ignore\]/;
const FOCUS = /\b(?:it|test|describe|context)\.only\s*\(|\bf(?:it|describe)\s*\(/;
const ASSERT = /\bexpect\s*\(|\bassert\w*\s*[(.]|\bshould\b|\bAssert\.\w+\(|\bassertThat\(/;
const DESTRUCTIVE_SQL = /\b(DROP\s+(?:TABLE|COLUMN|INDEX|CONSTRAINT|SCHEMA)|TRUNCATE\b|ALTER\s+TABLE\s+\S+\s+DROP\b|RENAME\s+(?:COLUMN|TO)\b|DELETE\s+FROM\b)/i;
const DEP_LINE = /^\s*"(@?[\w.\-/]+)"\s*:\s*"([^"]+)"\s*,?\s*$/;

export function computeFacts(files, cfg) {
  const facts = [];
  const push = (kind, severity, file, line, text) => facts.push({ source: "fact", kind, severity, file, line, text });
  const changedTests = files.filter((f) => f.meta.kind === "test" || (f.meta.test && f.meta.noise));
  const testStems = new Set(changedTests.map((f) => f.meta.stem));

  for (const f of files) {
    const m = f.meta;
    const a = added(f);
    const r = removed(f);
    if (m.test) {
      for (const l of a) if (SKIP.test(l.s)) push("skip-added", "high", f.path, l.n, `Adds a skipped test: \`${l.s.trim().slice(0, 100)}\``);
      for (const l of a) if (FOCUS.test(l.s)) push("focus-added", "high", f.path, l.n, `Adds a focused test (\`.only\`) — the rest of the file stops running: \`${l.s.trim().slice(0, 100)}\``);
      const net = r.filter((l) => ASSERT.test(l.s)).length - a.filter((l) => ASSERT.test(l.s)).length;
      if (net > 0) push("assertions-removed", "medium", f.path, firstLine(f), `Removes ${net} more assertion${net > 1 ? "s" : ""} than it adds.`);
      if (f.status === "deleted") push("test-deleted", "high", f.path, null, "Deletes a test file.");
    }
    if (/\.sql$/i.test(f.path) || matchAny(f.path, cfg?.areas?.migrations ?? [])) {
      for (const l of a) if (DESTRUCTIVE_SQL.test(l.s)) push("destructive-sql", "high", f.path, l.n, `Destructive schema change: \`${l.s.trim().slice(0, 100)}\``);
    }
    if (f.path.split("/").pop() === "package.json") {
      const before = new Map(r.map((l) => l.s.match(DEP_LINE)).filter(Boolean).map((x) => [x[1], x[2]]));
      for (const l of a) {
        const d = l.s.match(DEP_LINE);
        if (!d || ["name", "version", "description"].includes(d[1]) || !/\d|workspace:|file:|git/.test(d[2])) continue;
        if (!before.has(d[1])) push("dependency-added", "medium", f.path, l.n, `Adds dependency \`${d[1]}\` ${d[2]}.`);
        else if (before.get(d[1]) !== d[2]) push("dependency-changed", "low", f.path, l.n, `Changes \`${d[1]}\` ${before.get(d[1])} → ${d[2]}.`);
      }
    }
    if (m.kind === "source" && !testStems.has(m.stem) && !/\.config\.[^.]+$/.test(f.path)) {
      // Low on its own: most changes to glue code carry no test. Medium where you said it matters.
      push("untested-change", m.areas.length ? "medium" : "low", f.path, null, `Source changed (+${f.additions} −${f.deletions}); no changed test shares its name.`);
    }
    for (const area of m.areas) {
      if (area === "migrations" && /\.sql$/i.test(f.path)) push("area", "medium", f.path, null, "Touches area **migrations**.");
      else if (area !== "migrations" && !m.noise) push("area", "medium", f.path, null, `Touches area **${area}**.`);
    }
  }
  return facts;
}

function firstLine(f) {
  for (const h of f.hunks) for (const l of h.lines) if (l.t !== "ctx") return l.n ?? l.o;
  return null;
}

// ---------- PR-level facts for triage rules ----------

export const CONDITIONS = [
  "areas", "paths", "onlyPaths", "linesChanged", "filesChanged", "ageDays", "draft", "labels",
  "author", "skippedTestsAdded", "srcWithoutTests", "addedLinesMatch", "destructiveSql", "assertionsRemoved",
];

export function prFacts(pr, files, cfg, now = Date.now()) {
  for (const f of files) f.meta ??= classify(f, cfg);
  const facts = computeFacts(files, cfg);
  const count = (k) => facts.filter((x) => x.kind === k).length;
  return {
    paths: files.map((f) => f.path),
    areas: [...new Set(files.flatMap((f) => (f.meta.noise ? [] : f.meta.areas)))],
    linesChanged: pr.additions + pr.deletions,
    filesChanged: pr.changedFiles ?? files.length,
    ageDays: Math.floor((now - Date.parse(pr.createdAt)) / 86400000),
    draft: !!pr.isDraft,
    labels: (pr.labels ?? []).map((l) => l.name),
    author: pr.author?.login ?? null,
    skippedTestsAdded: count("skip-added") + count("focus-added"),
    srcWithoutTests: count("untested-change") > 0,
    destructiveSql: count("destructive-sql"),
    assertionsRemoved: count("assertions-removed"),
    addedText: files.filter((f) => !f.meta.noise).flatMap((f) => added(f).map((l) => l.s)).join("\n"),
    noiseFiles: files.filter((f) => f.meta.noise).length,
    facts,
  };
}

function compare(value, cond) {
  if (typeof cond === "boolean" || typeof cond === "string") return value === cond;
  if (typeof cond === "number") return value === cond;
  const ops = { gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b, eq: (a, b) => a === b };
  return Object.entries(cond).every(([op, b]) => {
    if (!ops[op]) throw new Error(`unknown comparator "${op}" (use gt, gte, lt, lte, eq)`);
    return ops[op](value, b);
  });
}

// Every condition in a rule must hold (AND). Returns what matched, as evidence.
export function evalRule(rule, f, cfg) {
  const ev = [];
  for (const [k, c] of Object.entries(rule.when)) {
    let ok;
    switch (k) {
      case "areas": { const hit = c.filter((a) => f.areas.includes(a)); ok = hit.length > 0; if (ok) ev.push(`area ${hit.join(", ")}`); break; }
      case "paths": { const hit = f.paths.filter((p) => matchAny(p, c)); ok = hit.length > 0; if (ok) ev.push(hit.slice(0, 3).join(", ") + (hit.length > 3 ? ` +${hit.length - 3}` : "")); break; }
      case "onlyPaths": ok = f.paths.length > 0 && f.paths.every((p) => matchAny(p, c)); break;
      case "labels": ok = c.some((l) => f.labels.includes(l)); break;
      case "author": ok = (Array.isArray(c) ? c : [c]).includes(f.author); break;
      case "addedLinesMatch": ok = new RegExp(c, "im").test(f.addedText); break;
      default: ok = compare(f[k], c); if (ok && typeof f[k] === "number") ev.push(`${k} ${f[k]}`);
    }
    if (!ok) return null;
  }
  return ev;
}

// ---------- reading order (pr-tour) ----------

export const DEFAULT_READING_ORDER = [
  { name: "contracts & schema", paths: ["**/*.d.ts", "**/types/**", "**/types.*", "**/schema.*", "**/*.proto", "**/openapi.*", "**/*.graphql", "**/migrations/**", "**/*.sql"] },
  { name: "domain", paths: ["**/domain/**", "**/core/**", "**/models/**", "**/entities/**"] },
  { name: "services & data", paths: ["**/services/**", "**/service/**", "**/db/**", "**/repositories/**", "**/api/**", "**/server/**", "**/payments/**", "**/lib/**"] },
  { name: "UI & entry points", paths: ["app/**", "**/components/**", "**/pages/**", "**/ui/**", "**/routes/**", "**/controllers/**"] },
  { name: "config & scripts", paths: ["**/*.config.*", "**/*.json", "**/*.yml", "**/*.yaml", "**/*.toml", "scripts/**", ".github/**"] },
];

const SEV = { high: 3, medium: 2, low: 1 };
export const sevRank = (s) => SEV[s] ?? 0;

// Deterministic order: hotspots (a high item) first, then by layer, tests
// straight after the code they test, orphan tests after, noise collapsed last.
export function readingOrder(files, items, cfg) {
  const layers = cfg?.tour?.readingOrder ?? DEFAULT_READING_ORDER;
  const layerOf = (p) => { const i = layers.findIndex((l) => matchAny(p, l.paths)); return i < 0 ? layers.length : i; };
  const maxSev = (p) => Math.max(0, ...items.filter((x) => x.file === p).map((x) => sevRank(x.severity)));
  const code = files.filter((f) => f.meta.kind !== "noise" && f.meta.kind !== "test");
  const tests = files.filter((f) => f.meta.kind === "test");
  const noise = files.filter((f) => f.meta.kind === "noise");
  const pairOf = new Map();
  for (const t of tests) {
    const src = code.find((c) => c.meta.stem === t.meta.stem);
    if (src) pairOf.set(t.path, src.path);
  }
  const groupSev = (c) => Math.max(maxSev(c.path), ...tests.filter((t) => pairOf.get(t.path) === c.path).map((t) => maxSev(t.path)));
  const byLayer = (x, y) => layerOf(x.path) - layerOf(y.path) || x.path.localeCompare(y.path);
  const hot = code.filter((c) => groupSev(c) === 3).sort(byLayer);
  const rest = code.filter((c) => groupSev(c) < 3).sort(byLayer);
  const orphans = tests.filter((t) => !pairOf.has(t.path));
  const hotOrphans = orphans.filter((t) => maxSev(t.path) === 3);
  const coldOrphans = orphans.filter((t) => maxSev(t.path) < 3).sort(byLayer);
  const out = [];
  const layerName = (p) => layers[layerOf(p)]?.name ?? "other";
  const withTests = (c, why) => {
    out.push({ path: c.path, role: "code", why });
    for (const t of tests.filter((t) => pairOf.get(t.path) === c.path).sort((a, b) => a.path.localeCompare(b.path))) {
      out.push({ path: t.path, role: "test", pairedWith: c.path, why: `test for ${c.path.split("/").pop()}` });
    }
  };
  for (const c of hot) withTests(c, `hotspot — high-severity item · ${layerName(c.path)}`);
  for (const t of hotOrphans) out.push({ path: t.path, role: "test", why: "hotspot — high-severity item in a test" });
  for (const c of rest) withTests(c, `layer ${layerOf(c.path) + 1}: ${layerName(c.path)}`);
  for (const t of coldOrphans) out.push({ path: t.path, role: "test", why: "test with no changed source file" });
  for (const n of noise.sort((a, b) => a.path.localeCompare(b.path))) out.push({ path: n.path, role: "noise", why: n.meta.noise });
  return out;
}
