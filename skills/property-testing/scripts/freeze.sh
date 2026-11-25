#!/usr/bin/env bash
# freeze.sh — record the SHA-256 of each frozen property, so a later edit shows up. Read-only.
# Usage: scripts/freeze.sh <file>[:<first>-<last>] ...
#   A line range hashes only those lines (the property); no range hashes the whole file.
# Prints one line per argument: "<sha256>  <file>:<first>-<last>". Run it again at the end:
# a changed hash means the property changed after it was frozen; report the diff and the reason.
set -euo pipefail

[ $# -ge 1 ] || { sed -n '3,6p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
if command -v sha256sum >/dev/null; then sha() { sha256sum | cut -d' ' -f1; }
else sha() { shasum -a 256 | cut -d' ' -f1; }; fi

for arg in "$@"; do
  file=${arg%:*}; range=${arg##*:}
  if [ "$file" = "$arg" ] || ! [[ $range =~ ^[0-9]+-[0-9]+$ ]]; then file=$arg; range=""; fi
  [ -f "$file" ] || { echo "no such file: $file" >&2; exit 2; }
  if [ -n "$range" ]; then
    first=${range%-*}; last=${range#*-}
    [ "$first" -le "$last" ] || { echo "bad range: $range" >&2; exit 2; }
    total=$(wc -l < "$file" | tr -d ' ')
    [ "$last" -le "$total" ] || { echo "$file has $total lines, range ends at $last" >&2; exit 2; }
    printf '%s  %s:%s\n' "$(sed -n "${first},${last}p" "$file" | sha)" "$file" "$range"
  else
    printf '%s  %s\n' "$(sha < "$file")" "$file"
  fi
done
