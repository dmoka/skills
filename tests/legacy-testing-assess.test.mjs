import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ASSESS = fileURLToPath(new URL("../skills/legacy-testing/scripts/assess.sh", import.meta.url));

// The repo is written at test time: committed .test.ts fixtures would be picked up by test runners.
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "assess-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

function assess(cwd, ...args) {
  const r = spawnSync("bash", [ASSESS, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// One section of the output, from its "== title" line to the next section.
const section = (out, title) => out.split("\n== ").find((s) => s.startsWith(title)) ?? "";

const ticketbay = () =>
  repo({
    "package.json": '{ "devDependencies": { "vitest": "1" } }',
    "src/db/admin-queries.ts": "export function overview(x) { if (x) return 1; return 0; }\n",
    "src/db/orders-repo.ts": "export function find(id) { if (!id) throw new Error(); return id > 0 ? 1 : 2; }\n",
    "src/lib/money.ts": "export const add = (a, b) => a + b;\n",
    "tests/integration/admin-queries.test.ts": 'import { overview } from "../../src/db/admin-queries";\n',
    ".stryker-tmp/sandbox-1/tests/orders-repo.test.ts": 'import { find } from "../src/db/orders-repo";\n',
  });

test("a file target: finds the test in another folder that imports it", () => {
  const { code, out } = assess(ticketbay(), "src/db/admin-queries.ts");
  assert.equal(code, 0);
  assert.match(section(out, "Counts"), /source files under src\/db\/admin-queries\.ts: 1/);
  assert.match(section(out, "Tests that reference"), /src\/db\/admin-queries\.ts\n  <- tests\/integration\/admin-queries\.test\.ts/);
  assert.match(section(out, "Source files no test"), /\(none\)/);
  assert.doesNotMatch(out, /no test files/);
});

test("a file target with no test: listed as untested, no reference", () => {
  const { out } = assess(ticketbay(), "src/lib/money.ts");
  assert.match(section(out, "Tests that reference"), /\(none\)/);
  assert.match(section(out, "Source files no test"), /src\/lib\/money\.ts/);
});

test("a folder target: tests are searched in the whole repo, paths stay repo-relative", () => {
  for (const target of ["src/db", "src/db/", "./src/db"]) {
    const { out } = assess(ticketbay(), target);
    assert.match(section(out, "Counts"), /source files under src\/db: 2\ntest files in the repo:  1/, target);
    assert.match(section(out, "Tests that reference"), /src\/db\/admin-queries\.ts\n  <- tests\/integration\/admin-queries\.test\.ts/, target);
    assert.match(section(out, "Source files no test"), /branches .* src\/db\/orders-repo\.ts/, target);
    assert.doesNotMatch(section(out, "Source files no test"), /admin-queries|money/, target);
  }
});

test("Stryker sandbox copies are not counted as tests", () => {
  const { out } = assess(ticketbay());
  assert.match(section(out, "Counts"), /test files in the repo:  1\n/);
  assert.match(section(out, "Source files no test"), /src\/db\/orders-repo\.ts/);
});

test("python: a test importing the module by its dotted path counts", () => {
  const dir = repo({
    "pyproject.toml": "[tool.pytest.ini_options]\n",
    "app/billing/invoice.py": "def total(x):\n    if x:\n        return 1\n",
    "tests/test_invoice.py": "from app.billing.invoice import total\n",
  });
  const { out } = assess(dir, "app/billing/invoice.py");
  assert.match(section(out, "Tests that reference"), /app\/billing\/invoice\.py\n  <- tests\/test_invoice\.py/);
});

test("a repo with no tests says so", () => {
  const { out } = assess(repo({ "src/a.ts": "export const a = 1;\n" }), "src");
  assert.match(out, /no test files in the repo/);
});

test("a path that does not exist exits 2 with a message", () => {
  const { code, err } = assess(ticketbay(), "src/nope.ts");
  assert.equal(code, 2);
  assert.match(err, /src\/nope\.ts: no such file or directory/);
});
