#!/usr/bin/env bash
# able-to-fail.sh — prove an invariant can fail: remove one guard in a copy and expect VIOLATION.
# Usage: scripts/able-to-fail.sh <Spec.tla> --line <n> --from '<old text>' --to '<new text>' [--config <file.cfg>] [--time-limit <s>]
#   Copies the spec's folder to ${TMPDIR:-/tmp}/model-check-design/mutants/, replaces <old text>
#   with <new text> on line <n> of the copy (the original is never touched), and runs
#   scripts/model-check-design.sh on the copy.
#   Prints:  mutant: <Spec.tla>:<n> '<old>' -> '<new>' : <VERDICT>
#   Exit 0 when the mutant gives VIOLATION (the invariant can fail), 1 otherwise.
set -euo pipefail

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
[ $# -ge 1 ] || usage
case $1 in -h|--help) usage ;; esac
SPEC=$1; shift
LINE="" FROM="" TO="__unset__" CFG="" LIMIT=600
while [ $# -gt 0 ]; do
  case $1 in
    --line) LINE=$2; shift 2 ;; --from) FROM=$2; shift 2 ;; --to) TO=$2; shift 2 ;;
    --config) CFG=$2; shift 2 ;; --time-limit) LIMIT=$2; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -f "$SPEC" ] && [ -n "$LINE" ] && [ -n "$FROM" ] && [ "$TO" != __unset__ ] || usage
[ -n "$CFG" ] || CFG=${SPEC%.tla}.cfg
[ -f "$CFG" ] || { echo "config not found: $CFG" >&2; exit 2; }
orig=$(sed -n "${LINE}p" "$SPEC")
grep -qF -- "$FROM" <<<"$orig" || { echo "line $LINE of $SPEC does not contain: $FROM" >&2; echo "line $LINE is: $orig" >&2; exit 2; }

DIR=${TMPDIR:-/tmp}/model-check-design/mutants/$(basename "${SPEC%.tla}")-L$LINE-$$
mkdir -p "$DIR"
cp "$(dirname "$SPEC")"/*.tla "$DIR/"
cp "$CFG" "$DIR/mutant.cfg"
FROM="$FROM" TO="$TO" LINE="$LINE" perl -i -pe 'if ($. == $ENV{LINE}) { my $i = index($_, $ENV{FROM}); substr($_, $i, length $ENV{FROM}) = $ENV{TO} if $i >= 0 }' "$DIR/$(basename "$SPEC")"
echo "mutated line $LINE: $(sed -n "${LINE}p" "$DIR/$(basename "$SPEC")" | sed 's/^[[:space:]]*//')"

set +e
out=$("$(dirname "$0")/model-check-design.sh" "$DIR/$(basename "$SPEC")" --config "$DIR/mutant.cfg" --time-limit "$LIMIT")
set -e
v=$(sed -n 's/^VERDICT: //p' <<<"$out")
sed -n '/^reason:/p' <<<"$out"
echo "mutant: $(basename "$SPEC"):$LINE '$FROM' -> '$TO' : ${v:-ERROR}"
case $v in
  VIOLATION) echo "ABLE TO FAIL"; exit 0 ;;
  DEADLOCK) echo "NOT ABLE TO FAIL: the mutant made the flow stuck instead of breaking the invariant; remove a different guard"; exit 1 ;;
  *) echo "NOT ABLE TO FAIL: the invariant does not see this guard, or the mutant broke the model (read the reason)"; exit 1 ;;
esac
