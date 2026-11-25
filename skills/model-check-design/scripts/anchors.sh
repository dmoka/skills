#!/usr/bin/env bash
# anchors.sh — check that every variable and action of a model points at the code it models.
# Usage: scripts/anchors.sh <Spec.tla> [--repo <dir>]
#   The spec carries one header line and one anchor line per variable and per action:
#     \* sync: <commit>
#     \* anchor <Name>: <path>:<line>[-<line>]@<commit>   (repeat for a step spread over places)
#     \* anchor <Name>: model-only — <why the code has no such thing>
#   Exit 1 when a variable or action has no anchor, an anchor names another commit than
#   the sync commit, or (with --repo) the commit, file or line does not exist in that repo.
set -euo pipefail

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
[ $# -ge 1 ] || usage
case $1 in -h|--help) usage ;; esac
SPEC=$1; shift; REPO=""
[ "${1:-}" = --repo ] && { REPO=${2:?--repo needs a dir}; shift 2; }
[ -f "$SPEC" ] || { echo "spec not found: $SPEC" >&2; exit 2; }
TLA="$(dirname "$0")/tla.pl"

sync=$(sed -n 's/^[[:space:]]*\\\*[[:space:]]*sync:[[:space:]]*\([0-9a-fA-F]\{7,40\}\).*/\1/p' "$SPEC" | head -1)
bad=0
if [ -z "$sync" ]; then echo "MISSING  header '\\* sync: <commit>' (the commit the model was read from)"; bad=1
else echo "sync commit: $sync"; fi

anchors=$(sed -n 's/^.*\\\*[[:space:]]*anchor[[:space:]]\{1,\}\([A-Za-z_][A-Za-z0-9_]*\)[[:space:]]*:[[:space:]]*\(.*\)$/\1	\2/p' "$SPEC")
names=$( { "$TLA" vars "$SPEC" | sed 's/^/variable /'; "$TLA" actions "$SPEC" | sed 's/^/action /'; } )
[ -n "$names" ] || { echo "no variables or actions found in $SPEC" >&2; exit 2; }

while read -r kind name; do
  mine=$(awk -F'\t' -v n="$name" '$1==n{print $2}' <<<"$anchors")
  if [ -z "$mine" ]; then echo "MISSING  $kind $name has no '\\* anchor $name: <path>:<line>@<commit>' line"; bad=1; continue; fi
  while IFS= read -r a; do
    case $a in model-only*) echo "ok       $kind $name: $a"; continue ;; esac
    if ! [[ $a =~ ^([^[:space:]:@]+):([0-9]+)(-([0-9]+))?@([0-9a-fA-F]{7,40}) ]]; then
      echo "BROKEN   $kind $name: '$a' is not <path>:<line>@<commit> or model-only — <why>"; bad=1; continue; fi
    path=${BASH_REMATCH[1]} line=${BASH_REMATCH[2]} last=${BASH_REMATCH[4]:-${BASH_REMATCH[2]}} commit=${BASH_REMATCH[5]}
    if [ -n "$sync" ] && [[ $commit != "$sync"* && $sync != "$commit"* ]]; then
      echo "STALE    $kind $name: anchor at $commit, sync commit is $sync"; bad=1; continue; fi
    if [ -n "$REPO" ]; then
      if ! n=$(git -C "$REPO" show "$commit:$path" 2>/dev/null | wc -l | tr -d ' '); then
        echo "BROKEN   $kind $name: $path does not exist at $commit in $REPO"; bad=1; continue; fi
      if [ "$n" -eq 0 ] || [ "$last" -gt "$n" ]; then echo "BROKEN   $kind $name: $path has $n lines at $commit, anchor says $last"; bad=1; continue; fi
      echo "ok       $kind $name: $path:$line  $(git -C "$REPO" show "$commit:$path" | sed -n "${line}p" | sed 's/^[[:space:]]*//' | cut -c1-80)"
    else
      echo "ok       $kind $name: $a"
    fi
  done <<<"$mine"
done <<<"$names"
[ $bad -eq 0 ] && echo "ANCHORS OK" || { echo "ANCHORS INCOMPLETE"; exit 1; }
