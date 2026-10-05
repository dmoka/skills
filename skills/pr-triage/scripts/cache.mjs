// The code cache for many repos: one bare partial clone per repo in
// <home>/.cache/pr-triage/<host>/<path>. No working tree, so it never touches
// a checkout of the user's. Every open PR head sits in refs/pr-triage/pr/<n>;
// the default branch and each PR's base branch sit in refs/heads/<branch>.
// Judges read with `git --git-dir=<cache> show|grep|diff <ref>`.
//
// Each sync fetches the current heads (a push or a rebase moves them), drops
// the refs of PRs that closed, updates the default branch, and downloads the
// files at every fetched head in one batch, so reads stay offline and fast.

import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, statSync } from "node:fs";
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

// Brings the cache of one repo up to date with its open PRs. One run at a
// time per repo (a lock beside the cache). A broken cache is deleted and
// cloned again once: it holds nothing that cannot be fetched again.
// Returns { dir, failed: Map<number, reason>, read(ref, path) }.
export function syncCache(opts) {
  const { entry, info, home, run = defaultRun } = opts;
  const dir = cacheDirOf(entry, home);
  if (!info.defaultBranch) throw new Error(`${entry.id}: the host reports no default branch (an empty repo?)`);
  mkdirSync(dirname(dir), { recursive: true });
  return withLock(`${dir}.lock`, () => {
    if (existsSync(dir) && !healthy(dir, run)) {
      console.error(`${entry.id}: the cache is broken; deleting it and cloning again`);
      rmSync(dir, { recursive: true, force: true });
    }
    try { return syncOnce(opts, dir); }
    catch (e) { throw new Error(`${e.message} — if it keeps failing, run: node scripts/triage.mjs --clean-cache ${entry.id}`); }
  });
}

// Readable config, readable refs, and the commit HEAD names is present.
function healthy(dir, run) {
  const ok = (args) => run("git", ["--git-dir", dir, ...args], { env: gitEnv() }).ok;
  return existsSync(join(dir, "HEAD")) && ok(["config", "--get", "remote.origin.url"]) && ok(["for-each-ref", "--count=1"])
    && ok(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
}

// mkdir is atomic: whoever creates the folder holds the lock. A lock whose
// process is gone, or older than 30 minutes, is taken over.
function withLock(lock, fn, { waitMs = 10 * 60 * 1000, staleMs = 30 * 60 * 1000 } = {}) {
  const start = Date.now();
  const nap = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try { mkdirSync(lock); writeFileSync(join(lock, "pid"), String(process.pid)); break; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (lockIsStale(lock, staleMs)) { rmSync(lock, { recursive: true, force: true }); continue; }
      if (Date.now() - start > waitMs) throw new Error(`another pr-triage run holds ${lock}; if none is running, delete that folder`);
      Atomics.wait(nap, 0, 0, 250);
    }
  }
  try { return fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
}

function lockIsStale(lock, staleMs) {
  try {
    if (Date.now() - statSync(lock).mtimeMs > staleMs) return true;
    const pid = Number(readFileSync(join(lock, "pid"), "utf8"));
    if (!pid) return false; // the owner has not written its pid yet
    try { process.kill(pid, 0); return false; } catch (e) { return e.code === "ESRCH"; }
  } catch { return false; }
}

function syncOnce({ entry, info, prs, adapter, run = defaultRun }, dir) {
  const env = adapter.gitEnv?.() ?? {};
  const git = (args, opts = {}) => cacheGit(dir, args, { run, env, ...opts });

  if (!existsSync(join(dir, "HEAD"))) {
    rmSync(dir, { recursive: true, force: true }); // a clone that died half way
    cacheGit(null, ["clone", "--bare", "--quiet", "--filter=blob:none", "--no-tags", "--single-branch", "--branch", info.defaultBranch, info.remoteUrl, dir], { run, env });
    for (const [k, v] of adapter.gitConfig ?? []) git(["config", "--add", k, v]);
  }
  git(["config", "remote.origin.url", info.remoteUrl]);
  git(["symbolic-ref", "HEAD", `refs/heads/${info.defaultBranch}`]);

  // Destination ref in the cache -> source ref on the host.
  const want = new Map([[`refs/heads/${info.defaultBranch}`, `refs/heads/${info.defaultBranch}`]]);
  for (const p of prs) {
    if (p.baseRefName) want.set(`refs/heads/${p.baseRefName}`, `refs/heads/${p.baseRefName}`);
    want.set(prRef(p.number), p.headRef);
  }
  const fetch = (pairs) => git(["fetch", "--quiet", "--no-tags", "--filter=blob:none", "origin", ...pairs.map(([dst, src]) => `+${src}:${dst}`)]);
  const failed = new Map();
  try { fetch([...want]); }
  catch {
    // One bad ref fails the whole fetch: retry one by one to find it.
    for (const [dst, src] of want) {
      try { fetch([[dst, src]]); }
      catch (e) {
        if (!dst.startsWith("refs/pr-triage/pr/")) throw new Error(`${entry.id}: could not fetch ${dst} — ${e.message}`);
        failed.set(Number(dst.split("/").pop()), e.message);
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
