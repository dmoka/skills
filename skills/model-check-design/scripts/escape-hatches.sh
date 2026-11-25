#!/usr/bin/env bash
# escape-hatches.sh — list every way a change makes a model check weaker, against a base ref.
# Usage: scripts/escape-hatches.sh <base-ref> [<path> ...]
#   Run it inside the git repo that holds the model (.tla/.cfg/.qnt). Compares the working
#   tree (tracked changes and new untracked files) with <base-ref>, limited to <path>s if given.
#   Exit 0: no escape hatch. Exit 1: one HATCH line per finding; each one needs the user's
#   approval and a fresh judge (references/judge.md) before it may stay. Exit 2: usage error.
# Flags: a removed INVARIANT/PROPERTY name; a shrunk, changed or removed CONSTANT; an added
# CONSTRAINT, ACTION_CONSTRAINT, VIEW or CHECK_DEADLOCK FALSE; a model set, range or number
# that got smaller; an action dropped from Next; anything a *.frozen file pins that changed;
# an added simulation or depth-bounded run (-simulate, -depth, -dfid, -deadlock, quint run);
# an added Quint assume, or a lowered --max-steps / --max-samples.
set -euo pipefail

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
[ $# -ge 1 ] || usage
case $1 in -h|--help) usage ;; esac
BASE=$1; shift
HERE=$(cd "$(dirname "$0")" && pwd)
TLA="$HERE/tla.pl"
git rev-parse --git-dir >/dev/null 2>&1 || { echo "not inside a git repo" >&2; exit 2; }
git rev-parse --verify -q "$BASE^{commit}" >/dev/null || { echo "unknown base ref: $BASE" >&2; exit 2; }
TOP=$(git rev-parse --show-toplevel)
cd "$TOP"

files=$( { git diff --name-only "$BASE" -- "$@"; git ls-files --others --exclude-standard -- "$@"; } | sort -u)
n=0
hatch() { n=$((n + 1)); echo "HATCH $1  $2"; }
old() { git show "$BASE:$1" 2>/dev/null || true; }
added_lines() {  # file -> "<newline>\t<text>" for every added line (all lines for a new file)
  if git cat-file -e "$BASE:$1" 2>/dev/null; then
    git diff -U0 "$BASE" -- "$1" | awk '/^@@/{split($3, a, ","); ln=substr(a[1], 2) - 1; next} /^\+\+\+/{next} /^\+/{ln++; print ln "\t" substr($0, 2)}'
  else awk '{print NR "\t" $0}' "$1"; fi
}
removed_lines() { git diff -U0 "$BASE" -- "$1" 2>/dev/null | awk '/^---/{next} /^-/{print substr($0, 2)}'; }

for f in $files; do
  [ -f "$f" ] || { case $f in *.tla|*.cfg|*.qnt) hatch "$f" "model file deleted" ;; esac; continue; }
  case $f in
    *.cfg)
      for c in $(old "$f" | "$TLA" checks - | sort -u); do
        "$TLA" checks "$f" | grep -qx -- "$c" || hatch "$f" "removed check: $c is no longer an INVARIANT/PROPERTY"
      done
      while IFS=$'\t' read -r k v; do
        [ -n "$k" ] || continue
        now=$("$TLA" consts "$f" | awk -F'\t' -v k="$k" '$1==k{print $2}')
        if [ -z "$now" ]; then hatch "$f" "removed constant: $k (was $v)"; continue; fi
        [ "$now" = "$v" ] && continue
        size() { case $1 in \{*\}) local in=${1#\{}; in=${in%\}}; [[ $in =~ [^[:space:]] ]] && awk -F, '{print NF}' <<<"$in" || echo 0 ;; *[!0-9]*) echo "" ;; *) echo "$1" ;; esac; }
        so=$(size "$v"); sn=$(size "$now")
        if [ -n "$so" ] && [ -n "$sn" ] && [ "$sn" -lt "$so" ]; then hatch "$f" "shrunk constant: $k $v -> $now"
        else hatch "$f" "changed constant: $k $v -> $now (a different model: say why)"; fi
      done < <(old "$f" | "$TLA" consts -)
      while IFS=$'\t' read -r ln text; do
        case $text in
          *CHECK_DEADLOCK*FALSE*) hatch "$f:$ln" "deadlock check turned off: $text" ;;
          *ACTION_CONSTRAINT*|*CONSTRAINT*) hatch "$f:$ln" "added state constraint (a PASS holds only inside it): $text" ;;
          *VIEW*) hatch "$f:$ln" "added VIEW (states that differ outside the view are merged): $text" ;;
        esac
      done < <(added_lines "$f" | sed 's/\\\*.*$//' | grep -E $'\t''[[:space:]]*(ACTION_CONSTRAINTS?|CONSTRAINTS?|CHECK_DEADLOCK|VIEW)\b' || true)
      ;;
    *.tla)
      while IFS=$'\t' read -r k v; do
        [ -n "$k" ] || continue
        now=$("$TLA" sizes "$f" | awk -F'\t' -v k="$k" '$1==k{print $2}')
        if [ -n "$now" ] && [ "$now" -lt "$v" ]; then hatch "$f" "shrunk model value: $k has $now (was $v)"; fi
      done < <(old "$f" | "$TLA" sizes -)
      if old "$f" | grep -q '^Next'; then
        for a in $(old "$f" | "$TLA" next - 2>/dev/null); do
          old "$f" | "$TLA" actions - | grep -qx "$a" || continue
          if ! "$TLA" next "$f" 2>/dev/null | grep -qx "$a"; then hatch "$f" "action dropped from Next: $a"; fi
        done
      fi
      ;;
    *.qnt)
      while IFS=$'\t' read -r ln text; do hatch "$f:$ln" "added Quint assume: $text"; done \
        < <(added_lines "$f" | grep -E $'\t''.*\bassume\b' || true)
      ;;
  esac
  # Run flags anywhere (scripts, Makefiles, CI files): simulation and depth bounds are never a pass.
  while IFS=$'\t' read -r ln text; do
    hatch "$f:$ln" "added a run that cannot PASS (simulation or bounded depth): $(sed 's/^[[:space:]]*//' <<<"$text" | cut -c1-100)"
  done < <(added_lines "$f" | grep -E $'\t''.*(tlc2?\.TLC|tlc |TLC |tla2tools|quint).*(-simulate|-depth|-dfid|-deadlock)|'$'\t''.*quint +run\b' || true)
  for flag in --max-steps --max-samples; do
    o=$(removed_lines "$f" | grep -Eo -- "$flag[ =][0-9]+" | grep -Eo '[0-9]+' | head -1 || true)
    w=$(added_lines "$f" | grep -Eo -- "$flag[ =][0-9]+" | grep -Eo '[0-9]+' | head -1 || true)
    if [ -n "$o" ] && [ -n "$w" ] && [ "$w" -lt "$o" ]; then hatch "$f" "lowered $flag $o -> $w"; fi
  done
done
# Every freeze file in the repo: a frozen invariant, constant, set size, action or deadlock
# setting that changed since the user approved it (scripts/freeze.sh check).
while IFS= read -r fz; do
  spec=$(sed -n 's/^# model-check-design freeze: spec=\([^ ]*\) config=\([^ ]*\).*/\1/p' "$fz")
  cfg=$(sed -n 's/^# model-check-design freeze: spec=\([^ ]*\) config=\([^ ]*\).*/\2/p' "$fz")
  [ -n "$spec" ] || continue
  out=$("$HERE/freeze.sh" check "$(dirname "$fz")/$spec" --config "$(dirname "$fz")/$cfg" 2>&1) && continue
  while IFS= read -r l; do hatch "${fz#./}" "frozen: ${l#CHANGED  }"; done < <(grep -E '^CHANGED|^no freeze|not found' <<<"$out" || echo "CHANGED  freeze check failed: $out")
done < <(find . -name '*.frozen' -not -path './.git/*' -not -path '*/node_modules/*' | sort)
echo "escape hatches: $n"
[ $n -eq 0 ] || exit 1
