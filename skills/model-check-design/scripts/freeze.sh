#!/usr/bin/env bash
# freeze.sh — pin the approved invariants and model size, and check the pin later.
# Usage: scripts/freeze.sh record <Spec.tla> [--config <file.cfg>]
#        scripts/freeze.sh check  <Spec.tla> [--config <file.cfg>]
#   record  writes <config>.frozen next to the config: a SHA-256 per INVARIANT/PROPERTY
#           (its definition plus every definition it uses), the CONSTANT values, the size of
#           every literal set/range/number, the actions in Next, and the deadlock setting.
#           Run it only after the user approved the plain-words invariants.
#   check   exit 1 when a frozen invariant changed or is no longer checked, a constant or
#           model set got smaller or changed, an action left Next, the deadlock check was
#           turned off, or a CONSTRAINT/VIEW appeared. Comments and whitespace do not count.
set -euo pipefail

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
[ $# -ge 2 ] || usage
MODE=$1 SPEC=$2; shift 2
CFG=${SPEC%.tla}.cfg
[ "${1:-}" = --config ] && { CFG=${2:?--config needs a file}; shift 2; }
case $MODE in record|check) ;; *) usage ;; esac
TLA="$(dirname "$0")/tla.pl"
[ -f "$SPEC" ] || { echo "spec not found: $SPEC" >&2; exit 2; }
[ -f "$CFG" ] || { echo "config not found: $CFG" >&2; exit 2; }
FROZEN=${CFG%.cfg}.frozen
checks=$("$TLA" checks "$CFG")
[ -n "$checks" ] || { echo "the config lists no INVARIANT or PROPERTY: nothing to freeze" >&2; exit 2; }

snapshot() {  # the current state, in the freeze file's line format
  for n in $checks; do echo "inv $("$TLA" hash "$SPEC" "$n" 2>/dev/null || echo missing) $n"; done
  "$TLA" consts "$CFG" | awk -F'\t' '{print "const " $1 " " $2}'
  "$TLA" sizes "$SPEC" | awk -F'\t' '{print "size " $1 " " $2}'
  "$TLA" next "$SPEC" 2>/dev/null | grep -Fx -f <("$TLA" actions "$SPEC") | sed 's/^/action /' || true
  if "$TLA" lines "$CFG" | cut -f2 | grep -Eq '^[[:space:]]*CHECK_DEADLOCK[[:space:]]+FALSE'; then echo "deadlock off"; else echo "deadlock on"; fi
  "$TLA" lines "$CFG" | cut -f2 | grep -E '^[[:space:]]*((ACTION_)?CONSTRAINTS?|VIEW)' | sed 's/^[[:space:]]*/limit /' || true
}

if [ "$MODE" = record ]; then
  snap=$(snapshot)
  {
    echo "# model-check-design freeze: spec=$(basename "$SPEC") config=$(basename "$CFG") at $(date -u +%Y-%m-%dT%H:%MZ)"
    echo "# Do not edit. Weakening any line needs the user's approval and a fresh judge (references/judge.md)."
    echo "$snap"
  } > "$FROZEN"
  echo "frozen in $FROZEN:"
  grep -v '^#' "$FROZEN" | sed 's/^/  /'
  exit 0
fi

[ -f "$FROZEN" ] || { echo "no freeze file: $FROZEN — run: scripts/freeze.sh record $SPEC --config $CFG" >&2; exit 1; }
now=$(snapshot)
frozen=$(grep -v '^#' "$FROZEN")
val() { awk -v k="$1" -v n="$2" '$1==k && $2==n {sub("^" k " " n " ", ""); print; exit}' <<<"$3"; }
num() { case $1 in \{*\}) local in=${1#\{}; in=${in%\}}; if [[ $in =~ [^[:space:]] ]]; then awk -F, '{print NF}' <<<"$in"; else echo 0; fi ;; *[!0-9]*|'') echo "" ;; *) echo "$1" ;; esac; }
bad=0
change() { echo "CHANGED  $*"; bad=1; }
while read -r kind name rest; do
  case $kind in
    inv)  # inv <hash> <Name>
      want=$name; name=$rest
      got=$(awk -v n="$name" '$1=="inv" && $3==n {print $2}' <<<"$now")
      if [ -z "$got" ]; then change "$name: no longer listed under INVARIANT/PROPERTY in $(basename "$CFG")"
      elif [ "$got" = missing ]; then change "$name: the definition is gone from $(basename "$SPEC")"
      elif [ "$got" != "$want" ]; then change "$name: its definition (or one it uses) differs from the frozen one"
      else echo "ok       invariant $name"; fi ;;
    const|size)
      got=$(val "$kind" "$name" "$now")
      if [ -z "$got" ]; then change "$kind $name removed (was $rest)"
      elif [ "$got" != "$rest" ]; then
        a=$(num "$rest"); b=$(num "$got")
        if [ -n "$a" ] && [ -n "$b" ] && [ "$b" -lt "$a" ]; then change "$kind $name shrunk: $rest -> $got"
        elif [ -n "$a" ] && [ -n "$b" ] && [ "$b" -gt "$a" ]; then echo "ok       $kind $name grew: $rest -> $got"
        else change "$kind $name changed: $rest -> $got"; fi
      fi ;;
    action) grep -qx "action $name" <<<"$now" || change "action $name dropped from Next" ;;
    deadlock) if [ "$name" = on ] && grep -qx "deadlock off" <<<"$now"; then change "deadlock check turned off (CHECK_DEADLOCK FALSE)"; fi ;;
  esac
done <<<"$frozen"
while read -r l; do [ -z "$l" ] || grep -qxF "$l" <<<"$frozen" || change "new limit: ${l#limit }"; done < <(grep '^limit ' <<<"$now" || true)
for n in $checks; do grep -q "^inv [^ ]* $n\$" <<<"$frozen" || echo "note     $n is checked but not frozen (new: freeze it after the user approves it)"; done
if [ $bad -eq 0 ]; then echo "FROZEN OK"; else echo "FROZEN CHANGED"; exit 1; fi
