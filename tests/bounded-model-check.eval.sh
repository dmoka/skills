#!/usr/bin/env bash
# bounded-model-check.eval.sh — trigger evals for skills/bounded-model-check with `claude -p`.
# Usage: tests/bounded-model-check.eval.sh <new-scratch-dir> [all-installed|project-only|both]
#   6 requests that never name the skill must pick it; 4 near-miss requests must not.
#   project-only loads only the skills in the scratch project (FIRES_ONLY_PROJECT=1).
# Costs real model calls. Writes into <new-scratch-dir> only.
set -euo pipefail

[ $# -ge 1 ] || { sed -n '3,7p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$1; MODE=${2:-both}
d=$OUT/autopick/app
mkdir -p "$d/.claude/skills" "$d/src"
git -C "$d" init -q
cp -R "$ROOT/skills/bounded-model-check" "$d/.claude/skills/"
printf '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n' >"$d/Cargo.toml"
printf 'pub fn payload(buf: &[u8]) -> &[u8] {\n    let len = buf[0] as usize;\n    &buf[1..1 + len]\n}\n' >"$d/src/lib.rs"

yes=(
  "Can you prove that payload() in src/lib.rs never panics, for every possible input buffer?"
  "I want to run Kani on this crate. Set up proof harnesses for the parser."
  "Our property tests pass but I want more than property tests: check this length-prefixed parser exhaustively for out-of-bounds reads."
  "Is there any input where this midpoint calculation (low + high) / 2 overflows? I want a proof, not a sample."
  "We have a C TLV parser in firmware. Use CBMC to check it for buffer overreads."
  "There's unsafe Rust in our ring buffer. Can we formally verify the index math up to some bound?"
)
no=(
  "Add property-based tests with proptest for the parser in src/lib.rs."
  "Write a TLA+ spec for our payment retry flow to find race conditions."
  "Run cargo-mutants on this crate and tell me which mutants survive."
  "Fix the out-of-bounds panic in payload() in src/lib.rs."
)
modes=(all-installed project-only); [ "$MODE" = both ] || modes=("$MODE")
for mode in "${modes[@]}"; do
  echo "== autopick ($mode skills) =="
  env=(); [ "$mode" = project-only ] && env=(FIRES_ONLY_PROJECT=1)
  (cd "$d" && env "${env[@]+"${env[@]}"}" "$ROOT/skills/write-great-skill/scripts/fires.sh" bounded-model-check "${yes[@]}" --not "${no[@]}") | sed 's/^/  /' || true
done
