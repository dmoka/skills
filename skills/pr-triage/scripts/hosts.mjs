// Host adapters for many repos: GitHub through `gh`, Azure DevOps through `az`
// (with the azure-devops extension). Each one lists the open PRs with their
// text, names the git ref that holds each PR head, and lends git the login the
// user already has. Code itself is read from the cache (cache.mjs), not here.
//
// adapter.info()          -> { defaultBranch, remoteUrl, webUrl }
// adapter.listOpen(limit) -> PR metadata in `gh pr view --json` shape, plus
//                            headRefs: the refs to fetch, first that works wins
// adapter.readIssue(n)    -> { number, title, body } | null (null: the host has none)
// adapter.gitEnv()        -> env for git fetches (the credential, never written to disk)
// adapter.gitConfig       -> config written into the cache, so later reads can fetch

import { run as defaultRun, firstLine } from "./repos.mjs";

// The Azure DevOps resource id: `az account get-access-token --resource` for git.
const AZURE_DEVOPS = "499b84ac-1321-427f-aa17-267ca6975798";

const branchOf = (ref) => String(ref ?? "").replace(/^refs\/heads\//, "");

// Config passed to git through the environment: it applies to this command
// only and is never written to a file.
export function gitConfigEnv(pairs) {
  const env = { GIT_CONFIG_COUNT: String(pairs.length) };
  pairs.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v; });
  return env;
}

export function adapterFor(entry, { run = defaultRun } = {}) {
  const call = (cmd, args) => {
    const r = run(cmd, args);
    if (!r.ok) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed: ${firstLine(r.stderr) || `exit ${r.code}`}`);
    return r.stdout;
  };
  const json = (cmd, args) => JSON.parse(call(cmd, args));
  if (entry.host === "github") return github(entry.path, json);
  if (entry.host === "azure") return azure(entry.path, json, call);
  throw new Error(`${entry.id}: no adapter for host "${entry.host}"`);
}

function github(repo, json) {
  // gh is the credential helper: git asks it for the login it already has.
  const helper = [["credential.https://github.com.helper", ""], ["credential.https://github.com.helper", "!gh auth git-credential"]];
  return {
    info() {
      const r = json("gh", ["repo", "view", repo, "--json", "defaultBranchRef,url"]);
      return { defaultBranch: r.defaultBranchRef?.name, remoteUrl: `https://github.com/${repo}.git`, webUrl: r.url };
    },
    listOpen(limit = 100) {
      const fields = "number,title,body,author,url,baseRefName,headRefName,headRefOid,createdAt,isDraft,labels,closingIssuesReferences";
      return json("gh", ["pr", "list", "--repo", repo, "--state", "open", "--limit", String(limit), "--json", fields])
        // refs/pull/<n>/head exists for every PR, forks included.
        .map((p) => ({ ...p, headRefs: [`refs/pull/${p.number}/head`] }));
    },
    readIssue(n) { return json("gh", ["issue", "view", String(n), "--repo", repo, "--json", "number,title,body"]); },
    gitEnv: () => gitConfigEnv(helper),
    gitConfig: helper,
  };
}

function azure(path, json, call) {
  const [org, project, name] = path.split("/");
  const orgUrl = `https://dev.azure.com/${org}`;
  let webUrl = null;
  return {
    info() {
      const r = json("az", ["repos", "show", "--repository", name, "--project", project, "--org", orgUrl, "--output", "json"]);
      webUrl = r.webUrl ?? `${orgUrl}/${encodeURIComponent(project)}/_git/${encodeURIComponent(name)}`;
      return { defaultBranch: branchOf(r.defaultBranch), remoteUrl: r.remoteUrl ?? webUrl, webUrl };
    },
    listOpen(limit = 100) {
      const ids = json("az", ["repos", "pr", "list", "--repository", name, "--project", project, "--org", orgUrl, "--status", "active", "--top", String(limit), "--output", "json"])
        .map((p) => p.pullRequestId);
      // The list can shorten descriptions; `pr show` gives the whole text.
      return ids.map((id) => {
        const p = json("az", ["repos", "pr", "show", "--id", String(id), "--org", orgUrl, "--output", "json"]);
        return {
          number: p.pullRequestId,
          title: p.title ?? "",
          body: p.description ?? "",
          author: { login: p.createdBy?.uniqueName ?? p.createdBy?.displayName ?? null },
          url: `${webUrl ?? `${orgUrl}/${encodeURIComponent(project)}/_git/${encodeURIComponent(name)}`}/pullrequest/${p.pullRequestId}`,
          baseRefName: branchOf(p.targetRefName),
          headRefName: branchOf(p.sourceRefName),
          headRefOid: p.lastMergeSourceCommit?.commitId ?? null,
          createdAt: p.creationDate,
          isDraft: !!p.isDraft,
          labels: (p.labels ?? []).filter((l) => l.active !== false).map((l) => ({ name: l.name })),
          closingIssuesReferences: [],
          // The source branch; for a PR from a fork, the merge ref Azure DevOps keeps.
          headRefs: [p.sourceRefName, `refs/pull/${p.pullRequestId}/merge`].filter(Boolean),
        };
      });
    },
    readIssue: null, // work items are not read; the description and commits carry the intent
    gitEnv() {
      // The token of the user's `az login`, sent as a header for this fetch only.
      // Without one, git falls back to the user's own credential manager.
      try {
        const token = call("az", ["account", "get-access-token", "--resource", AZURE_DEVOPS, "--query", "accessToken", "--output", "tsv"]).trim();
        return token ? gitConfigEnv([["http.extraHeader", `Authorization: Bearer ${token}`]]) : {};
      } catch { return {}; }
    },
    gitConfig: [],
  };
}
