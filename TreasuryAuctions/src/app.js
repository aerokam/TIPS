// Treasury Auctions - app.js

const R2_CSV_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/Auctions.csv';
const TENTATIVE_TIPS_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/tentative_tips.json';
const TENTATIVE_XML_URL = 'https://home.treasury.gov/system/files/221/Tentative-Auction-Schedule.xml';
// If CORS fails for direct XML, we may need an R2 mirror. For now we attempt direct.

const UPCOMING_BASE_URL =
  'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/upcoming_auctions' +
  '?format=csv&fields=cusip,announcemt_date,auction_date,issue_date,security_term,security_type,reopening' +
  '&sort=announcemt_date,auction_date';

function upcomingUrl() {
  const today = new Date().toISOString().substring(0, 10);
  return `${UPCOMING_BASE_URL}&filter=auction_date:gte:${today}`;
}

// ── Default column sets per view ──────────────────────────────────────────────
// Fields the user confirmed from their two FiscalData URLs, plus reasonable
// defaults for Bills and Notes/Bonds. All fields remain available in the
// column chooser regardless of view.

const DEFAULT_COLS = {
  all: [
    'cusip','security_type','security_term','announcemt_date','dated_date',
    'auction_date','issue_date','maturity_date','int_rate','high_investment_rate',
    'high_yield','high_price','accrued_int_per1000','reopening',
    'inflation_index_security','original_security_term','closing_time_comp',
  ],
  bills: [
    'cusip','security_term','announcemt_date','auction_date','issue_date',
    'maturity_date','high_investment_rate','high_yield','high_price',
    'offering_amt','reopening','original_security_term','closing_time_comp',
  ],
  notesbonds: [
    'cusip','security_type','security_term','original_security_term',
    'announcemt_date','dated_date','auction_date','issue_date','maturity_date',
    'int_rate','high_yield','high_price','accrued_int_per1000',
    'offering_amt','reopening','inflation_index_security','closing_time_comp',
  ],
  tips: [
    'cusip','security_term','announcemt_date','dated_date','auction_date',
    'issue_date','maturity_date','int_rate','high_yield','unadj_price',
    'adj_price','offering_amt','adj_accrued_int_per1000','ref_cpi_on_dated_date',
    'ref_cpi_on_issue_date','index_ratio_on_issue_date','reopening',
    'original_security_term',
  ],
};

// ── View row filters ──────────────────────────────────────────────────────────
const VIEW_FILTER = {
  all:       null,
  bills:     r => r.security_type === 'Bill',
  notesbonds:r => r.security_type !== 'Bill' && r.inflation_index_security !== 'Yes',
  tips:      r => r.inflation_index_security === 'Yes',
};

// ── Pretty column labels ──────────────────────────────────────────────────────
const FIELD_LABELS = {
  cusip: 'CUSIP', security_type: 'Type', security_term: 'Term',
  announcemt_date: 'Announced', dated_date: 'Dated Date',
  auction_date: 'Auction Date', issue_date: 'Issue Date',
  maturity_date: 'Maturity', original_security_term: 'Orig Term',
  int_rate: 'Coupon', high_investment_rate: 'High Inv Rate',
  high_yield: 'High Yield', low_yield: 'Low Yield',
  avg_med_yield: 'Avg/Med Yield', avg_med_investment_rate: 'Avg/Med Inv Rate',
  high_price: 'High Price', low_price: 'Low Price', avg_med_price: 'Avg/Med Price',
  accrued_int_per1000: 'Accrued/$1K', reopening: 'Reopen',
  inflation_index_security: 'TIPS', closing_time_comp: 'Close Time (Comp)',
  closing_time_noncomp: 'Close Time (Noncomp)',
  unadj_price: 'Unadj Price', adj_price: 'Adj Price',
  offering_amt: 'Offering Amt', adj_accrued_int_per1000: 'Adj Accrued/$1K',
  ref_cpi_on_dated_date: 'Ref CPI (Dated)', ref_cpi_on_issue_date: 'Ref CPI (Issue)',
  index_ratio_on_issue_date: 'Index Ratio',
  bid_to_cover_ratio: 'Bid/Cover',
  comp_accepted: 'Comp Accepted', comp_tendered: 'Comp Tendered',
  noncomp_accepted: 'Noncomp Accepted', noncomp_tendered: 'Noncomp Tendered',
  total_accepted: 'Total Accepted', total_tendered: 'Total Tendered',
  primary_dealer_accepted: 'Primary Dealer Acc', primary_dealer_tendered: 'Primary Dealer Ten',
  direct_bidder_accepted: 'Direct Bidder Acc', direct_bidder_tendered: 'Direct Bidder Ten',
  indirect_bidder_accepted: 'Indirect Bidder Acc', indirect_bidder_tendered: 'Indirect Bidder Ten',
  frn_index_determination_date: 'FRN Index Date', frn_index_determination_rate: 'FRN Index Rate',
  lut_dt: 'Last Updated',
};

function fieldLabel(f) {
  return FIELD_LABELS[f] || f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Format detection by field name ────────────────────────────────────────────
function detectFmt(f) {
  if (f.includes('cpi')) return 'num5';
  if (f.endsWith('_date') || f.endsWith('_dt')) return 'date';
  if (f.includes('_rate') || f.includes('_yield')) return 'pct3';
  if (f.includes('price')) return 'num6';
  if (f === 'bid_to_cover_ratio') return 'num2';
  if (f.includes('ratio')) return 'num5';
  if (f.includes('accrued')) return 'num6';
  if (f.includes('amt') || f.includes('accepted') || f.includes('tendered')) return 'amt';
  return null;
}

function fmtVal(v, fmt) {
  if (v === '' || v == null) return '';
  const n = parseFloat(v);
  switch (fmt) {
    case 'date': if (v.length >= 10) { const [y,m,d] = v.substring(0,10).split('-'); return `${m}/${d}/${y}`; } return v;
    case 'pct3': return isNaN(n) ? v : n.toFixed(3) + '%';
    case 'num2': return isNaN(n) ? v : n.toFixed(2);
    case 'num3': return isNaN(n) ? v : n.toFixed(3);
    case 'num4': return isNaN(n) ? v : n.toFixed(4);
    case 'num5': return isNaN(n) ? v : n.toFixed(5);
    case 'num6': return isNaN(n) ? v : n.toFixed(6);
    case 'amt':  return isNaN(n) ? v : n.toLocaleString();
    default:     return v;
  }
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = splitLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

function splitLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// ── State ─────────────────────────────────────────────────────────────────────
let allData = [];
let allColumns = [];           // all column names from CSV, in CSV order
let activeView = 'all';
let sortCol = null;
let sortAsc = false;
let filters = {};              // field -> filter string
let dateFrom = '';
let dateTo = '';
let tentativeAuctions = [];    // Parsed from Treasury's Tentative Auction Schedule XML
let tentSortCol = null;
let tentSortAsc = true;
let tentFilters = {};

let orderedColumns = { all: [], bills: [], notesbonds: [], tips: [] };
let colWidths = {};           // field -> width (px)

const ROW_LIMIT = 100;        // default cap for non-TIPS views when no date range set

// Per-view visible column sets (starts as defaults, user-adjustable)
const viewCols = {
  all:        new Set(DEFAULT_COLS.all),
  bills:      new Set(DEFAULT_COLS.bills),
  notesbonds: new Set(DEFAULT_COLS.notesbonds),
  tips:       new Set(DEFAULT_COLS.tips),
};

// ── Status ────────────────────────────────────────────────────────────────────
function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
}

// ── Sidebar: column chooser ───────────────────────────────────────────────────
function renderColList() {
  const search = document.getElementById('colSearch').value.toLowerCase();
  const visible = viewCols[activeView];
  const list = document.getElementById('colList');

  // Use the specific order for the active view
  const cols = orderedColumns[activeView];

  list.innerHTML = cols.map(f => {
    const label = fieldLabel(f);
    const hidden = search && !label.toLowerCase().includes(search) && !f.toLowerCase().includes(search);
    const checked = visible.has(f);
    return `<div class="col-item${hidden ? ' hidden' : ''}" data-field="${f}" draggable="true">
      <input type="checkbox" id="col_${f}" ${checked ? 'checked' : ''}>
      <label for="col_${f}">${label}</label>
    </div>`;
  }).join('');

  // Drag-and-drop logic for reordering
  let draggedField = null;

  list.querySelectorAll('.col-item').forEach(el => {
    el.addEventListener('dragstart', e => {
      draggedField = el.dataset.field;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const targetField = el.dataset.field;
      if (draggedField && draggedField !== targetField) {
        const arr = orderedColumns[activeView];
        const fromIdx = arr.indexOf(draggedField);
        const toIdx = arr.indexOf(targetField);
        arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, draggedField);
        renderColList();
        renderTable();
      }
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      draggedField = null;
    });

    // Checkbox change logic
    const cb = el.querySelector('input');
    cb.addEventListener('change', e => {
      const f = el.dataset.field;
      if (e.target.checked) viewCols[activeView].add(f);
      else viewCols[activeView].delete(f);
      renderTable();
    });
  });
}

// ── Active/filtered data ──────────────────────────────────────────────────────
function getActiveRows() {
  const filter = VIEW_FILTER[activeView];
  let rows = filter ? allData.filter(filter) : allData;

  // Apply date range filter on auction_date
  if (dateFrom) rows = rows.filter(r => r.auction_date >= dateFrom);
  if (dateTo)   rows = rows.filter(r => r.auction_date <= dateTo);

  // Apply column filters
  const activeFilters = Object.entries(filters).filter(([, v]) => v.trim());
  if (activeFilters.length) {
    rows = rows.filter(r =>
      activeFilters.every(([f, v]) => {
        const val = (r[f] || '').toString().toLowerCase();
        const filterStr = v.trim().toLowerCase();

        // Support range filters: >, <, >=, <=
        const match = filterStr.match(/^(>=|<=|>|<)(.*)$/);
        if (match) {
          const op = match[1];
          const target = match[2].trim();
          const rVal = r[f];
          if (rVal === '' || rVal == null) return false;

          // If it's a date field or target looks like a date
          if (detectFmt(f) === 'date' || /^\d{4}-\d{2}-\d{2}$/.test(target)) {
            const rowDate = rVal.substring(0, 10);
            if (op === '>') return rowDate > target;
            if (op === '<') return rowDate < target;
            if (op === '>=') return rowDate >= target;
            if (op === '<=') return rowDate <= target;
          }

          // Numeric comparison
          const nRow = parseFloat(rVal);
          const nTarget = parseFloat(target);
          if (!isNaN(nRow) && !isNaN(nTarget)) {
            if (op === '>') return nRow > nTarget;
            if (op === '<') return nRow < nTarget;
            if (op === '>=') return nRow >= nTarget;
            if (op === '<=') return nRow <= nTarget;
          }
        }

        return val.includes(filterStr);
      })
    );
  }

  // Sort
  if (sortCol !== null) {
    const field = sortCol;
    const fmt = detectFmt(field);
    const isNumeric = fmt && fmt !== 'date' && fmt !== null;
    rows = [...rows].sort((a, b) => {
      const av = a[field] ?? '';
      const bv = b[field] ?? '';
      if (isNumeric) {
        const na = parseFloat(av);
        const nb = parseFloat(bv);
        const aEmpty = av === '' || isNaN(na);
        const bEmpty = bv === '' || isNaN(nb);
        if (aEmpty && bEmpty) return 0;
        if (aEmpty) return 1;
        if (bEmpty) return -1;
        const cmp = na - nb;
        return sortAsc ? cmp : -cmp;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
  }

  // Pagination: cap at ROW_LIMIT unless TIPS view or date range is active
  const totalRows = rows.length;
  const capped = activeView !== 'tips' && !dateFrom && !dateTo;
  const displayRows = capped ? rows.slice(0, ROW_LIMIT) : rows;

  return { displayRows, totalRows, capped };
}

// ── Sticky Header Helpers ───────────────────────────────────────────────────
function updateFilterRowSticky() {
  const thead = document.getElementById('mainThead');
  if (!thead) return;
  const hdr = thead.querySelector('tr:first-child');
  const filterRow = thead.querySelector('.filter-row');
  if (hdr && filterRow) {
    const h = hdr.offsetHeight;
    filterRow.querySelectorAll('td').forEach(td => {
      td.style.top = h + 'px';
    });
  }
}

// Global ResizeObserver to handle header wrapping
const headerObserver = new ResizeObserver(() => updateFilterRowSticky());

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable() {
  const cols = (orderedColumns[activeView] || []).filter(f => viewCols[activeView].has(f));
  const rows = getActiveRows();

  // Header row + filter row
  const thead = document.getElementById('mainThead');
  headerObserver.disconnect();

  thead.innerHTML = `
    <tr>
      ${cols.map(f => {
        const cls = sortCol === f ? (sortAsc ? 'sort-asc' : 'sort-desc') : '';
        const width = colWidths[f] ? `style="width:${colWidths[f]}px;min-width:${colWidths[f]}px;"` : '';
        return `<th class="${cls}" data-field="${f}" ${width}>
          <span class="col-delete" title="Remove column">✕</span>
          ${fieldLabel(f)}
          <div class="resizer"></div>
        </th>`;
      }).join('')}
    </tr>
    <tr class="filter-row">
      ${cols.map(f => {
        const val = filters[f] || '';
        const width = colWidths[f] ? `style="width:${colWidths[f]}px;min-width:${colWidths[f]}px;"` : '';
        return `<td ${width}><input class="filter-input${val ? ' active' : ''}" type="text" data-field="${f}" value="${val}" placeholder="…" size="1"></td>`;
      }).join('')}
    </tr>
  `;

  // Start observing the new header row for height changes
  const firstRow = thead.querySelector('tr:first-child');
  if (firstRow) headerObserver.observe(firstRow);

  // Fix filter row sticky top after header renders
  requestAnimationFrame(() => {
    updateFilterRowSticky();
    initResizing();
  });

  // Sort click handlers on header cells
  thead.querySelectorAll('th[data-field]').forEach(th => {
    th.draggable = true;
    th.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', th.dataset.field);
      th.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    th.addEventListener('dragover', e => {
      e.preventDefault();
      th.classList.add('drag-over');
    });
    th.addEventListener('dragleave', () => th.classList.remove('drag-over'));
    th.addEventListener('drop', e => {
      e.preventDefault();
      th.classList.remove('drag-over');
      const draggedField = e.dataTransfer.getData('text/plain');
      const targetField = th.dataset.field;
      if (draggedField && draggedField !== targetField) {
        const arr = orderedColumns[activeView];
        const fromIdx = arr.indexOf(draggedField);
        const toIdx = arr.indexOf(targetField);
        arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, draggedField);
        renderTable();
        renderColList(); // Sync sidebar
      }
    });
    th.addEventListener('dragend', () => th.classList.remove('dragging'));

    th.addEventListener('click', e => {
      if (e.target.classList.contains('resizer')) return;
      if (e.target.classList.contains('col-delete')) {
        const f = th.dataset.field;
        viewCols[activeView].delete(f);
        renderTable();
        renderColList();
        return;
      }
      const f = th.dataset.field;
      if (sortCol === f) sortAsc = !sortAsc;
      else { sortCol = f; sortAsc = true; }
      renderTable();
    });
  });

  // Filter input handlers (debounced)
  let debounceTimer;
  thead.querySelectorAll('.filter-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const f = e.target.dataset.field;
      const v = e.target.value;
      filters[f] = v;
      e.target.classList.toggle('active', !!v);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => renderBody(cols), 200);
    });
  });

  renderBody(cols);
}

function renderBody(cols) {
  const { displayRows, totalRows, capped } = getActiveRows();
  const tbody = document.getElementById('mainTbody');
  let band = 0, lastDate = null;
  tbody.innerHTML = displayRows.map(r => {
    const d = r.auction_date || '';
    if (d !== lastDate) { lastDate = d; band = 1 - band; }
    const cls = band === 1 ? ' class="row-band-b"' : '';
    return `<tr${cls}>${cols.map(f => {
      const width = colWidths[f] ? `style="width:${colWidths[f]}px;min-width:${colWidths[f]}px;"` : '';
      return `<td data-field="${f}" ${width}>${fmtVal(r[f], detectFmt(f))}</td>`;
    }).join('')}</tr>`;
  }).join('');
  const countEl = document.getElementById('row-count');
  if (capped) {
    countEl.innerHTML = `<span style="color:#f59e0b;font-weight:600;">Showing ${ROW_LIMIT} of ${totalRows.toLocaleString()} rows — use date range to see more</span>`;
  } else {
    countEl.textContent = `${displayRows.length.toLocaleString()} rows`;
  }
}

// ── Render upcoming ───────────────────────────────────────────────────────────
function renderUpcoming(csvText) {
  const tbody = document.getElementById('upcoming-tbody');
  const thead = document.getElementById('upcoming-thead');
  if (!csvText) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td style="padding:8px 10px;color:#64748b;font-style:italic;">No upcoming auction data available.</td></tr>';
    return;
  }
  let { headers, rows } = parseCSV(csvText);
  if (!rows.length) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td style="padding:8px 10px;color:#64748b;font-style:italic;">No upcoming auctions found.</td></tr>';
    return;
  }

  // Cross-reference with Tentative Schedule and identify TIPS
  const extendedHeaders = [...headers, 'inflation_index_security'];
  rows.forEach(r => {
    const rDate = (r.auction_date || '').trim();
    const rTerm = (r.security_term || '').toLowerCase().trim();
    const isActuallyTips = (r.security_type || '').toLowerCase().includes('tips');

    const isTentativeTips = tentativeAuctions.some(t => {
      const tDate = (t.auction_date || '').trim();
      const tTerm = (t.security_term || '').toLowerCase().trim();
      return tDate === rDate && tTerm === rTerm && t.tips === 'Yes';
    });

    r.inflation_index_security = (isActuallyTips || isTentativeTips) ? 'Yes' : 'No';
  });

  thead.innerHTML = extendedHeaders.map(f => `<th>${fieldLabel(f)}</th>`).join('');
  let band = 0, lastDate = null;
  tbody.innerHTML = rows.map(r => {
    const d = r.auction_date || '';
    if (d !== lastDate) { lastDate = d; band = 1 - band; }
    const cls = band === 1 ? ' class="row-band-b"' : '';
    return `<tr${cls}>${extendedHeaders.map(f => {
      const val = r[f];
      const fmt = detectFmt(f);
      let cellClass = '';
      if (f === 'inflation_index_security' && val === 'Yes') {
        cellClass = ' style="color:#059669;font-weight:600;"';
      }
      return `<td${cellClass}>${fmtVal(val, fmt)}</td>`;
    }).join('')}</tr>`;
  }).join('');
}

function tentWeekKey(dateStr) {
  let d;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) d = new Date(dateStr + 'T00:00:00');
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(dateStr)) {
    const [m, day, y] = dateStr.split('/');
    d = new Date(+y, +m - 1, +day);
  } else return dateStr;
  if (isNaN(d.getTime())) return dateStr;
  const dow = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - ((dow + 6) % 7)); // back to Monday
  return d.toISOString().substring(0, 10);
}

// ── Tentative table fields ────────────────────────────────────────────────────
const TENT_FIELDS = [
  { key: 'auction_date',      label: 'Auction Date' },
  { key: 'security_term',     label: 'Term' },
  { key: 'security_type',     label: 'Type' },
  { key: 'reopening',         label: 'Reopen' },
  { key: 'tips',              label: 'TIPS' },
  { key: 'announcement_date', label: 'Announcement Date' },
  { key: 'settlement_date',   label: 'Settlement Date' },
];

// ── Render Tentative Schedule ────────────────────────────────────────────────
function renderTentative() {
  const tbody = document.getElementById('tentative-tbody');
  const thead = document.getElementById('tentative-thead');

  if (!tentativeAuctions.length) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="7" style="padding:20px; color:#64748b; font-style:italic; text-align:center;">No tentative schedule data available.</td></tr>';
    return;
  }

  thead.innerHTML = `
    <tr>
      ${TENT_FIELDS.map(f => {
        const cls = tentSortCol === f.key ? (tentSortAsc ? 'sort-asc' : 'sort-desc') : '';
        return `<th class="${cls}" data-field="${f.key}">${f.label}</th>`;
      }).join('')}
    </tr>
    <tr class="filter-row">
      ${TENT_FIELDS.map(f => {
        const val = tentFilters[f.key] || '';
        return `<td><input class="filter-input${val ? ' active' : ''}" type="text" data-field="${f.key}" value="${val}" placeholder="…" size="1"></td>`;
      }).join('')}
    </tr>
  `;

  // Sort click handlers
  thead.querySelectorAll('th[data-field]').forEach(th => {
    th.addEventListener('click', () => {
      const f = th.dataset.field;
      if (tentSortCol === f) tentSortAsc = !tentSortAsc;
      else { tentSortCol = f; tentSortAsc = true; }
      renderTentative();
    });
  });

  // Filter input handlers (debounced)
  let debounceTimer;
  thead.querySelectorAll('.filter-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const f = e.target.dataset.field;
      tentFilters[f] = e.target.value;
      e.target.classList.toggle('active', !!e.target.value);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(renderTentBody, 200);
    });
  });

  // Fix filter row sticky top
  requestAnimationFrame(() => {
    const hdr = thead.querySelector('tr:first-child');
    const filterRow = thead.querySelector('.filter-row');
    if (hdr && filterRow) {
      const h = hdr.offsetHeight;
      filterRow.querySelectorAll('td').forEach(td => { td.style.top = h + 'px'; });
    }
  });

  renderTentBody();
}

function renderTentBody() {
  const tbody = document.getElementById('tentative-tbody');

  // Exclude FRNs, then apply column filters
  let rows = tentativeAuctions.filter(a => a.floating_rate !== 'Yes');
  const activeFilters = Object.entries(tentFilters).filter(([, v]) => v.trim());
  if (activeFilters.length) {
    rows = rows.filter(r =>
      activeFilters.every(([f, v]) =>
        (r[f] || '').toLowerCase().includes(v.trim().toLowerCase())
      )
    );
  }

  // Sort
  if (tentSortCol) {
    const field = tentSortCol;
    rows = [...rows].sort((a, b) => {
      const av = a[field] ?? '';
      const bv = b[field] ?? '';
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return tentSortAsc ? cmp : -cmp;
    });
  }

  // Band by auction_date change
  let band = 0, lastDate = null;
  tbody.innerHTML = rows.map(node => {
    const d = node.auction_date;
    if (d !== lastDate) { lastDate = d; band = 1 - band; }
    const cls = band === 1 ? ' class="row-band-b"' : '';
    let rowHtml = `<tr${cls}>`;
    TENT_FIELDS.forEach(f => {
      const val = node[f.key];
      let cellStyle = '';
      if (f.key === 'tips' && val === 'Yes') cellStyle = ' style="color:#059669; font-weight:600;"';
      rowHtml += `<td${cellStyle}>${val}</td>`;
    });
    rowHtml += '</tr>';
    return rowHtml;
  }).join('');
}

// ── Load data ─────────────────────────────────────────────────────────────────
async function loadData() {
  setStatus('Fetching data...');

  const R2_XML_MIRROR = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/Tentative-Auction-Schedule.xml';

  const [csvResult, upcomingResult, xmlResult] = await Promise.allSettled([
    fetch(R2_CSV_URL, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`R2 HTTP ${r.status}`); return r.text(); }),
    fetch(upcomingUrl(), { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`Upcoming HTTP ${r.status}`); return r.text(); }),
    fetch(R2_XML_MIRROR, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`XML HTTP ${r.status}`); return r.text(); }),
  ]);

  if (xmlResult.status === 'fulfilled') {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlResult.value, 'text/xml');
      const nodes = xmlDoc.getElementsByTagName('AuctionCalendarDate');
      tentativeAuctions = Array.from(nodes).map(node => ({
        auction_date: node.getElementsByTagName('AuctionDate')[0]?.textContent || '',
        security_term: node.getElementsByTagName('SecurityTermWeekYear')[0]?.textContent || '',
        security_type: node.getElementsByTagName('SecurityType')[0]?.textContent || '',
        reopening: node.getElementsByTagName('ReOpeningIndicator')[0]?.textContent === 'Y' ? 'Yes' : 'No',
        tips: node.getElementsByTagName('TIPS')[0]?.textContent === 'Y' ? 'Yes' : 'No',
        floating_rate: node.getElementsByTagName('FloatingRate')[0]?.textContent === 'Y' ? 'Yes' : 'No',
        announcement_date: node.getElementsByTagName('AnnouncementDate')[0]?.textContent || '',
        settlement_date: node.getElementsByTagName('SettlementDate')[0]?.textContent || '',
      }))
      .filter(a => a.auction_date.trim() !== '') // Remove blank rows
      .sort((a, b) => a.auction_date < b.auction_date ? -1 : a.auction_date > b.auction_date ? 1 : 0); // Sort by date
    } catch (err) {
      console.warn('Error parsing tentative XML:', err);
    }
  }

  if (csvResult.status === 'fulfilled') {
    const { headers, rows } = parseCSV(csvResult.value);
    allColumns = headers;
    allData = rows;
    ['all', 'bills', 'notesbonds', 'tips'].forEach(v => {
      if (!orderedColumns[v].length) orderedColumns[v] = [...allColumns];
    });
    renderColList();
    renderTable();
  } else {
    setStatus(`Failed to load auction data: ${csvResult.reason}`, true);
    console.error(csvResult.reason);
    return;
  }

  renderUpcoming(upcomingResult.status === 'fulfilled' ? upcomingResult.value : null);
  if (upcomingResult.status === 'rejected') console.warn('Upcoming fetch failed:', upcomingResult.reason);

  setStatus(`Updated: ${new Date().toLocaleTimeString()}`);
}

// ── Resizing Logic ───────────────────────────────────────────────────────────
let isResizing = false;
let startX, startWidth, resizerField;

function initResizing() {
  const resizers = document.querySelectorAll('.resizer');
  resizers.forEach(resizer => {
    resizer.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation(); // prevent sort
      isResizing = true;
      resizerField = resizer.parentElement.dataset.field;
      startX = e.pageX;
      startWidth = resizer.parentElement.offsetWidth;
      document.body.style.cursor = 'col-resize';
    });

    resizer.addEventListener('dblclick', e => {
      e.stopPropagation();
      const field = resizer.parentElement.dataset.field;
      delete colWidths[field];
      renderTable();
    });
  });
}

window.addEventListener('mousemove', e => {
  if (!isResizing) return;
  const width = Math.max(30, startWidth + (e.pageX - startX));
  colWidths[resizerField] = width;

  // Real-time update ONLY table cells in this column for smooth feel
  const cells = document.querySelectorAll(`th[data-field="${resizerField}"], td[data-field="${resizerField}"]`);
  cells.forEach(c => {
    c.style.width = width + 'px';
    c.style.minWidth = width + 'px';
  });
});

window.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    document.body.style.cursor = '';
    renderTable(); // finalized re-render
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  // View tab buttons
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeView = btn.dataset.view;
      filters = {};
      sortCol = null;
      sortAsc = false;
      dateFrom = ''; dateTo = '';
      document.getElementById('dateFrom').value = '';
      document.getElementById('dateTo').value = '';
      renderColList();
      renderTable();
    });
  });

  // Column search
  document.getElementById('colSearch').addEventListener('input', renderColList);

  // Sort Selected
  document.getElementById('sortSelectedBtn').addEventListener('click', () => {
    const visible = viewCols[activeView];
    orderedColumns[activeView].sort((a, b) => {
      const aVis = visible.has(a);
      const bVis = visible.has(b);
      if (aVis && !bVis) return -1;
      if (!aVis && bVis) return 1;
      return 0;
    });
    renderColList();
    renderTable();
  });

  // Reset defaults
  document.getElementById('resetColsBtn').addEventListener('click', () => {
    viewCols[activeView] = new Set(DEFAULT_COLS[activeView]);
    orderedColumns[activeView] = [...allColumns]; // reset to original order
    colWidths = {}; // clear widths
    renderColList();
    renderTable();
  });

  // Clear filters
  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    filters = {};
    renderTable();
  });

  // Date range
  document.getElementById('dateFrom').addEventListener('change', e => { dateFrom = e.target.value; renderTable(); });
  document.getElementById('dateTo').addEventListener('change', e => { dateTo = e.target.value; renderTable(); });
  document.getElementById('clearDateBtn').addEventListener('click', () => {
    dateFrom = ''; dateTo = '';
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    renderTable();
  });

  // Tab switching
  document.getElementById('tabHeader').addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    
    const tabName = btn.dataset.tab;
    btn.classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
    
    if (tabName === 'tentative') {
      renderTentative();
      document.getElementById('row-count').textContent = '';
    } else if (tabName === 'upcoming') {
      // For upcoming tab, we update the row count from the upcoming table
      const count = document.getElementById('upcoming-tbody').querySelectorAll('tr').length;
      document.getElementById('row-count').textContent = `${count} upcoming auctions`;
    } else {
      renderTable(); // Updates row-count for historical
    }
  });

  // Refresh
  document.getElementById('refreshBtn').addEventListener('click', loadData);

  loadData();
}

init();
