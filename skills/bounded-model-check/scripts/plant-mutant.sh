#!/usr/bin/env bash
# plant-mutant.sh — prove a harness can fail: plant one bug, run the checker, restore the file.
# Usage: scripts/plant-mutant.sh <file> <line> '<old>' '<new>' -- <command...>
#   e.g. scripts/plant-mutant.sh src/lib.rs 12 'a.checked_add(b)' 'Some(a.wrapping_add(b))' \
#          -- scripts/bmc-run.sh .bmc/m1.log cargo kani --harness add_fee_never_overflows
# <old> must occur exactly once on <line>. The file is restored byte for byte on every exit path.
# CAUGHT when the command exits 10 (bmc-run.sh: FAILED); MISSED on 0 (still VERIFIED);
# INVALID on any other exit (the mutant did not compile, or the bound or covers broke).
# Prints the record line:  mutant: <file>:<line> '<old>' -> '<new>'  CAUGHT|MISSED|INVALID
set -euo pipefail

usage() { sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
[ $# -ge 6 ] && [ "$5" = "--" ] || usage
file=$1; line=$2; old=$3; new=$4; shift 5
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 2; }
[[ "$line" =~ ^[0-9]+$ ]] || { echo "line must be a number: $line" >&2; exit 2; }
[ "$old" != "$new" ] || { echo "old and new are the same" >&2; exit 2; }

hits=$(OLD="$old" awk -v n="$line" 'NR == n { s = $0; c = 0; while ((i = index(s, ENVIRON["OLD"])) > 0) { c++; s = substr(s, i + length(ENVIRON["OLD"])) } print c }' "$file")
[ "${hits:-0}" = 1 ] || { echo "'$old' occurs ${hits:-0} times on $file:$line (need exactly 1)" >&2; exit 2; }

backup=$(mktemp "${TMPDIR:-/tmp}/plant-mutant.XXXXXX")
cp -p "$file" "$backup"
restore() { cp -p "$backup" "$file"; cmp -s "$backup" "$file" || echo "WARNING: $file was not restored; the original is at $backup" >&2; }
trap restore EXIT

OLD="$old" NEW="$new" awk -v n="$line" 'NR == n { i = index($0, ENVIRON["OLD"]); $0 = substr($0, 1, i - 1) ENVIRON["NEW"] substr($0, i + length(ENVIRON["OLD"])) } { print }' "$backup" >"$file"
echo "planted: $file:$line"
sed -n "${line}p" "$file"

set +e
"$@"
rc=$?
set -e

case $rc in
  10) verdict=CAUGHT ;;
  0) verdict=MISSED ;;
  *) verdict="INVALID (exit $rc)" ;;
esac
echo "mutant: $file:$line '$old' -> '$new'  $verdict"
[ $rc = 10 ]
