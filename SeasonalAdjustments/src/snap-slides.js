// snap-slides.js — The reworked deck. Each drawSn(el) renders one full-page
// annotated SVG from the frozen snapshot (snap-data.js). Annotations are drawn
// ON the chart — no external legends.
// Spec: knowledge/1.0_SeasonalAdjustments_Explorer.md

import {
  SNAP, SNAPSHOT_LABEL, SETTLE_LABEL, MONTHS, DIM, cum, MATS,
  localDate, doy, dateLabel, Sat, waveMin, waveMax,
} from './snap-data.js';
import { note, callout, vBracket, ring, AMBER, CYAN, INK } from './sa-annotate.js';

const GRID = '#334155', MUTED = '#94a3b8';
const QUOTED = '#f97316';   // same orange the YieldCurves app uses for the quoted (Ask, Market) curve
const WAVE = '#7dd3fc';
const SETTLE = '#38bdf8';

const fmtMY = s => { const d = localDate(s); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const SETTLE_DOY = doy(8, 1); // Sep 1

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
  s += `<text x="15" y="${midY}" text-anchor="middle" transform="rotate(-90 15 ${midY})" style="fill:${MUTED};font-size:12px">quoted ask yield (%)</text>`;

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

  // measure the saw-tooth early vs. later, between two real adjacent TIPS three
  // months apart (Apr → Jul of the same year: Apr misses the spring surge, Jul
  // captures it), to show the difference shrinking as maturity lengthens.
  const lowestCoupon = list => list.reduce((a, b) => (b.coupon < a.coupon ? b : a));
  const aprJul = yr => {
    const apr = bonds.filter(b => b.matMonth === 3 && b.matDate.getFullYear() === yr);
    const jul = bonds.filter(b => b.matMonth === 6 && b.matDate.getFullYear() === yr);
    if (!apr.length || !jul.length) return null;
    const a = lowestCoupon(apr), j = lowestCoupon(jul);
    return { a, j, bp: Math.round((a.ask - j.ask) * 10000) };
  };
  for (const yr of [2028, 2032]) {
    const m = aprJul(yr);
    if (!m) continue;
    const xa = tx(m.a.matDate.getTime()), xj = tx(m.j.matDate.getTime());
    const ya = ty(m.a.ask * 100), yj = ty(m.j.ask * 100);
    const bx = (xa + xj) / 2;
    s += `<circle cx="${xa.toFixed(1)}" cy="${ya.toFixed(1)}" r="5.5" fill="none" stroke="${INK}" stroke-width="1.5"/>`;
    s += `<circle cx="${xj.toFixed(1)}" cy="${yj.toFixed(1)}" r="5.5" fill="none" stroke="${INK}" stroke-width="1.5"/>`;
    s += vBracket(bx, ya, yj, INK, 4);
    s += note(bx + 9, Math.min(ya, yj) - 6, `${m.bp} bp`, INK, 'start', 12);
  }

  // caption (title comes from the page h2)
  s += note(W / 2, 40, [`Quoted ask yields as of ${SNAPSHOT_LABEL} (settlement = ${SETTLE_LABEL}).`], MUTED, 'middle', 12);
  s += note(W / 2, H - 14, ['Every Jul / Oct maturity is lower than its Jan / Apr neighbours, and the differences shrink as maturity increases.'], AMBER, 'middle', 13);

  el.innerHTML = s;
}

// ── Slide 2: The Seasonal Factor ───────────────────────────────────────────
// One year of the seasonal factor S = CPI(NSA) ÷ its de-seasonalized trend.
// The index runs above trend in late summer, below in late winter, on a fixed
// yearly cycle. The Sep 1 settlement date sits near the top; the four dates
// every TIPS matures on (the 15th of Jan / Apr / Jul / Oct) sit at four fixed
// heights — Jul and Oct near the settlement level, Jan and Apr well below.
export function drawS2(el) {
  const W = 900, H = 520, L = 60, R = 96, T = 74, B = 62;
  const lo = Math.floor((waveMin() - 0.0012) * 1000) / 1000;
  const hi = Math.ceil((waveMax() + 0.0012) * 1000) / 1000;
  const x = d => L + (d / 364) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  let s = '';

  // month gridlines
  for (let m = 0; m < 12; m++) {
    const xx = x(cum[m]);
    s += `<line x1="${xx.toFixed(1)}" y1="${T}" x2="${xx.toFixed(1)}" y2="${H - B}" stroke="${GRID}" stroke-width="1" opacity=".35"/>`;
    s += `<text x="${(xx + 3).toFixed(1)}" y="${H - B + 16}" style="fill:${MUTED};font-size:11px">${MONTHS[m]}</text>`;
  }
  // y ticks (S value)
  for (let v = Math.ceil(lo * 200) / 200; v <= hi + 1e-9; v += 0.005) {
    const yy = y(v);
    s += `<text x="${L - 8}" y="${(yy + 3).toFixed(1)}" text-anchor="end" style="fill:${MUTED};font-size:10px">${v.toFixed(3)}</text>`;
  }
  // trend reference at S = 1
  const y1 = y(1);
  s += `<line x1="${L}" y1="${y1.toFixed(1)}" x2="${W - R}" y2="${y1.toFixed(1)}" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="3 3" opacity=".7"/>`;
  s += `<text x="${W - R + 6}" y="${(y1 + 3).toFixed(1)}" style="fill:${MUTED};font-size:10px">1.000 — trend</text>`;

  // the wave, with a faint fill to the trend line
  let path = '', area = `M${x(0).toFixed(1)} ${y1.toFixed(1)} `;
  for (let d = 0; d < 365; d++) {
    path += (d ? 'L' : 'M') + x(d).toFixed(1) + ' ' + y(Sat(d)).toFixed(1) + ' ';
    area += 'L' + x(d).toFixed(1) + ' ' + y(Sat(d)).toFixed(1) + ' ';
  }
  area += `L${x(364).toFixed(1)} ${y1.toFixed(1)} Z`;
  s += `<path d="${area}" fill="${WAVE}" opacity=".09"/>`;
  s += `<path d="${path}" fill="none" stroke="${WAVE}" stroke-width="2.5"/>`;

  // trough
  let tr = 0;
  for (let d = 0; d < 365; d++) if (Sat(d) < Sat(tr)) tr = d;
  s += `<circle cx="${x(tr).toFixed(1)}" cy="${y(Sat(tr)).toFixed(1)}" r="3.5" fill="${WAVE}"/>`;
  s += note(x(tr), y(Sat(tr)) + 18, 'late-winter low', WAVE, 'middle', 11);

  // settlement marker — which this year lands right at the seasonal high
  const xs = x(SETTLE_DOY), ys = y(Sat(SETTLE_DOY));
  s += `<line x1="${xs.toFixed(1)}" y1="${T}" x2="${xs.toFixed(1)}" y2="${(H - B).toFixed(1)}" stroke="${SETTLE}" stroke-width="1.5" stroke-dasharray="4 3" opacity=".8"/>`;
  s += `<circle cx="${xs.toFixed(1)}" cy="${ys.toFixed(1)}" r="6" fill="${SETTLE}"/>`;
  s += callout(xs, ys - 6, xs - 236, T + 4, [`You buy on ${SETTLE_LABEL} — which this`, `year sits right at the seasonal high,`, `S = ${Sat(SETTLE_DOY).toFixed(4)}`], SETTLE, 'start', -0.16, 12);

  // the four maturity days
  for (const mm of MATS) {
    const d = doy(mm.m, 15), xd = x(d), yd = y(Sat(d));
    const high = Sat(d) >= Sat(SETTLE_DOY) - 0.0015;
    s += `<line x1="${xd.toFixed(1)}" y1="${yd.toFixed(1)}" x2="${xd.toFixed(1)}" y2="${(H - B).toFixed(1)}" stroke="${AMBER}" stroke-width="1" stroke-dasharray="2 3" opacity=".5"/>`;
    s += `<circle cx="${xd.toFixed(1)}" cy="${yd.toFixed(1)}" r="5" fill="none" stroke="${AMBER}" stroke-width="2"/>`;
    s += note(xd + (mm.m === 0 ? 6 : 0), yd + (high ? -12 : 20), `${mm.label.slice(0, 3)}  ${Sat(d).toFixed(4)}`, AMBER, mm.m === 0 ? 'start' : 'middle', 11);
  }

  // captions
  s += note(W / 2, 34, ['The CPI index TIPS track runs above and below its de-seasonalized level on a fixed yearly cycle.  S is the ratio.'], MUTED, 'middle', 12);
  s += note(W / 2, H - 14, ['You buy near the top.  Jul and Oct maturities redeem near that level; Jan and Apr maturities redeem well below.'], AMBER, 'middle', 13);

  el.innerHTML = s;
}
