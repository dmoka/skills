#!/usr/bin/env node
// shared/*.mjs is the source of truth. Each skill carries an identical copy so
// it installs with one `cp -r`. `node tools/sync-shared.mjs` copies;
// `--check` fails if any copy drifted (run it before every commit).
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

// shared/*.mjs -> <skill>/scripts/, shared/*.md -> <skill>/references/
const SKILLS = ["skills/pr-triage", "skills/pr-tour"];
const check = process.argv.includes("--check");
let drift = 0;
for (const name of readdirSync("shared").filter((f) => /\.(mjs|md)$/.test(f))) {
  const src = readFileSync(`shared/${name}`, "utf8");
  for (const dir of SKILLS) {
    const sub = name.endsWith(".md") ? "references" : "scripts";
    mkdirSync(`${dir}/${sub}`, { recursive: true });
    const dst = `${dir}/${sub}/${name}`;
    const same = existsSync(dst) && readFileSync(dst, "utf8") === src;
    if (same) continue;
    if (check) { console.error(`drift: ${dst} differs from shared/${name}`); drift++; }
    else { writeFileSync(dst, src); console.log(`synced ${dst}`); }
  }
}
if (drift) { console.error("run: node tools/sync-shared.mjs"); process.exit(1); }
