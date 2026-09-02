#!/usr/bin/env node
// Blocks commits that introduce a term the Data Dictionary does not define into
// prose a reader sees: help text, popup rows, and the knowledge specs. See
// CLAUDE.md "Help Text Follows the Specs".
//
// Only lines the commit ADDS or CHANGES are gated, so existing debt never blocks
// an unrelated commit. `node scripts/check-vocabulary.js --audit` lists that debt
// across the whole repo instead.
//
// Only prose is scanned: markdown outside code spans and fences, and string
// literals in .js/.html. Identifiers and code comments are not prose and are
// left alone -- `legCount` in gap-math.js is a variable name, not a word a
// reader meets.
import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

// Each rule names what the Data Dictionary calls the thing instead. `ignore`
// exempts a line that matched for an unrelated reason.
const RULES = [
  // "Block" is ordinary English for a chunk of a file (the DARA block, a code
  // block, a paragraph block) and stays legal there. What is banned is block
  // standing in for a run of years, which the DD names.
  { id: 'block-of-years', re: /(gap|future[- ]?30y)[^.\n]{0,40}\bblocks?\b|\bblocks?\b[^.\n]{0,25}\b(of|the) (gap )?years\b|\bblock (coupon|excess|total)\b/i,
    why: 'names a run of years the DD already has terms for',
    use: 'gap years, Future 30Y rungs, or the years themselves' },
  { id: 'leg', re: /\blegs?\b/i,
    why: 'is a metaphor, and names a breakeven component by something it is not',
    use: 'the yield itself: "the real yield", "the SA TIPS yield", "uses a TIPS yield"' },
  // "print" as a plain verb is fine -- a script prints rows. What is banned is the
  // noun: a CPI print, irregular prints, a yield printing below a curve.
  { id: 'print', re: /\b(a|the|one|two|latest|last|next|known|unpublished|monthly|CPI|CPI-U|sparse|irregular|first|second|close|consolidation)[\s/,]+prints?\b|\bprints?\s+(below|above)\b|\b\d[\d:.]*\s+prints?\b|\bprints?\s+(sparsely|thinly)\b/i,
    why: 'is a metaphor for a published value or a quote',
    use: 'value or release for a CPI figure, quotes for feed records, "is below" for a data point' },
  { id: 'tenor', re: /\btenors?\b/i,
    why: 'not used for a maturity or term in this repo',
    use: 'maturity' },
  // "Treasury's" is left out on purpose: the institution takes a possessive and
  // only the security type does not, and no cheap pattern tells them apart.
  { id: 'possessive', re: /\b(TIPS|Note|Bond)'s\b/,
    why: 'security types take no possessive',
    use: 'reword: "the coupon on the TIPS"' },
  { id: 'bracket-cover', re: /bracket\/cover/i,
    why: 'compounds two separately defined terms into one that is defined nowhere',
    use: 'name both: "bracket year and cover year", "excess TIPS or cover excess"' },
  { id: 'synthetic-gap', re: /synthetic[- ]gap/i,
    why: 'the defined term is synthetic TIPS, which covers gap years and Future 30Y rungs alike',
    use: 'synthetic TIPS' },
  { id: 'n-bracket', re: /\b3-bracket\b|\bthree-bracket\b/i,
    why: 'the DD says the structure is never named by how many brackets it holds, and the control reads Multi-bracket',
    use: 'Multi-bracket' },
  { id: 'invented-side', re: /\blower[- ]side\b|\bupper[- ]side\b|\btwo[- ]sided\b/i,
    why: 'invented in a past session and swept out',
    use: 'the lower brackets, the upper bracket, 2-bracket' },
];

// Considered and left out pending a decision: "leg". It is undefined in the DD,
// but it is in live use for the two maturities of a breakeven pair (YieldCurves
// 4.0, YieldsMonitor 2.3/2.4). Either define it in the DD or replace it there,
// then add the rule.

// A source string is prose only if it reads like a sentence. Class lists, CSS
// values and id strings are code that happens to sit in quotes.
function isProse(s) {
  if (/[a-z-]+\s*:\s*[^;]+;/.test(s)) return false; // a CSS declaration, not a sentence
  if (/#[0-9a-f]{3,8}\b/i.test(s)) return false;
  const words = s.match(/[A-Za-z]{2,}/g) ?? [];
  if (words.length < 6) return false;
  const digits = (s.match(/[0-9]/g) ?? []).length;
  return digits / s.length < 0.15;
}

// A file whose prose a reader meets: the specs, and the apps' own text.
function isScanned(f) {
  if (f.includes('node_modules') || f.includes('.chrome-profile')) return false;
  if (/(^|\/)knowledge\/.*\.md$/.test(f)) return true;
  if (/^Primer\/content\/.*\.md$/.test(f)) return true;
  return /(^|\/)(index\.html|src\/[^/]+\.js)$/.test(f);
}

// Markdown: drop fenced blocks, inline code, link targets, and HTML anchors.
function proseFromMarkdown(text) {
  let fenced = false;
  return text.split('\n').map(line => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return ''; }
    if (fenced) return '';
    return line
      .replace(/`[^`]*`/g, ' ')
      .replace(/\]\([^)]*\)/g, '] ')
      .replace(/<[^>]*>/g, ' ');
  });
}

// .js/.html: only string literals. Everything else is code, and code is not prose.
const STRING_LITERAL = new RegExp(
  "'((?:[^'\\\\\\n]|\\\\.)*)'" + '|' +
  '"((?:[^"\\\\\\n]|\\\\.)*)"' + '|' +
  '`((?:[^`\\\\]|\\\\.)*)`', 'g');

function proseFromSource(text) {
  return text.split('\n').map(line => {
    const out = [];
    STRING_LITERAL.lastIndex = 0;
    let m;
    while ((m = STRING_LITERAL.exec(line))) {
      const s = m[1] ?? m[2] ?? m[3] ?? '';
      if (isProse(s)) out.push(s);
    }
    return out.join(' ');
  });
}

function proseLines(file, text) {
  return file.endsWith('.md') ? proseFromMarkdown(text) : proseFromSource(text);
}

function findings(file, text, onlyLines) {
  const prose = proseLines(file, text);
  const hits = [];
  prose.forEach((line, i) => {
    if (!line.trim()) return;
    if (onlyLines && !onlyLines.has(i + 1)) return;
    for (const rule of RULES) {
      if (!rule.re.test(line)) continue;
      if (rule.ignore && rule.ignore.test(line)) continue;
      hits.push({ file, line: i + 1, rule, text: line.trim().slice(0, 100) });
    }
  });
  return hits;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name.startsWith('.chrome')) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else {
      const rel = relative(ROOT, full).split('\\').join('/');
      if (isScanned(rel)) out.push(rel);
    }
  }
  return out;
}

// Line numbers a staged diff adds or changes, per file.
function stagedAddedLines() {
  const diff = execSync('git diff --cached --unified=0 --diff-filter=ACM', {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const byFile = new Map();
  let file = null;
  for (const line of diff.split('\n')) {
    const f = /^\+\+\+ b\/(.*)$/.exec(line);
    if (f) { file = f[1]; if (isScanned(file)) byFile.set(file, new Set()); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file && byFile.has(file)) {
      const start = +h[1], count = h[2] === undefined ? 1 : +h[2];
      for (let n = start; n < start + count; n++) byFile.get(file).add(n);
    }
  }
  return byFile;
}

const audit = process.argv.includes('--audit');
const hits = [];

if (audit) {
  for (const file of walk(ROOT)) {
    try { hits.push(...findings(file, readFileSync(join(ROOT, file), 'utf8'), null)); } catch {}
  }
} else {
  for (const [file, lines] of stagedAddedLines()) {
    if (!lines.size) continue;
    try { hits.push(...findings(file, readFileSync(join(ROOT, file), 'utf8'), lines)); } catch {}
  }
}

if (!hits.length) {
  if (audit) console.log('vocabulary audit: nothing found.');
  process.exit(0);
}

if (audit) {
  const byRule = new Map();
  for (const h of hits) byRule.set(h.rule.id, [...(byRule.get(h.rule.id) ?? []), h]);
  for (const [id, list] of byRule) {
    console.log('\n' + id + ' (' + list.length + ') - ' + list[0].rule.why);
    console.log('  use instead: ' + list[0].rule.use);
    for (const h of list) console.log('  ' + h.file + ':' + h.line + '  ' + h.text);
  }
  process.exit(0);
}

for (const h of hits) {
  console.error('vocabulary check: ' + h.file + ':' + h.line + ' uses "' + h.rule.id + '", which ' + h.rule.why);
  console.error('  line: ' + h.text);
  console.error('  use instead: ' + h.rule.use);
}
console.error('\nCommit blocked. Help text and specs use the terms knowledge/DATA_DICTIONARY.md');
console.error('defines; if no defined term fits, ask before inventing one, and add the term to the');
console.error('Data Dictionary rather than working around it. Audit the whole repo with:');
console.error('  node scripts/check-vocabulary.js --audit');
process.exit(1);
