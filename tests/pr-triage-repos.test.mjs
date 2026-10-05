import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRepoEntry, loadRepoList, preflight, formatTable } from "../skills/pr-triage/scripts/repos.mjs";
import { adapterFor } from "../skills/pr-triage/scripts/hosts.mjs";
import { syncCache, cleanCache, cacheDirOf, prRef } from "../skills/pr-triage/scripts/cache.mjs";

const SCRIPTS = fileURLToPath(new URL("../skills/pr-triage/scripts/", import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), "pr-triage-"));
const git = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8" });

test("repo entries: github and azure parse; gitlab, unknown hosts and bad paths carry a reason", () => {
  assert.deepEqual(parseRepoEntry(" github:dmoka/ticket-bay "), { id: "github:dmoka/ticket-bay", host: "github", path: "dmoka/ticket-bay", name: "ticket-bay", error: null });
  assert.equal(parseRepoEntry("azure:contoso/Payments Team/api").name, "api");
  assert.equal(parseRepoEntry("GitHub:a/b").host, "github");
  assert.equal(parseRepoEntry("gitlab:x/y").error, "GitLab is not supported yet");
  assert.match(parseRepoEntry("bitbucket:x/y").error, /unknown host "bitbucket"/);
  assert.match(parseRepoEntry("github:only-owner").error, /expected github:<owner>\/<repo>/);
  assert.match(parseRepoEntry("azure:org/repo").error, /expected azure:<org>\/<project>\/<repo>/);
  assert.match(parseRepoEntry("github:../etc").error, /expected/);
  assert.match(parseRepoEntry("dmoka/ticket-bay").error, /expected "<host>:<path>"/);
});

test("repo list: none -> null; JSONC with comments, trailing commas and duplicates; slugs stay unique", () => {
  const home = tmp();
  assert.equal(loadRepoList(home), null);
  mkdirSync(join(home, ".config", "pr-triage"), { recursive: true });
  const file = join(home, ".config", "pr-triage", "repos.jsonc");
  writeFileSync(file, `// mine\n{ "repos": [\n "github:dmoka/ticket-bay", // public\n "github:dmoka/ticket-bay",\n "azure:dmoka/ticket/bay",\n "gitlab:x/y",\n ],\n}\n`);
  const list = loadRepoList(home);
  assert.equal(list.path, file);
  assert.deepEqual(list.repos.map((r) => [r.id, r.slug, !r.error]), [
    ["github:dmoka/ticket-bay", "dmoka-ticket-bay", true],
    ["azure:dmoka/ticket/bay", "azure-dmoka-ticket-bay", true], // same slug as above: the host goes in front
    ["gitlab:x/y", "x-y", false],
  ]);
  writeFileSync(file, `["github:a/b"]`);
  assert.throws(() => loadRepoList(home), /expected \{ "repos"/);
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
  assert.equal(preflight(entries("github:a/b"), { run: loggedOut.exec })[0].status, "not logged in — run: gh auth login");

  const gh = fakeRun([GIT_OK, [/^gh --version/, {}], [/^gh auth status --active/, {}], [/^gh repo view a\/public/, {}]]);
  const rows = preflight(entries("github:a/public", "github:a/private", "gitlab:x/y"), { run: gh.exec });
  assert.deepEqual(rows.map((r) => [r.ready, r.status]), [
    [true, "ready"],
    [false, "your login can't read this repo; ask for read access"],
    [false, "GitLab is not supported yet"],
  ]);
  // The tool and login checks run once, however many repos share them.
  assert.equal(gh.calls.filter((c) => c.startsWith("gh auth status")).length, 1);
  // Read-only: nothing that logs in, writes or changes a PR.
  assert.ok(gh.calls.every((c) => !/login|token|comment|merge|edit|create/.test(c)), gh.calls.join("\n"));

  const oldGh = fakeRun([GIT_OK, [/^gh --version/, {}], [/^gh auth status --active/, { ok: false, stderr: "unknown flag: --active" }], [/^gh auth status --hostname/, {}], [/^gh repo view/, {}]]);
  assert.equal(preflight(entries("github:a/b"), { run: oldGh.exec })[0].status, "ready");

  const net = fakeRun([GIT_OK, [/^gh --version/, {}], [/^gh auth status/, {}], [/^gh repo view/, { ok: false, stderr: "error connecting to api.github.com: dial tcp: lookup api.github.com: no such host — could not resolve" }]]);
  assert.match(preflight(entries("github:a/b"), { run: net.exec })[0].status, /^network error/);

  const noGit = fakeRun([[/^git --version/, { ok: false, missing: true }]]);
  assert.equal(preflight(entries("github:a/b"), { run: noGit.exec })[0].status, "git not installed — install: https://git-scm.com/downloads");
});

test("preflight: azure — az, the azure-devops extension, az login, read access", () => {
  const az = (extra) => fakeRun([GIT_OK, [/^az --version/, {}], ...extra]);
  const e = entries("azure:contoso/Payments/api");
  assert.equal(preflight(e, { run: fakeRun([GIT_OK, [/^az /, { ok: false, missing: true }]]).exec })[0].status,
    "az not installed — install: https://learn.microsoft.com/cli/azure/install-azure-cli");
  assert.equal(preflight(e, { run: az([]).exec })[0].status, "azure-devops extension missing — run: az extension add --name azure-devops");
  assert.equal(preflight(e, { run: az([[/^az extension show/, {}]]).exec })[0].status, "not logged in — run: az login");
  assert.equal(preflight(e, { run: az([[/^az extension show/, {}], [/^az account show/, {}]]).exec })[0].status, "your login can't read this repo; ask for read access");
  const ok = az([[/^az extension show/, {}], [/^az account show/, {}], [/^az repos show --repository api --project Payments --org https:\/\/dev.azure.com\/contoso/, {}]]);
  assert.equal(preflight(e, { run: ok.exec })[0].status, "ready");
});

test("the table lines up its columns", () => {
  const t = formatTable([{ id: "github:a/b", host: "github", tool: "gh", status: "ready" }, { id: "gitlab:x/y", host: "gitlab", tool: "—", status: "GitLab is not supported yet" }]).split("\n");
  assert.equal(t[0], "repo        host    tool  status");
  assert.equal(t[2], "github:a/b  github  gh    ready");
});

// Recorded-shape `az repos pr show` output (Azure DevOps REST GitPullRequest).
const azPr = (id, src, extra = {}) => ({
  pullRequestId: id, title: `PR ${id}`, description: `Why ${id}: customers with 10+ orders get 5% off.`, status: "active",
  createdBy: { displayName: "Ada Lovelace", uniqueName: "ada@contoso.com" }, creationDate: "2026-10-01T09:00:00.0000000Z",
  isDraft: false, sourceRefName: src, targetRefName: "refs/heads/main", labels: [{ name: "payments", active: true }, { name: "old", active: false }],
  lastMergeSourceCommit: { commitId: "abc" }, ...extra,
});

test("azure adapter: az output becomes gh-shaped PR metadata", () => {
  const { exec, calls } = fakeRun([
    [/^az repos show/, { stdout: JSON.stringify({ defaultBranch: "refs/heads/main", remoteUrl: "https://contoso@dev.azure.com/contoso/Payments/_git/api", webUrl: "https://dev.azure.com/contoso/Payments/_git/api" }) }],
    [/^az repos pr list/, { stdout: JSON.stringify([{ pullRequestId: 7 }]) }],
    [/^az repos pr show --id 7/, { stdout: JSON.stringify(azPr(7, "refs/heads/feature/discount", { isDraft: true })) }],
    [/^az account get-access-token/, { stdout: "tok123\n" }],
  ]);
  const a = adapterFor(parseRepoEntry("azure:contoso/Payments/api"), { run: exec });
  assert.deepEqual(a.info(), { defaultBranch: "main", remoteUrl: "https://contoso@dev.azure.com/contoso/Payments/_git/api", webUrl: "https://dev.azure.com/contoso/Payments/_git/api" });
  const [p] = a.listOpen(50);
  assert.deepEqual(
    { n: p.number, author: p.author.login, url: p.url, base: p.baseRefName, head: p.headRefName, draft: p.isDraft, labels: p.labels, refs: p.headRefs },
    { n: 7, author: "ada@contoso.com", url: "https://dev.azure.com/contoso/Payments/_git/api/pullrequest/7", base: "main", head: "feature/discount", draft: true,
      labels: [{ name: "payments" }], refs: ["refs/heads/feature/discount", "refs/pull/7/merge"] });
  assert.ok(calls.some((c) => c.includes("--status active --top 50")));
  const env = a.gitEnv();
  assert.deepEqual([env.GIT_CONFIG_COUNT, env.GIT_CONFIG_KEY_0, env.GIT_CONFIG_VALUE_0], ["1", "http.extraHeader", "Authorization: Bearer tok123"]);
  assert.equal(a.readIssue, null);
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
    { number: 5, baseRefName: "main", headRefs: ["refs/heads/feature/discount"] },
    { number: 6, baseRefName: "main", headRefs: ["refs/heads/deleted", "refs/heads/also-deleted"] },
    // The first ref is gone, the fallback (Azure DevOps: refs/pull/<n>/merge) works.
    { number: 9, baseRefName: "main", headRefs: ["refs/heads/gone", "refs/heads/feature/discount"] },
  ];
  const c = syncCache({ entry, info, prs, adapter, home });
  const g = (...a) => execFileSync("git", ["--git-dir", c.dir, ...a], { encoding: "utf8" }).trim();
  assert.equal(c.dir, cacheDirOf(entry, home));
  assert.equal(g("rev-parse", "--is-bare-repository"), "true");
  assert.equal(g("config", "remote.origin.partialclonefilter"), "blob:none");
  assert.equal(g("config", "pr-triage.test"), "yes");
  assert.deepEqual(g("for-each-ref", "--format=%(refname)").split("\n"), ["refs/heads/main", prRef(5), prRef(9)]);
  assert.match(c.failed.get(6), /couldn.t find remote ref refs\/heads\/deleted/);
  assert.equal(c.failed.has(9), false);
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

test("azure end to end with a fake az: preflight table, cache, one queue, keyed tours, read-only calls", () => {
  const root = tmp();
  const home = join(root, "home");
  const bin = join(root, "bin");
  const work = join(root, "work");
  mkdirSync(join(home, ".config", "pr-triage"), { recursive: true });
  mkdirSync(bin);
  mkdirSync(work);
  const url = makeOrigin(join(root, "origin"));
  const remote = "https://contoso@dev.azure.com/contoso/Payments/_git/shop";
  // The Azure DevOps URL resolves to the local origin; nothing reaches the network.
  writeFileSync(join(home, ".gitconfig"), `[url "${url}"]\n\tinsteadOf = ${remote}\n`);
  writeFileSync(join(home, ".config", "pr-triage", "repos.jsonc"), JSON.stringify({ repos: ["azure:contoso/Payments/shop", "gitlab:x/y", "github:a/b"] }));
  const log = join(root, "az.log");
  const answers = {
    "repos show": { defaultBranch: "refs/heads/main", remoteUrl: remote, webUrl: "https://dev.azure.com/contoso/Payments/_git/shop" },
    "repos pr list": [{ pullRequestId: 7 }, { pullRequestId: 8 }],
    "repos pr show 7": azPr(7, "refs/heads/feature/discount", { title: "Apply the loyalty discount at checkout" }),
    "repos pr show 8": azPr(8, "refs/heads/feature/gone"),
  };
  writeFileSync(join(root, "answers.json"), JSON.stringify(answers));
  writeFileSync(join(bin, "az"), `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, a.join(" ") + "\\n");
const answers = JSON.parse(fs.readFileSync(${JSON.stringify(join(root, "answers.json"))}, "utf8"));
const say = (x) => { process.stdout.write(typeof x === "string" ? x : JSON.stringify(x)); process.exit(0); };
const line = a.join(" ");
if (line === "--version") say("azure-cli 2.65.0\\n");
if (line.startsWith("extension show --name azure-devops")) say("");
if (line.startsWith("account show")) say("");
if (line.startsWith("account get-access-token")) say("fake-token\\n");
if (line.startsWith("repos pr list")) say(answers["repos pr list"]);
if (line.startsWith("repos pr show")) say(answers["repos pr show " + a[a.indexOf("--id") + 1]]);
if (line.startsWith("repos show")) say(answers["repos show"]);
process.stderr.write("fake az: unexpected " + line + "\\n"); process.exit(2);
`);
  // gh is logged out here, so the GitHub row stops at the login check.
  writeFileSync(join(bin, "gh"), `#!/bin/sh\n[ "$1" = "--version" ] && echo "gh version 2.83.2" && exit 0\necho "You are not logged into any GitHub hosts." >&2\nexit 1\n`);
  chmodSync(join(bin, "az"), 0o755);
  chmodSync(join(bin, "gh"), 0o755);
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_NOSYSTEM: "1" };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;

  const r = spawnSync(process.execPath, [join(SCRIPTS, "triage.mjs")], { cwd: work, env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /azure:contoso\/Payments\/shop\s+azure\s+az\s+ready/);
  assert.match(r.stdout, /gitlab:x\/y\s+gitlab\s+—\s+GitLab is not supported yet/);
  assert.match(r.stdout, /github:a\/b\s+github\s+gh\s+not logged in — run: gh auth login/);

  const t = JSON.parse(readFileSync(join(work, ".pr-review", "triage.json"), "utf8"));
  assert.equal(t.repo, null);
  assert.deepEqual(t.prs.map((p) => [p.key, p.repo, p.number, p.labels]), [["contoso-Payments-shop-7", "contoso/Payments/shop", 7, ["payments"]]]);
  const shop = t.repos.find((x) => x.host === "azure");
  assert.deepEqual([shop.ready, shop.open, shop.skipped.map((s) => s.number)], [true, 2, [8]]);
  assert.deepEqual(t.repos.filter((x) => !x.ready).map((x) => x.id), ["gitlab:x/y", "github:a/b"]);

  const tour = JSON.parse(readFileSync(join(work, ".pr-review", "tour-contoso-Payments-shop-7.json"), "utf8"));
  assert.deepEqual(tour.files.map((f) => f.path).sort(), ["src/price.ts", "tests/price.test.ts"]);
  assert.equal(tour.host, "azure");
  assert.equal(tour.pr.url, "https://dev.azure.com/contoso/Payments/_git/shop/pullrequest/7");
  assert.ok(tour.intent.sources.some((s) => s.type === "description" && /10\+ orders/.test(s.text)));
  assert.ok(tour.intent.sources.some((s) => s.type === "commits" || s.type === "title"));
  // The judge's read commands work against the cache.
  const show = execFileSync("git", ["--git-dir", tour.read.gitDir, "show", `${tour.read.head}:src/price.ts`], { encoding: "utf8", env });
  assert.match(show, /orders >= 10/);
  assert.equal(tour.read.gitDir, join(home, ".cache", "pr-triage", "azure", "contoso", "Payments", "shop"));

  const html = readFileSync(join(work, ".pr-review", "review.html"), "utf8");
  assert.match(html, /"contoso-Payments-shop-7":\{"kind":"tour"/);
  // Read-only on the host: only show, list, version and token calls.
  const calls = readFileSync(log, "utf8").trim().split("\n");
  assert.ok(calls.every((c) => /^(--version|extension show|account show|account get-access-token|repos show|repos pr list|repos pr show)\b/.test(c)), calls.join("\n"));
  assert.ok(readdirSync(work).every((f) => f === ".pr-review"), "nothing else is written to the working folder");
});
