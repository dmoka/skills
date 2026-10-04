#!/usr/bin/env bash
# write-great-skill.eval.sh — live evals for skills/write-great-skill with `claude -p`.
# Usage: tests/write-great-skill.eval.sh <new-scratch-dir> [release|rotate|autopick|all]
#   release   clone dmoka/ticket-bay (push disabled), hand it a release checklist,
#             expect .claude/skills/release/ with a trigger-rich description and scripts/release.sh
#   rotate    build an unrelated skill from scratch (an API-key rotation runbook)
#   autopick  5 requests that never name the skill must pick it; 2 unrelated ones must not
#             (twice: with every installed skill, and with project skills only)
# Costs real model calls. Never run it inside a real project: it writes into <new-scratch-dir> only.
set -euo pipefail

[ $# -ge 1 ] || { sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SKILL=$ROOT/skills/write-great-skill
OUT=$1; WHICH=${2:-all}
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
CHECK="node $SKILL/scripts/check-skill.mjs"

pass=0; fail=0
ok()   { pass=$((pass + 1)); echo "  PASS $*"; }
bad()  { fail=$((fail + 1)); echo "  FAIL $*"; }
expect() { local what=$1; shift; if "$@" >/dev/null 2>&1; then ok "$what"; else bad "$what"; fi; }

install_skill() { mkdir -p "$1/.claude/skills"; cp -R "$SKILL" "$1/.claude/skills/"; }
SANDBOX_RULES="Keep every temporary file under $OUT/tmp (TMPDIR points there). Do not call real accounts or services \
(cloud CLIs, password managers, payment or email providers): read their --help instead."
run_claude() {  # $1 = dir, $2 = prompt; transcript lands in $1.transcript.jsonl
  mkdir -p "$OUT/tmp"
  (cd "$1" && TMPDIR="$OUT/tmp" claude -p "$2 $SANDBOX_RULES" --output-format stream-json --verbose --max-turns 60 \
     --permission-mode bypassPermissions) > "$1.transcript.jsonl" 2>&1 || true
}
used_skill() { grep -q '"name":"Skill","input":{"skill":"write-great-skill"' "$1.transcript.jsonl"; }
desc_has() {  # $1 = SKILL.md, $2.. = words; true when at least half of the words appear
  local d n=0 w; d=$(sed -n '/^description:/,/^---$/p' "$1" | tr 'A-Z' 'a-z'); shift
  for w in "$@"; do grep -q -- "$w" <<<"$d" && n=$((n + 1)); done
  [ $((n * 2)) -ge $# ]
}

eval_release() {
  echo "== release (TicketBay) =="
  local d=$OUT/release/ticket-bay
  git clone -q https://github.com/dmoka/ticket-bay "$d"
  git -C "$d" remote set-url --push origin "no-push://disabled-for-eval"
  install_skill "$d"
  local tags_before; tags_before=$(git -C "$d" tag | wc -l)
  run_claude "$d" "Use the write-great-skill skill. Turn our release checklist into a skill for this repo. \
Every release we do: 1) be on main with a clean tree, git pull. 2) npm ci. 3) npm run typecheck. 4) npm run test:unit. \
5) npm run build. 6) bump the version: npm version <patch|minor|major> --no-git-tag-version, commit 'release vX.Y.Z'. \
7) git tag vX.Y.Z, then git push origin main --tags. 8) smoke test: npm start, curl -fsS http://localhost:3000/ must return 200, stop the server. \
Never release from a dirty tree or from a branch other than main. Never force-push. Never move an existing tag. \
I am not around to answer questions: make your best assumptions, list them, and finish the skill."
  local s=$d/.claude/skills/release
  expect "used write-great-skill" used_skill "$d"
  expect "release/SKILL.md exists" test -f "$s/SKILL.md"
  expect "check-skill passes" $CHECK "$s"
  expect "description is trigger-rich (release, ship, tag, version, publish, cut)" desc_has "$s/SKILL.md" release ship tag version publish cut
  expect "scripts/release.sh exists and is executable" test -x "$s/scripts/release.sh"
  expect "release.sh parses (bash -n)" bash -n "$s/scripts/release.sh"
  expect "release.sh holds the tag and the push" bash -c "grep -q 'git tag' '$s/scripts/release.sh' && grep -q 'git push' '$s/scripts/release.sh'"
  expect "the build and the tests are scripted too (scripts/)" \
    bash -c "cat '$s'/scripts/* | grep -q 'npm run build' && cat '$s'/scripts/* | grep -q 'test:unit'"
  expect "release.sh guards the push (dry run or --yes)" grep -Eq -- '--yes|dry.?run|DRY_RUN' "$s/scripts/release.sh"
  expect "SKILL.md calls the script" grep -q 'scripts/release.sh' "$s/SKILL.md"
  expect "has a Gotchas section" grep -qi '^#.*gotchas' "$s/SKILL.md"
  expect "no tag was created during the run" test "$(git -C "$d" tag | wc -l)" -eq "$tags_before"
}

eval_rotate() {
  echo "== rotate (from scratch) =="
  local d=$OUT/rotate/ops
  mkdir -p "$d"; git -C "$d" init -q; install_skill "$d"
  run_claude "$d" "Use the write-great-skill skill. Make a skill for this repo (.claude/skills/) from our API key rotation runbook. \
We keep the Stripe and SendGrid secret keys in the 1Password vault 'prod' and as Vercel env vars STRIPE_SECRET_KEY and SENDGRID_API_KEY on the Vercel project 'shop'. \
Rotation: create the new key in the provider dashboard (a human does this), save it with op item edit, replace the Vercel env var for production and preview \
(vercel env rm, then vercel env add), redeploy with vercel --prod, check that https://shop.example.com/api/health reports both providers ok, \
and revoke the old key in the dashboard 24 hours later. Never revoke the old key before the new deploy is verified. Never paste a key into chat, a file or a commit. \
I am not around to answer questions: make your best assumptions, list them, and finish the skill."
  local s; s=$(dirname "$(ls "$d"/.claude/skills/*/SKILL.md 2>/dev/null | grep -v write-great-skill | head -1)")
  echo "  skill folder: ${s#$d/}"
  expect "used write-great-skill" used_skill "$d"
  expect "a new skill folder exists" test -f "$s/SKILL.md"
  expect "check-skill passes" $CHECK "$s"
  expect "description is trigger-rich (rotate, key, leak, expire, stripe, sendgrid, secret)" desc_has "$s/SKILL.md" rotat key leak expir stripe sendgrid secret
  expect "has at least one script" bash -c "ls '$s'/scripts/* >/dev/null"
  expect "every shell script parses (bash -n)" bash -c "for f in '$s'/scripts/*.sh; do bash -n \"\$f\" || exit 1; done"
  expect "has a Gotchas section with the revoke rule" bash -c "grep -qi '^#.*gotchas' '$s/SKILL.md' && grep -qi 'revoke' '$s/SKILL.md'"
  expect "steps have done-checks" grep -qi 'done when' "$s/SKILL.md"
  expect "no secret-shaped strings" bash -c "! grep -rEq 'sk_live_[A-Za-z0-9]{8}|SG\.[A-Za-z0-9_-]{16}' '$s'"
}

eval_autopick() {
  local d=$OUT/autopick/app
  mkdir -p "$d"; git -C "$d" init -q; install_skill "$d"
  local yes=(
    "Every time I deploy I paste the same checklist into chat: build, run the tests, tag, push. Can you turn it into something the agent loads by itself?"
    "I want the agent to run our on-call runbook the same way every time. Package it up so it is reusable."
    "Write a skill that teaches Claude how we triage support tickets."
    "My SKILL.md for database migrations never gets used, the agent ignores it. What is wrong with it and how do I fix it?"
    "Create a slash command /changelog that collects merged PRs since the last tag and writes the changelog section."
  )
  local no=(
    "Fix the off-by-one in this loop: for (let i = 0; i <= items.length; i++) total += items[i].price"
    "Explain what a git rebase does, in three sentences."
  )
  for mode in all-installed project-only; do
    echo "== autopick ($mode skills) =="
    local env=(); [ $mode = project-only ] && env=(FIRES_ONLY_PROJECT=1)
    (cd "$d" && env "${env[@]+"${env[@]}"}" "$SKILL/scripts/fires.sh" write-great-skill "${yes[@]}") | sed 's/^/  /'
    echo "  -- should not fire:"
    (cd "$d" && env "${env[@]+"${env[@]}"}" "$SKILL/scripts/fires.sh" write-great-skill "${no[@]}") | sed 's/^/  /'
  done
}

case $WHICH in
  release) eval_release ;; rotate) eval_rotate ;; autopick) eval_autopick ;;
  all) eval_release; eval_rotate; eval_autopick ;;
  *) echo "unknown eval: $WHICH" >&2; exit 2 ;;
esac
[ "$WHICH" = autopick ] || echo "checks: $pass passed, $fail failed (transcripts: $OUT/**/*.transcript.jsonl)"
