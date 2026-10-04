import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkSkill, parseFrontmatter, firstSentence } from "../skills/write-great-skill/scripts/check-skill.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const fx = (name) => here(`./fixtures/write-great-skill/${name}`);
const has = (list, re) => list.some((m) => re.test(m));

test("frontmatter: quoted, folded and plain descriptions", () => {
  assert.equal(parseFrontmatter('---\nname: a\ndescription: "x: \\"y\\""\n---\n').fm.description, 'x: "y"');
  assert.equal(parseFrontmatter("---\nname: a\ndescription: >\n  one\n  two\n---\n").fm.description, "one two");
  assert.equal(parseFrontmatter("---\nname: a\ndescription: one\n  two\n---\n").fm.description, "one two");
  assert.equal(parseFrontmatter("no frontmatter"), null);
});

test("first sentence ends at the first period followed by a space", () => {
  assert.equal(firstSentence("Write or improve an agent skill (SKILL.md + scripts). Use when x."), "Write or improve an agent skill (SKILL.md + scripts).");
});

test("a good skill passes with no warnings; line refs into the project are not checked", () => {
  const r = checkSkill(fx("good-skill"));
  assert.deepEqual([r.fails, r.warns], [[], []]);
});

test("a bad skill fails on name, placeholder and missing file, and warns on the rest", () => {
  const { fails, warns } = checkSkill(fx("bad-skill"));
  assert.ok(has(fails, /name "Bad_Skill": use lowercase/));
  assert.ok(has(fails, /differs from the folder name/));
  assert.ok(has(fails, /placeholder left: TODO/));
  assert.ok(has(fails, /links to references\/missing\.md/));
  assert.ok(has(warns, /no "Use when/));
  assert.ok(has(warns, /too vague/));
  assert.ok(has(warns, /filler "make sure"/));
  assert.ok(has(warns, /filler "best practice"/));
  assert.ok(has(warns, /no Gotchas section/));
  assert.ok(has(warns, /scripts\/go\.sh is run directly but is not executable/));
});

test("a folded description is read whole", () => {
  const r = checkSkill(fx("folded-skill"));
  assert.deepEqual(r.fails, []);
  assert.equal(r.facts.firstSentence, "Rotate the API keys for the billing service.");
});

test("description over the spec limit warns; over the Claude Code cap fails", () => {
  assert.ok(has(checkSkill(fx("spec-length")).warns, /Agent Skills spec allows 1024/));
  assert.deepEqual(checkSkill(fx("spec-length")).fails, []);
  assert.ok(has(checkSkill(fx("too-long")).fails, /Claude Code cuts it at 1536/));
});

test("every skill in this repo passes (no FAIL)", () => {
  for (const name of readdirSync(here("../skills"))) {
    const { fails } = checkSkill(here(`../skills/${name}`));
    assert.deepEqual(fails, [], name);
  }
});
