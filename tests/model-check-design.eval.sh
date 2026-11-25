#!/usr/bin/env bash
# model-check-design.eval.sh — live trigger evals for skills/model-check-design with `claude -p`.
# Usage: tests/model-check-design.eval.sh <new-scratch-dir> [all-installed|project-only|both]
#   6 requests that never name the skill must pick it; 4 unrelated ones must not.
#   all-installed: with every skill the user has; project-only: this skill and bundled ones.
# Costs real model calls. Writes into <new-scratch-dir> only.
# The deterministic script tests are in tests/model-check-design.test.mjs (node --test).
set -euo pipefail

[ $# -ge 1 ] || { sed -n '3,7p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SKILL=$ROOT/skills/model-check-design
FIRES=$ROOT/skills/write-great-skill/scripts/fires.sh
OUT=$1; WHICH=${2:-both}
d=$OUT/autopick/app
mkdir -p "$d/.claude/skills"; git -C "$d" init -q; cp -R "$SKILL" "$d/.claude/skills/"

yes=(
  "Our job workers poll the jobs table and sometimes a job runs twice. Can two workers both pick the same job between the SELECT and the UPDATE? I want certainty, not another test."
  "The checkout client retries after a 10 second timeout with the same idempotency key, and we store the key after charging. Can a customer be charged twice? Check every ordering."
  "Write a TLA+ spec for our order state machine and run TLC on it."
  "Stripe webhooks can arrive out of order and twice. Can an order end up refunded and shipped, or credited twice? Explore every interleaving of the handlers."
  "We use a Redis lock with a 30 s lease around the nightly settlement. If the lease expires while the holder is still running, can two settlements overlap? Model-check it."
  "Our saga books the hotel, then the flight, and compensates on failure. If the process crashes halfway and restarts, can we end up with a flight and no hotel? Prove it either way."
)
no=(
  "Fix the off-by-one in this loop: for (let i = 0; i <= items.length; i++) total += items[i].price"
  "Write unit tests for the formatPrice function in src/lib/money.ts."
  "Explain the difference between a mutex and a semaphore in three sentences."
  "Our test suite has 95% coverage but bugs still slip through. Are the tests any good?"
)
for mode in all-installed project-only; do
  [ "$WHICH" = both ] || [ "$WHICH" = $mode ] || continue
  echo "== autopick ($mode skills) =="
  envs=(); [ $mode = project-only ] && envs=(FIRES_ONLY_PROJECT=1)
  (cd "$d" && env "${envs[@]+"${envs[@]}"}" "$FIRES" model-check-design "${yes[@]}" --not "${no[@]}") | sed 's/^/  /' || true
done
