import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRepoEntry, loadRepoList, preflight, formatTable } from "../skills/pr-triage/scripts/repos.mjs";
import { adapterFor } from "../skills/pr-triage/scripts/hosts.mjs";
import { syncCache, cleanCache, cacheDirOf, prRef } from "../skills/pr-triage/scripts/cache.mjs";
import { readCommands } from "../skills/pr-triage/scripts/build.mjs";

const SCRIPTS = fileURLToPath(new URL("../skills/pr-triage/scripts/", import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), "pr-triage-"));
const git = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8" });

test("repo entries: github parses; gitlab and azure are not supported yet; unknown hosts and bad paths carry a reason", () => {
  assert.deepEqual(parseRepoEntry(" github:dmoka/ticket-bay "), { id: "github:dmoka/ticket-bay", host: "github", path: "dmoka/ticket-bay", name: "ticket-bay", error: null });
  assert.equal(parseRepoEntry("GitHub:a/b").host, "github");
  assert.equal(parseRepoEntry("gitlab:x/y").error, "GitLab is not supported yet");
  assert.equal(parseRepoEntry("azure:org/project/repo").error, "Azure DevOps is not supported yet");
  assert.match(parseRepoEntry("bitbucket:x/y").error, /unknown host "bitbucket" — use github:/);
  assert.match(parseRepoEntry("github:only-owner").error, /expected github:<owner>\/<repo>/);
  assert.match(parseRepoEntry("github:a/b/c").error, /expected github:<owner>\/<repo>/);
  assert.match(parseRepoEntry("github:../etc").error, /expected/);
  assert.equal(parseRepoEntry("dmoka/ticket-bay").error, 'expected "<host>:<path>" — did you mean "github:dmoka/ticket-bay"?');
  // GitHub names ignore case: one id, one cache folder.
  assert.equal(parseRepoEntry("GITHUB:DMoka/Ticket-Bay").id, "github:dmoka/ticket-bay");
  assert.equal(parseRepoEntry("https://github.com/dmoka/ticket-bay.git").error, 'did you mean "github:dmoka/ticket-bay"?');
  assert.equal(parseRepoEntry("gh:dmoka/x").error, 'unknown host "gh" — did you mean "github:dmoka/x"?');
  assert.equal(parseRepoEntry("  ").id, "(empty entry)");
});

test("repo list: none -> null; JSONC with comments, trailing commas and duplicates; slugs stay unique", () => {
  const home = tmp();
  assert.equal(loadRepoList(home), null);
  mkdirSync(join(home, ".config", "pr-triage"), { recursive: true });
  const file = join(home, ".config", "pr-triage", "repos.jsonc");
  writeFileSync(file, `// mine\n{ "repos": [\n "github:dmoka/ticket-bay", // public\n "github:DMOKA/Ticket-Bay",\n "github:dmoka-ticket/bay",\n "gitlab:x/y",\n ],\n}\n`);
  const list = loadRepoList(home);
  assert.equal(list.path, file);
  assert.deepEqual(list.repos.map((r) => [r.id, r.slug, !r.error]), [
    ["github:dmoka/ticket-bay", "dmoka-ticket-bay", true],
    ["github:dmoka-ticket/bay", "dmoka-ticket-bay-2", true], // same slug as above: a number goes after
    ["gitlab:x/y", "x-y", false],
  ]);
  writeFileSync(file, `["github:a/b"]`);
  assert.throws(() => loadRepoList(home), /expected \{ "repos"/);
  writeFileSync(file, "  \n");
  assert.deepEqual(loadRepoList(home).repos, [], "an empty file is an empty list");
});

// A fake runner: each command line maps to a result; anything unlisted fails.
function fakeRun(table) {
  const calls = [];
  const exec = (cmd, args) => {
    const line = [cmd, ...args].join(" ");
    calls.push(line);
    for (const [re, res] of table) if (re.test(line)) return { ok: true, code: 0, stdout: "", stderr: "", missing: false, ...res };
    return { ok: false, code: 1, stdout: "", stderr: "HTTP 404: Not Found", missing: false };
  };
  return { exec, calls };
}
const GIT_OK = [/^git --version/, {}];
const entries = (...ids) => ids.map(parseRepoEntry);

test("preflight: install link, login command, read access, ready — in that order", () => {
  const missingGh = fakeRun([GIT_OK, [/^gh /, { ok: false, missing: true }]]);
  assert.equal(preflight(entries("github:a/b"), { run: missingGh.exec })[0].status, "gh not installed — install: https://cli.github.com");

  const loggedOut = fakeRun([GIT_OK, [/^gh --version/, {}], [/^gh auth status/, { ok: false, stderr: "You are not logged into any GitHub hosts." }]]);
  assert.equal(preflight(entries("github:a/b"), { run: loggedOut.exec, env: {} })[0].status, "not logged in — run: gh auth login");
  // gh login cannot fix a bad token in the environment.
  assert.equal(preflight(entries("github:a/b"), { run: loggedOut.exec, env: { GH_TOKEN: "bad" } })[0].status, "GH_TOKEN is set but not valid — unset it or replace it");

  const gh = fakeRun([GIT_OK, [/^gh --version/, {}], [/^gh auth status --active/, {}], [/^gh repo view a\/public/, {}]]);
  const rows = preflight(entries("github:a/public", "github:a/private", "gitlab:x/y"), { run: gh.exec });
  assert.deepEqual(rows.map((r) => [r.ready, r.status]), [
    [true, "ready"],
    [false, "not found — check the spelling; if it is private, your login can't read this repo; ask for read access"],
    [false, "GitLab is not supported yet"],
  ]);
  // The tool and login checks run once, however many repos share them.
  assert.equal(gh.calls.filter((c) => c.startsWith("gh auth status")).length, 1);
  // Read-only: nothing that logs in, writes or changes a PR.
  assert.ok(gh.calls.every((c) => !/login|token|comment|merge|edit|create/.test(c)), gh.calls.join("\n"));

  const oldGh = fakeRun([GIT_OK, [/^gh --version/, {}], [/^gh auth status --active/, { ok: false, stderr: "unknown flag: --active" }], [/^gh auth status --hostname/, {}], [/^gh repo view/, {}]]);
  assert.equal(preflight(entries("github:a/b"), { run: oldGh.exec })[0].status, "ready");

  // gh's real answer for a repo the login cannot see (private, or no such repo).
  const hidden = fakeRun([GIT_OK, [/^gh --version/, {}], [/^gh auth status/, {}], [/^gh repo view/, { ok: false, stderr: "GraphQL: Could not resolve to a Repository with the name 'a/b'. (repository)" }]]);
  assert.equal(preflight(entries("github:a/b"), { run: hidden.exec })[0].status, "not found — check the spelling; if it is private, your login can't read this repo; ask for read access");

  const net = fakeRun([GIT_OK, [/^gh --version/, {}], [/^gh auth status/, {}], [/^gh repo view/, { ok: false, stderr: "error connecting to api.github.com: dial tcp: lookup api.github.com: no such host — could not resolve" }]]);
  assert.match(preflight(entries("github:a/b"), { run: net.exec })[0].status, /^network error/);

  const noGit = fakeRun([[/^git --version/, { ok: false, missing: true }]]);
  assert.equal(preflight(entries("github:a/b"), { run: noGit.exec })[0].status, "git not installed — install: https://git-scm.com/downloads");
});

test("the table lines up its columns", () => {
  const t = formatTable([{ id: "github:a/b", host: "github", tool: "gh", status: "ready" }, { id: "gitlab:x/y", host: "gitlab", tool: "—", status: "GitLab is not supported yet" }]).split("\n");
  assert.equal(t[0], "repo        host    tool  status");
  assert.equal(t[2], "github:a/b  github  gh    ready");
});

test("github adapter: gh output becomes PR metadata with the refs/pull head", () => {
  const { exec, calls } = fakeRun([
    [/^gh repo view acme\/shop --json defaultBranchRef,url/, { stdout: JSON.stringify({ defaultBranchRef: { name: "trunk" }, url: "https://github.com/acme/shop" }) }],
    [/^gh pr list --repo acme\/shop --state open --limit 50/, { stdout: JSON.stringify([{ number: 7, title: "x", baseRefName: "trunk", headRefName: "feat/x" }]) }],
  ]);
  const a = adapterFor(parseRepoEntry("github:acme/shop"), { run: exec });
  assert.deepEqual(a.info(), { defaultBranch: "trunk", remoteUrl: "https://github.com/acme/shop.git", webUrl: "https://github.com/acme/shop" });
  assert.equal(a.listOpen(50)[0].headRef, "refs/pull/7/head");
  // The credential is gh's own login, asked for at fetch time; nothing is stored.
  const env = a.gitEnv();
  assert.deepEqual([env.GIT_CONFIG_COUNT, env.GIT_CONFIG_VALUE_0, env.GIT_CONFIG_VALUE_1], ["2", "", "!gh auth git-credential"]);
  assert.ok(calls.every((c) => /^gh (repo view|pr list)/.test(c)));
  assert.throws(() => adapterFor(parseRepoEntry("gitlab:x/y")), /no adapter/);
});

// A local origin: main plus a feature branch, served over file:// with partial clone on.
function makeOrigin(dir) {
  git(tmpdir(), "init", "-q", dir);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "price.ts"), "export function price(cents: number) {\n  return cents;\n}\n");
  writeFileSync(join(dir, "README.md"), "shop\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "init");
  git(dir, "checkout", "-qb", "feature/discount");
  writeFileSync(join(dir, "src", "price.ts"), "export function price(cents: number, orders = 0) {\n  return orders >= 10 ? Math.round(cents * 0.95) : cents;\n}\n");
  mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "tests", "price.test.ts"), "expect(price(100, 10)).toBe(95)\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "Apply the loyalty discount at checkout");
  git(dir, "checkout", "-q", "main");
  // GitHub keeps every PR head at refs/pull/<n>/head.
  git(dir, "update-ref", "refs/pull/7/head", "feature/discount");
  git(dir, "config", "uploadpack.allowFilter", "true");
  git(dir, "config", "uploadpack.allowAnySHA1InWant", "true");
  return `file://${dir}`;
}

test("cache: bare partial clone, heads in refs/pr-triage/pr/<n>, prune on rerun, every head file local, clean", () => {
  const root = tmp();
  const home = join(root, "home");
  const url = makeOrigin(join(root, "origin"));
  const entry = parseRepoEntry("github:acme/shop");
  const adapter = { gitEnv: () => ({}), gitConfig: [["pr-triage.test", "yes"]] };
  const info = { defaultBranch: "main", remoteUrl: url };
  const prs = [
    { number: 5, baseRefName: "main", headRef: "refs/pull/7/head" },
    { number: 6, baseRefName: "main", headRef: "refs/pull/6/head" }, // gone on the host
  ];
  const c = syncCache({ entry, info, prs, adapter, home });
  const g = (...a) => execFileSync("git", ["--git-dir", c.dir, ...a], { encoding: "utf8" }).trim();
  assert.equal(c.dir, cacheDirOf(entry, home));
  assert.equal(g("rev-parse", "--is-bare-repository"), "true");
  assert.equal(g("config", "remote.origin.partialclonefilter"), "blob:none");
  assert.equal(g("config", "pr-triage.test"), "yes");
  assert.deepEqual(g("for-each-ref", "--format=%(refname)").split("\n"), ["refs/heads/main", prRef(5)]);
  assert.match(c.failed.get(6), /couldn.t find remote ref refs\/pull\/6\/head/);
  assert.match(c.read(prRef(5), "src/price.ts"), /Math.round/);
  assert.equal(c.read(prRef(5), "nope.ts"), null);
  // Every file at every head is local: no read needs the network.
  assert.equal(g("rev-list", "--objects", "--missing=print", `${prRef(5)}^{tree}`, "refs/heads/main^{tree}").split("\n").filter((l) => l.startsWith("?")).length, 0);

  // PR 5 closed: its ref goes.
  syncCache({ entry, info, prs: [], adapter, home });
  assert.deepEqual(g("for-each-ref", "--format=%(refname)").split("\n"), ["refs/heads/main"]);

  assert.deepEqual(cleanCache({ entry, home }), { target: c.dir, existed: true });
  assert.ok(!existsSync(c.dir));
  assert.throws(() => cleanCache({ entry: { host: "github", path: "../../x" }, home }), /refusing/);
});

test("cache: a broken cache is deleted and cloned again", () => {
  const root = tmp();
  const home = join(root, "home");
  const url = makeOrigin(join(root, "origin"));
  const entry = parseRepoEntry("github:acme/shop");
  const args = { entry, info: { defaultBranch: "main", remoteUrl: url }, prs: [{ number: 5, baseRefName: "main", headRef: "refs/pull/7/head" }], adapter: { gitEnv: () => ({}), gitConfig: [] }, home };
  const dir = syncCache(args).dir;
  const breakers = {
    "garbage HEAD": () => writeFileSync(join(dir, "HEAD"), "garbage\n"),
    "bad config": () => writeFileSync(join(dir, "config"), "[[[x\n"),
    "no objects": () => rmSync(join(dir, "objects"), { recursive: true, force: true }),
    "bad packed-refs": () => { execFileSync("git", ["--git-dir", dir, "pack-refs", "--all"]); writeFileSync(join(dir, "packed-refs"), "zzzz\n"); },
  };
  for (const [name, breakIt] of Object.entries(breakers)) {
    breakIt();
    const c = syncCache(args);
    assert.match(c.read(prRef(5), "src/price.ts"), /Math.round/, name);
  }
  assert.ok(!existsSync(`${dir}.lock`), "the lock is released");
});

test("cache: runs at once on a fresh cache wait for each other; a dead run's lock is taken over", async () => {
  const root = tmp();
  const home = join(root, "home");
  const url = makeOrigin(join(root, "origin"));
  const script = join(root, "sync.mjs");
  writeFileSync(script, `import { syncCache } from ${JSON.stringify(join(SCRIPTS, "cache.mjs"))};
import { parseRepoEntry } from ${JSON.stringify(join(SCRIPTS, "repos.mjs"))};
const c = syncCache({ entry: parseRepoEntry("github:acme/shop"), home: ${JSON.stringify(home)}, info: { defaultBranch: "main", remoteUrl: ${JSON.stringify(url)} },
  prs: [{ number: 5, baseRefName: "main", headRef: "refs/pull/7/head" }], adapter: { gitEnv: () => ({}), gitConfig: [] } });
console.log(c.read("refs/pr-triage/pr/5", "src/price.ts") ? "ok" : "missing");`);
  const { spawn } = await import("node:child_process");
  const once = () => new Promise((resolve) => {
    const p = spawn(process.execPath, [script], { encoding: "utf8" });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out: out.trim(), err }));
  });
  const results = await Promise.all([once(), once(), once()]);
  for (const r of results) assert.deepEqual([r.code, r.out], [0, "ok"], r.err);

  // A lock left by a process that died: taken over, not waited on.
  const dir = cacheDirOf(parseRepoEntry("github:acme/shop"), home);
  mkdirSync(`${dir}.lock`);
  writeFileSync(join(`${dir}.lock`, "pid"), "999999");
  const r = await once();
  assert.deepEqual([r.code, r.out], [0, "ok"], r.err);
});

function annotate(dir, notes) {
  writeFileSync(join(dir, "triage.notes.json"), JSON.stringify(notes));
  return spawnSync(process.execPath, [join(SCRIPTS, "annotate.mjs"), join(dir, "triage.json"), join(dir, "triage.notes.json")], { encoding: "utf8" });
}

test("combined queue: keys across repos, one level order for all, same PR number in two repos", () => {
  const dir = tmp();
  const pr = (key, repo, number, level) => {
    writeFileSync(join(dir, `tour-${key}.json`), JSON.stringify({ kind: "tour", attention: { level, whatHappened: "x", why: "y" } }));
    return { key, repo, repoId: `github:${repo}`, number, tour: `tour-${key}.json`, attention: null, rank: null };
  };
  const report = { kind: "triage", repo: null, repos: [{ id: "github:a/shop" }, { id: "github:b/api" }],
    prs: [pr("a-shop-1", "a/shop", 1, "medium"), pr("b-api-1", "b/api", 1, "critical"), pr("b-api-2", "b/api", 2, "low")] };
  writeFileSync(join(dir, "triage.json"), JSON.stringify(report));

  let r = annotate(dir, { order: [1, 2] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /order: #1 is not an open PR in this report — use the "key" of each PR/);
  assert.match(r.stderr, /order: b-api-2 is missing/);

  r = annotate(dir, { order: ["a-shop-1", "b-api-1", "b-api-2"] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /order: b-api-1 is "critical" but sits below a "medium" PR/);

  r = annotate(dir, { summary: "One critical PR in b/api.", order: ["b-api-1", "a-shop-1", "b-api-2"] });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(readFileSync(join(dir, "triage.json"), "utf8"));
  assert.deepEqual(out.prs.map((p) => [p.key, p.repo, p.rank, p.attention.level]), [
    ["b-api-1", "b/api", 1, "critical"], ["a-shop-1", "a/shop", 2, "medium"], ["b-api-2", "b/api", 3, "low"],
  ]);
});

test("end to end with a fake gh: login table, unsupported hosts skipped, cache, one queue, keyed tours, read-only calls", () => {
  const root = tmp();
  const home = join(root, "home");
  const bin = join(root, "bin");
  const work = join(root, "work");
  mkdirSync(join(home, ".config", "pr-triage"), { recursive: true });
  mkdirSync(bin);
  mkdirSync(work);
  const url = makeOrigin(join(root, "origin"));
  // The GitHub URL resolves to the local origin; nothing reaches the network.
  writeFileSync(join(home, ".gitconfig"), `[url "${url}"]\n\tinsteadOf = https://github.com/acme/shop.git\n`);
  writeFileSync(join(home, ".config", "pr-triage", "repos.jsonc"),
    `{ "repos": ["github:acme/shop", "github:acme/secret", "gitlab:x/y", "azure:a/b/c"] } // gitlab and azure: not yet`);
  const log = join(root, "gh.log");
  const pr = (number, title, body) => ({ number, title, body, author: { login: "ada" }, url: `https://github.com/acme/shop/pull/${number}`,
    baseRefName: "main", headRefName: `feature/${number}`, headRefOid: "abc", createdAt: "2026-10-01T09:00:00Z", isDraft: false,
    labels: [{ name: "payments" }], closingIssuesReferences: [] });
  writeFileSync(join(root, "prs.json"), JSON.stringify([pr(7, "Apply the loyalty discount at checkout", "Customers with 10+ orders get 5% off."), pr(8, "Gone", "head deleted")]));
  writeFileSync(join(bin, "gh"), `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2), line = a.join(" ");
fs.appendFileSync(${JSON.stringify(log)}, line + "\\n");
const say = (x) => { process.stdout.write(typeof x === "string" ? x : JSON.stringify(x)); process.exit(0); };
if (line === "--version") say("gh version 2.83.2\\n");
if (line.startsWith("auth status --active")) say("");
if (line === "repo view acme/shop --json nameWithOwner") say({ nameWithOwner: "acme/shop" });
if (line === "repo view acme/shop --json defaultBranchRef,url") say({ defaultBranchRef: { name: "main" }, url: "https://github.com/acme/shop" });
if (line.startsWith("pr list --repo acme/shop --state open")) say(fs.readFileSync(${JSON.stringify(join(root, "prs.json"))}, "utf8"));
process.stderr.write("GraphQL: Could not resolve to a Repository (" + line + ")\\n"); process.exit(1);
`);
  chmodSync(join(bin, "gh"), 0o755);
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_NOSYSTEM: "1" };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;

  const r = spawnSync(process.execPath, [join(SCRIPTS, "triage.mjs")], { cwd: work, env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /github:acme\/shop\s+github\s+gh\s+ready/);
  assert.match(r.stdout, /github:acme\/secret\s+github\s+gh\s+not found — check the spelling; if it is private, your login can't read this repo/);
  assert.match(r.stdout, /gitlab:x\/y\s+gitlab\s+—\s+GitLab is not supported yet/);
  assert.match(r.stdout, /azure:a\/b\/c\s+azure\s+—\s+Azure DevOps is not supported yet/);

  const t = JSON.parse(readFileSync(join(work, ".pr-review", "triage.json"), "utf8"));
  assert.equal(t.repo, null);
  assert.deepEqual(t.prs.map((p) => [p.key, p.repo, p.number, p.labels]), [["acme-shop-7", "acme/shop", 7, ["payments"]]]);
  const shop = t.repos.find((x) => x.id === "github:acme/shop");
  assert.deepEqual([shop.ready, shop.open, shop.skipped.map((s) => s.number)], [true, 2, [8]]);
  assert.deepEqual(t.repos.filter((x) => !x.ready).map((x) => x.id), ["github:acme/secret", "gitlab:x/y", "azure:a/b/c"]);

  const tour = JSON.parse(readFileSync(join(work, ".pr-review", "tour-acme-shop-7.json"), "utf8"));
  assert.deepEqual(tour.files.map((f) => f.path).sort(), ["src/price.ts", "tests/price.test.ts"]);
  assert.equal(tour.host, "github");
  assert.ok(tour.intent.sources.some((s) => s.type === "description" && /10\+ orders/.test(s.text)));
  // The judge's read commands work against the cache.
  const show = execFileSync("git", ["--git-dir", tour.read.gitDir, "show", `${tour.read.head}:src/price.ts`], { encoding: "utf8", env });
  assert.match(show, /orders >= 10/);
  assert.equal(tour.read.gitDir, join(home, ".cache", "pr-triage", "github", "acme", "shop"));

  const html = readFileSync(join(work, ".pr-review", "review.html"), "utf8");
  assert.match(html, /"acme-shop-7":\{"kind":"tour"/);
  // Read-only on GitHub, and no login: only version, status, view and list calls.
  const calls = readFileSync(log, "utf8").trim().split("\n");
  assert.ok(calls.every((c) => /^(--version|auth status --active|repo view|pr list|issue view)\b/.test(c)), calls.join("\n"));
  assert.ok(readdirSync(work).every((f) => f === ".pr-review"), "nothing else is written to the working folder");
});

test("a broken repo list: one line, exit 1, no stack trace", () => {
  const home = tmp();
  mkdirSync(join(home, ".config", "pr-triage"), { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const text of ['{ "repos": [ "github:dmoka/ticket-bay" ', '["github:dmoka/ticket-bay"]', '{"repos":[42]}']) {
    writeFileSync(join(home, ".config", "pr-triage", "repos.jsonc"), text);
    for (const script of ["triage.mjs", "preflight.mjs"]) {
      const r = spawnSync(process.execPath, [join(SCRIPTS, script)], { cwd: home, env, encoding: "utf8" });
      assert.equal(r.status, 1, `${script}: ${text}`);
      assert.equal(r.stderr.trim().split("\n").length, 1, r.stderr);
      assert.match(r.stderr, /repos\.jsonc: (not valid JSONC|expected \{ "repos")/);
    }
  }
});

test("viewer: every queue link uses the PR key; read commands survive odd home folders", () => {
  const viewer = readFileSync(join(SCRIPTS, "viewer", "viewer.js"), "utf8");
  assert.doesNotMatch(viewer, /href="#\/pr\/\$\{p\.number\}"/);
  // Pasted into a shell, the cache path stays one argument, even with ', $ and ` in it.
  const show = readCommands({ gitDir: "/home/o'neil/$HOME/`x`", base: "refs/heads/main", head: "refs/pr-triage/pr/7" }).show;
  const args = execFileSync("sh", ["-c", show.replace(/^git /, "printf '%s|' ").replace("<path>", "src/a.ts")], { encoding: "utf8" });
  assert.equal(args, "--git-dir|/home/o'neil/$HOME/`x`|show|refs/pr-triage/pr/7:src/a.ts|");
});
