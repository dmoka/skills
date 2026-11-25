#!/usr/bin/env bash
# setup.sh — check Java and install the pinned tla2tools.jar (TLC) once.
# Usage: scripts/setup.sh [--check]
#   --check  only report what is missing; download nothing
# Installs tla2tools.jar v1.7.4 from the official tlaplus GitHub release to
# ${TLA2TOOLS_JAR:-~/.cache/model-check-design/tla2tools-1.7.4.jar} and verifies its SHA-256.
# Java is never installed by this script: it prints the command for your OS.
set -euo pipefail

case ${1:-} in -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;; esac
CHECK=no; [ "${1:-}" = --check ] && CHECK=yes

VERSION=1.7.4
URL=https://github.com/tlaplus/tlaplus/releases/download/v$VERSION/tla2tools.jar
PINNED_SHA=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
JAR=${TLA2TOOLS_JAR:-$HOME/.cache/model-check-design/tla2tools-$VERSION.jar}
JAVA=${JAVA:-java}
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

missing=0
echo "== java"
if out=$("$JAVA" -version 2>&1); then
  major=$(sed -n 's/.*version "\([0-9]*\).*/\1/p' <<<"$out" | head -1)
  if [ "${major:-0}" -ge 11 ]; then echo "ok: Java $major ($JAVA)"
  else echo "too old: Java ${major:-?}; TLC needs 11+"; missing=1; fi
else
  missing=1
  echo "missing: no java on PATH. Install a JRE 11+ (Eclipse Temurin), then rerun:"
  echo "  macOS:  brew install --cask temurin"
  echo "  Debian/Ubuntu: sudo apt-get install -y openjdk-21-jre-headless"
  echo "  Windows: winget install EclipseAdoptium.Temurin.21.JRE"
  echo "  or set JAVA=/path/to/bin/java"
fi

echo "== tla2tools.jar v$VERSION"
if [ -f "$JAR" ] && [ "$(sha "$JAR")" = "$PINNED_SHA" ]; then
  echo "ok: $JAR (SHA-256 matches)"
elif [ $CHECK = yes ]; then
  echo "missing or wrong hash: $JAR"; missing=1
else
  mkdir -p "$(dirname "$JAR")"
  tmp=$JAR.download
  echo "downloading $URL"
  curl -fsSL -o "$tmp" "$URL"
  got=$(sha "$tmp")
  if [ "$got" != "$PINNED_SHA" ]; then
    : > "$tmp"
    echo "SHA-256 mismatch: got $got, pinned $PINNED_SHA — not installed" >&2; exit 1
  fi
  mv "$tmp" "$JAR"
  echo "ok: installed $JAR"
fi
[ $missing -eq 0 ] && echo "READY" || { echo "NOT READY"; exit 1; }
