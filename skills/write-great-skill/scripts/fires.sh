#!/usr/bin/env bash
# fires.sh — does a fresh Claude Code session pick this skill by itself?
# Usage: scripts/fires.sh <skill-name> "<request>" ["<request>" ...]
#   Run it in the folder where the skill is installed (the repo, for .claude/skills/).
#   Each request runs in a new `claude -p` session that cannot write files or run commands.
#   FIRES_ONLY_PROJECT=1 loads only project and bundled skills (no ~/.claude skills, no plugins).
# Prints FIRED or MISSED per request, the skills that were picked, and the score.
set -euo pipefail

[ $# -ge 2 ] || { sed -n '3,7p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
command -v claude >/dev/null || { echo "claude CLI not found" >&2; exit 2; }
name=$1; shift

extra=()
[ "${FIRES_ONLY_PROJECT:-0}" = 1 ] && extra+=(--setting-sources project,local)

fired=0; total=0
for req in "$@"; do
  total=$((total + 1))
  out=$(claude -p "$req" "${extra[@]+"${extra[@]}"}" --output-format stream-json --verbose \
        --max-turns 3 --permission-mode default \
        --disallowedTools Write Edit NotebookEdit Bash 2>/dev/null || true)
  picked=$(printf '%s' "$out" | grep -o '"name":"Skill","input":{"skill":"[^"]*"' \
           | sed 's/.*"skill":"//; s/"$//' | sort -u | paste -sd, - || true)
  if printf '%s\n' "${picked//,/$'\n'}" | grep -qxE "([a-z0-9-]+:)?$name"; then
    fired=$((fired + 1)); echo "FIRED   $req"
  else
    echo "MISSED  $req   (picked: ${picked:-none})"
  fi
done
echo "$fired/$total fired"
