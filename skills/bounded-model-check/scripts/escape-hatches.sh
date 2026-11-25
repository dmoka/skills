#!/usr/bin/env bash
# escape-hatches.sh — list every escape hatch added since a base ref (committed, staged, unstaged, untracked).
# Usage: scripts/escape-hatches.sh <base-ref>      run inside the repo, e.g. scripts/escape-hatches.sh main
# An escape hatch is a line that lets a check pass without checking: an assumption, a lowered
# loop bound, a switched-off check, a stub, or code hidden from the checker.
# Prints "file:line  KIND  text" per hatch, then a count. Exit 0 when none, 1 when any.
# Every hatch it lists needs a stated reason and the user's approval before the run counts.
set -euo pipefail
export LC_ALL=C

[ $# -eq 1 ] || { sed -n '3,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
base=$1
git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repo" >&2; exit 2; }
git rev-parse --verify -q "$base^{commit}" >/dev/null || { echo "unknown ref: $base" >&2; exit 2; }

# kind<TAB>extended regex, matched against added lines
patterns=$(cat <<'P'
assume	kani::assume|kani::any_where|__CPROVER_assume|__ESBMC_assume|__VERIFIER_assume|assume_abort_if_not|CProver\.assume|Verifier\.assume
stub	#\[kani::stub|#\[kani::stub_verified|__CPROVER_havoc_object
hidden	cfg\(not\(kani\)\)|#ifndef[[:space:]]+__CPROVER|#if[[:space:]]+!defined\(__CPROVER
expect-panic	#\[kani::should_panic\]
check-off	--no-unwinding-checks|--no-unwinding-assertions|unwinding-checks[[:space:]]*=[[:space:]]*false|--no-standard-checks|--no-bounds-check|--no-pointer-check|--no-overflow-check|--no-signed-overflow-check|--no-div-by-zero-check|--no-assertions|--partial-loops|--no-assertion-reach-checks|--property[ =]
precondition	^[[:space:]]*(pre|#[[:space:]]*pre):|@icontract\.require|@deal\.pre
P
)

# One stream of "file<TAB>line<TAB>sign<TAB>text" for the diff plus untracked files.
added_lines() {
  git diff --no-color --no-ext-diff -U0 "$base" -- . | awk '
    /^\+\+\+ / { f = substr($0, 7); next }
    /^@@ / { split($3, a, ","); n = substr(a[1], 2) + 0; next }
    /^\+/ { t = substr($0, 2); gsub(/\t/, " ", t); printf "%s\t%d\t+\t%s\n", f, n, t; n++; next }
    /^-/ && !/^--- / { t = substr($0, 2); gsub(/\t/, " ", t); printf "%s\t0\t-\t%s\n", f, t }'
  git ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do
    case $f in target/*|*/target/*|node_modules/*|.bmc/*) continue ;; esac   # build output, logs
    grep -Iq . "$f" 2>/dev/null || continue                                 # binary or empty
    awk -v f="$f" '{ t = $0; gsub(/\t/, " ", t); printf "%s\t%d\t+\t%s\n", f, NR, t }' "$f"
  done
}

lines=$(added_lines)
found=0
while IFS=$'\t' read -r kind re; do
  [ -n "$kind" ] || continue
  while IFS=$'\t' read -r f n sign text; do
    [ "$sign" = + ] || continue
    printf '%s:%s  %-12s %s\n' "$f" "$n" "$kind" "$(printf '%s' "$text" | sed 's/^[[:space:]]*//')"
    found=$((found + 1))
  done < <(printf '%s\n' "$lines" | RE="$re" awk -F'\t' '$3 == "+" && $4 ~ ENVIRON["RE"]')
done <<<"$patterns"

# Lowered loop bounds: an unwind value added in a file where a larger one was removed.
while IFS=$'\t' read -r f n text; do
  printf '%s:%s  %-12s %s\n' "$f" "$n" lowered-bound "$(printf '%s' "$text" | sed 's/^[[:space:]]*//')"
  found=$((found + 1))
done < <(printf '%s\n' "$lines" | awk -F'\t' '
  function val(s) { if (match(s, /(unwind\(|--unwind[ =]|--default-unwind[ =]|default-unwind[ ]*=[ ]*)[0-9]+/)) { t = substr(s, RSTART, RLENGTH); gsub(/[^0-9]/, "", t); return t + 0 } return -1 }
  { v = val($4); if (v < 0) next
    if ($3 == "-") { if (v > maxrm[$1]) maxrm[$1] = v }
    else { add[++k] = $1 "\t" $2 "\t" $4; addv[k] = v } }
  END { for (i = 1; i <= k; i++) { split(add[i], p, "\t"); if (p[1] in maxrm && addv[i] < maxrm[p[1]]) print add[i] } }')

echo "$found new escape hatch(es) since $base"
[ "$found" -eq 0 ]
