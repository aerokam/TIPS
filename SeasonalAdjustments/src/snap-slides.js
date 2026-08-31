// snap-slides.js — The reworked deck. Each drawSn(el) renders one full-page
// annotated SVG from the frozen snapshot (snap-data.js). Annotations are drawn
// ON the chart — no external legends.
// Spec: knowledge/1.0_SeasonalAdjustments_Explorer.md

import { SNAP, SNAPSHOT_DATE, SETTLE_DATE, MONTHS, localDate } from './snap-data.js';
import { note, vBracket, AMBER, INK } from './sa-annotate.js';

const GRID = '#334155', MUTED = '#94a3b8';
const QUOTED = '#f97316';   // same orange the YieldCurves app uses for the quoted (Ask, Market) curve

const fmtMY = s => { const d = localDate(s); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

// ── Slide 1: The Sawtooth ──────────────────────────────────────────────────
// The quoted TIPS real-yield curve exactly as the YieldCurves app draws it
// today: one point per bond, market prices, plotted against maturity date.
// Start at Jul 2027 — real yields inside ~1 year are dominated by other
// effects and only muddy the picture. The curve visibly zig-zags: every
// Jul/Oct maturity prints below its Jan/Apr neighbours, a ~30 bp saw-tooth at
// the front that shrinks steadily out to 2036. Nothing about the month a bond
// matures in should move its yield — that is the puzzle the guide answers.
export function drawS1(el) {
  const W = 900, H = 520, L = 60, R = 24, T = 62, B = 74;
  const x0 = localDate('2027-07-15').getTime();
  const x1 = localDate('2037-01-01').getTime();
  const bonds = SNAP.bonds.filter(b => b.matDate.getTime() >= x0 && b.matDate.getTime() <= x1);

  const tx = ms => L + (ms - x0) / (x1 - x0) * (W - L - R);
  const pct = bonds.map(b => b.ask * 100);
  const lo = Math.floor((Math.min(...pct) - 0.05) * 10) / 10;
  const hi = Math.ceil((Math.max(...pct) + 0.05) * 10) / 10;
  const ty = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  let s = '';

  // y grid — 0.1 pp steps
  for (let v = lo; v <= hi + 1e-9; v = Math.round((v + 0.1) * 10) / 10) {
    const yy = ty(v);
    s += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${W - R}" y2="${yy.toFixed(1)}" stroke="${GRID}" stroke-width="1" opacity="${Math.abs(v * 10 % 5) < 1e-6 ? .55 : .3}"/>`;
    s += `<text x="${L - 8}" y="${(yy + 3).toFixed(1)}" text-anchor="end" style="fill:${MUTED};font-size:10px">${v.toFixed(1)}%</text>`;
  }
  // x — year gridlines
  for (let y = 2028; localDate(`${y}-01-01`).getTime() <= x1; y++) {
    const xx = tx(localDate(`${y}-01-01`).getTime());
    s += `<line x1="${xx.toFixed(1)}" y1="${T}" x2="${xx.toFixed(1)}" y2="${H - B}" stroke="${GRID}" stroke-width="1" opacity=".4"/>`;
    s += `<text x="${xx.toFixed(1)}" y="${H - B + 18}" text-anchor="middle" style="fill:${MUTED};font-size:11px">${y}</text>`;
  }
  const midY = (T + (H - B)) / 2;
  s += `<text x="15" y="${midY}" text-anchor="middle" transform="rotate(-90 15 ${midY})" style="fill:${MUTED};font-size:12px">quoted real yield (%)</text>`;

  // the quoted curve — one point per bond, connected in maturity order
  let p = '';
  bonds.forEach((b, i) => { p += (i ? 'L' : 'M') + tx(b.matDate.getTime()).toFixed(1) + ' ' + ty(b.ask * 100).toFixed(1) + ' '; });
  s += `<path d="${p}" fill="none" stroke="${QUOTED}" stroke-width="1.8"/>`;
  for (const b of bonds) {
    const cx = tx(b.matDate.getTime()), cy = ty(b.ask * 100);
    s += `<g><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="${QUOTED}"/>` +
         `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="transparent"/>` +
         `<title>${fmtMY(b.mat)} · ${(b.coupon * 100).toFixed(3)}% — quoted ${(b.ask * 100).toFixed(2)}%</title></g>`;
  }

  // measure the saw-tooth early vs. later: the same-year Jan→Jul drop (Jan
  // misses the spring surge, Jul captures it) in an early year and a later one,
  // to show the amplitude shrinking as maturity lengthens
  const janJul = yr => {
    const jans = bonds.filter(b => b.matMonth === 0 && b.matDate.getFullYear() === yr);
    const jul = bonds.find(b => b.matMonth === 6 && b.matDate.getFullYear() === yr);
    if (!jans.length || !jul) return null;
    const janAsk = jans.reduce((a, b) => a + b.ask, 0) / jans.length;
    return { jan: jans[0], janAsk, jul, bp: Math.round((janAsk - jul.ask) * 10000) };
  };
  for (const [yr, side] of [[2028, 1], [2031, 1]]) {
    const m = janJul(yr);
    if (!m) continue;
    const xj = tx(m.jul.matDate.getTime());
    const ya = ty(m.janAsk * 100), yj = ty(m.jul.ask * 100);
    const bx = xj + 18 * side;
    s += vBracket(bx, ya, yj, INK, 4);
    s += note(bx + 8 * side, Math.min(ya, yj) - 6, `${m.bp} bp`, INK, 'start', 12);
  }

  // caption (title comes from the page h2)
  s += note(W / 2, 40, [`The quoted curve as it stands today — market prices, one point per bond.  Snapshot ${fmtMY(SNAPSHOT_DATE)}, settlement ${SETTLE_DATE}.`], MUTED, 'middle', 11);
  s += note(W / 2, H - 14, ['Every Jul / Oct maturity prints below its Jan / Apr neighbours — and the gap shrinks as maturity lengthens.'], AMBER, 'middle', 13);

  el.innerHTML = s;
}
