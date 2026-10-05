// The code cache for many repos: one bare partial clone per repo in
// <home>/.cache/pr-triage/<host>/<path>. No working tree, so it never touches
// a checkout of the user's. Every open PR head sits in refs/pr-triage/pr/<n>;
// the default branch and each PR's base branch sit in refs/heads/<branch>.
// Judges read with `git --git-dir=<cache> show|grep|diff <ref>`.
//
// Each sync fetches the current heads (a push or a rebase moves them), drops
// the refs of PRs that closed, updates the default branch, and downloads the
// files at every fetched head in one batch, so reads stay offline and fast.

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { run as defaultRun, firstLine } from "./repos.mjs";

export const cacheRoot = (home = homedir()) => join(home, ".cache", "pr-triage");
export const cacheDirOf = (entry, home) => join(cacheRoot(home), entry.host, ...entry.path.split("/"));
export const prRef = (n) => `refs/pr-triage/pr/${n}`;

// A cache command never inherits a repo the caller pointed git at.
function gitEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_NAMESPACE"]) delete env[k];
  return env;
}

export function cacheGit(dir, args, { run = defaultRun, env, input } = {}) {
  const r = run("git", dir ? ["--git-dir", dir, ...args] : args, { env: gitEnv(env), input });
  if (!r.ok) throw new Error(`git ${args.slice(0, 2).join(" ")} failed: ${firstLine(r.stderr) || `exit ${r.code}`}`);
  return r.stdout;
}

// Brings the cache of one repo up to date with its open PRs.
// Returns { dir, failed: Map<number, reason>, read(ref, path) }.
export function syncCache({ entry, info, prs, adapter, home, run = defaultRun }) {
  const dir = cacheDirOf(entry, home);
  const env = adapter.gitEnv?.() ?? {};
  const git = (args, opts = {}) => cacheGit(dir, args, { run, env, ...opts });
  if (!info.defaultBranch) throw new Error(`${entry.id}: the host reports no default branch (an empty repo?)`);

  if (!existsSync(join(dir, "HEAD"))) {
    mkdirSync(dirname(dir), { recursive: true });
    cacheGit(null, ["clone", "--bare", "--quiet", "--filter=blob:none", "--no-tags", "--single-branch", "--branch", info.defaultBranch, info.remoteUrl, dir], { run, env });
    for (const [k, v] of adapter.gitConfig ?? []) git(["config", "--add", k, v]);
  }
  git(["config", "remote.origin.url", info.remoteUrl]);
  git(["symbolic-ref", "HEAD", `refs/heads/${info.defaultBranch}`]);

  // Destination ref -> source refs on the host, first that fetches wins.
  const want = new Map([[`refs/heads/${info.defaultBranch}`, [`refs/heads/${info.defaultBranch}`]]]);
  for (const p of prs) {
    if (p.baseRefName) want.set(`refs/heads/${p.baseRefName}`, [`refs/heads/${p.baseRefName}`]);
    want.set(prRef(p.number), p.headRefs);
  }
  const fetch = (pairs) => git(["fetch", "--quiet", "--no-tags", "--filter=blob:none", "origin", ...pairs.map(([dst, src]) => `+${src}:${dst}`)]);
  const failed = new Map();
  try { fetch([...want].map(([dst, srcs]) => [dst, srcs[0]])); }
  catch {
    // One bad ref fails the whole fetch: retry one by one to find it.
    for (const [dst, srcs] of want) {
      const errors = [];
      for (const src of srcs) {
        try { fetch([[dst, src]]); errors.length = 0; break; } catch (e) { errors.push(e.message); }
      }
      if (errors.length) {
        const n = dst.startsWith("refs/pr-triage/pr/") ? Number(dst.split("/").pop()) : null;
        if (n == null) throw new Error(`${entry.id}: could not fetch ${dst} — ${errors[0]}`);
        failed.set(n, errors[0]);
      }
    }
  }

  // Prune: refs of closed PRs and of branches no open PR targets any more.
  const unfetched = (ref) => ref.startsWith("refs/pr-triage/") && failed.has(Number(ref.split("/").pop()));
  const have = git(["for-each-ref", "--format=%(refname)", "refs/pr-triage/", "refs/heads/"]).split("\n").filter(Boolean);
  for (const ref of have) if (!want.has(ref) || unfetched(ref)) git(["update-ref", "-d", ref]);

  // Download every file at every head in one batch; git would otherwise fetch
  // each missing file on its own when a judge reads it.
  const tips = [...want.keys()].filter((ref) => !unfetched(ref));
  const missing = git(["rev-list", "--objects", "--missing=print", ...tips.map((t) => `${t}^{tree}`)])
    .split("\n").filter((l) => l.startsWith("?")).map((l) => l.slice(1));
  if (missing.length) {
    git(["-c", "fetch.negotiationAlgorithm=noop", "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--recurse-submodules=no", "--filter=blob:none", "--stdin", "origin"],
      { input: missing.join("\n") + "\n" });
  }

  return {
    dir,
    failed,
    // A file at a ref, or null when it is not there.
    read(ref, path) {
      const r = run("git", ["--git-dir", dir, "show", `${ref}:${path}`], { env: gitEnv(env) });
      return r.ok ? r.stdout : null;
    },
  };
}

// Removes the whole cache, or one repo's. Refuses any path outside the cache root.
export function cleanCache({ entry, home } = {}) {
  const root = resolve(cacheRoot(home));
  const target = resolve(entry ? cacheDirOf(entry, home) : root);
  if (target !== root && !target.startsWith(root + sep)) throw new Error(`refusing to remove ${target}: not inside ${root}`);
  const existed = existsSync(target);
  rmSync(target, { recursive: true, force: true });
  return { target, existed };
}
