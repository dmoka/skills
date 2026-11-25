#!/usr/bin/env bash
# escape-hatches.sh — count the escape hatches a change adds to property tests. Read-only.
# Usage: scripts/escape-hatches.sh <base-ref> [path ...]
#   Compares <base-ref> with the working tree (committed, staged, unstaged and new untracked files).
#   Only files that use a property library (Hypothesis, fast-check, proptest, jqwik, FsCheck,
#   CsCheck, rapid, QuickCheck) or set its run count (PROPTEST_CASES ...) are scanned.
#   An escape hatch: a new discard (assume(, prop_assume!, fc.pre, .filter(, Assume.that, ==>),
#   a health-check suppression, deadline=None, a skip marker, or a run count below MIN_RUNS (default 25)
#   or lower than the count it replaced in the same file.
# Prints one line per hatch (file:line kind text), then "escape hatches: N".
# Exit 0 when N is 0, 1 when N > 0, 2 on bad usage.
set -euo pipefail

[ $# -ge 1 ] || { sed -n '3,11p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
base=$1; shift
git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repository: $(pwd)" >&2; exit 2; }
git rev-parse --verify -q "$base^{commit}" >/dev/null || { echo "unknown base ref: $base" >&2; exit 2; }
MIN_RUNS=${MIN_RUNS:-25}
cd "$(git rev-parse --show-toplevel)"

LIBS='hypothesis|fast-check|fast_check|proptest|jqwik|fscheck|cscheck|pgregory\.net/rapid|rapid\.check|quickcheck'

# Unified diff of tracked files, then every untracked file as an all-added diff.
diff_all() {
  git diff --no-color --no-ext-diff -U0 "$base" -- "$@"
  git ls-files --others --exclude-standard -z -- "$@" | while IFS= read -r -d '' f; do
    git diff --no-color --no-index -U0 /dev/null "$f" || true
  done
}

is_pbt_file() { [ -f "$1" ] && grep -Eiq "$LIBS" "$1"; }

hits=0
current=""; pbt=0; newline=0; removed_max=""
report() { hits=$((hits + 1)); printf '%s:%s  %-22s %s\n' "$current" "$newline" "$1" "$(printf '%s' "$2" | sed 's/^[[:space:]]*//' | cut -c1-120)"; }

# The run count a line sets, or empty.
run_count() {
  printf '%s' "$1" | grep -Eo '(^|[^A-Za-z_])(max_examples|numRuns|num_runs|cases|tries|MaxTest|WithMaxTest|iter|rapid\.checks|PROPTEST_CASES|with_cases)[[:space:]]*[:=(][[:space:]]*[0-9_]+' \
    | grep -Eo '[0-9_]+$' | tr -d _ | head -1 || true
}

while IFS= read -r line; do
  case $line in
    '+++ '*)
      f=${line#+++ }; f=${f#b/}
      current=$f; removed_max=""
      if [ "$f" != /dev/null ] && is_pbt_file "$f"; then pbt=1; else pbt=0; fi
      continue ;;
    '--- '*) continue ;;
    '@@ '*)
      newline=$(printf '%s' "$line" | sed -E 's/^@@ -[0-9,]+ \+([0-9]+).*/\1/')
      continue ;;
  esac
  [ "$pbt" = 1 ] || continue
  case $line in
    -*)
      n=$(run_count "${line#-}")
      if [ -n "$n" ] && { [ -z "$removed_max" ] || [ "$n" -gt "$removed_max" ]; }; then removed_max=$n; fi
      continue ;;
    +*) text=${line#+} ;;
    *) continue ;;
  esac
  # A comment line (# or //) is skipped; a Rust attribute (#[ or #![) is code.
  code=$(printf '%s' "$text" | sed -E 's/^[[:space:]]*(#([^[!]|$)|\/\/).*$//')
  if [ -n "$code" ]; then
    printf '%s' "$code" | grep -Eq 'prop_assume!'                                 && report "discard prop_assume!" "$text"
    printf '%s' "$code" | grep -Eq '(^|[^_a-zA-Z.:])assume\(|hypothesis\.assume\(' && report "discard assume()" "$text"
    printf '%s' "$code" | grep -Eq '(^|[^A-Za-z_.])(fc\.)?pre\(' && report "discard fc.pre" "$text"
    printf '%s' "$code" | grep -Eq '\.(prop_)?filter(_map)?\(|\.Where\(|Gen\.filter|Arb\.filter|\.Filter\(' && report "discard filter" "$text"
    printf '%s' "$code" | grep -Eq 'Assume\.that\(|@Assume|==>' && report "discard assume (jvm/.NET)" "$text"
    printf '%s' "$code" | grep -Eq 'suppress_health_check|HealthCheck\.' && report "health check suppressed" "$text"
    printf '%s' "$code" | grep -Eq 'deadline[[:space:]]*=[[:space:]]*None' && report "deadline removed" "$text"
    printf '%s' "$code" | grep -Eq '@pytest\.mark\.skip|pytest\.skip\(|\b(it|test|describe)\.skip\(|\bx(it|test|describe)\(|#\[ignore\]|@Disabled|t\.Skip\(|Skip[[:space:]]*=' && report "property skipped" "$text"
    n=$(run_count "$code")
    if [ -n "$n" ]; then
      if [ "$n" -lt "$MIN_RUNS" ]; then report "run count $n < $MIN_RUNS" "$text"
      elif [ -n "$removed_max" ] && [ "$n" -lt "$removed_max" ]; then report "run count lowered $removed_max->$n" "$text"
      fi
    fi
  fi
  newline=$((newline + 1))
done < <(diff_all "$@")

echo "escape hatches: $hits"
[ "$hits" -eq 0 ]
