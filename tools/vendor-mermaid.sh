#!/usr/bin/env bash
# Rebuilds shared/vendor/beautiful-mermaid.mjs (used at pack time, never shipped to readers).
set -euo pipefail
tmp=$(mktemp -d); cd "$tmp"
npm init -y >/dev/null && npm i beautiful-mermaid@1.1.3 esbuild --silent
echo 'export { renderMermaidSVG, parseMermaid } from "beautiful-mermaid";' > vend.js
npx esbuild vend.js --bundle --minify --format=esm --platform=neutral --main-fields=module,main --outfile=out.mjs
echo "done: $tmp/out.mjs — prepend the license header and copy it to shared/vendor/"
