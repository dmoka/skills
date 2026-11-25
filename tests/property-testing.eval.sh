#!/usr/bin/env bash
# property-testing.eval.sh — live evals for skills/property-testing with `claude -p`.
# Usage: tests/property-testing.eval.sh <new-scratch-dir> [py|ts|rust|autopick|all]
#   py|ts|rust  copy tests/fixtures/property-testing/<fixture> (planted bugs: a withdraw off-by-one,
#               a roundtrip encode/decode bug, a needle at one magic value), install the skill,
#               run it headless, then check: both real bugs pinned as 'suspected bug' tests,
#               production code unchanged, a planted mutant per property, 0 escape hatches,
#               and the report names the needle as something property tests cannot see.
#   autopick    6 requests that never name the skill must pick it; 4 near misses must not.
# Costs real model calls and installs hypothesis/pytest (venv), fast-check/vitest (npm) or proptest (cargo)
# into <new-scratch-dir>. Never run it inside a real project.
set -euo pipefail

[ $# -ge 1 ] || { sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SKILL=$ROOT/skills/property-testing
FIX=$ROOT/tests/fixtures/property-testing
OUT=$1; WHICH=${2:-all}
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)

pass=0; fail=0
ok()   { pass=$((pass + 1)); echo "  PASS $*"; }
bad()  { fail=$((fail + 1)); echo "  FAIL $*"; }
expect() { local what=$1; shift; if "$@" >/dev/null 2>&1; then ok "$what"; else bad "$what"; fi; }

setup() {  # $1 = fixture name; prints the repo dir
  local d=$OUT/$1/repo
  mkdir -p "$d"; cp -R "$FIX/$1/." "$d/"
  case $1 in
    py-bank)     python3 -m venv "$OUT/$1/venv" >&2; "$OUT/$1/venv/bin/pip" install -q hypothesis pytest >&2
                 ln -s "$OUT/$1/venv" "$d/.venv" ;;
    ts-codec)    (cd "$d" && npm ci --silent) >&2 ;;
    rust-ledger) (cd "$d" && cargo fetch -q) >&2 ;;
  esac
  mkdir -p "$d/.claude/skills"; cp -R "$SKILL" "$d/.claude/skills/"
  printf '.claude/\n' >> "$d/.gitignore"
  git -C "$d" init -q -b main; git -C "$d" add -A
  git -C "$d" -c user.email=eval@example.com -c user.name=eval commit -qm fixture
  echo "$d"
}
run_claude() {  # $1 = dir; transcript lands in $1.transcript.jsonl
  mkdir -p "$OUT/tmp"
  (cd "$1" && TMPDIR="$OUT/tmp" claude -p "Use the property-testing skill on this repo. Nobody is around to answer questions." \
     --output-format stream-json --verbose --max-turns 150 --permission-mode bypassPermissions) > "$1.transcript.jsonl" 2>&1 || true
}
ran() { grep -Eq -- "\"command\":\"[^\"]*$2" "$1.transcript.jsonl"; }       # a Bash call ran this
said() { grep '"type":"result"' "$1.transcript.jsonl" | grep -Eiq -- "$2"; }     # the final report says it
tests_say() { grep -rEil -- "suspected bug" "$1" --include='*.py' --include='*.ts' --include='*.rs' | grep -v '/.claude/' | xargs grep -Eiq -- "$2"; }

eval_fixture() {  # $1 fixture, $2 source path, $3 withdraw regex, $4 roundtrip regex, $5 needle regex
  echo "== $1 =="
  local d; d=$(setup "$1")
  run_claude "$d"
  expect "used the property-testing skill" grep -q '"skill":"property-testing"' "$d.transcript.jsonl"
  expect "production code unchanged ($2)" git -C "$d" diff --quiet HEAD -- "$2"
  expect "withdraw off-by-one pinned as a suspected bug" tests_say "$d" "$3"
  expect "roundtrip bug pinned as a suspected bug" tests_say "$d" "$4"
  expect "a mutant was planted with plant-mutant.sh" ran "$d" 'plant-mutant\.sh'
  expect "the report has a mutant record (file:line)" said "$d" "[a-z_/]+\\.(py|ts|rs):[0-9]+"
  expect "escape hatches: 0" bash -c "cd '$d' && '$SKILL/scripts/escape-hatches.sh' main"
  expect "the report names the needle as unseen ($5)" said "$d" "$5"
}

eval_autopick() {
  local d=$OUT/autopick/app
  mkdir -p "$d"; git -C "$d" init -q; mkdir -p "$d/.claude/skills"; cp -R "$SKILL" "$d/.claude/skills/"
  local yes=(
    "Add property-based tests for our money helpers with Hypothesis."
    "Write fast-check tests that check decode(encode(x)) == x for every input."
    "I want generative tests for this parser: for all inputs it must not crash and must round-trip."
    "Set up proptest for the ledger crate and test withdraw for all balances and amounts."
    "Our state machine for the shopping cart keeps breaking. Write model-based tests that run random command sequences."
    "Can you write QuickCheck-style tests for the fee calculation in this Java service with jqwik?"
  )
  local no=(
    "Write a unit test for the login function: a wrong password returns 401."
    "Run mutation testing on src/domain and tell me which mutants survive."
    "This module has no tests at all and I need to refactor it. Where do I start?"
    "Fix the failing CI build: the TypeScript compiler complains about a missing type."
  )
  for mode in all-installed project-only; do
    echo "== autopick ($mode skills) =="
    local env=(); [ $mode = project-only ] && env=(FIRES_ONLY_PROJECT=1)
    (cd "$d" && env "${env[@]+"${env[@]}"}" "$ROOT/skills/write-great-skill/scripts/fires.sh" property-testing "${yes[@]}" --not "${no[@]}") | sed 's/^/  /' || true
  done
}

py()   { eval_fixture py-bank bank 'withdraw' 'memo|encode|decode' '3.?133.?700|_LEGACY_FLAT'; }
ts()   { eval_fixture ts-codec src 'withdraw' 'params|encode|decode' '123.?457|REPRICED_SKU_TOTAL'; }
rust() { eval_fixture rust-ledger src 'withdraw' 'rle|encode|decode' '4.?000.?037|AUDIT_BALANCE'; }

case $WHICH in
  py) py ;; ts) ts ;; rust) rust ;; autopick) eval_autopick ;;
  all) py; ts; rust; eval_autopick ;;
  *) echo "unknown eval: $WHICH" >&2; exit 2 ;;
esac
[ "$WHICH" = autopick ] || echo "checks: $pass passed, $fail failed (transcripts: $OUT/*/repo.transcript.jsonl)"
