// sa-annotate.js — SVG callout helpers for the TIPS Seasonality visual guide.
// Comic-book style annotations drawn directly ON the charts: curved arrows,
// dashed rings, gap brackets, short bold labels. Every function returns an
// SVG string to concatenate into a chart's innerHTML.
// Spec: knowledge/1.0_SeasonalAdjustments_Explorer.md §Annotation Layer

export const AMBER = '#fbbf24';
export const CYAN  = '#38bdf8';
export const GREEN = '#22c55e';
export const RED   = '#f87171';
export const INK   = '#e2e8f0';

const FONT_STACK = '-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif'; // matches body{} in index.html

// Real text measurement (canvas), not a character-count guess — this is what
// lets bubble() / callout() know exactly where the rendered text edges are.
let _mctx = null;
function measureWidth(text, size) {
  if (!_mctx) _mctx = document.createElement('canvas').getContext('2d');
  _mctx.font = `700 ${size}px ${FONT_STACK}`;
  return _mctx.measureText(text).width * 1.05; // small fudge for letter-spacing:.01em
}

// Multi-line label. `lines` = string (split on \n) or array of strings.
// anchor: 'start' | 'middle' | 'end'
export function note(x, y, lines, color = AMBER, anchor = 'start', size = 13) {
  const arr = Array.isArray(lines) ? lines : String(lines).split('\n');
  const lh = size + 3;
  let s = `<text x="${x}" y="${y}" text-anchor="${anchor}" style="fill:${color};font-size:${size}px;font-weight:700;letter-spacing:.01em">`;
  arr.forEach((ln, i) => {
    s += `<tspan x="${x}" dy="${i === 0 ? 0 : lh}">${ln}</tspan>`;
  });
  return s + '</text>';
}

// Bounding box of a note() block in local coordinates, given its anchor.
function noteBox(x, y, arr, anchor, size) {
  const lh = size + 3;
  const maxW = Math.max(...arr.map(l => measureWidth(l, size)));
  const x0 = anchor === 'end' ? x - maxW : anchor === 'middle' ? x - maxW / 2 : x;
  const y0 = y - size * 0.8;
  const h = (arr.length - 1) * lh + size * 1.1;
  return { x0, y0, w: maxW, h };
}

// Curved arrow from (x1,y1) to (x2,y2) with an arrowhead at the tip.
// bend: perpendicular offset of the control point (+ = right of travel).
export function arrow(x1, y1, x2, y2, color = AMBER, bend = 0.25) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const mx = (x1 + x2) / 2 - dy * bend, my = (y1 + y2) / 2 + dx * bend;
  // tangent at the tip of the quadratic = tip minus control point
  const tx = x2 - mx, ty = y2 - my;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl, uy = ty / tl;          // unit tangent into the tip
  const px = -uy, py = ux;                   // unit perpendicular
  const hs = Math.min(9, len * 0.3);         // arrowhead size
  const bx = x2 - ux * hs, by = y2 - uy * hs;
  return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}"` +
         ` fill="none" stroke="${color}" stroke-width="1.8"/>` +
         `<path d="M${x2.toFixed(1)} ${y2.toFixed(1)} L${(bx + px * hs * 0.45).toFixed(1)} ${(by + py * hs * 0.45).toFixed(1)}` +
         ` L${(bx - px * hs * 0.45).toFixed(1)} ${(by - py * hs * 0.45).toFixed(1)} Z" fill="${color}"/>`;
}

// Nearest point on an axis-aligned box border to an external (or internal)
// point — shared by callout() and calloutMulti() so every arrow, however
// many a bubble has, attaches the same way: at the edge, never through the text.
function edgePoint(rx0, ry0, rw, rh, x, y) {
  let ax = Math.max(rx0, Math.min(x, rx0 + rw));
  let ay = Math.max(ry0, Math.min(y, ry0 + rh));
  const insideX = x > rx0 && x < rx0 + rw, insideY = y > ry0 && y < ry0 + rh;
  if (insideX && insideY) { // target sits inside the box — push out along the shortest side
    const dl = x - rx0, dr = rx0 + rw - x, dt = y - ry0, db = ry0 + rh - y;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) ax = rx0; else if (m === dr) ax = rx0 + rw;
    else if (m === dt) ay = ry0; else ay = ry0 + rh;
  }
  return [ax, ay];
}

// Speech-bubble label + arrow pointing at a target (x,y). Text sits at (tx,ty).
// The bubble's box is measured from the *real* rendered text (see noteBox), and
// the arrow leaves from whichever point on the box border is nearest the
// target — so it always starts outside the text and never crosses it.
export function callout(x, y, tx, ty, lines, color = AMBER, anchor = 'start', bend = 0.25, size = 13) {
  const arr = Array.isArray(lines) ? lines : String(lines).split('\n');
  const pad = 7;
  const box = noteBox(tx, ty, arr, anchor, size);
  const rx0 = box.x0 - pad, ry0 = box.y0 - pad, rw = box.w + pad * 2, rh = box.h + pad * 2;
  const [ax, ay] = edgePoint(rx0, ry0, rw, rh, x, y);
  const bubble = `<rect x="${rx0.toFixed(1)}" y="${ry0.toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" rx="7" fill="#0b1220" stroke="${color}" stroke-width="1.3" opacity=".92"/>`;
  return bubble + note(tx, ty, arr, color, anchor, size) + arrow(ax, ay, x, y, color, bend);
}

// One bubble, several arrows — e.g. one explanation pointing at two regions
// of the chart at once. `targets` = [{x, y, bend}, ...]; each arrow attaches
// at whichever edge point is nearest its own target.
export function calloutMulti(targets, tx, ty, lines, color = AMBER, anchor = 'start', size = 13) {
  const arr = Array.isArray(lines) ? lines : String(lines).split('\n');
  const pad = 7;
  const box = noteBox(tx, ty, arr, anchor, size);
  const rx0 = box.x0 - pad, ry0 = box.y0 - pad, rw = box.w + pad * 2, rh = box.h + pad * 2;
  const bubble = `<rect x="${rx0.toFixed(1)}" y="${ry0.toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" rx="7" fill="#0b1220" stroke="${color}" stroke-width="1.3" opacity=".92"/>`;
  let arrows = '';
  targets.forEach(({ x, y, bend = 0.2, color: c = color }) => {
    const [ax, ay] = edgePoint(rx0, ry0, rw, rh, x, y);
    arrows += arrow(ax, ay, x, y, c, bend);
  });
  return bubble + note(tx, ty, arr, color, anchor, size) + arrows;
}

// Dashed ellipse "circled in marker" around a region.
export function ring(cx, cy, rx, ry, color = AMBER) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${color}"` +
         ` stroke-width="2" stroke-dasharray="7 5" opacity=".9"/>`;
}

// Vertical measurement bracket between y1 and y2 at x, with serif end caps.
export function vBracket(x, y1, y2, color = AMBER, cap = 6) {
  return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${color}" stroke-width="2"/>` +
         `<line x1="${x - cap}" y1="${y1}" x2="${x + cap}" y2="${y1}" stroke="${color}" stroke-width="2"/>` +
         `<line x1="${x - cap}" y1="${y2}" x2="${x + cap}" y2="${y2}" stroke="${color}" stroke-width="2"/>`;
}

// Rounded pill of text — used for in-chart term definitions ("what is S?").
export function pill(x, y, text, color = AMBER, anchor = 'middle') {
  const w = text.length * 6.6 + 18;
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return `<rect x="${x0}" y="${y - 13}" width="${w}" height="20" rx="10" fill="#0b1220" stroke="${color}" opacity=".95"/>` +
         `<text x="${x0 + w / 2}" y="${y + 1}" text-anchor="middle" style="fill:${color};font-size:11px;font-weight:700">${text}</text>`;
}
