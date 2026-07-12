// sa-pages-gap.js — Pages 6–12: the seasonal gap, the one-line price fix,
// and why the yield effect shrinks with maturity. Annotations drawn on-chart.
// Spec: knowledge/1.0_SeasonalAdjustments_Explorer.md §Pages

import {
  D, MONTHS, cum, MATS, Sat, Smin, Smax, doy, dateLabel, state,
  cashFlowSchedule, modifiedDuration, yieldForYears, ILLUS_COUPON,
} from './sa-data.js';
import { note, arrow, callout, ring, vBracket, pill, AMBER, CYAN, GREEN, RED, INK } from './sa-annotate.js';

const GRID = '#334155', MUTED = '#94a3b8', WAVE = '#7dd3fc';

const gapPct = () => (Sat(doy(state.matIdx, 15)) / Sat(state.settleDoy) - 1) * 100; // seasonal index growth settle→maturity
const ratio = () => Sat(state.settleDoy) / Sat(doy(state.matIdx, 15));               // Canty price multiplier

// ── Page 6: You buy on one day of the wave ──────────────────────────────────
export function drawP6(el) {
  const W = 900, H = 440, L = 56, R = 130, T = 42, B = 40;
  const lo = Smin() - 0.0006, hi = Smax() + 0.0012;
  const x = i => L + (i / 364) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let s = '';
  for (let m = 0; m < 12; m++) {
    const xx = x(cum[m]);
    s += `<line x1="${xx}" y1="${T}" x2="${xx}" y2="${H - B}" stroke="${GRID}" stroke-width="1" opacity=".4"/>`;
    s += `<text x="${xx + 3}" y="${H - 22}" style="fill:${MUTED};font-size:12px">${MONTHS[m]}</text>`;
  }
  let p = ''; for (let i = 0; i < 365; i++) p += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(D.daily[i]).toFixed(1) + ' ';
  s += `<path d="${p}" fill="none" stroke="${WAVE}" stroke-width="3"/>`;

  const sD = state.settleDoy, mD = doy(state.matIdx, 15);
  const ys = y(Sat(sD)), ym = y(Sat(mD));
  const xr = W - R + 34; // bracket lane at right

  // dashed levels out to the bracket
  s += `<line x1="${x(sD)}" y1="${ys}" x2="${xr}" y2="${ys}" stroke="${CYAN}" stroke-width="1.3" stroke-dasharray="5 4" opacity=".8"/>`;
  s += `<line x1="${x(mD)}" y1="${ym}" x2="${xr}" y2="${ym}" stroke="${AMBER}" stroke-width="1.3" stroke-dasharray="5 4" opacity=".8"/>`;

  s += `<circle cx="${x(sD)}" cy="${ys}" r="7" fill="${CYAN}"/>`;
  s += `<circle cx="${x(mD)}" cy="${ym}" r="7" fill="${AMBER}"/>`;
  s += callout(x(sD), ys - 10, Math.max(L + 8, Math.min(x(sD) - 60, W - 380)), T - 20, [`YOU BUY HERE — ${dateLabel(sD)}.`, 'S(settle) is locked the day you trade'], CYAN, 'start', -0.2);
  s += callout(x(mD), ym + 12, Math.min(x(mD) + 60, W - R - 130), H - 62, [`EVERY PAYMENT LANDS HERE — ${MATS.find(m => m.m === state.matIdx).label},`, 'this year, next year, every year: S(maturity)'], AMBER, 'start', 0.2);

  // the gap bracket
  const g = gapPct();
  if (Math.abs(ys - ym) > 2) {
    s += vBracket(xr, ys, ym, INK);
    s += note(xr + 8, (ys + ym) / 2 + 4, [`THE GAP`, `${g >= 0 ? '+' : ''}${g.toFixed(2)}%`], INK, 'start', 13);
  } else {
    s += note(xr + 8, (ys + ym) / 2 + 4, ['NO GAP', '0.00%'], GREEN, 'start', 13);
  }
  s += note(W / 2, H - 4, ['slide your purchase date — the gap between the two dots is the whole story of TIPS seasonality'], MUTED, 'middle', 12);
  el.innerHTML = s;
}

// ── Shared multi-year timeline (pages 7, 8, 12) ─────────────────────────────
// opts.annotate: 'story' (page 7) | 'preset' (page 8) | 'minimal' (page 12)
export function timelineSVG(opts = {}) {
  const W = 900, H = opts.h || 430, L = 56, R = 20, T = 40, B = 36;
  const sD = state.settleDoy;
  const flows = cashFlowSchedule(sD);
  const ef = flows[flows.length - 1].elapsed;
  const x = e => L + (e / ef) * (W - L - R);
  const Ssettle = Sat(sD);
  const sAt = e => Sat(sD + e);
  const lo = Math.min(Smin(), Ssettle) - 0.0006, hi = Math.max(Smax(), Ssettle) + 0.0012;
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let s = '';

  // calendar month ticks
  for (let e = 0; e <= ef; e++) {
    const m = cum.indexOf((sD + e) % 365);
    if (m < 0) continue;
    const xx = x(e);
    if (m === 0) {
      s += `<line x1="${xx.toFixed(1)}" y1="${T}" x2="${xx.toFixed(1)}" y2="${H - B}" stroke="${GRID}" opacity=".55"/>`;
      s += `<text x="${xx.toFixed(1)}" y="${H - B + 14}" text-anchor="middle" style="fill:${MUTED};font-size:11px">Jan</text>`;
    } else if (m === 6 && ef < 365 * 6) {
      s += `<line x1="${xx.toFixed(1)}" y1="${T}" x2="${xx.toFixed(1)}" y2="${H - B}" stroke="${GRID}" opacity=".25"/>`;
      s += `<text x="${xx.toFixed(1)}" y="${H - B + 14}" text-anchor="middle" style="fill:${MUTED};font-size:11px" opacity=".6">Jul</text>`;
    }
  }
  for (let k = 1; 365 * k <= ef; k++) {
    s += `<text x="${x(365 * k).toFixed(1)}" y="${T - 6}" text-anchor="middle" style="fill:${INK};font-size:11px" opacity=".65">+${k}y</text>`;
  }

  // S(settle) reference line + wave
  const ySettle = y(Ssettle);
  s += `<line x1="${L}" y1="${ySettle}" x2="${W - R}" y2="${ySettle}" stroke="${CYAN}" stroke-width="1.5" stroke-dasharray="6 4" opacity=".85"/>`;
  let p = ''; const step = Math.max(1, Math.round(ef / 600));
  for (let e = 0; e <= ef; e += step) p += (e ? 'L' : 'M') + x(e).toFixed(1) + ' ' + y(sAt(e)).toFixed(1) + ' ';
  s += `<path d="${p}" fill="none" stroke="${WAVE}" stroke-width="2"/>`;

  // gap bars, thickness ∝ PV
  const maxPv = Math.max(...flows.map(f => f.pv));
  for (const f of flows) {
    const xx = x(f.elapsed), Sv = sAt(f.elapsed), yv = y(Sv);
    const up = Sv > Ssettle;
    const col = up ? GREEN : RED;
    const w = 1.2 + 22 * (f.pv / maxPv);
    s += `<line x1="${xx.toFixed(1)}" y1="${ySettle.toFixed(1)}" x2="${xx.toFixed(1)}" y2="${yv.toFixed(1)}" stroke="${col}" stroke-width="${w.toFixed(1)}" opacity="${f.principal ? 0.95 : 0.55}" stroke-linecap="round"><title>${f.principal ? 'Final payment (last coupon + principal)' : 'Coupon'} — day +${Math.round(f.elapsed)}: S=${Sv.toFixed(5)}, PV $${f.pv.toFixed(2)}</title></line>`;
    if (f.principal) s += `<circle cx="${xx.toFixed(1)}" cy="${yv.toFixed(1)}" r="5" fill="${AMBER}"/>`;
  }
  s += `<circle cx="${L}" cy="${ySettle.toFixed(1)}" r="6" fill="${CYAN}"/>`;

  // ── annotations ──
  const fin = flows[flows.length - 1];
  const finX = x(fin.elapsed), finY = y(sAt(fin.elapsed));
  const g = gapPct();
  const noGap = Math.abs(g) < 0.02;

  if (opts.annotate === 'story') {
    s += note(L + 8, ySettle + (sAt(60) > Ssettle ? 18 : -10), 'your entry level — S(settle)', CYAN, 'start', 12);
    if (flows.length >= 2 && !noGap) {
      const f1 = flows[0], f2 = flows[1];
      s += callout(x(f1.elapsed), (ySettle + y(sAt(f1.elapsed))) / 2, x(f1.elapsed) + 40, T + 12, ['year 1: a gap'], INK, 'start', -0.25, 12);
      s += callout(x(f2.elapsed), (ySettle + y(sAt(f2.elapsed))) / 2, x(f2.elapsed) + 40, T + 32, ['year 2: the SAME gap — it repeats, it never cancels'], INK, 'start', -0.25, 12);
    }
    if (noGap) {
      s += note(W / 2, T + 16, ['settlement is on the payment month/day → no gap at all — slide the date to open one up'], GREEN, 'middle', 13);
    } else {
      s += callout(finX - 4, (ySettle + finY) / 2, Math.min(finX - 90, W - 330), H - 54, ['the FINAL gap bar is fat because it carries the PRINCIPAL —', 'bar thickness = share of the price. This is the gap that matters.'], AMBER, 'end', 0.25);
    }
  }

  if (opts.annotate === 'preset') {
    if (noGap) {
      s += ring(finX, (ySettle + finY) / 2, 26, 26, GREEN);
      s += note(W / 2, T + 14, ['bought on the anniversary: whole years to maturity → you enter and exit at the SAME point of the wave'], GREEN, 'middle', 13);
      s += note(W / 2, T + 32, ['seasonality cancels — NO adjustment needed'], GREEN, 'middle', 13);
    } else {
      s += ring(finX, (ySettle + finY) / 2, 26, Math.abs(finY - ySettle) / 2 + 16, RED);
      s += note(W / 2, T + 14, [`bought mid-wave: the final payment sits ${g >= 0 ? '+' : ''}${g.toFixed(2)}% ${g >= 0 ? 'above' : 'below'} your entry level —`], RED, 'middle', 13);
      s += note(W / 2, T + 32, ['a predictable, calendar-driven distortion baked into the quoted price'], RED, 'middle', 13);
    }
  }

  return s;
}

export function drawP7(el) { el.innerHTML = timelineSVG({ annotate: 'story' }); }
export function drawP8(el) { el.innerHTML = timelineSVG({ annotate: 'preset' }); }

// ── Page 9: The fix — one multiplication ────────────────────────────────────
export function drawP9(el) {
  const W = 900, H = 460;
  const sD = state.settleDoy, mD = doy(state.matIdx, 15);
  const Ss = Sat(sD), Sm = Sat(mD), r = Ss / Sm;
  const CP = 100, SACP = CP * r;
  let s = '';

  // mini wave inset (top)
  const mw = { L: 170, R: 170, T: 40, B: 250 };
  const lo = Smin() - 0.0006, hi = Smax() + 0.0012;
  const x = i => mw.L + (i / 364) * (W - mw.L - mw.R);
  const y = v => mw.T + (1 - (v - lo) / (hi - lo)) * (H - mw.T - mw.B);
  let p = ''; for (let i = 0; i < 365; i++) p += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(D.daily[i]).toFixed(1) + ' ';
  s += `<path d="${p}" fill="none" stroke="${WAVE}" stroke-width="2.5" opacity=".9"/>`;
  s += `<circle cx="${x(sD)}" cy="${y(Ss)}" r="6" fill="${CYAN}"/>`;
  s += `<circle cx="${x(mD)}" cy="${y(Sm)}" r="6" fill="${AMBER}"/>`;
  s += note(x(sD), y(Ss) - 12, 'S(settle)', CYAN, 'middle', 12);
  s += note(x(mD), y(Sm) + 22, 'S(maturity)', AMBER, 'middle', 12);

  // equation tiles (bottom)
  const ty0 = H - 170, th = 92;
  function tile(x0, w, title, big, color, sub) {
    let t = `<rect x="${x0}" y="${ty0}" width="${w}" height="${th}" rx="12" fill="#0b1220" stroke="${color}" stroke-width="1.5"/>`;
    t += `<text x="${x0 + w / 2}" y="${ty0 + 22}" text-anchor="middle" style="fill:${MUTED};font-size:11px;letter-spacing:.05em">${title}</text>`;
    t += `<text x="${x0 + w / 2}" y="${ty0 + 54}" text-anchor="middle" style="fill:${color};font-size:24px;font-weight:800">${big}</text>`;
    if (sub) t += `<text x="${x0 + w / 2}" y="${ty0 + 76}" text-anchor="middle" style="fill:${MUTED};font-size:11px">${sub}</text>`;
    return t;
  }
  const g = (r - 1) * 100;
  s += tile(70, 190, 'QUOTED PRICE', CP.toFixed(3), INK, 'what your broker shows');
  s += `<text x="${290}" y="${ty0 + 58}" text-anchor="middle" style="fill:${MUTED};font-size:30px">×</text>`;
  s += tile(320, 240, 'S(settle) ÷ S(maturity)', r.toFixed(5), WAVE, `the seasonal ratio (${g >= 0 ? '+' : ''}${g.toFixed(2)}%)`);
  s += `<text x="${590}" y="${ty0 + 58}" text-anchor="middle" style="fill:${MUTED};font-size:30px">=</text>`;
  s += tile(620, 210, 'SEASONALLY ADJUSTED PRICE', SACP.toFixed(3), GREEN, 'seasons stripped out');

  // arrows: dots → ratio tile
  s += arrow(x(sD), y(Ss) + 10, 400, ty0 - 6, CYAN, 0.25);
  s += arrow(x(mD), y(Sm) + 10, 480, ty0 - 6, AMBER, -0.25);

  s += note(W / 2, H - 44, ['one multiplication removes the predictable seasonal slug from the price —'], INK, 'middle', 14);
  s += note(W / 2, H - 24, ['now TIPS maturing in ANY month can be compared on equal footing  (Canty 2009 — the formula the YieldCurves app applies)'], MUTED, 'middle', 12);
  el.innerHTML = s;
}

// ── Page 10: Same gap, any maturity ─────────────────────────────────────────
export function drawP10(el) {
  const W = 900, H = 500;
  const YEARS = [1, 2, 3, 5];
  const rowH = 104, top = 46;
  const sD = state.settleDoy;
  const Ssettle = Sat(sD);
  let s = '';
  s += note(W / 2, 22, ['same purchase date, same maturity month — only YEARS TO MATURITY changes'], INK, 'middle', 14);

  const r = ratio();
  YEARS.forEach((yrs, i) => {
    const y0 = top + i * rowH, y1 = y0 + rowH - 26;
    const flows = cashFlowSchedule(sD, state.matIdx, yrs);
    const ef = 5 * 365 + 200; // shared x-scale across rows so time lines up
    const L = 90, R = 150;
    const x = e => L + (e / ef) * (W - L - R);
    const lo = Smin() - 0.0004, hi = Smax() + 0.0004;
    const y = v => y0 + (1 - (v - lo) / (hi - lo)) * (y1 - y0);
    const yS = y(Ssettle);

    s += `<text x="10" y="${(y0 + y1) / 2 + 4}" style="fill:${INK};font-size:15px;font-weight:800">${yrs}y</text>`;
    s += `<line x1="${L}" y1="${yS}" x2="${x(flows[flows.length - 1].elapsed)}" y2="${yS}" stroke="${CYAN}" stroke-width="1.2" stroke-dasharray="5 4" opacity=".8"/>`;
    let p = ''; const efi = flows[flows.length - 1].elapsed;
    for (let e = 0; e <= efi; e += 4) p += (e ? 'L' : 'M') + x(e).toFixed(1) + ' ' + y(Sat(sD + e)).toFixed(1) + ' ';
    s += `<path d="${p}" fill="none" stroke="${WAVE}" stroke-width="1.5" opacity=".85"/>`;
    const maxPv = Math.max(...flows.map(f => f.pv));
    for (const f of flows) {
      const Sv = Sat(sD + f.elapsed), col = Sv > Ssettle ? GREEN : RED;
      const w = 1 + 12 * (f.pv / maxPv);
      s += `<line x1="${x(f.elapsed).toFixed(1)}" y1="${yS.toFixed(1)}" x2="${x(f.elapsed).toFixed(1)}" y2="${y(Sv).toFixed(1)}" stroke="${col}" stroke-width="${w.toFixed(1)}" opacity="${f.principal ? .95 : .55}" stroke-linecap="round"/>`;
      if (f.principal) s += `<circle cx="${x(f.elapsed).toFixed(1)}" cy="${y(Sv).toFixed(1)}" r="4" fill="${AMBER}"/>`;
    }
    s += `<circle cx="${L}" cy="${yS}" r="4" fill="${CYAN}"/>`;
    s += note(W - R + 16, (y0 + y1) / 2 + 4, `price × ${r.toFixed(5)}`, WAVE, 'start', 13);
  });

  const yEnd = top + YEARS.length * rowH;
  s += vBracket(W - 34, top + rowH / 2 - 10, yEnd - rowH / 2 - 16, AMBER, 5);
  s += note(W - 40, yEnd - rowH / 2 + 14, ['IDENTICAL'], AMBER, 'end', 13);
  s += note(W / 2, yEnd + 18, ['the final payment always lands on the same month/day — the same height of the wave —'], INK, 'middle', 13);
  s += note(W / 2, yEnd + 36, ['so the PRICE adjustment is the same whether you hold 1 year or 5. But the yield…'], INK, 'middle', 13);
  el.innerHTML = s;
}

// ── Page 11: …but yield spreads it over the years ───────────────────────────
export function drawP11(el) {
  const W = 900, H = 480, L = 76, R = 30, T = 78, B = 76;
  const YEARS = [1, 2, 3, 5, 7, 10];
  const sD = state.settleDoy;
  const r = ratio();
  const priceGapPct = (1 - r) * 100; // % price mispricing removed
  const bps = YEARS.map(yrs => {
    const flows = cashFlowSchedule(sD, state.matIdx, yrs);
    const yld = yieldForYears(yrs);
    return { yrs, bps: (1 - r) / modifiedDuration(flows, yld) * 10000 };
  });
  const noGap = Math.max(...bps.map(b => Math.abs(b.bps))) < 3; // near-anniversary: nothing to show
  const maxAbs = Math.max(...bps.map(b => Math.abs(b.bps)), 1);
  const slot = (W - L - R) / YEARS.length;
  const x = i => L + slot * i + slot / 2;
  const y0 = H - B;
  const hOf = v => Math.abs(v) / maxAbs * (y0 - T - 8);

  let s = '';
  s += note(W / 2, 26, [`the price nudge is fixed: ${priceGapPct >= 0 ? '+' : ''}${priceGapPct.toFixed(2)}% — the SAME for every maturity`], INK, 'middle', 14);
  s += note(W / 2, 46, ['but yield is PER YEAR — more years to spread it over means fewer basis points each year'], MUTED, 'middle', 12);

  s += `<line x1="${L - 10}" y1="${y0}" x2="${W - R}" y2="${y0}" stroke="#64748b" stroke-width="1.5"/>`;
  const sign = bps[0].bps >= 0 ? 1 : -1;
  bps.forEach((b, i) => {
    const h = noGap ? 3 : hOf(b.bps);
    const bw = Math.min(slot * 0.55, 74);
    s += `<rect x="${x(i) - bw / 2}" y="${y0 - h}" width="${bw}" height="${Math.max(h, 2)}" rx="5" fill="${sign >= 0 ? GREEN : RED}" opacity="${0.45 + 0.5 * (Math.abs(b.bps) / maxAbs)}"/>`;
    s += `<text x="${x(i)}" y="${y0 - h - 10}" text-anchor="middle" style="fill:${INK};font-size:15px;font-weight:800">${b.bps >= 0 ? '+' : ''}${b.bps.toFixed(0)} bp</text>`;
    s += `<text x="${x(i)}" y="${y0 + 20}" text-anchor="middle" style="fill:${MUTED};font-size:13px">${b.yrs}y</text>`;
  });

  if (noGap) {
    s += note(W / 2, (T + y0) / 2, ['no gap right now (settlement is near the anniversary) —', 'slide the settlement date to open one up'], MUTED, 'middle', 14);
  } else {
    // guide curve ~ 1/duration
    let gp = '';
    bps.forEach((b, i) => { gp += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + (y0 - hOf(b.bps)).toFixed(1) + ' '; });
    s += `<path d="${gp}" fill="none" stroke="${AMBER}" stroke-width="1.8" stroke-dasharray="6 4" opacity=".85"/>`;
    s += callout(x(0), y0 - hOf(bps[0].bps) - 24, x(0) + 60, T + 6, ['1 year to absorb the whole nudge → BIG yield effect'], sign >= 0 ? GREEN : RED, 'start', -0.2);
    const last = bps.length - 1;
    s += callout(x(last), y0 - hOf(bps[last].bps) - 20, x(last) - 40, y0 - hOf(bps[0].bps) * 0.55, ['10 years → a tenth of the punch.', 'THIS is why seasonality dominates', 'short TIPS and fades in long ones'], AMBER, 'end', 0.25);
  }
  s += note(W / 2, H - 26, ['yield impact ≈ price gap ÷ years of duration  —  same wave, same gap, different lever length'], INK, 'middle', 13);
  el.innerHTML = s;
}

// ── Page 12: Playground (chart + live readout in HTML panel) ────────────────
export function drawP12(el) {
  el.innerHTML = timelineSVG({ annotate: 'minimal', h: 400 });
}

export function playgroundReadout() {
  const sD = state.settleDoy, mD = doy(state.matIdx, 15);
  const Ss = Sat(sD), Sm = Sat(mD), r = Ss / Sm;
  const flows = cashFlowSchedule(sD);
  const yld = yieldForYears(state.yearsToMat);
  const md = modifiedDuration(flows, yld);
  const totalPv = flows.reduce((a, f) => a + f.pv, 0);
  const fin = flows[flows.length - 1];
  const finCpnPv = fin.pv * (ILLUS_COUPON * 1000) / fin.cf;
  const principalShare = (fin.pv - finCpnPv) / totalPv;
  return {
    settle: dateLabel(sD), Ss, Sm, ratio: r,
    gapPct: (Sm / Ss - 1) * 100,
    stubDays: Math.round(flows[0].elapsed),
    bps: (1 - r) / md * 10000, modDur: md,
    bond: `${fin.yearsElapsed.toFixed(1)}y, ${(ILLUS_COUPON * 100).toFixed(2)}% coupon, ${(yld * 100).toFixed(2)}% real yield`,
    principalShare, nFlows: flows.length,
  };
}
