// popup.js — Singleton popup for structured data display
// API: showPopup(anchorEl, title, rows), hidePopup()
//
// rows: array of descriptors:
//   { label, note?, value? }          — data row; note renders small below label
//   { label, note?, value, total:true }— bold total row with top border
//   { sep: true }                      — horizontal divider
//   { heading: string }                — section heading (no value)

let _el = null;

function _build() {
  _el = document.createElement('div');
  _el.id = 'shared-popup';
  _el.style.cssText =
    'position:fixed;background:#fff;border:1px solid #cbd5e1;border-radius:6px;' +
    'padding:0;width:max-content;max-width:min(560px,92vw);' +
    'max-height:90vh;flex-direction:column;' +
    'box-shadow:0 4px 18px rgba(0,0,0,.14);z-index:400;font-size:12px;display:none;';
  document.body.appendChild(_el);

  let drag = false, ox = 0, oy = 0;
  _el.addEventListener('mousedown', e => {
    if (!e.target.closest('.sp-hdr')) return;
    const r = _el.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    drag = true; e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    _el.style.left = (e.clientX - ox) + 'px';
    _el.style.top  = (e.clientY - oy) + 'px';
  });
  document.addEventListener('mouseup', () => { drag = false; });
  document.addEventListener('click', e => {
    if (_el.style.display !== 'none' && !_el.contains(e.target)) hidePopup();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hidePopup();
  });
}

export function hidePopup() { if (_el) _el.style.display = 'none'; }

let _state = null;

export function showPopup(anchorEl, title, rowsOrBuilder, breadcrumb, initialToggleVal) {
  if (!_el) _build();

  let rows;
  if (typeof rowsOrBuilder === 'function') {
    _state = { anchorEl, title, builder: rowsOrBuilder, breadcrumb, currentToggleVal: initialToggleVal };
    rows = rowsOrBuilder(initialToggleVal);
  } else {
    _state = null;
    rows = rowsOrBuilder;
  }

  const bcHTML = breadcrumb
    ? '<div style="font-size:10px;color:#64748b;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.02em;">' + breadcrumb + '</div>'
    : '';

  // Render rows into 2-column table (label+note | value)
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
                 (opt.active ? 'background:#fff;box-shadow:0 1px 2px rgba(0,0,0,0.1);color:#1e293b;' : 'background:none;color:#64748b;') + '">' +
                 opt.label + '</button>'
               ).join('') +
             '</div></td></tr>';
      continue;
    }
    if (r.heading != null) {
      trs += '<tr><td colspan="2" style="padding:4px 0 2px;font-size:10px;font-weight:700;' +
             'color:#64748b;text-transform:uppercase;letter-spacing:.05em">' + r.heading + '</td></tr>';
      continue;
    }
    if (r.html) {
      trs += '<tr><td colspan="2" style="padding:4px 0">' + r.html + '</td></tr>';
      continue;
    }
    const ts  = r.total
      ? 'font-weight:700;border-top:2px solid #1e293b;padding-top:5px;'
      : '';
    const note = r.note
      ? '<div style="font-size:10px;color:#64748b;margin-top:1px;white-space:normal;max-width:260px">' +
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
  const table = trs
    ? '<table style="border-collapse:collapse;width:auto">' + trs + '</table>'
    : '';

  _el.innerHTML =
    '<div class="sp-hdr" style="display:flex;justify-content:space-between;align-items:center;' +
    'padding:7px 10px 7px 14px;border-bottom:1px solid #e2e8f0;cursor:move;user-select:none">' +
      '<div style="display:flex;flex-direction:column;min-width:0;flex:1">' +
        bcHTML +
        '<span style="font-size:12px;font-weight:700;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + title + '</span>' +
      '</div>' +
      '<button style="background:none;border:none;font-size:18px;color:#94a3b8;cursor:pointer;' +
              'line-height:1;padding:0 0 0 12px;flex-shrink:0" ' +
              'id="sp-close" style="cursor:pointer;background:none;border:none;font-size:18px;color:#94a3b8;padding:0 0 0 12px">×</button>' +
    '</div>' +
    '<div style="padding:10px 14px;overflow-y:auto;flex:1;">' + table + '</div>';

  _el.querySelector('#sp-close').addEventListener('click', hidePopup);
  _el.querySelectorAll('.sp-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (_state && _state.builder) {
        const newVal = btn.dataset.val;
        showPopup(_state.anchorEl, _state.title, _state.builder, _state.breadcrumb, newVal);
      }
    });
  });
  _el.style.display = 'flex';

  // Position: below anchor, clamped to viewport
  const ar = anchorEl.getBoundingClientRect();
  const pw = _el.offsetWidth, ph = _el.offsetHeight;
  let left = ar.left;
  let top  = ar.bottom + 6;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, ar.top - ph - 6);
  left = Math.min(left, window.innerWidth - pw - 8);
  left = Math.max(8, left);
  _el.style.left = left + 'px';
  _el.style.top  = top  + 'px';
}
