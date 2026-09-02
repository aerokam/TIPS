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
  // x — gridlines at every maturity month (15th of Jan / Apr / Jul / Oct) so the
  // reader can read a point's maturity month straight off the axis: month
  // abbreviation on every tick, the year on a second row under each January
  for (let y = 2027; y <= 2037; y++) {
    for (const mo of [0, 3, 6, 9]) {
      const t = localDate(`${y}-${String(mo + 1).padStart(2, '0')}-15`).getTime();
      if (t < x0 || t > x1) continue;
      const xx = tx(t), major = mo === 0;
      s += `<line x1="${xx.toFixed(1)}" y1="${T}" x2="${xx.toFixed(1)}" y2="${H - B}" stroke="${GRID}" stroke-width="1" opacity="${major ? .45 : .16}"/>`;
      s += `<text x="${xx.toFixed(1)}" y="${H - B + 14}" text-anchor="middle" style="fill:${MUTED};font-size:9px">${MONTHS[mo]}</text>`;
      if (major) s += `<text x="${xx.toFixed(1)}" y="${H - B + 27}" text-anchor="middle" style="fill:${MUTED};font-size:11px;font-weight:600">${y}</text>`;
    }
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

// ── Slide 2: Why the Month Matters ─────────────────────────────────────────
// Slide 2 connects the slide-1 saw-tooth to its cause. The daily Ref CPI used
// for TIPS inflation adjustments is interpolated from monthly CPI-U NSA (FRED
// CPIAUCNS) and has a seasonal pattern that repeats each year. No official
// seasonally adjusted Ref CPI is published; we compute one by applying the same
// interpolation to BLS's SA CPI-U (CPIAUCSL). Ref CPI NSA / Ref CPI SA is the
// SA Factor (DATA_DICTIONARY.md#sa-factor), plotted here for one year. It
// differs between settlement and each maturity month/day, and that difference
// is why the quoted yield and the SA yield are not equal. SA calcs key on mm/dd.
export function drawS2(el) {
  const W = 900, H = 520, L = 66, R = 116, T = 96, B = 80;
  const lo = 0.9905, hi = 1.007;   // headroom above the peak / below the trough for labels
  const x = d => L + (d / 364) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  let s = '';

  // month gridlines
  for (let m = 0; m < 12; m++) {
    const xx = x(cum[m]);
    s += `<line x1="${xx.toFixed(1)}" y1="${T}" x2="${xx.toFixed(1)}" y2="${H - B}" stroke="${GRID}" stroke-width="1" opacity=".3"/>`;
    s += `<text x="${(xx + 3).toFixed(1)}" y="${H - B + 16}" style="fill:${MUTED};font-size:11px">${MONTHS[m]}</text>`;
  }
  // y ticks
  for (let v = Math.ceil(lo * 200) / 200; v <= hi + 1e-9; v += 0.005) {
    const yy = y(v);
    s += `<text x="${L - 8}" y="${(yy + 3).toFixed(1)}" text-anchor="end" style="fill:${MUTED};font-size:10px">${v.toFixed(3)}</text>`;
  }
  const midY = (T + (H - B)) / 2;
  s += `<text x="16" y="${midY}" text-anchor="middle" transform="rotate(-90 16 ${midY})" style="fill:${MUTED};font-size:11px">SA Factor  (Ref CPI NSA ÷ Ref CPI SA)</text>`;

  // reference at factor = 1
  const y1 = y(1);
  s += `<line x1="${L}" y1="${y1.toFixed(1)}" x2="${W - R}" y2="${y1.toFixed(1)}" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="3 3" opacity=".7"/>`;
  s += `<text x="${W - R + 6}" y="${(y1 + 3).toFixed(1)}" style="fill:${MUTED};font-size:10px">1.000 — NSA = SA</text>`;

  // the wave
  let path = '', area = `M${x(0).toFixed(1)} ${y1.toFixed(1)} `;
  for (let d = 0; d < 365; d++) {
    path += (d ? 'L' : 'M') + x(d).toFixed(1) + ' ' + y(Sat(d)).toFixed(1) + ' ';
    area += 'L' + x(d).toFixed(1) + ' ' + y(Sat(d)).toFixed(1) + ' ';
  }
  area += `L${x(364).toFixed(1)} ${y1.toFixed(1)} Z`;
  s += `<path d="${area}" fill="${WAVE}" opacity=".09"/>`;
  s += `<path d="${path}" fill="none" stroke="${WAVE}" stroke-width="2.5"/>`;

  // settlement marker
  const xs = x(SETTLE_DOY), ys = y(Sat(SETTLE_DOY));
  s += `<line x1="${xs.toFixed(1)}" y1="${ys.toFixed(1)}" x2="${xs.toFixed(1)}" y2="${(H - B).toFixed(1)}" stroke="${SETTLE}" stroke-width="1.5" stroke-dasharray="4 3" opacity=".8"/>`;
  s += `<line x1="${L}" y1="${ys.toFixed(1)}" x2="${W - R}" y2="${ys.toFixed(1)}" stroke="${SETTLE}" stroke-width="1" stroke-dasharray="5 4" opacity=".4"/>`;
  s += `<circle cx="${xs.toFixed(1)}" cy="${ys.toFixed(1)}" r="6" fill="${SETTLE}"/>`;
  s += callout(xs, ys - 4, xs - 250, ys - 8, [`settlement  ${SETTLE_LABEL}`, `SA Factor ${Sat(SETTLE_DOY).toFixed(4)}`], SETTLE, 'start', -0.14, 11);

  // the four maturity month/days
  for (const mm of MATS) {
    const d = doy(mm.m, 15), xd = x(d), yd = y(Sat(d));
    const below = Sat(d) < Sat(SETTLE_DOY);
    const dx = mm.m === 0 ? 9 : 0;
    const anchor = mm.m === 0 ? 'start' : 'middle';
    s += `<line x1="${xd.toFixed(1)}" y1="${yd.toFixed(1)}" x2="${xd.toFixed(1)}" y2="${(H - B).toFixed(1)}" stroke="${AMBER}" stroke-width="1" stroke-dasharray="2 3" opacity=".45"/>`;
    s += `<circle cx="${xd.toFixed(1)}" cy="${yd.toFixed(1)}" r="5" fill="none" stroke="${AMBER}" stroke-width="2"/>`;
    s += note(xd + dx, yd + (below ? 19 : -11), `${MONTHS[mm.m]} 15   ${Sat(d).toFixed(4)}`, AMBER, anchor, 11);
  }
  // the SA-Factor difference between settlement and the Apr maturity date,
  // labelled on-chart as the extreme case
  const apr = doy(3, 15);
  s += note(x(apr) + 6, (ys + y(Sat(apr))) / 2, ['The SA Factor differs between settlement', 'and this maturity month/day. That is why', 'the quoted yield and the SA yield are', 'not equal.'], INK, 'start', 10.5);

  // captions — provenance in grey, the SA Factor definition in white.
  // First use of NSA / SA / SA Factor; each line kept inside the viewBox width.
  s += note(W / 2, 22, [
    'The daily Ref CPI used for TIPS inflation adjustments is interpolated from monthly CPI-U Not Seasonally Adjusted (NSA; FRED CPIAUCNS).',
    'It has a seasonal pattern that repeats each year, and no official seasonally adjusted Ref CPI is published.',
    'We derive one with the same interpolation from BLS’s Seasonally Adjusted (SA) CPI-U (CPIAUCSL).',
  ], MUTED, 'middle', 11.5);
  s += note(W / 2, 72, ['Ref CPI NSA ÷ Ref CPI SA is the SA Factor shown here: above 1 in late summer, below 1 in late winter.'], INK, 'middle', 11.5);

  s += note(W / 2, H - 14, ['Settlement is near the SA Factor peak. Jul and Oct maturity dates are close to it; Jan and Apr are well below.'], AMBER, 'middle', 13);

  el.innerHTML = s;
}

// ── Slide 3: Near and Far ──────────────────────────────────────────────────
// The SA price factor = SA Factor(settlement) / SA Factor(maturity mm/dd), the
// multiplier the fix applies to the quoted price. Walk two real TIPS: one
// maturing Oct (mm/dd factor closest to the Sep settlement -> factor barely
// above 1, tiny yield move) and one maturing Apr (farthest -> factor ~1.007,
// large yield move). Same formula both times; distance from the settlement
// factor sets the size.
export function drawS3(el) {
  const W = 900, H = 520;
  const settleSAF = Sat(SETTLE_DOY);

  // pick the two bonds: Oct 2028 (near) and Apr 2028 (far), lowest coupon at each
  const pick = (mo) => SNAP.bonds
    .filter(b => b.matMonth === mo && b.matDate.getFullYear() === 2028)
    .sort((a, b) => a.coupon - b.coupon)[0];
  const near = pick(9), far = pick(3);
  const row = (b) => {
    const mSAF = Sat(doy(b.matMonth, 15));
    return { b, mSAF, pf: settleSAF / mSAF, dbp: (b.sa - b.ask) * 10000 };
  };
  const N = row(near), F = row(far);

  let s = '';

  // formula strip
  s += note(W / 2, 26, ['SA price factor  =  SA Factor (settlement date)  ÷  SA Factor (maturity month & day)'], INK, 'middle', 14);
  s += note(W / 2, 44, ['— the multiplier the seasonal adjustment applies to the quoted price.'], MUTED, 'middle', 11);

  // ---- left: one-year SA Factor wave, compact ----
  const L = 52, WR = 452, T = 84, B = H - 96;
  const lo = 0.9905, hi = 1.007;
  const x = d => L + (d / 364) * (WR - L);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (B - T);

  for (let m = 0; m < 12; m++) {
    const xx = x(cum[m]);
    s += `<line x1="${xx.toFixed(1)}" y1="${T}" x2="${xx.toFixed(1)}" y2="${B}" stroke="${GRID}" stroke-width="1" opacity=".25"/>`;
    s += `<text x="${(xx + 2).toFixed(1)}" y="${B + 14}" style="fill:${MUTED};font-size:9px">${MONTHS[m][0]}</text>`;
  }
  const y1 = y(1);
  s += `<line x1="${L}" y1="${y1.toFixed(1)}" x2="${WR}" y2="${y1.toFixed(1)}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3" opacity=".5"/>`;
  s += note(L - 4, y1 + 3, '1.000', MUTED, 'end', 9);
  let path = '';
  for (let d = 0; d < 365; d++) path += (d ? 'L' : 'M') + x(d).toFixed(1) + ' ' + y(Sat(d)).toFixed(1) + ' ';
  s += `<path d="${path}" fill="none" stroke="${WAVE}" stroke-width="2"/>`;

  // settlement level line + the two maturity month/days, each with a dashed
  // connector up to the settlement level (short for Oct, long for Apr)
  s += `<line x1="${L}" y1="${y(settleSAF).toFixed(1)}" x2="${WR}" y2="${y(settleSAF).toFixed(1)}" stroke="${SETTLE}" stroke-width="1" stroke-dasharray="5 3" opacity=".5"/>`;
  const mark = (d, saf, col, lbl, lblDx, lblDy, anchor) => {
    const xd = x(d), yd = y(saf);
    s += `<line x1="${xd.toFixed(1)}" y1="${yd.toFixed(1)}" x2="${xd.toFixed(1)}" y2="${y(settleSAF).toFixed(1)}" stroke="${col}" stroke-width="1.4" stroke-dasharray="3 2" opacity=".8"/>`;
    s += `<circle cx="${xd.toFixed(1)}" cy="${yd.toFixed(1)}" r="5" fill="${col}"/>`;
    s += note(xd + lblDx, yd + lblDy, lbl, col, anchor, 10);
  };
  mark(SETTLE_DOY, settleSAF, SETTLE, `settlement  ${settleSAF.toFixed(4)}`, -10, -10, 'end');
  mark(doy(9, 15), N.mSAF, '#22c55e', `Oct 15  ${N.mSAF.toFixed(4)}`, 12, 4, 'start');
  mark(doy(3, 15), F.mSAF, '#f97316', `Apr 15  ${F.mSAF.toFixed(4)}`, 0, 18, 'middle');
  s += note((L + WR) / 2, T - 10, 'SA Factor, one year', MUTED, 'middle', 10);

  // ---- right: two cards ----
  const cx0 = 486, cw = W - cx0 - 26;
  const card = (top, r, tone, tag) => {
    const h = 150;
    s += `<rect x="${cx0}" y="${top}" width="${cw}" height="${h}" rx="10" fill="#0b1220" stroke="${tone}" stroke-width="1.4"/>`;
    s += note(cx0 + 16, top + 24, `${tag}  ·  matures ${MONTHS[r.b.matMonth]} 2028`, tone, 'start', 12);
    s += note(cx0 + 16, top + 46, `${(r.b.coupon * 100).toFixed(3)}% coupon`, MUTED, 'start', 10);
    s += note(cx0 + 16, top + 72, `SA Factor at maturity month/day:  ${r.mSAF.toFixed(4)}`, INK, 'start', 11);
    s += note(cx0 + 16, top + 90, `SA price factor  =  ${settleSAF.toFixed(4)} ÷ ${r.mSAF.toFixed(4)}  =`, INK, 'start', 11);
    s += note(cx0 + cw - 16, top + 92, `${r.pf.toFixed(4)}`, tone, 'end', 17);
    s += `<line x1="${cx0 + 14}" y1="${top + 104}" x2="${cx0 + cw - 14}" y2="${top + 104}" stroke="${GRID}"/>`;
    s += note(cx0 + 16, top + 126, `quoted ${(r.b.ask * 100).toFixed(2)}%   →   SA ${(r.b.sa * 100).toFixed(2)}%`, INK, 'start', 12);
    s += note(cx0 + cw - 16, top + 126, `${r.dbp >= 0 ? '+' : ''}${r.dbp.toFixed(0)} bp`, tone, 'end', 14);
  };
  card(84, N, '#22c55e', 'NEAR');
  card(252, F, '#f97316', 'FAR');

  // takeaway
  s += note(W / 2, H - 30, ['Same formula both times. The farther the maturity SA Factor is from the settlement SA Factor, the farther the SA price factor is from 1 —'], INK, 'middle', 12.5);
  s += note(W / 2, H - 13, ['and the larger the move from the quoted yield to the SA yield.'], AMBER, 'middle', 12.5);

  el.innerHTML = s;
}
