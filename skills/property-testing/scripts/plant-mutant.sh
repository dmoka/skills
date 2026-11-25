#!/usr/bin/env bash
# plant-mutant.sh — prove a property can fail: plant one mutant, run the property, restore the file.
# Usage: scripts/plant-mutant.sh <file> <line> '<old>' '<new>' -- <test command ...>
#   Replaces the first literal <old> on <line> of <file> with <new>, runs the test command,
#   and restores the original file in every case (success, failure, Ctrl-C).
#   Run the narrowest command that runs only the property under check.
# Prints the last 20 lines of the test output and a record line:
#   mutant: <file>:<line> '<old>' -> '<new>'  KILLED | SURVIVED
# Exit 0: KILLED (the test command failed: the property can fail).
# Exit 1: SURVIVED (the test command passed: the property is vacuous for this mutant).
# Exit 2: bad usage, <old> not on <line>, or the file was not restored.
set -euo pipefail

[ $# -ge 6 ] && [ "$5" = "--" ] || { sed -n '3,11p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
file=$1; line=$2; old=$3; new=$4; shift 5
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 2; }
[[ $line =~ ^[0-9]+$ ]] || { echo "line must be a number: $line" >&2; exit 2; }
[ "$old" != "$new" ] || { echo "old and new are the same" >&2; exit 2; }
original_line=$(sed -n "${line}p" "$file")
case $original_line in *"$old"*) ;; *) echo "'$old' is not on $file:$line: $original_line" >&2; exit 2 ;; esac

backup=$(mktemp "${TMPDIR:-/tmp}/plant-mutant.XXXXXX")
cp -p "$file" "$backup"
# Restore by content: the file gets a new mtime, so build tools (cargo, tsc) rebuild it.
restore() { cat "$backup" > "$file"; rm -f "$backup"; }
trap restore EXIT INT TERM

OLD=$old NEW=$new LINE=$line awk '
  NR == ENVIRON["LINE"] { i = index($0, ENVIRON["OLD"]); if (i) $0 = substr($0, 1, i - 1) ENVIRON["NEW"] substr($0, i + length(ENVIRON["OLD"])) }
  { print }' "$backup" > "$file"
echo "planted $file:$line"
echo "  before: $original_line"
echo "  after:  $(sed -n "${line}p" "$file")"
echo "running: $*"

out=$(mktemp "${TMPDIR:-/tmp}/plant-mutant-out.XXXXXX")
set +e
"$@" > "$out" 2>&1
status=$?
set -e
tail -n 20 "$out"
rm -f "$out"

restore
trap - EXIT INT TERM
if [ "$(sed -n "${line}p" "$file")" != "$original_line" ]; then echo "FILE NOT RESTORED: $file" >&2; exit 2; fi

if [ $status -ne 0 ]; then
  echo "mutant: $file:$line '$old' -> '$new'  KILLED (exit $status)"
  exit 0
fi
echo "mutant: $file:$line '$old' -> '$new'  SURVIVED: the property passed on the mutant"
exit 1
