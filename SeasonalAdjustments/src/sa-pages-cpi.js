// sa-pages-cpi.js — Pages 1–5: from raw CPI to "every payment rides the index".
// Each drawPn(el) renders one full-page annotated SVG. Annotations are drawn
// ON the chart (arrows, rings, notes) — no external legends.
// Spec: knowledge/1.0_SeasonalAdjustments_Explorer.md §Pages

import { D, MONTHS, DIM, cum, MATS, Sat, Smin, Smax, doy, dateLabel, state, ILLUS_COUPON } from './sa-data.js';
import { note, arrow, callout, calloutMulti, ring, vBracket, pill, AMBER, CYAN, GREEN, RED, INK } from './sa-annotate.js';

const GRID = '#334155', MUTED = '#94a3b8', SLATE = '#94a3b8', WAVE = '#7dd3fc', BLUE = '#3b82f6';

function noData(el, W, H) {
  el.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" style="fill:${MUTED};font-size:14px">CPI data unavailable (offline) — later chapters still work from the built-in seasonal shape.</text>`;
}

// Average MoM % change of CPI-U by calendar month, from the Ref CPI series
// (unshifting the 3-month lag). Only COMPLETE calendar years are counted, so
// every month gets the same N — the raw series starts/ends mid-year (e.g.
// Apr–Aug), and without this filter those partial edge years silently pad
// some months' buckets but not others (an inaccuracy we shipped once).
// Returns {nsaAvg[12], saAvg[12], byMo, N}.
function monthlyMoM() {
  const lookup = Object.fromEntries(D.series.map(r => [r.date, r]));
  function sampleMonth(yr, mo) {
    for (let d = 0; d <= 3; d++) for (const sg of [0, 1, -1]) {
      const ds = new Date(yr, mo, 15 + sg * d).toISOString().slice(0, 10);
      if (lookup[ds]) return lookup[ds];
    }
    return null;
  }
  const d0 = new Date(D.series[0].date), d1 = new Date(D.series[D.series.length - 1].date);
  const monthly = [];
  let cur = new Date(d0.getFullYear(), d0.getMonth(), 1);
  while (cur <= d1) {
    const row = sampleMonth(cur.getFullYear(), cur.getMonth());
    if (row) monthly.push({ yr: cur.getFullYear(), mo: cur.getMonth(), nsa: row.nsa, sa: row.sa });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  // full calendar years only: first Jan on/after d0, last Dec on/before d1
  const fullFrom = d0.getMonth() === 0 ? d0.getFullYear() : d0.getFullYear() + 1;
  const fullTo = d1.getMonth() === 11 ? d1.getFullYear() : d1.getFullYear() - 1;

  const byMo = Array.from({ length: 12 }, () => ({ nsa: [], sa: [] }));
  for (let i = 1; i < monthly.length; i++) {
    const c = monthly[i], p = monthly[i - 1];
    if (!p.nsa || isNaN(p.nsa)) continue;
    const shift = c.mo - 3, cpiMo = (shift + 12) % 12, cpiYr = shift < 0 ? c.yr - 1 : c.yr;
    if (cpiYr < fullFrom || cpiYr > fullTo) continue;
    byMo[cpiMo].nsa.push({ yr: cpiYr, val: (c.nsa / p.nsa - 1) * 100 });
    byMo[cpiMo].sa.push({ yr: cpiYr, val: (c.sa / p.sa - 1) * 100 });
  }
  const avg = m => m.reduce((s, v) => s + v.val, 0) / m.length;
  return {
    nsaAvg: byMo.map(m => m.nsa.length ? avg(m.nsa) : 0),
    saAvg: byMo.map(m => m.sa.length ? avg(m.sa) : 0),
    byMo,
    N: fullTo - fullFrom + 1,
  };
}

// ── Page 1: Prices have seasons ─────────────────────────────────────────────
// Layout reserves a full annotation band above AND below the plot (topBand /
// botBand) so bubbles never sit on top of chart data — they live in dead
// space and just point in with an arrow.
export function drawP1(el) {
  const W = 900, H = 640, L = 68, R = 16;
  const topBand = 130, botBand = 170; // dead space reserved above/below the plot
  const T = topBand, B = botBand;
  if (!D.series || !D.series.length) return noData(el, W, H);
  const { nsaAvg, saAvg, byMo, N } = monthlyMoM();

  const allVals = [...byMo.flatMap(m => m.nsa.map(v => v.val)), 0];
  // lo/hi rounded to the 0.2 lattice (not 0.1) so the 0.2-step tick loop below
  // always lands exactly on 0.0% — a zero axis line needs an exact zero tick.
  const lo = Math.floor(Math.min(...allVals) / 0.2) * 0.2, hi = Math.ceil(Math.max(...allVals) / 0.2) * 0.2;
  const ty = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const slot = (W - L - R) / 12, cx = mo => L + slot * mo + slot / 2;
  const plotBottom = H - B;

  let s = '';
  for (let v = lo; v <= hi + 0.001; v = Math.round((v + 0.2) * 10) / 10) {
    const yy = ty(v), isZ = Math.abs(v) < 0.001;
    s += `<line x1="${L}" y1="${yy}" x2="${W - R}" y2="${yy}" stroke="${isZ ? '#64748b' : GRID}" stroke-width="${isZ ? 1.5 : 1}" opacity="${isZ ? 1 : .35}"/>`;
    s += `<text x="${L - 8}" y="${yy + 3}" text-anchor="end" style="fill:${MUTED};font-size:10px">${v.toFixed(1)}%</text>`;
  }
  for (let m = 0; m < 12; m++) s += `<text x="${cx(m)}" y="${plotBottom + 22}" text-anchor="middle" style="fill:${MUTED};font-size:12px">${MONTHS[m]}</text>`;
  const midY = (T + plotBottom) / 2;
  s += `<text x="14" y="${midY}" text-anchor="middle" transform="rotate(-90 14 ${midY})" style="fill:${MUTED};font-size:12px">MoM % change in CPI-U</text>`;

  // H1/H2 soft background wash — full plot height, so it always contains
  // every point in its half (a hard-edged box sized to the average line
  // was cutting off the individual-year X marks that ran wider than it).
  // H2 uses RED (not CYAN) so it doesn't fight the BLUE average line below.
  const h1x0 = L, h1x1 = L + slot * 6, h2x1 = W - R;
  s += `<rect x="${h1x0}" y="${T}" width="${h1x1 - h1x0}" height="${plotBottom - T}" fill="${AMBER}" opacity=".07"/>`;
  s += `<rect x="${h1x1}" y="${T}" width="${h2x1 - h1x1}" height="${plotBottom - T}" fill="${RED}" opacity=".07"/>`;

  // per-year NSA points as small dots, one color per year — nudged apart
  // horizontally only when two years land within a few px of each other.
  // First pass computes positions (needed for both the dots and the per-year
  // connecting lines below); second pass draws.
  const YEAR_COLORS = ['#f472b6', '#a78bfa', '#60a5fa', '#2dd4bf', '#fb923c', '#fde047'];
  const years = [...new Set(byMo.flatMap(m => m.nsa.map(p => p.yr)))].sort((a, b) => a - b);
  const yearColor = Object.fromEntries(years.map((yr, i) => [yr, YEAR_COLORS[i % YEAR_COLORS.length]]));

  const dotXY = []; // for annotation targeting below
  const yearPos = {}; // yearPos[yr][m] = {x,y} — one calendar-year's trajectory
  const dotR = 1.3, hitR = 8; // visible dot vs. its (larger) hover hit-area
  const monthPts = [];
  for (let m = 0; m < 12; m++) {
    const x = cx(m);
    const pts = byMo[m].nsa.map(p => ({ ...p, cy: ty(p.val) }));
    const order = pts.map((_, i) => i).sort((a, b) => pts[a].cy - pts[b].cy);
    const dx = new Array(pts.length).fill(0);
    let lastCy = null, side = 1;
    order.forEach(i => {
      if (lastCy !== null && Math.abs(pts[i].cy - lastCy) < 5.5) { dx[i] = side * slot * 0.14; side = -side; }
      else side = 1;
      lastCy = pts[i].cy;
    });
    pts.forEach((p, i) => { (yearPos[p.yr] ||= {})[m] = { x: x + dx[i], y: p.cy }; });
    monthPts.push(pts.map((p, i) => ({ ...p, px: x + dx[i] })));
    const lowI = order[order.length - 1]; // bottom-most (lowest-value) point this month
    dotXY[m] = { x: x + dx[lowI], y: pts[lowI] ? pts[lowI].cy : ty(nsaAvg[m]) };
  }

  // thin per-year lines, colored to match their dots — each year's own
  // Jan→Dec trajectory, so the reader can see one specific year's seasonal
  // path (and pick it out by color), not just the average
  Object.entries(yearPos).forEach(([yr, pos]) => {
    let path = '';
    for (let m = 0; m < 12; m++) { if (!pos[m]) continue; path += (path ? 'L' : 'M') + pos[m].x.toFixed(1) + ' ' + pos[m].y.toFixed(1); }
    s += `<path d="${path}" fill="none" stroke="${yearColor[yr]}" stroke-width="1" opacity=".35"/>`;
  });

  for (let m = 0; m < 12; m++) {
    monthPts[m].forEach(p => {
      const px = p.px, py = p.cy;
      // a transparent circle (radius > the visible dot) is the actual hover
      // target — the small dot alone is too small a hit-area to aim at
      s += `<g opacity=".8"><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${dotR}" fill="${yearColor[p.yr]}"/><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${hitR}" fill="transparent"/><title>${p.yr}: ${p.val >= 0 ? '+' : ''}${p.val.toFixed(2)}%</title></g>`;
    });
  }

  // NSA average line — bright BLUE so it stands out the way GREEN (SA) does,
  // instead of competing with the muted grey per-year dots/text
  let nsaPath = ''; for (let m = 0; m < 12; m++) nsaPath += (m ? 'L' : 'M') + cx(m).toFixed(1) + ' ' + ty(nsaAvg[m]).toFixed(1);
  s += `<path d="${nsaPath}" fill="none" stroke="${BLUE}" stroke-width="2.2"/>`;
  for (let m = 0; m < 12; m++) s += `<circle cx="${cx(m)}" cy="${ty(nsaAvg[m])}" r="3" fill="${BLUE}"/>`;

  // SA line
  let saPath = ''; for (let m = 0; m < 12; m++) saPath += (m ? 'L' : 'M') + cx(m).toFixed(1) + ' ' + ty(saAvg[m]).toFixed(1);
  s += `<path d="${saPath}" fill="none" stroke="${GREEN}" stroke-width="2.5"/>`;
  for (let m = 0; m < 12; m++) s += `<circle cx="${cx(m)}" cy="${ty(saAvg[m])}" r="3.5" fill="${GREEN}"/>`;

  // ── Annotations — all in the reserved top/bottom bands, never over data ──
  // Top band: one combined H1/H2 explanation, two arrows (one per wash color).
  s += calloutMulti([
    { x: (h1x0 + h1x1) / 2, y: T + 14, bend: -0.15, color: AMBER },
    { x: (h1x1 + h2x1) / 2, y: T + 14, bend: 0.15, color: RED },
  ], W / 2, 46, [
    'Month-over-month (MoM) CPI-U, not seasonally adjusted (NSA),',
    'is generally higher in H1 (Jan–Jun) than H2 (Jul–Dec).',
  ], INK, 'middle');

  // Bottom band: grey X, grey LINE, GREEN — spread left/center/right so none
  // touch, and each arrow targets the nearest usable point directly above its
  // own box rather than reaching across the chart.
  const xBoxTx = L + 10, lineBoxTx = W / 2, greenBoxTx = W - R - 10;

  // each DOT: connect to whichever nearby month has a point closest to the
  // bottom of the plot (i.e. physically nearest this box, which sits under Jan–Apr)
  const dotM = [0, 1, 2, 3].sort((a, b) => dotXY[b].y - dotXY[a].y)[0];
  s += callout(dotXY[dotM].x, dotXY[dotM].y, xBoxTx, plotBottom + 60, [
    'each DOT = CPI month-over-month',
    '(MoM) change for one year',
    '(color = year;',
    'hover a dot for the year)',
  ], SLATE, 'start', 0.2);

  // BLUE LINE / GREEN: land on clearly different months (May vs Nov) so the
  // two arrows read as distinct, not two curves converging on the same spot
  const barM = 4; // May
  s += callout(cx(barM), ty(nsaAvg[barM]), lineBoxTx, plotBottom + 60, [
    `BLUE LINE = the ${N}-year average`,
    'MoM % change in CPI-U',
    '(All Urban Consumers, NSA)',
  ], BLUE, 'middle', -0.2);

  const saM = 10; // Nov
  s += callout(cx(saM), ty(saAvg[saM]), greenBoxTx, plotBottom + 60, [
    `GREEN = that same ${N}-year average,`,
    'computed from the SA (Seasonally',
    'Adjusted) series instead —',
    'flatter, since SA removes',
    'the seasonal effects',
  ], GREEN, 'end', 0.2);

  el.innerHTML = s;
}

// ── Page 2: Every year, the same wave ───────────────────────────────────────
export function drawP2(el) {
  const W = 900, H = 480, L = 56, R = 14, T = 46, B = 42;
  if (!D.series || !D.series.length) return noData(el, W, H);
  const series = D.series;
  const firstJanRow = series.find(r => r.date.slice(5, 7) === '01');
  const chartStart = firstJanRow ? `${firstJanRow.date.slice(0, 4)}-01-01` : series[0].date;
  const t0 = new Date(chartStart).getTime(), t1 = new Date(series[series.length - 1].date).getTime();
  const tx = d => L + (new Date(d).getTime() - t0) / (t1 - t0) * (W - L - R);
  const fVals = series.map(r => r.factor).filter(v => !isNaN(v));
  const lo = Math.min(...fVals) - 0.0012, hi = Math.max(...fVals) + 0.0018;
  const ty = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  let s = '';
  const y0 = parseInt(chartStart.slice(0, 4)), y1 = parseInt(series[series.length - 1].date.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    const xx = tx(`${y}-01-01`);
    s += `<line x1="${xx}" y1="${T}" x2="${xx}" y2="${H - B}" stroke="${GRID}" stroke-width="1" opacity=".5"/>`;
    s += `<text x="${xx + 3}" y="${H - B + 16}" style="fill:${MUTED};font-size:11px">${y}</text>`;
  }
  const yy1 = ty(1);
  s += `<line x1="${L}" y1="${yy1}" x2="${W - R}" y2="${yy1}" stroke="#94a3b8" stroke-width="1.2" opacity=".7" stroke-dasharray="2 3"/>`;
  s += `<text x="${W - R}" y="${yy1 - 5}" text-anchor="end" style="fill:${MUTED};font-size:11px">1.000 = no seasonal push either way</text>`;

  let p = ''; series.forEach(r => { if (!isNaN(r.factor) && r.date >= chartStart) p += (p ? 'L' : 'M') + tx(r.date).toFixed(1) + ' ' + ty(r.factor).toFixed(1) + ' '; });
  s += `<path d="${p}" fill="none" stroke="${WAVE}" stroke-width="2"/>`;

  // per-year peak/trough markers (full years only)
  const byYear = {};
  for (const r of series) { if (r.date < chartStart || isNaN(r.factor)) continue; (byYear[r.date.slice(0, 4)] ||= []).push(r); }
  const peaks = [], troughs = [];
  for (const y of Object.keys(byYear)) {
    const rows = byYear[y];
    if (rows.length < 300) continue;
    peaks.push(rows.reduce((a, b) => b.factor > a.factor ? b : a));
    troughs.push(rows.reduce((a, b) => b.factor < a.factor ? b : a));
  }
  for (const pk of peaks) s += ring(tx(pk.date), ty(pk.factor), 13, 13, AMBER);
  for (const tr of troughs) s += ring(tx(tr.date), ty(tr.factor), 13, 13, CYAN);

  if (peaks.length) {
    const mid = peaks[Math.floor(peaks.length / 2)];
    s += callout(tx(mid.date), ty(mid.factor) - 14, W / 2 - 40, T - 26, ['a PEAK every late summer — same spot, every year'], AMBER, 'middle', 0.15);
  }
  if (troughs.length) {
    const mid = troughs[Math.floor(troughs.length / 2)];
    s += callout(tx(mid.date), ty(mid.factor) + 14, W / 2 + 10, H - 52, ['a DIP every late winter — same spot, every year'], CYAN, 'middle', 0.15);
  }
  s += pill(W / 2, T + 22, 'the Seasonal Factor S = actual CPI ÷ seasonally-adjusted CPI', WAVE);
  s += note(W / 2, H - 4, ['repeats like clockwork → PREDICTABLE — and predictable means it can be corrected for'], INK, 'middle', 13);

  el.innerHTML = s;
}

// ── Page 3: One year, up close ──────────────────────────────────────────────
export function drawP3(el) {
  const W = 900, H = 480, L = 56, R = 16, T = 50, B = 40;
  const lo = Smin() - 0.0006, hi = Smax() + 0.0012;
  const x = i => L + (i / 364) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let s = '';
  for (let m = 0; m < 12; m++) {
    const xx = x(cum[m]);
    s += `<line x1="${xx}" y1="${T}" x2="${xx}" y2="${H - B}" stroke="${GRID}" stroke-width="1" opacity=".4"/>`;
    s += `<text x="${xx + 3}" y="${H - 22}" style="fill:${MUTED};font-size:12px">${MONTHS[m]}</text>`;
  }
  const yy1 = y(1);
  s += `<line x1="${L}" y1="${yy1}" x2="${W - R}" y2="${yy1}" stroke="#94a3b8" stroke-width="1.2" opacity=".7" stroke-dasharray="2 3"/>`;
  s += `<text x="${L + 4}" y="${yy1 - 5}" style="fill:${MUTED};font-size:11px">1.000 — the trend, no seasonal push</text>`;

  // shaded above/below
  let above = `M${x(0)} ${yy1} `, below = `M${x(0)} ${yy1} `;
  for (let i = 0; i < 365; i++) { const yv = y(D.daily[i]); above += `L${x(i).toFixed(1)} ${Math.min(yv, yy1).toFixed(1)} `; below += `L${x(i).toFixed(1)} ${Math.max(yv, yy1).toFixed(1)} `; }
  s += `<path d="${above}L${x(364)} ${yy1} Z" fill="${AMBER}" opacity=".10"/>`;
  s += `<path d="${below}L${x(364)} ${yy1} Z" fill="${CYAN}" opacity=".10"/>`;

  let p = ''; for (let i = 0; i < 365; i++) p += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(D.daily[i]).toFixed(1) + ' ';
  s += `<path d="${p}" fill="none" stroke="${WAVE}" stroke-width="3"/>`;

  // peak & trough with values
  let pkI = 0, trI = 0;
  for (let i = 0; i < 365; i++) { if (D.daily[i] > D.daily[pkI]) pkI = i; if (D.daily[i] < D.daily[trI]) trI = i; }
  const pkPct = (D.daily[pkI] - 1) * 100, trPct = (D.daily[trI] - 1) * 100;
  s += `<circle cx="${x(pkI)}" cy="${y(D.daily[pkI])}" r="5" fill="${AMBER}"/>`;
  s += `<circle cx="${x(trI)}" cy="${y(D.daily[trI])}" r="5" fill="${CYAN}"/>`;
  s += callout(x(pkI), y(D.daily[pkI]) - 8, x(pkI) - 150, T - 20, [`TOP of the wave: ${dateLabel(pkI)},`, `prices ${pkPct >= 0 ? '+' : ''}${pkPct.toFixed(2)}% above trend`], AMBER, 'start', -0.2);
  s += callout(x(trI) - 8, y(D.daily[trI]) - 4, x(trI) - 60, y(D.daily[trI]) - 130, [`BOTTOM: ${dateLabel(trI)},`, `${trPct.toFixed(2)}% below trend`], CYAN, 'end', 0.25);

  // TIPS maturity months
  for (const mm of MATS) {
    const dd = doy(mm.m, 15);
    s += `<line x1="${x(dd)}" y1="${y(Sat(dd))}" x2="${x(dd)}" y2="${H - B}" stroke="${AMBER}" stroke-width="1.2" opacity=".5" stroke-dasharray="3 3"/>`;
    s += `<circle cx="${x(dd)}" cy="${y(Sat(dd))}" r="6" fill="none" stroke="${AMBER}" stroke-width="2.5"/>`;
    s += `<text x="${x(dd)}" y="${H - B - 6}" text-anchor="middle" style="fill:${AMBER};font-size:11px;font-weight:700">${mm.label}</text>`;
  }
  s += note(x(doy(7, 20)), y(1) + 120, ['every TIPS matures on the 15th of Jan, Apr, Jul or Oct —', 'each sits at a DIFFERENT height on the wave'], AMBER, 'middle', 13);

  el.innerHTML = s;
}

// ── Page 4: A TIPS is a stream of payments ──────────────────────────────────
export function drawP4(el) {
  const W = 900, H = 480, L = 120, R = 40, T = 60;
  const base = H - 110;
  const YRS = 5, cpn = ILLUS_COUPON * 1000, fin = cpn + 1000;
  const x = t => L + (t / YRS) * (W - L - R);
  const hMax = base - T - 30;
  const hOf = cf => Math.max(3, cf / fin * hMax);

  let s = '';
  // timeline base
  s += `<line x1="${L - 30}" y1="${base}" x2="${W - R + 20}" y2="${base}" stroke="#64748b" stroke-width="2"/>`;
  s += `<path d="M${W - R + 20} ${base} l-10 -5 v10 Z" fill="#64748b"/>`;
  for (let t = 0; t <= YRS; t++) {
    s += `<line x1="${x(t)}" y1="${base - 4}" x2="${x(t)}" y2="${base + 4}" stroke="#64748b" stroke-width="1.5"/>`;
    s += `<text x="${x(t)}" y="${base + 20}" text-anchor="middle" style="fill:${MUTED};font-size:12px">${t === 0 ? 'today' : '+' + t + 'y'}</text>`;
  }

  // you buy here
  s += `<circle cx="${x(0)}" cy="${base}" r="6" fill="${CYAN}"/>`;
  s += note(x(0), base + 42, ['YOU BUY HERE', '(settlement)'], CYAN, 'middle', 12);

  // coupon bars
  for (let t = 1; t < YRS; t++) {
    s += `<rect x="${x(t) - 4}" y="${base - hOf(cpn)}" width="8" height="${hOf(cpn)}" fill="${GREEN}" rx="2"/>`;
    s += `<text x="${x(t)}" y="${base - hOf(cpn) - 8}" text-anchor="middle" style="fill:${GREEN};font-size:11px">$12.50</text>`;
  }
  // final bar
  s += `<rect x="${x(YRS) - 22}" y="${base - hOf(fin)}" width="44" height="${hOf(fin)}" fill="${AMBER}" rx="4"/>`;
  s += `<text x="${x(YRS)}" y="${base - hOf(fin) - 10}" text-anchor="middle" style="fill:${AMBER};font-size:14px;font-weight:800">$1,012.50</text>`;

  s += callout(x(2), base - hOf(cpn) - 22, x(1.05), T + 26, ['coupons: 1¼% of $1,000 a year —', 'real money, but TINY at this scale'], GREEN, 'start', -0.25);
  s += callout(x(YRS) - 26, base - hOf(fin) * 0.55, x(3.05), base - hOf(fin) * 0.72, ['MATURITY: your $1,000 principal', 'comes back (plus the last coupon).', 'One payment ≈ 94% of the bond’s value'], AMBER, 'end', 0.2);

  // price = discounted sum
  s += `<rect x="${L - 96}" y="${base - 150}" width="88" height="64" rx="8" fill="#0b1220" stroke="${CYAN}"/>`;
  s += `<text x="${L - 52}" y="${base - 126}" text-anchor="middle" style="fill:${CYAN};font-size:12px;font-weight:700">price</text>`;
  s += `<text x="${L - 52}" y="${base - 108}" text-anchor="middle" style="fill:${MUTED};font-size:10px">today</text>`;
  s += arrow(x(0.9), base - 60, L - 6, base - 116, CYAN, -0.3);
  s += note(W / 2, H - 26, ['the price today is just all of these future payments, discounted back — nothing else'], INK, 'middle', 13);

  el.innerHTML = s;
}

// ── Page 5: Every payment rides the index ───────────────────────────────────
export function drawP5(el) {
  const W = 900, H = 480, L = 66, R = 20, T = 46, B = 66;
  const YRS = 5, EXAG = 4, TREND = 0.025;
  const s0 = state.settleDoy;
  const S0 = Sat(s0);
  const idx = e => Math.pow(1 + TREND, e / 365) * (1 + EXAG * (Sat(s0 + e) / S0 - 1));
  const trend = e => Math.pow(1 + TREND, e / 365);
  const total = YRS * 365;
  let minIdx = 1; for (let e = 0; e <= total; e += 4) minIdx = Math.min(minIdx, idx(e));
  const lo = minIdx - 0.006, hi = trend(total) * 1.012;
  const x = e => L + (e / total) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  let s = '';
  for (let k = 0; k <= YRS; k++) {
    s += `<line x1="${x(k * 365)}" y1="${T}" x2="${x(k * 365)}" y2="${H - B}" stroke="${GRID}" stroke-width="1" opacity=".35"/>`;
    s += `<text x="${x(k * 365)}" y="${H - B + 16}" text-anchor="middle" style="fill:${MUTED};font-size:12px">${k === 0 ? 'today' : '+' + k + 'y'}</text>`;
  }
  // trend line
  let tp = ''; for (let e = 0; e <= total; e += 8) tp += (e ? 'L' : 'M') + x(e).toFixed(1) + ' ' + y(trend(e)).toFixed(1) + ' ';
  s += `<path d="${tp}" fill="none" stroke="${MUTED}" stroke-width="1.5" stroke-dasharray="6 5" opacity=".8"/>`;
  // index path with exaggerated seasonal ripple
  let ip = ''; for (let e = 0; e <= total; e += 4) ip += (e ? 'L' : 'M') + x(e).toFixed(1) + ' ' + y(idx(e)).toFixed(1) + ' ';
  s += `<path d="${ip}" fill="none" stroke="${WAVE}" stroke-width="2.5"/>`;

  // payment anniversaries: maturity mm/dd each year (use current maturity month)
  const matDoy = doy(state.matIdx, 15);
  const firstGap = ((matDoy - s0) % 365 + 365) % 365 || 365;
  const payDots = [];
  for (let k = 0; ; k++) {
    const e = firstGap + 365 * k;
    if (e > total) break;
    payDots.push(e);
  }
  for (const e of payDots) {
    const last = e === payDots[payDots.length - 1];
    s += `<line x1="${x(e)}" y1="${y(idx(e))}" x2="${x(e)}" y2="${H - B}" stroke="${last ? AMBER : GREEN}" stroke-width="${last ? 3 : 1.5}" opacity=".7"/>`;
    s += `<circle cx="${x(e)}" cy="${y(idx(e))}" r="${last ? 7 : 5}" fill="${last ? AMBER : GREEN}"/>`;
  }

  const midPay = payDots[Math.min(1, payDots.length - 1)];
  s += callout(x(midPay), y(idx(midPay)) - 8, L + 40, T + 4, ['each payment is scaled by the index', 'ON ITS OWN DAY — same calendar day', 'every year → same spot on every ripple'], GREEN, 'start', -0.2);
  const lastPay = payDots[payDots.length - 1];
  s += callout(x(lastPay) - 10, y(idx(lastPay)) - 12, x(lastPay) - 70, y(idx(lastPay)) - 90, ['the BIG one — principal —', 'rides the index too'], AMBER, 'end', 0.25);

  // ripple label hugging a mid-chart crest (no long arrow — it names what it touches)
  let rippleE = 2.3 * 365; for (let e = 2.3 * 365; e < 3.3 * 365; e += 4) if (idx(e) / trend(e) > idx(rippleE) / trend(rippleE)) rippleE = e;
  s += note(x(rippleE), y(idx(rippleE)) - 20, `the seasonal ripple — exaggerated ${EXAG}× to be visible`, WAVE, 'middle', 12);
  // trend label in the empty band under the dashed line, where the ripple dips away
  s += note(x(170), y(trend(170)) + 22, 'the TREND — the index with seasonality removed', MUTED, 'start', 12);

  s += note(W / 2, H - 22, ['payment $ = fixed real amount × the index on its payment day  (this is a TIPS’s inflation protection)'], INK, 'middle', 13);
  el.innerHTML = s;
}
