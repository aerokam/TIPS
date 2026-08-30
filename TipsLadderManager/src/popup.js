// popup.js — Draggable + resizable popup(s) for structured data display.
// API: showPopup(anchorEl, title, rows), hidePopup()
//
// rows: array of descriptors:
//   { label, note?, value? }          — data row; note renders small below label
//   { label, note?, value, total:true }— bold total row with top border
//   { sep: true }                      — horizontal divider
//   { heading: string }                — section heading (no value)
//   { html: string }                   — raw HTML row (e.g. an embedded sub-table or visual)
//   { prose: string }                  — a paragraph of explanatory text, wrapped to a readable
//                                        measure rather than the popup's full width
//
// Two instances, both draggable/resizable per the app-wide standard (modal.js):
// `primary` opens from table cells / info-links; `secondary` opens when the triggering
// anchor is itself inside the primary popup (a nested "Level 3" drill, e.g. clicking a gap
// year inside the Gap Duration popup) — so drilling into one item doesn't close the popup
// you drilled down from, and you can click through several nested items in a row.

import { makeDraggableResizable } from './modal.js';

const RESIZE_HANDLES =
  '<div class="resize-handle n"></div><div class="resize-handle s"></div>' +
  '<div class="resize-handle e"></div><div class="resize-handle w"></div>' +
  '<div class="resize-handle nw"></div><div class="resize-handle ne"></div>' +
  '<div class="resize-handle sw"></div><div class="resize-handle se"></div>';

function _renderTable(rows) {
  let trs = '';
  for (const r of rows) {
    if (r.sep) {
      trs += '<tr><td colspan="2" style="padding:2px 0">' +
             '<hr style="border:none;border-top:1px dashed #e2e8f0;margin:0"></td></tr>';
      continue;
    }
    if (r.toggle) {
      trs += '<tr><td colspan="2" style="padding:4px 0">' +
             '<div style="display:flex;background:#f1f5f9;border-radius:4px;padding:2px;gap:2px;">' +
               r.toggle.options.map(opt =>
                 '<button class="sp-toggle-btn" data-val="' + opt.value + '" ' +
                 'style="flex:1;border:none;border-radius:3px;padding:3px 0;font-size:10px;font-weight:700;cursor:pointer;' +
                 (opt.active ? 'background:#fff;box-shadow:0 1px 2px rgba(0,0,0,0.1);color:#1e293b;' : 'background:none;color:#334155;') + '">' +
                 opt.label + '</button>'
               ).join('') +
             '</div></td></tr>';
      continue;
    }
    if (r.heading != null) {
      trs += '<tr><td colspan="2" style="padding:4px 0 2px;font-size:10px;font-weight:700;' +
             'color:#334155;text-transform:uppercase;letter-spacing:.05em">' + r.heading + '</td></tr>';
      continue;
    }
    if (r.html) {
      trs += '<tr><td colspan="2" style="padding:4px 0">' + r.html + '</td></tr>';
      continue;
    }
    // Prose sets its own measure. The popup is width:max-content, so without a bound a paragraph
    // lays out as one long line and pushes the popup to its 560px maximum; 34em at this font size
    // is roughly 70 characters, the width prose is comfortable to read at.
    if (r.prose) {
      trs += '<tr><td colspan="2" style="padding:4px 0">' +
             '<div style="max-width:34em;line-height:1.5;white-space:normal">' + r.prose +
             '</div></td></tr>';
      continue;
    }
    const ts  = r.total
      ? 'font-weight:700;border-top:2px solid #1e293b;padding-top:5px;'
      : '';
    const note = r.note
      ? '<div style="font-size:10px;color:#334155;margin-top:1px;white-space:normal;">' +
        r.note + '</div>'
      : '';
    const val = r.value != null ? String(r.value) : '';
    trs +=
      '<tr>' +
      '<td style="padding:3px 20px 3px 0;vertical-align:top;white-space:nowrap;' + ts + '">' +
        r.label + note +
      '</td>' +
      '<td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums;' +
          'white-space:nowrap;vertical-align:top;' + ts + '">' + val + '</td>' +
      '</tr>';
  }
  return trs
    ? '<table style="border-collapse:collapse;width:auto">' + trs + '</table>'
    : '';
}

function _makeInstance(id, zIndex) {
  const el = document.createElement('div');
  el.id = id;
  el.style.cssText =
    'position:fixed;background:#fff;border:1px solid #cbd5e1;border-radius:6px;' +
    'padding:0;width:max-content;max-width:min(560px,92vw);' +
    'max-height:90vh;flex-direction:column;' +
    'box-shadow:0 4px 18px rgba(0,0,0,.14);z-index:' + zIndex + ';font-size:12px;display:none;';
  el.innerHTML =
    '<div class="sp-hdr" style="display:flex;justify-content:space-between;align-items:center;' +
    'padding:7px 10px 7px 14px;border-bottom:1px solid #e2e8f0;cursor:move;user-select:none">' +
      '<div style="display:flex;flex-direction:column;min-width:0;flex:1">' +
        '<div class="sp-breadcrumb" style="font-size:10px;color:#334155;margin-bottom:2px;' +
             'text-transform:uppercase;letter-spacing:0.02em;display:none;"></div>' +
        '<span class="sp-title" style="font-size:12px;font-weight:700;color:#1e293b;' +
              'white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></span>' +
      '</div>' +
      '<button id="sp-close" style="cursor:pointer;background:none;border:none;font-size:18px;' +
              'color:#94a3b8;padding:0 0 0 12px">×</button>' +
    '</div>' +
    '<div class="sp-body" style="padding:10px 14px;overflow-y:auto;flex:1;"></div>' +
    RESIZE_HANDLES;
  document.body.appendChild(el);

  makeDraggableResizable(el, el.querySelector('.sp-hdr'), { minWidth: 260, minHeight: 120 });

  let openAnchor = null;
  let state = null;

  function hide() { el.style.display = 'none'; openAnchor = null; }

  el.querySelector('#sp-close').addEventListener('click', hide);
  el.querySelector('.sp-body').addEventListener('click', e => {
    const btn = e.target.closest('.sp-toggle-btn');
    if (btn && state && state.builder) {
      const newVal = btn.dataset.val;
      inst.show(state.anchorEl, state.title, state.builder, state.breadcrumb, newVal);
    }
  });

  const inst = {
    el,
    hide,
    get openAnchor() { return openAnchor; },
    show(anchorEl, title, rowsOrBuilder, breadcrumb, initialToggleVal) {
      openAnchor = anchorEl;

      let rows;
      if (typeof rowsOrBuilder === 'function') {
        state = { anchorEl, title, builder: rowsOrBuilder, breadcrumb, currentToggleVal: initialToggleVal };
        rows = rowsOrBuilder(initialToggleVal);
      } else {
        state = null;
        rows = rowsOrBuilder;
      }

      const bcEl = el.querySelector('.sp-breadcrumb');
      if (breadcrumb) { bcEl.style.display = 'block'; bcEl.textContent = breadcrumb; }
      else { bcEl.style.display = 'none'; bcEl.textContent = ''; }
      el.querySelector('.sp-title').textContent = title;
      el.querySelector('.sp-body').innerHTML = _renderTable(rows);
      el.style.display = 'flex';

      // Position: below anchor, clamped to viewport
      const ar = anchorEl.getBoundingClientRect();
      const pw = el.offsetWidth, ph = el.offsetHeight;
      let left = ar.left;
      let top  = ar.bottom + 6;
      if (top + ph > window.innerHeight - 8) top = Math.max(8, ar.top - ph - 6);
      left = Math.min(left, window.innerWidth - pw - 8);
      left = Math.max(8, left);
      el.style.left = left + 'px';
      el.style.top  = top  + 'px';
    },
  };
  return inst;
}

const primary   = _makeInstance('shared-popup', 400);
const secondary = _makeInstance('shared-popup-l3', 401); // renders above primary when both are open

// A drag or resize that starts on a popup and ends past its edge still fires a click, and that
// click’s target is the nearest common ancestor of press and release — the document body. That
// reads as an outside click and would close the popup mid-resize, so where the press started is
// what decides, not where it ended.
let _pressStartedInside = false;
document.addEventListener('mousedown', e => {
  _pressStartedInside = primary.el.contains(e.target) || secondary.el.contains(e.target);
}, true);

// Outside-click closes an instance, but a click landing in the *other* instance never counts
// as "outside" — so clicking inside the nested (secondary) popup never closes the primary one
// it drilled down from, and vice versa.
document.addEventListener('click', e => {
  if (_pressStartedInside) { _pressStartedInside = false; return; }
  if (secondary.el.style.display !== 'none' && !secondary.el.contains(e.target)
      && !primary.el.contains(e.target) && e.target !== secondary.openAnchor) secondary.hide();
  if (primary.el.style.display !== 'none' && !primary.el.contains(e.target)
      && !secondary.el.contains(e.target) && e.target !== primary.openAnchor) hidePopup();
}, true);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hidePopup();
});

export function hidePopup() { secondary.hide(); primary.hide(); }

export function showPopup(anchorEl, title, rowsOrBuilder, breadcrumb, initialToggleVal) {
  const nested = !!(anchorEl && primary.el.contains(anchorEl));
  if (!nested) secondary.hide(); // a fresh primary popup invalidates any nested popup drilled from the old one
  const inst = nested ? secondary : primary;
  inst.show(anchorEl, title, rowsOrBuilder, breadcrumb, initialToggleVal);
}
