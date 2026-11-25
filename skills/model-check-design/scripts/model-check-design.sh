#!/usr/bin/env bash
# model-check-design.sh — run TLC on one model and print a fail-closed verdict.
# Usage: scripts/model-check-design.sh <Spec.tla> [--config <file.cfg>] [--time-limit <seconds>] [--workers <n>]
#   --config      default: <Spec>.cfg next to the spec
#   --time-limit  default: 600 (TIME_LIMIT when TLC is still running)
#   --workers     default: auto
# Env: TLA2TOOLS_JAR (default ~/.cache/model-check-design/tla2tools-1.7.4.jar, from scripts/setup.sh)
#      JAVA (default: java on PATH)
# Verdicts: PASS VIOLATION DEADLOCK EMPTY COVERAGE_MISSING TIME_LIMIT ERROR
# Only PASS exits 0. PASS needs: TLC finished, distinct states > 0, 0 states left
# on the queue, every action enabled at least once, at least one INVARIANT/PROPERTY.
# The full TLC log and TLC metadata go in a new folder per run under ${TMPDIR:-/tmp}/model-check-design/,
# never into the repo. No -simulate, -depth or -deadlock flags are ever passed.
set -euo pipefail

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
[ $# -ge 1 ] || usage
case $1 in -h|--help) usage ;; esac

SPEC=$1; shift
CFG=""; LIMIT=600; WORKERS=auto
while [ $# -gt 0 ]; do
  case $1 in
    --config) CFG=${2:?--config needs a file}; shift 2 ;;
    --time-limit) LIMIT=${2:?--time-limit needs seconds}; shift 2 ;;
    --workers) WORKERS=${2:?--workers needs a number}; shift 2 ;;
    *) echo "unknown argument: $1 (simulation and depth bounds are not supported: they are never a pass)" >&2; exit 2 ;;
  esac
done

PINNED_SHA=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88   # tla2tools.jar v1.7.4
JAR=${TLA2TOOLS_JAR:-$HOME/.cache/model-check-design/tla2tools-1.7.4.jar}
JAVA=${JAVA:-java}

verdict() {  # $1 verdict, $2 reason; prints the result block and exits
  echo "VERDICT: $1"
  echo "reason: $2"
  [ -n "${LOG:-}" ] && echo "log: $LOG"
  case $1 in PASS) exit 0 ;; VIOLATION) exit 1 ;; DEADLOCK) exit 3 ;; EMPTY) exit 4 ;;
    COVERAGE_MISSING) exit 5 ;; TIME_LIMIT) exit 6 ;; *) exit 7 ;; esac
}

[ -f "$SPEC" ] || verdict ERROR "spec not found: $SPEC"
case $SPEC in *.tla) ;; *) verdict ERROR "the spec must be a .tla file (PlusCal: translate it first, see references/modeling.md)" ;; esac
[ -n "$CFG" ] || CFG=${SPEC%.tla}.cfg
[ -f "$CFG" ] || verdict ERROR "config not found: $CFG"
abs() { echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; }
SPEC=$(abs "$SPEC"); CFG=$(abs "$CFG")
[ -f "$JAR" ] || verdict ERROR "tla2tools.jar not found at $JAR — run scripts/setup.sh or set TLA2TOOLS_JAR"
command -v "$JAVA" >/dev/null 2>&1 || [ -x "$JAVA" ] || verdict ERROR "java not found — install Java 11+ (scripts/setup.sh prints how) or set JAVA"

if command -v sha256sum >/dev/null 2>&1; then sum=$(sha256sum "$JAR" | cut -d' ' -f1); else sum=$(shasum -a 256 "$JAR" | cut -d' ' -f1); fi
[ "$sum" = "$PINNED_SHA" ] || verdict ERROR "tla2tools.jar SHA-256 is $sum, pinned is $PINNED_SHA (v1.7.4) — run scripts/setup.sh"

# What the config asks for. A config without checks checks nothing.
cfgtext=$(sed 's/\\\*.*$//' "$CFG")
checks=$(awk 'BEGIN{on=0} /^[[:space:]]*(INVARIANTS?|PROPERTY|PROPERTIES)([[:space:]]|$)/{on=1; sub(/^[[:space:]]*[A-Z_]+/,"")} /^[[:space:]]*(INIT|NEXT|SPECIFICATION|CONSTANTS?|CONSTRAINTS?|ACTION_CONSTRAINTS?|SYMMETRY|VIEW|CHECK_DEADLOCK|ALIAS|POSTCONDITION)([[:space:]]|$)/{on=0} on{print}' <<<"$cfgtext" | tr -s ' \t' '\n\n' | grep -v '^$' | paste -sd' ' - || true)
deadlock_off=$(grep -Eq '^[[:space:]]*CHECK_DEADLOCK[[:space:]]+FALSE' <<<"$cfgtext" && echo yes || echo no)
constraints=$(grep -Eo '^[[:space:]]*(ACTION_)?CONSTRAINTS?[[:space:]]+.*' <<<"$cfgtext" | sed 's/^[[:space:]]*//' | paste -sd';' - || true)

OUT=${TMPDIR:-/tmp}/model-check-design
mkdir -p "$OUT"
base=$(basename "${SPEC%.tla}")-$(basename "${CFG%.cfg}")
RUN=$(mktemp -d "$OUT/$base.XXXXXX")   # one folder per run: parallel runs (judges) never share a log
LOG=$RUN/tlc.log
META=$RUN/meta

echo "spec: $SPEC"
echo "config: $CFG"
echo "checks: ${checks:-none}"
echo "deadlock check: $([ "$deadlock_off" = yes ] && echo 'OFF (CHECK_DEADLOCK FALSE — an escape hatch, needs approval)' || echo on)"
[ -n "$constraints" ] && echo "state constraint: $constraints (a PASS holds only inside it — an escape hatch, needs approval)"
echo "time limit: ${LIMIT}s"

[ -n "$checks" ] || verdict EMPTY "the config lists no INVARIANT or PROPERTY: nothing is checked"

set +e
(cd "$(dirname "$SPEC")" && perl -e 'alarm shift @ARGV; exec @ARGV' "$LIMIT" \
  "$JAVA" -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -tool -coverage 1 -cleanup \
  -metadir "$META" -workers "$WORKERS" -config "$CFG" \
  "$(basename "$SPEC")") > "$LOG" 2>&1
code=$?
set -e

# Parse TLC tool-mode output (@!@!@STARTMSG <code>:<severity> @!@!@ ... @!@!@ENDMSG).
parsed=$(awk '
  /^@!@!@STARTMSG/ { split($2, a, ":"); msg=a[1]; sev=a[2]; next }
  /^@!@!@ENDMSG/   { msg=""; next }
  msg=="2193" { print "done=1" }
  msg=="2110" || msg=="2111" || msg=="2116" || msg=="2112" { print "violation=" $0 }
  msg=="2114" { print "deadlock=1" }
  msg=="2199" { gsub(",", ""); print "stats=" $1 " " $4 " " $8 }
  msg=="2194" { n=split($0, w, " "); d=w[n]; sub(/\.$/, "", d); print "depth=" d }
  msg=="2772" { line=$0; name=line; sub(/^</, "", name); sub(/ .*/, "", name)
                cnt=line; sub(/.*>: /, "", cnt); print "action=" name " " cnt }
  msg=="2217" { print "trace=" $0 }
  sev=="1" && msg!="2110" && msg!="2111" && msg!="2112" && msg!="2116" && msg!="2114" && msg!="2121" { print "error=" $0 }
  msg ~ /^(3[0-9][0-9][0-9]|4[0-9][0-9][0-9]|1[0-9][0-9][0-9]|2401)$/ { print "error=" $0 }
' "$LOG")

get() { grep "^$1=" <<<"$parsed" | sed "s/^$1=//" || true; }
stats=$(get stats | tail -1); distinct=$(awk '{print $2}' <<<"$stats"); queue=$(awk '{print $3}' <<<"$stats")
depth=$(get depth | tail -1)
actions=$(get action | awk '{split($2, c, ":"); n[$1]=c[2]} END{for (a in n) print a, n[a]}' | sort)
uncovered=$(awk '$2==0{print $1}' <<<"$actions" | paste -sd' ' -)
[ -n "$stats" ] && echo "states: $(awk '{print $1}' <<<"$stats") generated, ${distinct} distinct, ${queue} left on queue, depth ${depth:-?}"
[ -n "$actions" ] && echo "actions (times enabled): $(awk '{printf "%s%s=%s", sep, $1, $2; sep=" "}' <<<"$actions")"

print_trace() {
  echo "trace:"
  awk '/^@!@!@STARTMSG 2217/{on=1; next} /^@!@!@ENDMSG 2217/{on=0} on && NF{print "  " $0}' "$LOG"
}

[ $code -eq 142 ] && verdict TIME_LIMIT "TLC did not finish within ${LIMIT}s: the state space is too large or unbounded; shrink nothing silently — see references/verdicts.md"
v=$(get violation | head -1)
if [ -n "$v" ]; then print_trace; verdict VIOLATION "$v"; fi
if [ -n "$(get deadlock)" ]; then print_trace; verdict DEADLOCK "a reachable state has no next step (a stuck flow, or a finished flow with no Done step — see references/verdicts.md)"; fi
err=$(get error | sort -u | head -3 | paste -sd' ' -)
if [ -n "$err" ] || [ -z "$(get done)" ]; then
  detail=$(awk '/^@!@!@STARTMSG (2201|2772|2773|2774|2221|2193|2200|2199)/{skip=1; next} /^@!@!@STARTMSG/{skip=0; next} /^@!@!@ENDMSG/{next} !skip' "$LOG" \
    | grep -iE -m 4 'error|encountered|expecting|unknown operator|not defined|exception|cannot' | sed 's/^[[:space:]]*//' | paste -sd' ' - | cut -c1-400 || true)
  [ -n "$detail" ] && err="$err — $detail"
fi
[ -z "$(get done)" ] && verdict ERROR "TLC did not complete (exit $code). ${err:-see the log}"
[ -n "$err" ] && verdict ERROR "$err"
[ -n "$stats" ] || verdict ERROR "no final state count in the TLC output"
[ "${distinct:-0}" -gt 0 ] || verdict EMPTY "0 distinct states: Init admits no state, so every invariant holds vacuously"
[ "${queue:-1}" -eq 0 ] || verdict EMPTY "$queue states left on the queue: the search did not finish"
[ -n "$actions" ] || verdict COVERAGE_MISSING "TLC printed no action coverage: Next has no named actions to check"
[ -z "$uncovered" ] || verdict COVERAGE_MISSING "never enabled: $uncovered — the model cannot reach these steps, so the PASS would not cover them"
verdict PASS "$distinct distinct states, every action enabled, checks hold: $checks"
