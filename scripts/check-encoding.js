#!/usr/bin/env node
// Blocks commits that introduce mojibake (double-encoded UTF-8) or a stray
// UTF-8 BOM. Both are the signature of a file having been read with Windows
// PowerShell's Get-Content (which falls back to the Windows-1252 codepage)
// and written back with Set-Content/Out-File -Encoding UTF8. See CLAUDE.md
// "Windows / Tooling Note".
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

// Windows-1252 byte -> codepoint, for the 0x80-0x9F block where cp1252
// diverges from plain Latin-1 (0xA0-0xFF maps straight to U+00A0-U+00FF).
const CP1252_HIGH = {
  0x80: 0x20ac, 0x81: 0x0081, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e,
  0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030,
  0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8d: 0x008d, 0x8e: 0x017d,
  0x8f: 0x008f, 0x90: 0x0090, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9d: 0x009d,
  0x9e: 0x017e, 0x9f: 0x0178,
};

// Reverse map: codepoint -> cp1252 byte, for every byte 0x00-0xFF.
const CODEPOINT_TO_BYTE = new Map();
for (let byte = 0; byte <= 0xff; byte++) {
  const cp = byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte] : byte;
  CODEPOINT_TO_BYTE.set(cp, byte);
}

function isAscii(line) {
  for (let i = 0; i < line.length; i++) {
    if (line.charCodeAt(i) > 127) return false;
  }
  return true;
}

// Reinterpret `line` as if each character were really a cp1252 byte, then
// see if those bytes form valid, different UTF-8. That round-trip only
// succeeds when the line actually is UTF-8-decoded-as-cp1252-then-re-encoded
// mojibake -- ordinary text (ASCII or genuine Unicode) either round-trips
// to itself or fails to decode as UTF-8 at all.
function findMojibake(line) {
  if (isAscii(line)) return null; // pure ASCII can't be this bug
  const bytes = [];
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    const byte = CODEPOINT_TO_BYTE.get(cp);
    if (byte === undefined) return null; // not representable in cp1252 at all
    bytes.push(byte);
  }
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
  return decoded !== line ? decoded : null;
}

const TEXT_EXT = /\.(html|js|css|md|json|txt|svg|xml)$/i;

const staged = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
  .split('\n')
  .filter(f => f && TEXT_EXT.test(f));

let failed = false;

for (const file of staged) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue; // deleted/renamed away
  }

  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  if (hasBom) {
    console.error(`encoding check: ${file} has a UTF-8 BOM (unexpected for this project)`);
    failed = true;
  }

  const text = buf.toString('utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const fixed = findMojibake(line);
    if (fixed) {
      console.error(`encoding check: ${file}:${i + 1} looks like double-encoded UTF-8 (mojibake)`);
      console.error(`  found: ${line.trim().slice(0, 80)}`);
      console.error(`  meant: ${fixed.trim().slice(0, 80)}`);
      failed = true;
    }
  });
}

if (failed) {
  console.error('\nCommit blocked. Fix the encoding (re-save as plain UTF-8, no BOM) before committing.');
  process.exit(1);
}
