#!/usr/bin/env bash
# bmc-run.sh — run a bounded model checker and print a fail-closed verdict per harness.
# Usage: scripts/bmc-run.sh <log-file> <command...>
#   e.g. scripts/bmc-run.sh .bmc/parse.log cargo kani --harness parse_never_panics
#        scripts/bmc-run.sh .bmc/rec.log cbmc src/rec.c bmc/rec_harness.c --function harness --unwind 18
#        scripts/bmc-run.sh --parse <existing-log>      (only read a log, run nothing)
# Verdicts (exit code = worst verdict):
#   VERIFIED (0)       no failed check, every cover reached
#   FAILED (10)        a check failed: a counterexample exists inside the bound
#   BOUND-TOO-LOW (11) an unwinding assertion failed: raise the bound, never disable the check
#   VACUOUS (12)       no cover reached: the assumptions remove every input
#   UNCOVERED (12)     some cover not reached: a branch the harness claims is never run
#   NO-COVER (12)      verified, but the harness has no cover: nothing proves it ran
#   TIMEOUT (2)        no verdict after BMC_TIMEOUT seconds (default 600): shrink a bound or add an unwind
#   UNKNOWN (2)        no verdict in the output (compile error, crash)
# Refuses flags that switch checks off (exit 3). BMC_ALLOW="<flag>" lets one through after the user approved it.
set -euo pipefail

usage() { sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
[ $# -ge 1 ] || usage

if [ "$1" = "--parse" ]; then
  [ $# -eq 2 ] && [ -f "$2" ] || usage
  log=$2
else
  [ $# -ge 2 ] || usage
  log=$1; shift
  for a in "$@"; do
    case $a in
      --no-unwinding-checks|--no-unwinding-assertions|--no-standard-checks|--no-bounds-check|\
      --no-pointer-check|--no-div-by-zero-check|--no-signed-overflow-check|--partial-loops|\
      --no-assertions|--no-overflow-check|--no-assertion-reach-checks|--property|--property=*)
        if [ "${BMC_ALLOW:-}" != "$a" ]; then
          echo "REFUSED: $a switches a check off (--property drops every other check, unwinding included). It needs the user's approval (then BMC_ALLOW=$a)." >&2
          exit 3
        fi ;;
    esac
  done
  cmd=("$@")
  # cargo kani: terse output keeps one summary block per harness
  if [ "${cmd[0]}" = cargo ] && [ "${cmd[1]:-}" = kani ] && [[ " ${cmd[*]} " != *" --output-format"* ]]; then
    cmd+=(--output-format terse)
  fi
  mkdir -p "$(dirname "$log")"
  echo "+ ${cmd[*]}"
  limit=${BMC_TIMEOUT:-600}
  now() { perl -MTime::HiRes=time -e 'printf "%.1f", time'; }
  start=$(now)
  set +e
  set -m                                   # the checker gets its own process group
  "${cmd[@]}" >"$log" 2>&1 &
  pid=$!
  set +m
  # one watchdog process, killed as soon as the checker ends; it holds no output pipe
  perl -e 'sleep $ARGV[0]; kill "TERM", -$ARGV[1]' "$limit" "$pid" </dev/null >/dev/null 2>&1 &
  dog=$!
  wait "$pid"
  rc=$?
  kill "$dog" 2>/dev/null; wait "$dog" 2>/dev/null
  set -e
  secs=$(perl -e "printf '%.1f', $(now) - $start")
  if [ "$rc" -eq 143 ] && perl -e "exit !($secs >= $limit)"; then
    echo "BMC-RUN: TIMEOUT after ${limit}s" >>"$log"
  fi
  echo "checker exit $rc (Kani exits 1 on any failure; the verdict below is what counts), ${secs}s, log: $log"
fi

# CBMC prints no "Checking harness" line: name the run after --function (default main).
fn=main
[ -n "${cmd+x}" ] && for ((i = 0; i < ${#cmd[@]}; i++)); do
  [ "${cmd[$i]}" = --function ] && fn=${cmd[$((i + 1))]:-main}
done

awk -v cfn="$fn" '
function flush() {
  if (name == "") return
  if (!done) v = timedout ? "TIMEOUT" : "UNKNOWN"
  else if (realfail > 0) v = "FAILED"
  else if (unwindfail > 0) v = "BOUND-TOO-LOW"
  else if (crashed) v = timedout ? "TIMEOUT" : "UNKNOWN"
  else if (failed_word && kani) v = "UNKNOWN"
  else if (failed_word) v = "FAILED"
  else if (ctotal == 0) v = "NO-COVER"
  else if (csat == 0) v = "VACUOUS"
  else if (csat < ctotal) v = "UNCOVERED"
  else v = "VERIFIED"
  note = ""
  if (ctotal > 0) note = sprintf(" (covers %d/%d reached)", csat, ctotal)
  if (v == "FAILED" && unwindfail > 0) note = note " (an unwinding assertion failed too)"
  if (v == "UNKNOWN" && crashed) note = note " (the solver was killed or crashed: no check result)"
  if (v == "UNKNOWN" && !crashed && failed_word) note = note " (FAILED without a failed check: read the log)"
  if (v == "VERIFIED" && unreach > 0) note = note sprintf(" (%d checks unreachable)", unreach)
  printf "%-14s %s%s\n", v, name, note
  if (v == "FAILED") for (i = 1; i <= nf; i++) printf "               failed: %s\n", fails[i]
  rank = (v == "VERIFIED") ? 0 : (v == "FAILED") ? 10 : (v == "BOUND-TOO-LOW") ? 11 : (v == "UNKNOWN" || v == "TIMEOUT") ? 2 : 12
  if (worst_r(rank) > worst_r(worst)) worst = rank
  count++
  name = ""; done = 0; lastfail = 0; crashed = 0; realfail = 0; unwindfail = 0; failed_word = 0; ctotal = 0; csat = 0; nf = 0; unreach = 0
}
function worst_r(r) { return r == 0 ? 0 : r == 12 ? 1 : r == 11 ? 2 : r == 10 ? 3 : 4 }
BEGIN { worst = 0; count = 0; cbmc = 0 }
/^Checking harness / { flush(); kani = 1; name = $3; sub(/\.\.\.$/, "", name); next }
/^CBMC failed with status / { crashed = 1; next }
# Kani summary lines
/^ *\*\* [0-9]+ of [0-9]+ cover properties satisfied/ { csat = $2; ctotal = $4; next }
/^Failed Checks: / {
  d = $0; sub(/^Failed Checks: /, "", d)
  if (d ~ /^unwinding assertion/) unwindfail++; else { realfail++; fails[++nf] = d; lastfail = nf }
  next
}
/^ File: "[^"]*", line [0-9]+, in / {
  if (lastfail) { f = $0; sub(/^ File: "/, "", f); sub(/", line /, ":", f); sub(/, in /, " in ", f); fails[lastfail] = fails[lastfail] "  at " f; lastfail = 0 }
  next
}
/^BMC-RUN: TIMEOUT/ { timedout = 1; if (name == "") name = cfn; next }
/^VERIFICATION:- (SUCCESSFUL|FAILED)/ { done = 1; if ($0 ~ /FAILED/) failed_word = 1; next }
/^ *\*\* [0-9]+ of [0-9]+ failed.*unreachable/ { match($0, /[0-9]+ unreachable/); unreach = substr($0, RSTART, RLENGTH) + 0 }
# CBMC per-property lines: [id] line N description: STATUS
/^\[[^]]+\] .*: (SUCCESS|FAILURE|UNKNOWN)$/ {
  cbmc = 1; if (name == "") name = cfn
  st = $NF; d = $0; sub(/: (SUCCESS|FAILURE|UNKNOWN)$/, "", d)
  if (d ~ /cover: /) {
    # CBMC lists the covers of every harness in the loaded files: count only the covers of this harness
    if (cfn == "main" || index(d, "[" cfn ".") == 1) { ctotal++; if (st == "FAILURE") csat++ }
  }
  else if (st == "FAILURE") { if (d ~ /unwinding assertion/) unwindfail++; else { realfail++; fails[++nf] = d } }
  next
}
/^VERIFICATION (SUCCESSFUL|FAILED)$/ { if (name == "") name = cfn; done = 1; if ($0 ~ /FAILED/ && !cbmc) failed_word = 1; next }
END {
  flush()
  if (count == 0) { print "UNKNOWN        no harness result in the log"; worst = 2 }
  exit worst
}' "$log"
