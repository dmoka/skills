#!/usr/bin/env bash
# freeze-rule.sh — pin the approved rules file so a later edit shows up.
# Usage: scripts/freeze-rule.sh <rules-file>              write <rules-file>.sha256 and print the hash
#        scripts/freeze-rule.sh --check <rules-file>      exit 0 when the file still matches, 1 when it changed
set -euo pipefail

usage() { sed -n '3,4p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

if [ "${1:-}" = --check ]; then
  [ $# -eq 2 ] && [ -f "$2" ] && [ -f "$2.sha256" ] || usage
  want=$(cut -d' ' -f1 "$2.sha256"); got=$(sha "$2")
  if [ "$want" = "$got" ]; then echo "FROZEN  $2  $got"; exit 0; fi
  echo "CHANGED $2  frozen $want, now $got: report the diff and the reason, and get approval again"
  exit 1
fi
[ $# -eq 1 ] && [ -f "$1" ] || usage
h=$(sha "$1")
printf '%s  %s\n' "$h" "$(basename "$1")" >"$1.sha256"
echo "frozen $1  sha256 $h  (written to $1.sha256)"
