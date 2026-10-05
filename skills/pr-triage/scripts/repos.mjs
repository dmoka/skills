// Many repos: the repo list, its entries, and the login check that runs
// before every multi-repo triage. pr-triage only. Zero dependencies; Node >= 18.
//
// The list lives in one place, <home>/.config/pr-triage/repos.jsonc:
//   { "repos": ["github:dmoka/ticket-bay", "azure:<org>/<project>/<repo>"] }
// No list -> pr-triage triages the current repo, as before.
//
// The login check never asks for a token, never stores a credential and
// never runs a login. It only reports what to install or run.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseJsonc } from "./lib.mjs";

export const HOSTS = {
  github: { tool: "gh", parts: 2, shape: "github:<owner>/<repo>" },
  azure: { tool: "az", parts: 3, shape: "azure:<org>/<project>/<repo>" },
};

export const INSTALL = {
  git: "https://git-scm.com/downloads",
  gh: "https://cli.github.com",
  az: "https://learn.microsoft.com/cli/azure/install-azure-cli",
};

export const listPath = (home = homedir()) => join(home, ".config", "pr-triage", "repos.jsonc");

// Runs a command without a shell; never throws. `missing` means the command is not installed.
// Windows installs az as az.cmd, which Node only starts through a shell.
export function run(cmd, args, { input, env } = {}) {
  const viaShell = process.platform === "win32" && cmd === "az";
  const r = spawnSync(viaShell ? "az.cmd" : cmd, viaShell ? args.map((a) => `"${String(a).replace(/"/g, '\\"')}"`) : args,
    { encoding: "utf8", input, env, shell: viaShell, maxBuffer: 256 * 1024 * 1024 });
  const stderr = r.stderr ?? "";
  // ENOTDIR: a PATH entry is a file, and the command is in none of the folders.
  const missing = ["ENOENT", "ENOTDIR"].includes(r.error?.code) || (viaShell && /is not recognized/.test(stderr));
  return { ok: !r.error && r.status === 0, code: r.status, stdout: r.stdout ?? "", stderr: r.error && !missing ? String(r.error.message) : stderr, missing };
}

export const firstLine = (s) => String(s ?? "").trim().split("\n").find((l) => l.trim()) ?? "";

// "github:dmoka/ticket-bay" -> { id, host, path, name, error: null }.
// A bad or unsupported entry keeps its text and carries the reason in `error`.
export function parseRepoEntry(text) {
  const s = String(text ?? "").trim();
  const m = s.match(/^([A-Za-z][\w-]*):(.+)$/);
  if (!m) return { id: s, host: null, path: null, error: `expected "<host>:<path>", e.g. "github:owner/repo"` };
  const host = m[1].toLowerCase();
  const path = m[2].trim().replace(/^\/+|\/+$/g, "");
  const id = `${host}:${path}`;
  if (host === "gitlab") return { id, host, path, error: "GitLab is not supported yet" };
  const spec = HOSTS[host];
  if (!spec) return { id, host, path, error: `unknown host "${host}" — use github: or azure:` };
  const parts = path.split("/");
  // Each part becomes a folder of the cache, so "." and ".." are refused.
  if (parts.length !== spec.parts || parts.some((p) => !p.trim() || p === "." || p === ".." || /[\\\x00-\x1f]/.test(p))) {
    return { id, host, path, error: `expected ${spec.shape}` };
  }
  return { id, host, path, name: parts[parts.length - 1], error: null };
}

// The list, or null when there is none. Duplicates are dropped. Each entry
// gets a `slug` for file names and links: "dmoka/ticket-bay" -> "dmoka-ticket-bay".
export function loadRepoList(home = homedir()) {
  const path = listPath(home);
  if (!existsSync(path)) return null;
  let data;
  try { data = parseJsonc(readFileSync(path, "utf8")); }
  catch (e) { throw new Error(`${path}: not valid JSONC — ${e.message}`); }
  if (!Array.isArray(data?.repos) || data.repos.some((r) => typeof r !== "string")) {
    throw new Error(`${path}: expected { "repos": ["github:owner/repo", "azure:org/project/repo"] }`);
  }
  const repos = [];
  const slugs = new Set();
  for (const text of data.repos) {
    const e = parseRepoEntry(text);
    if (repos.some((r) => r.id === e.id)) continue;
    let slug = String(e.path ?? e.id).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
    if (slugs.has(slug)) slug = `${e.host ?? "x"}-${slug}`;
    slugs.add(slug);
    repos.push({ ...e, slug });
  }
  return { path, repos };
}

// One row per repo: { ...entry, tool, ready, status }. In order: git and the
// host's tool installed? logged in? can this login read the repo?
export function preflight(entries, { run: exec = run } = {}) {
  const seen = new Map();
  const once = (key, fn) => { if (!seen.has(key)) seen.set(key, fn()); return seen.get(key); };
  return entries.map((e) => ({ ...e, ...checkOne(e, exec, once) }));
}

const CANNOT_READ = "your login can't read this repo; ask for read access";
const NETWORK = /could not resolve|timed? ?out|network|ENOTFOUND|ECONNRESET|connection (refused|reset)/i;
const cannotRead = (r) => (NETWORK.test(r.stderr) ? `network error: ${firstLine(r.stderr)}` : CANNOT_READ);

function checkOne(e, exec, once) {
  if (e.error) return { tool: HOSTS[e.host]?.tool ?? "—", ready: false, status: e.error };
  const tool = HOSTS[e.host].tool;
  const fail = (status) => ({ tool, ready: false, status });
  if (once("git", () => exec("git", ["--version"])).missing) return fail(`git not installed — install: ${INSTALL.git}`);
  if (e.host === "github") {
    if (once("gh", () => exec("gh", ["--version"])).missing) return fail(`gh not installed — install: ${INSTALL.gh}`);
    // --active: a stale second account must not hide a working one. gh before 2.40 has no --active.
    const auth = once("gh-auth", () => {
      const r = exec("gh", ["auth", "status", "--active", "--hostname", "github.com"]);
      return /unknown flag/.test(r.stderr) ? exec("gh", ["auth", "status", "--hostname", "github.com"]) : r;
    });
    if (!auth.ok) return fail("not logged in — run: gh auth login");
    const r = exec("gh", ["repo", "view", e.path, "--json", "nameWithOwner"]);
    return r.ok ? { tool, ready: true, status: "ready" } : fail(cannotRead(r));
  }
  // azure
  if (once("az", () => exec("az", ["--version"])).missing) return fail(`az not installed — install: ${INSTALL.az}`);
  if (!once("az-devops", () => exec("az", ["extension", "show", "--name", "azure-devops", "--output", "none"])).ok) {
    return fail("azure-devops extension missing — run: az extension add --name azure-devops");
  }
  if (!once("az-auth", () => exec("az", ["account", "show", "--output", "none"])).ok) return fail("not logged in — run: az login");
  const [org, project, repo] = e.path.split("/");
  const r = exec("az", ["repos", "show", "--repository", repo, "--project", project, "--org", `https://dev.azure.com/${org}`, "--output", "none"]);
  return r.ok ? { tool, ready: true, status: "ready" } : fail(cannotRead(r));
}

export function formatTable(rows) {
  const cols = [["repo", (r) => r.id], ["host", (r) => r.host ?? "?"], ["tool", (r) => r.tool], ["status", (r) => r.status]];
  const cells = rows.map((r) => cols.map(([, f]) => String(f(r) ?? "")));
  const width = cols.map(([h], i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) => c.map((x, i) => (i === c.length - 1 ? x : x.padEnd(width[i]))).join("  ");
  return [line(cols.map(([h]) => h)), line(width.map((w) => "-".repeat(w))), ...cells.map(line)].join("\n");
}
