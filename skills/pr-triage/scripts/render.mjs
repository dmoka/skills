#!/usr/bin/env node
// Renders a triage.json or tour-<n>.json into ONE self-contained HTML file:
// no server, no build step, no network needed (Geist loads from Google Fonts
// when online and falls back to system fonts). The HTML adds no facts — it
// is a view of the JSON, so humans and agents see the same report.
// Source of truth: shared/render.mjs in github.com/dmoka/skills.
//
//   node render.mjs <report.json> [--out report.html]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const input = args._[0];
if (!input) { console.error("usage: render.mjs <report.json> [--out file.html]"); process.exit(1); }
const report = JSON.parse(readFileSync(input, "utf8"));
const outPath = args.out ?? input.replace(/\.json$/, ".html");

// ---------- helpers ----------

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Minimal inline markdown: `code` and **bold**, after escaping.
const md = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
const num = (n) => `<span class="num">${esc(n)}</span>`;
const sevBadge = (s) => `<span class="sev sev-${esc(s)}">${esc(s)}</span>`;
const srcBadge = (s) => (s === "fact" ? `<span class="tag tag-fact" title="Computed by a script from the diff">FACT</span>`
  : s === "map" ? `<span class="tag tag-ask" title="No quote from the author explains this file">ASK WHY</span>`
  : `<span class="tag tag-model" title="Written by the model; file and line checked by annotate.mjs">LOOK HERE</span>`);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const age = (d) => (d == null ? "—" : d === 0 ? "today" : `${d}d`);
const when = (iso) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "");

// ---------- syntax highlight (tiny, per line, zero deps) ----------

const KW = {
  js: "abstract as async await break case catch class const continue debugger default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while with yield",
  py: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield",
  sql: "add alter and as begin by cascade check column commit constraint create default delete desc distinct drop exists foreign from group having if in index insert into is join key left limit not null on or order primary references rename select set table to transaction truncate unique update using values where",
  go: "break case chan const continue default defer else fallthrough for func go goto if import interface map nil package range return select struct switch type var true false",
  generic: "if else for while return class function def fn let const var true false null nil new public private static import package use struct enum match impl pub mut",
};
const langOf = (path) => {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte"].includes(ext)) return "js";
  if (ext === "py") return "py";
  if (ext === "sql") return "sql";
  if (ext === "go") return "go";
  if (["json", "jsonc"].includes(ext)) return "json";
  if (["css", "scss"].includes(ext)) return "css";
  if (["md", "txt", "lock", "yaml", "yml", "toml"].includes(ext)) return "plain";
  return "generic";
};
const kwSets = Object.fromEntries(Object.entries(KW).map(([k, v]) => [k, new Set(v.split(" "))]));
function highlight(line, lang) {
  if (lang === "plain" || line.length > 400) return esc(line);
  const comment = lang === "py" ? /^#.*/ : lang === "sql" ? /^--.*/ : /^\/\/.*|^\/\*.*?(\*\/|$)/;
  const kws = kwSets[lang] ?? (lang === "json" || lang === "css" ? new Set() : kwSets.generic);
  const ci = lang === "sql";
  let out = "";
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    let m;
    if ((m = rest.match(comment))) { out += `<span class="hl-c">${esc(m[0])}</span>`; i += m[0].length; continue; }
    if ((m = rest.match(/^("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)/))) {
      const isKey = lang === "json" && /^\s*:/.test(line.slice(i + m[0].length));
      out += `<span class="${isKey ? "hl-p" : "hl-s"}">${esc(m[0])}</span>`; i += m[0].length; continue;
    }
    if ((m = rest.match(/^\b\d[\d_]*(\.\d+)?([eE][+-]?\d+)?n?\b/))) { out += `<span class="hl-n">${esc(m[0])}</span>`; i += m[0].length; continue; }
    if ((m = rest.match(/^[A-Za-z_$][\w$]*/))) {
      const w = m[0];
      if (kws.has(ci ? w.toLowerCase() : w)) out += `<span class="hl-k">${esc(w)}</span>`;
      else if (/^[A-Z][A-Za-z0-9]*$/.test(w) && lang !== "sql") out += `<span class="hl-t">${esc(w)}</span>`;
      else if (line[i + w.length] === "(") out += `<span class="hl-f">${esc(w)}</span>`;
      else out += esc(w);
      i += w.length; continue;
    }
    out += esc(line[i]); i++;
  }
  return out;
}

// ---------- page shell ----------

const CSS = `
:root{
  --bg:oklch(0.155 0.004 285);--fg:oklch(0.94 0.002 286);--card:oklch(0.185 0.004 285);
  --raised:oklch(0.215 0.005 285);--muted:oklch(0.24 0.005 285);--mfg:oklch(0.68 0.006 286);
  --dim:oklch(0.52 0.006 286);--border:oklch(1 0 0 / 0.09);--border2:oklch(1 0 0 / 0.14);--faint:oklch(1 0 0 / 0.035);
  --red:oklch(0.704 0.191 22.2);--red-bg:oklch(0.704 0.191 22.2 / 0.12);
  --amber:oklch(0.8 0.14 75);--amber-bg:oklch(0.8 0.14 75 / 0.11);
  --green:oklch(0.76 0.15 152);--green-bg:oklch(0.76 0.15 152 / 0.10);
  --blue:oklch(0.74 0.11 250);--blue-bg:oklch(0.74 0.11 250 / 0.12);
  --add:oklch(0.76 0.15 152 / 0.09);--add-g:oklch(0.76 0.15 152 / 0.55);--del:oklch(0.704 0.191 22.2 / 0.09);--del-g:oklch(0.704 0.191 22.2 / 0.55);
  --r:6px;--sans:"Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
*{box-sizing:border-box}html{background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.5 var(--sans);-webkit-font-smoothing:antialiased;font-feature-settings:"ss01"}
::selection{background:oklch(0.35 0.01 286);color:#fff}
a{color:inherit;text-decoration:none}a:hover{text-decoration:underline;text-decoration-color:var(--dim);text-underline-offset:2px}
code,.mono,.num{font-family:var(--mono);font-size:12px}.num{font-variant-numeric:tabular-nums}
code{background:var(--muted);border:1px solid var(--border);border-radius:4px;padding:0 4px;font-size:11.5px}
b{font-weight:600}
.wrap{max-width:1200px;margin:0 auto;padding:0 24px 64px}
header.top{position:sticky;top:0;z-index:5;background:color-mix(in oklch,var(--bg) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--border)}
header.top .wrap{display:flex;align-items:center;gap:12px;height:48px;padding-bottom:0}
.mark{display:flex;align-items:center;gap:8px;font-weight:600;letter-spacing:-0.01em}
.mark i{width:18px;height:18px;border-radius:5px;background:var(--fg);display:inline-block;position:relative}
.mark i:after{content:"";position:absolute;inset:5px 5px auto 5px;height:2px;background:var(--bg);box-shadow:0 3px 0 var(--bg),0 6px 0 var(--bg)}
.sep{color:var(--dim)}.meta{color:var(--mfg)}.grow{flex:1}
h1{font-size:20px;font-weight:600;letter-spacing:-0.02em;margin:28px 0 4px;line-height:1.3}
h2{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.06em;color:var(--mfg);margin:28px 0 10px;display:flex;align-items:center;gap:8px}
h2 .count{color:var(--dim);text-transform:none;letter-spacing:0;font-weight:400}
.sub{color:var(--mfg);display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.box{border:1px solid var(--border);border-radius:var(--r);background:var(--card)}
.strip{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;margin-top:20px}
.strip>div{padding:12px 14px;border-left:1px solid var(--border)}.strip>div:first-child{border-left:0}
.strip .k{font-size:11px;color:var(--mfg)}.strip .v{font-family:var(--mono);font-size:18px;font-variant-numeric:tabular-nums;margin-top:2px;letter-spacing:-0.02em}
.strip .v small{font-family:var(--sans);font-size:12px;color:var(--dim);margin-left:6px;letter-spacing:0}
table{width:100%;border-collapse:collapse}
th{font-size:11px;font-weight:500;color:var(--mfg);text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:9px 12px;border-bottom:1px solid var(--border);vertical-align:top}
tr:last-child td{border-bottom:0}tbody tr:hover td{background:var(--faint)}
td.r,th.r{text-align:right}
.sev,.tag,.chip,.pill{display:inline-flex;align-items:center;gap:4px;border-radius:999px;border:1px solid var(--border2);padding:0 7px;height:18px;font-size:10.5px;font-weight:500;white-space:nowrap;letter-spacing:0.01em}
.sev{text-transform:uppercase;font-size:10px;letter-spacing:0.04em}
.sev-high{color:var(--red);background:var(--red-bg);border-color:oklch(0.704 0.191 22.2 / 0.3)}
.sev-medium{color:var(--amber);background:var(--amber-bg);border-color:oklch(0.8 0.14 75 / 0.28)}
.sev-low{color:var(--mfg)}
.tag{font-family:var(--mono);font-size:9.5px;letter-spacing:0.05em;border-radius:4px;height:17px;padding:0 5px}
.tag-fact{color:var(--fg);background:var(--muted)}
.tag-model{color:var(--blue);background:var(--blue-bg);border-color:oklch(0.74 0.11 250 / 0.3)}
.tag-ask{color:var(--amber);background:var(--amber-bg);border-color:oklch(0.8 0.14 75 / 0.28)}
.tag-src{color:var(--mfg);background:transparent}
.imap{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);border-top:1px solid var(--border)}
.imap:first-of-type{border-top:0}
.imap>div{padding:8px 0}.imap>div:first-child{padding-right:16px}
.imap .files{display:flex;flex-wrap:wrap;gap:4px;align-content:flex-start}
.fchip{font-family:var(--mono);font-size:11px;border:1px solid var(--border2);border-radius:4px;padding:1px 6px;color:var(--fg);background:var(--muted)}
.fchip.dim{color:var(--mfg);background:transparent}
.fchip.warn{color:var(--amber);background:var(--amber-bg);border-color:oklch(0.8 0.14 75 / 0.28)}
.fchip.bad{color:var(--red);background:var(--red-bg);border-color:oklch(0.704 0.191 22.2 / 0.3)}
.imap-h{font-size:11px;color:var(--dim);margin:12px 0 2px}
.chip{color:var(--mfg);font-family:var(--mono);font-size:10.5px;border-radius:4px}
.chip .p{color:var(--fg)}.chip.neg .p{color:var(--green)}
.pill{color:var(--mfg)}
.score{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:22px;border-radius:5px;font-family:var(--mono);font-size:12.5px;font-weight:500;font-variant-numeric:tabular-nums;border:1px solid var(--border2)}
.score.high{color:var(--red);background:var(--red-bg);border-color:oklch(0.704 0.191 22.2 / 0.3)}
.score.medium{color:var(--amber);background:var(--amber-bg);border-color:oklch(0.8 0.14 75 / 0.28)}
.score.low{color:var(--fg)}.score.none{color:var(--dim)}
.plus{color:var(--green)}.minus{color:var(--red)}
.att{display:inline-flex;align-items:center;justify-content:center;min-width:64px;height:20px;padding:0 8px;border-radius:5px;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border:1px solid var(--border2);white-space:nowrap}
.att-critical{color:var(--bg);background:var(--red);border-color:var(--red)}
.att-high{color:var(--red);background:var(--red-bg);border-color:oklch(0.704 0.191 22.2 / 0.35)}
.att-medium{color:var(--amber);background:var(--amber-bg);border-color:oklch(0.8 0.14 75 / 0.3)}
.att-low{color:var(--mfg)}.att-none{color:var(--dim);font-weight:400;text-transform:none;letter-spacing:0}
.what{margin-top:5px;max-width:70ch;color:var(--fg)}
.whyline{margin-top:3px;color:var(--mfg);max-width:74ch;font-size:12.5px}
.whyline .ev,.facts a{text-decoration:none}.whyline .ev{color:var(--blue);font-size:11.5px}
.go{font-size:12px;color:var(--fg);white-space:nowrap;border:1px solid var(--border2);border-radius:5px;padding:3px 8px}.go:hover{background:var(--faint);text-decoration:none}
.attbox{margin-top:18px;display:flex;gap:12px;align-items:flex-start;padding:12px 14px}
.attbox .t{flex:1}.attbox .t div{color:var(--mfg);font-size:12.5px;margin-top:2px}
.rank{color:var(--dim);font-family:var(--mono);font-variant-numeric:tabular-nums}
.title{font-weight:500}.title .n{color:var(--dim);font-family:var(--mono);font-weight:400;margin-left:6px;font-size:12px}
.expl{color:var(--mfg);margin-top:3px;max-width:62ch}
.facts{margin-top:5px;display:flex;flex-direction:column;gap:2px}.facts div{color:var(--mfg);font-size:12px}
.facts div:before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--red);margin-right:7px;vertical-align:1px}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.ev{color:var(--dim);font-size:11px;margin-top:3px;font-family:var(--mono)}
.rule-when{font-family:var(--mono);font-size:11.5px;color:var(--mfg)}
.model{border-left:2px solid oklch(0.74 0.11 250 / 0.5);padding:2px 0 2px 12px}
.note{color:var(--mfg);font-size:12px;margin-top:6px}
.footer{margin-top:40px;padding-top:14px;border-top:1px solid var(--border);color:var(--dim);font-size:12px;display:flex;gap:16px;flex-wrap:wrap}
/* tour */
.why{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0}
.why>section{padding:16px 18px;border-top:1px solid var(--border)}
.why>section:nth-child(-n+2){border-top:0}.why>section:nth-child(even){border-left:1px solid var(--border)}
.why>section.full{grid-column:1/-1;border-left:0}
.why h3{font-size:11px;font-weight:500;color:var(--mfg);margin:0 0 8px;display:flex;align-items:center;gap:8px;text-transform:uppercase;letter-spacing:0.06em}
.quote{border-left:2px solid var(--border2);padding-left:12px;color:var(--fg);white-space:pre-wrap;font-size:12.5px;max-height:220px;overflow:auto}
.src{color:var(--dim);font-size:11px;margin-bottom:4px}
.unknown{display:flex;gap:10px;align-items:flex-start}.unknown p{margin:0;color:var(--mfg)}
.items{display:flex;flex-direction:column}
.item{display:grid;grid-template-columns:62px 78px minmax(0,1fr);gap:10px;padding:9px 0;border-top:1px solid var(--border);align-items:start}
.item:first-child{border-top:0;padding-top:0}
.item .loc{font-family:var(--mono);font-size:11.5px;color:var(--mfg)}
.item .why-t{color:var(--mfg);font-size:12px;margin-top:2px}
.claim{padding:8px 0;border-top:1px solid var(--border)}.claim:first-child{border-top:0;padding-top:0}
.claim q,.imap q{font-style:normal;color:var(--fg)}.claim q:before,.imap q:before{content:"\\201C"}.claim q:after,.imap q:after{content:"\\201D"}
.toc{counter-reset:s}
.toc a{display:grid;grid-template-columns:28px minmax(0,1fr) auto auto;gap:10px;padding:6px 12px;border-bottom:1px solid var(--border);align-items:center}
.toc a:last-child{border-bottom:0}.toc a:hover{background:var(--faint);text-decoration:none}
.toc .i{color:var(--dim);font-family:var(--mono);font-size:11px;font-variant-numeric:tabular-nums}
.toc .p{font-family:var(--mono);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.toc .w{color:var(--dim);font-size:11.5px;white-space:nowrap}
.toc a.test .p{padding-left:16px;color:var(--mfg)}.toc a.test .p:before{content:"└ ";color:var(--dim)}
.toc .d{font-family:var(--mono);font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums}
.file{margin-top:14px;overflow:clip}
.file.test{margin-left:22px}
.fh{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--raised);position:sticky;top:48px;z-index:2}
.fh .step{font-family:var(--mono);font-size:11px;color:var(--dim);font-variant-numeric:tabular-nums;min-width:18px}
.fh .path{font-family:var(--mono);font-size:12.5px;font-weight:500}
.fh .old{font-family:var(--mono);font-size:11.5px;color:var(--dim)}
.fh .pos{color:var(--dim);font-size:11.5px}
.fnote{padding:8px 12px;border-bottom:1px solid var(--border);color:var(--mfg);font-size:12.5px;display:flex;gap:8px;align-items:flex-start}
.diff{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px;line-height:1.55}
.diff td{padding:0;border:0;vertical-align:top}.diff tr:hover td{background:none}
.diff .ln{width:1%;min-width:44px;padding:0 8px;text-align:right;color:var(--dim);user-select:none;font-variant-numeric:tabular-nums;font-size:11px}
.diff .code{white-space:pre-wrap;word-break:break-word;padding:0 12px 0 14px;position:relative}
.diff tr.add .code{background:var(--add)}.diff tr.add .ln{background:var(--add)}.diff tr.add .code:before{content:"+";position:absolute;left:3px;color:var(--add-g)}
.diff tr.del .code{background:var(--del)}.diff tr.del .ln{background:var(--del)}.diff tr.del .code:before{content:"−";position:absolute;left:3px;color:var(--del-g)}
.diff tr.hunk td{background:var(--faint);color:var(--dim);padding:3px 12px;font-size:11px}
.diff tr.flag .ln:first-child{box-shadow:inset 2px 0 0 var(--red)}
.diff tr.flag.medium .ln:first-child{box-shadow:inset 2px 0 0 var(--amber)}
.diff tr.flag.low .ln:first-child{box-shadow:inset 2px 0 0 var(--dim)}
.diff tr.ann td{padding:0}
.ann-box{margin:4px 12px 6px 104px;padding:8px 10px;border:1px solid var(--border2);border-radius:var(--r);background:var(--card);font-family:var(--sans);font-size:12.5px;display:flex;gap:8px;align-items:flex-start}
.ann-box .t{flex:1}.ann-box .t div{color:var(--mfg);font-size:12px;margin-top:2px}
.hl-k{color:oklch(0.77 0.1 300)}.hl-s{color:oklch(0.8 0.08 190)}.hl-n{color:oklch(0.8 0.09 330)}.hl-c{color:var(--dim);font-style:italic}.hl-t{color:oklch(0.83 0.07 250)}.hl-f{color:oklch(0.86 0.05 250)}.hl-p{color:oklch(0.8 0.05 250)}
details>summary{cursor:pointer;list-style:none}details>summary::-webkit-details-marker{display:none}
details>summary .caret{display:inline-block;transition:transform .15s;color:var(--dim)}details[open]>summary .caret{transform:rotate(90deg)}
.noise summary.nh{display:flex;align-items:center;gap:10px;padding:10px 12px}
.noise .row{border-top:1px solid var(--border)}
.noise .row>summary{display:grid;grid-template-columns:14px minmax(0,1fr) 140px 90px;gap:10px;padding:6px 12px;align-items:center}
.noise .row>summary:hover{background:var(--faint)}
.noise .row .p{font-family:var(--mono);font-size:12px;color:var(--mfg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.more>summary{padding:8px 12px;color:var(--mfg);font-size:12px}
.empty{color:var(--dim);padding:4px 0}
@media (max-width:820px){.why{grid-template-columns:1fr}.why>section:nth-child(even){border-left:0}.why>section:nth-child(2){border-top:1px solid var(--border)}.hide-sm{display:none}.item{grid-template-columns:1fr}.ann-box{margin-left:12px}.file.test{margin-left:8px}.wrap{padding:0 16px 48px}}
`;

function page(title, topRight, body, meta) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="color-scheme" content="dark">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>${CSS}</style></head>
<body>
<header class="top"><div class="wrap">${topRight}</div></header>
<main class="wrap">${body}</main>
<script type="application/json" id="report">${JSON.stringify(meta).replace(/</g, "\\u003c")}</script>
</body></html>
`;
}

// ---------- triage ----------

const LEVELS = ["critical", "high", "medium", "low"];
const attBadge = (lvl) => (lvl ? `<span class="att att-${esc(lvl)}">${esc(lvl)}</span>` : `<span class="att att-none">not judged</span>`);

function renderTriage(r, tours) {
  const prs = r.prs;
  const judged = prs.filter((p) => p.attention).length;
  const count = (lvl) => prs.filter((p) => p.attention?.level === lvl).length;
  const top = `<span class="mark"><i></i>PR Triage</span><span class="sep">/</span><span class="mono meta">${esc(r.repo)}</span><span class="grow"></span><span class="meta hide-sm">${esc(when(r.generatedAt))}</span>`;
  const anchorIn = (p, file, line, side) => {
    const t = tours.get(p.number);
    const i = t?.order.findIndex((o) => o.path === file);
    if (i == null || i < 0) return `tour-${p.number}.html`;
    return `tour-${p.number}.html#f${i}${line != null ? (side === "old" ? "-o" : "-n") + line : ""}`;
  };

  const rows = prs.map((p, i) => {
    const a = p.attention;
    const hasTour = tours.has(p.number);
    return `
<tr>
  <td class="rank r">${p.rank ?? i + 1}</td>
  <td>${attBadge(a?.level)}</td>
  <td>
    <div class="title"><a href="${hasTour ? `tour-${p.number}.html` : esc(p.url)}">${esc(p.title)}</a><a class="n" href="${esc(p.url)}">#${p.number}</a><span class="n" style="font-family:var(--sans)">${esc(p.author ?? "")}</span>${p.draft ? ` <span class="pill">draft</span>` : ""}${p.labels.map((l) => ` <span class="pill">${esc(l)}</span>`).join("")}</div>
    ${a ? `<div class="model what">${md(a.whatHappened)}</div><div class="whyline">${md(a.why)}${a.file ? ` <a class="mono ev" href="${anchorIn(p, a.file, a.line, a.side)}">${esc(a.file.split("/").pop())}${a.line != null ? ":" + a.line : ""}</a>` : ""}</div>` : ""}
    ${p.highFacts.length ? `<div class="facts">${p.highFacts.slice(0, 3).map((f) => `<div>${md(f.text)} <a class="mono" style="color:var(--dim)" href="${anchorIn(p, f.file, f.line, f.side)}">${esc(f.file.split("/").pop())}${f.line ? ":" + f.line : ""}</a></div>`).join("")}</div>` : ""}
  </td>
  <td class="r num">${p.readLines.toLocaleString("en")}<div style="color:var(--dim);white-space:nowrap">${p.noiseLines ? `+${p.noiseLines.toLocaleString("en")} noise` : plural(p.filesChanged, "file")}</div></td>
  <td class="r num">${age(p.ageDays)}</td>
  <td class="r">${hasTour ? `<a class="go" href="tour-${p.number}.html">Tour →</a>` : `<span class="empty mono" title="Ask your agent">tour PR ${p.number}</span>`}</td>
</tr>`;
  }).join("");

  const body = `
<h1>What needs your attention first</h1>
<div class="sub"><span>${judged === prs.length ? "Every open PR was read and judged by the model; each reason links to the line that drives it." : `${judged} of ${prs.length} PRs judged so far — the rest are listed by number.`}</span></div>
<div class="box strip">
  <div><div class="k">Open PRs</div><div class="v">${prs.length}<small>${prs.filter((p) => p.draft).length} draft</small></div></div>
  <div><div class="k">Critical</div><div class="v" style="color:${count("critical") ? "var(--red)" : "inherit"}">${count("critical")}</div></div>
  <div><div class="k">High</div><div class="v" style="color:${count("high") ? "var(--red)" : "inherit"}">${count("high")}</div></div>
  <div><div class="k">Lines to read</div><div class="v">${prs.reduce((s, p) => s + p.readLines, 0).toLocaleString("en")}</div></div>
  <div><div class="k">Noise, collapsed</div><div class="v">${prs.reduce((s, p) => s + p.noiseLines, 0).toLocaleString("en")}<small>lines</small></div></div>
</div>
${r.summary ? `<h2>Summary <span class="tag tag-model">MODEL</span></h2><div class="model">${md(r.summary)}</div>` : ""}
<h2>Queue <span class="count">${prs.length} · most attention first</span></h2>
<div class="box"><table>
<thead><tr><th class="r">#</th><th>Attention</th><th>Pull request · what happened · why</th><th class="r">To read</th><th class="r">Age</th><th></th></tr></thead>
<tbody>${rows}</tbody></table></div>
${(r.overlaps ?? []).length ? `<h2>PRs that change the same files <span class="count">merge order matters</span></h2><div class="box"><table><tbody>${r.overlaps.slice(0, 12).map((o) => `<tr><td class="mono" style="width:55%">${esc(o.file)}</td><td>${o.prs.map((n) => `<a class="fchip" href="${tours.has(n) ? `tour-${n}.html` : "#"}">#${n}</a>`).join(" ")}</td></tr>`).join("")}${r.overlaps.length > 12 ? `<tr><td colspan="2" class="empty">+${r.overlaps.length - 12} more files</td></tr>` : ""}</tbody></table></div>` : ""}
<div class="footer"><span>Attention is the model's judgement after reading each PR. Blue text is the model's; red dots are facts a script computed from the diff.</span><span>An order to read in — never a verdict. The last PR still gets read.</span></div>`;
  return page(`Triage · ${r.repo}`, top, body, { kind: "triage", schemaVersion: r.schemaVersion });
}

// ---------- tour ----------

function renderTour(r, { back = false } = {}) {
  const files = new Map(r.files.map((f) => [f.path, f]));
  const idx = new Map(r.order.map((o, i) => [o.path, i]));
  const anchor = (path, line, side = "new") => `#f${idx.get(path)}${line != null ? (side === "old" ? "-o" : "-n") + line : ""}`;
  const loc = (path, line, side) => `<a class="mono" href="${anchor(path, line, side)}">${esc(path.split("/").pop())}${line != null ? ":" + line : ""}</a>`;
  const SRC = { model: 0, map: 1, fact: 2 };
  const items = [...r.items].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]) || SRC[a.source] - SRC[b.source]);
  const pr = r.pr;
  const top = `${back ? `<a class="go" href="triage.html">← Queue</a>` : ""}<span class="mark"><i></i>PR Tour</span><span class="sep">/</span><span class="mono meta">${esc(r.repo ?? "local diff")}</span><span class="sep">/</span><span class="mono">#${esc(pr.number)}</span><span class="grow"></span><span class="meta hide-sm">${esc(when(r.generatedAt))}</span>`;

  const TYPE = { spec: "SPEC", description: "DESCRIPTION", issue: "ISSUE", commits: "COMMITS", title: "TITLE" };
  const srcBlock = (x) => {
    const long = x.text.split("\n").length > 10 || x.text.length > 700;
    const head = `<div class="src"><span class="tag tag-src">${TYPE[x.type] ?? esc(x.type)}</span> ${esc(x.source)}</div>`;
    return long ? `<details class="more" style="margin:0 -12px"><summary>${head.replace('class="src"', 'class="src" style="display:inline-block;margin:0 0 0 12px"')} <span class="caret">▸</span></summary><div class="quote" style="margin:0 12px 6px">${esc(x.text)}</div></details>`
      : `${head}<div class="quote">${esc(x.text)}</div>`;
  };
  const intent = (r.intent.status === "UNKNOWN"
    ? `<div class="unknown" style="margin-bottom:10px">${sevBadge("high").replace(">high<", ">unknown<")}<p>No spec, no description, no linked issue, and no title or commit that says what this is for. There is nothing to review against — ask the author first. The summary on the right is the model's reading of the diff, not the author's intent.</p></div>`
    : r.intent.status === "title only"
      ? `<div class="unknown" style="margin-bottom:10px">${sevBadge("medium").replace(">medium<", ">title only<")}<p>The title is all the author wrote. Everything the title does not explain is listed under <b>Intent map</b>.</p></div>` : "")
    + r.intent.sources.map(srcBlock).join("<div style='height:10px'></div>");

  const kindOf = new Map(r.files.map((f) => [f.path, f.kind]));
  const chip = (p, cls = "") => `<a class="fchip ${cls || (kindOf.get(p) === "noise" ? "dim" : "")}" href="#f${idx.get(p)}" title="${esc(p)}">${esc(p.split("/").pop())}</a>`;
  const allNoise = r.files.every((f) => f.kind === "noise");
  const areaOf = new Map(r.files.map((f) => [f.path, f.areas]));
  const imap = !r.whatItDoes ? `<div class="empty">Not annotated yet.</div>`
    : [
      ...(r.explains ?? []).filter((e) => e.files.length).map((e) => `<div class="imap"><div><q>${md(e.quote)}</q></div><div class="files">${e.files.map((p) => chip(p)).join("")}</div></div>`),
      (r.unexplained ?? []).length ? `<div class="imap-h">Not explained by anything the author wrote — ask why</div><div class="imap"><div style="color:var(--mfg)">${plural(r.unexplained.length, "file")} with no stated reason</div><div class="files">${r.unexplained.map((p) => chip(p, areaOf.get(p)?.length ? "bad" : "warn")).join("")}</div></div>` : `<div class="imap-h">${allNoise ? "Every change is noise (renames, formatting, lockfiles, generated files) — nothing needs a reason." : "Every changed file is explained by the author's words."}</div>`,
      (r.unmatched ?? []).length ? `<div class="imap-h">Stated, but not visible in this diff</div>${r.unmatched.map((q) => `<div class="imap"><div><q>${md(q)}</q></div><div class="files"><span class="empty">no matching change</span></div></div>`).join("")}` : "",
    ].join("");

  const claims = r.claims.length
    ? r.claims.map((c) => `<div class="claim"><q>${md(c.quote)}</q>${c.file ? ` <span class="sep">→</span> check at ${loc(c.file, c.line, c.side)}` : ""}${c.note ? `<div class="note">${md(c.note)}</div>` : ""}</div>`).join("")
    : `<div class="empty">${r.intent.status === "UNKNOWN" ? "No stated intent, so no claims to check." : "No checkable claims in the PR text."}</div>`;

  const itemRow = (it) => `<div class="item"><div>${sevBadge(it.severity)}</div><div>${srcBadge(it.source)}</div><div><div>${md(it.text)} ${it.file ? `<span class="sep">·</span> ${loc(it.file, it.line, it.side)}` : ""}</div>${it.why ? `<div class="why-t">${md(it.why)}</div>` : ""}</div></div>`;
  const major = items.filter((it) => it.severity !== "low");
  const minor = items.filter((it) => it.severity === "low");
  const itemRows = !items.length ? `<div class="empty">No facts and no LOOK HERE items.</div>`
    : major.map(itemRow).join("") + (minor.length ? `<details class="more" style="margin:${major.length ? "4px" : "0"} -12px 0"><summary><span class="caret">▸</span> ${plural(minor.length, "low-severity item")}</summary><div style="padding:0 12px">${minor.map(itemRow).join("")}</div></details>` : "");

  const counts = { high: items.filter((i) => i.severity === "high").length, medium: items.filter((i) => i.severity === "medium").length };
  const nonNoise = r.order.filter((o) => o.role !== "noise");
  const noise = r.order.filter((o) => o.role === "noise");
  const readLines = nonNoise.reduce((s, o) => s + files.get(o.path).additions + files.get(o.path).deletions, 0);
  const noiseLines = noise.reduce((s, o) => s + files.get(o.path).additions + files.get(o.path).deletions, 0);

  const toc = nonNoise.map((o) => {
    const f = files.get(o.path);
    return `<a class="${o.role}" href="#f${idx.get(o.path)}"><span class="i">${idx.get(o.path) + 1}</span><span class="p">${esc(o.path)}</span><span class="w hide-sm">${esc(o.why)}</span><span class="d"><span class="plus">+${f.additions}</span> <span class="minus">−${f.deletions}</span></span></a>`;
  }).join("") + (noise.length ? `<a href="#noise"><span class="i">…</span><span class="p" style="color:var(--dim)">${plural(noise.length, "noise file")}, collapsed</span><span class="w hide-sm">${[...new Set(noise.map((n) => n.why))].join(", ")}</span><span class="d" style="color:var(--dim)">${noiseLines} lines</span></a>` : "");

  const fileBlocks = nonNoise.map((o) => fileBlock(r, o, files.get(o.path), idx.get(o.path), items)).join("");
  const noiseBlock = noise.length ? `
<details class="box noise" id="noise"><summary class="nh"><span class="caret">▸</span><b>Noise</b><span class="meta">${plural(noise.length, "file")} · ${noiseLines.toLocaleString("en")} lines · collapsed because they carry little reading value — not because anyone checked them</span></summary>
${noise.map((o) => { const f = files.get(o.path); return `<details class="row" id="f${idx.get(o.path)}"><summary><span class="caret">▸</span><span class="p">${esc(o.path)}${f.oldPath && f.oldPath !== f.path ? ` <span style="color:var(--dim)">← ${esc(f.oldPath)}</span>` : ""}</span><span class="pill">${esc(o.why)}</span><span class="num r"><span class="plus">+${f.additions}</span> <span class="minus">−${f.deletions}</span></span></summary>${diffTable(f, idx.get(o.path), items, 400)}</details>`; }).join("")}
</details>` : "";

  const body = `
<h1>${esc(pr.title)}</h1>
<div class="sub">${pr.url ? `<a class="mono" href="${esc(pr.url)}">#${esc(pr.number)}</a>` : ""}${pr.author ? `<span>${esc(pr.author)}</span>` : ""}${pr.base ? `<span class="mono">${esc(pr.base)} ← ${esc(pr.head)}</span>` : ""}${pr.draft ? `<span class="pill">draft</span>` : ""}<span class="num"><span class="plus">+${pr.additions}</span> <span class="minus">−${pr.deletions}</span></span><span>${plural(pr.filesChanged, "file")}</span></div>
${r.attention ? `<div class="box attbox">${attBadge(r.attention.level)}<div class="t"><b>${md(r.attention.whatHappened)}</b><div>${md(r.attention.why)}${r.attention.file ? ` <a class="mono" style="color:var(--blue)" href="${anchor(r.attention.file, r.attention.line, r.attention.side)}">${esc(r.attention.file.split("/").pop())}${r.attention.line != null ? ":" + r.attention.line : ""}</a>` : ""}</div></div><span class="tag tag-model">MODEL</span></div>` : ""}
<div class="box strip">
  <div><div class="k">Read</div><div class="v">${readLines.toLocaleString("en")}<small>lines in ${plural(nonNoise.length, "file")}</small></div></div>
  <div><div class="k">Collapsed noise</div><div class="v">${noiseLines.toLocaleString("en")}<small>lines in ${plural(noise.length, "file")}</small></div></div>
  <div><div class="k">High</div><div class="v" style="color:${counts.high ? "var(--red)" : "inherit"}">${counts.high}</div></div>
  <div><div class="k">Medium</div><div class="v" style="color:${counts.medium ? "var(--amber)" : "inherit"}">${counts.medium}</div></div>
  <div><div class="k">Intent</div><div class="v" style="font-size:14px;margin-top:5px">${r.intent.status === "UNKNOWN" ? `<span style="color:var(--red)">UNKNOWN</span>` : r.intent.status === "title only" ? `<span style="color:var(--amber)">title only</span>` : esc(r.intent.status)}<small>${(r.unexplained ?? []).length ? `${r.unexplained.length} unexplained` : ""}</small></div></div>
</div>
<h2>Why</h2>
<div class="box why">
  <section><h3>Intent <span class="count" style="text-transform:none;letter-spacing:0;color:var(--dim)">the author's words</span></h3>${intent}</section>
  <section><h3>What the diff does <span class="tag tag-model">MODEL</span></h3>${r.whatItDoes ? `<div class="model">${md(r.whatItDoes)}</div>` : `<div class="empty">Not annotated yet.</div>`}</section>
  <section class="full"><h3>Intent map <span class="count" style="text-transform:none;letter-spacing:0;color:var(--dim)">the author's words → the files they explain · MODEL mapping, quotes and files checked</span></h3>${imap}</section>
  ${r.claims.length ? `<section class="full"><h3>Claims to check</h3>${claims}</section>` : ""}
  <section class="full"><h3>Where to look <span class="count" style="text-transform:none;letter-spacing:0;color:var(--dim)">${items.length} items · FACT = computed from the diff · LOOK HERE = model, line-checked · ASK WHY = no stated reason</span></h3><div class="items">${itemRows}</div></section>
</div>
<h2>Reading order <span class="count">${esc(r.orderRule)}</span></h2>
<div class="box toc">${toc}</div>
${fileBlocks}
${noise.length ? `<h2>Collapsed</h2>${noiseBlock}` : ""}
<div class="footer"><span>This tour points attention. It gives no merge verdict and no security verdict.</span><span>Collapsed means low reading value, not verified.</span><span>Blue = written by the model.</span></div>`;
  return page(`Tour #${pr.number} · ${pr.title}`, top, body, { kind: "tour", schemaVersion: r.schemaVersion, pr: pr.number });
}

function fileBlock(r, o, f, i, items) {
  const posLabel = o.role === "test" ? `test for <span class="mono">${esc(o.pairedWith?.split("/").pop() ?? "")}</span>` : esc(o.why);
  const note = r.fileNotes?.[f.path];
  return `
<div class="box file ${o.role === "test" ? "test" : ""}" id="f${i}">
  <div class="fh"><span class="step">${i + 1}</span><span class="path">${esc(f.path)}</span>${f.status === "renamed" ? `<span class="old">← ${esc(f.oldPath)}</span>` : ""}${f.status === "added" ? `<span class="pill">new</span>` : f.status === "deleted" ? `<span class="pill">deleted</span>` : ""}${f.areas.map((a) => `<span class="pill">${esc(a)}</span>`).join("")}<span class="grow"></span><span class="pos hide-sm">${o.role === "test" ? posLabel : posLabel}</span><span class="num"><span class="plus">+${f.additions}</span> <span class="minus">−${f.deletions}</span></span></div>
  ${note ? `<div class="fnote"><span class="tag tag-model">MODEL</span><span>${md(note)}</span></div>` : ""}
  ${diffTable(f, i, items, 300)}
</div>`;
}

function diffTable(f, i, items, foldAt) {
  if (f.binary) return `<div class="empty" style="padding:10px 12px">Binary file.</div>`;
  if (!f.hunks.length) return `<div class="empty" style="padding:10px 12px">${f.status === "renamed" ? "Renamed without content changes." : "No content changes."}</div>`;
  const lang = langOf(f.path);
  const here = items.filter((x) => x.file === f.path && x.line != null);
  // File-level low items (area tags) already show in the file header; keep the diff for findings.
  const unanchored = items.filter((x) => x.file === f.path && x.line == null && x.severity !== "low");
  const rowsFor = (lines) => lines.map((l) => {
    const hits = here.filter((x) => (x.side === "old" ? l.t !== "add" && l.o === x.line : l.t !== "del" && l.n === x.line));
    const sev = hits.length ? hits.map((h) => h.severity).sort((a, b) => ["high", "medium", "low"].indexOf(a) - ["high", "medium", "low"].indexOf(b))[0] : null;
    const id = l.n != null && l.t !== "del" ? `f${i}-n${l.n}` : `f${i}-o${l.o}`;
    const row = `<tr class="${l.t}${sev ? " flag " + sev : ""}" id="${id}"><td class="ln">${l.o ?? ""}</td><td class="ln">${l.n ?? ""}</td><td class="code">${highlight(l.s, lang) || " "}</td></tr>`;
    const ann = hits.map((h) => `<tr class="ann"><td colspan="3"><div class="ann-box">${sevBadge(h.severity)}${srcBadge(h.source)}<div class="t">${md(h.text)}${h.why ? `<div>${md(h.why)}</div>` : ""}</div></div></td></tr>`).join("");
    return row + ann;
  }).join("");
  const head = unanchored.length ? `<tr class="ann"><td colspan="3">${unanchored.map((h) => `<div class="ann-box">${sevBadge(h.severity)}${srcBadge(h.source)}<div class="t">${md(h.text)}${h.why ? `<div>${md(h.why)}</div>` : ""}</div></div>`).join("")}</td></tr>` : "";
  const total = f.hunks.reduce((s, h) => s + h.lines.length, 0);
  if (here.length) foldAt = Infinity; // never hide a flagged line behind a fold
  const body = f.hunks.map((h) => `<tr class="hunk"><td colspan="3">${esc(h.header)}</td></tr>${rowsFor(h.lines)}`).join("");
  const table = `<table class="diff">${head}${body}</table>`;
  if (total > foldAt) return `<details class="more"><summary><span class="caret">▸</span> Show ${total.toLocaleString("en")} diff lines</summary>${table}</details>`;
  return table;
}

// ---------- main ----------

const dir = dirname(input);
if (report.kind === "triage") {
  // One call renders the queue and every tour it lists, so the links work.
  const tours = new Map();
  for (const p of report.prs) {
    const path = join(dir, p.tour);
    if (!existsSync(path)) continue;
    const t = JSON.parse(readFileSync(path, "utf8"));
    tours.set(p.number, t);
    writeFileSync(path.replace(/\.json$/, ".html"), renderTour(t, { back: true }));
  }
  writeFileSync(outPath, renderTriage(report, tours));
  console.log(`${outPath} (+ ${tours.size} tours)`);
} else if (report.kind === "tour") {
  writeFileSync(outPath, renderTour(report, { back: existsSync(join(dir, "triage.json")) }));
  console.log(outPath);
} else { console.error(`unknown report kind "${report.kind}"`); process.exit(1); }
