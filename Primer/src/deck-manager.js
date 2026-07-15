// deck-manager.js — the only place that understands content/deck.md's syntax.
// Fetches and parses the deck (page order, chapters, titles, and every static
// content block), and renders those blocks to HTML. Holds zero page-specific
// text itself — that all lives in the .md file. Calculator widgets (live
// data, sliders, listeners) are wired separately by primer-calcs.js, keyed by
// page id, after this module renders each page's static blocks.

const CFR_URL = {
  '356.2': 'https://www.ecfr.gov/current/title-31/subtitle-B/chapter-II/subchapter-A/part-356/subpart-A/section-356.2',
  '356.5': 'https://www.ecfr.gov/current/title-31/subtitle-B/chapter-II/subchapter-A/part-356/subpart-A/section-356.5',
  '356.10': 'https://www.ecfr.gov/current/title-31/subtitle-B/chapter-II/subchapter-A/part-356/subpart-B/section-356.10',
  '356.25': 'https://www.ecfr.gov/current/title-31/subtitle-B/chapter-II/subchapter-A/part-356/subpart-C/section-356.25',
  '356.30': 'https://www.ecfr.gov/current/title-31/subtitle-B/chapter-II/subchapter-A/part-356/subpart-D/section-356.30',
  appC: 'https://www.ecfr.gov/current/title-31/subtitle-B/chapter-II/subchapter-A/part-356/appendix-Appendix%20C%20to%20Part%20356',
};

export async function loadDeck(path = './content/deck.md') {
  const res = await fetch(path);
  if (!res.ok) throw new Error('Failed to load ' + path);
  const text = (await res.text()).replace(/\r\n/g, '\n');
  return parseDeck(text);
}

function parseDeck(text) {
  return text.split(/\n(?=# )/).map(c => c.trim()).filter(Boolean).map(parsePage);
}

function parsePage(chunk) {
  const lines = chunk.split('\n');
  const id = lines[0].replace(/^#\s*/, '').trim();
  let i = 1, ch = '', title = '';
  while (i < lines.length && lines[i].trim() !== '') {
    const m = lines[i].match(/^(ch|title):\s?(.*)$/);
    if (m) { if (m[1] === 'ch') ch = m[2].trim(); else title = m[2].trim(); }
    i++;
  }
  return { id, ch, title, blocks: parseBlocks(lines.slice(i).join('\n').trim()) };
}

// ── Block-level parsing ──────────────────────────────────────────────────
function parseBlocks(body) {
  if (!body) return [];
  const lines = body.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    if (line.startsWith(':::')) {
      const type = line.slice(3).trim();
      i++;
      const fenceLines = [];
      while (i < lines.length && lines[i].trim() !== ':::') { fenceLines.push(lines[i]); i++; }
      i++; // skip closing :::
      blocks.push(parseFence(type, fenceLines.join('\n').trim()));
    } else if (line.startsWith('## ')) {
      const term = line.slice(3).trim();
      i++;
      const cardLines = [];
      while (i < lines.length && !lines[i].startsWith('## ') && !lines[i].startsWith(':::')) { cardLines.push(lines[i]); i++; }
      blocks.push(parseCard(term, cardLines.join('\n').trim()));
    } else {
      i++; // stray line between blocks; ignore
    }
  }
  return blocks;
}

function parseFence(type, body) {
  if (type === 'table') return { type: 'table', table: parseTable(body) };
  if (type === 'grid2') return { type: 'grid2', cards: parseBlocks(body).filter(b => b.type === 'card') };
  if (type.startsWith('card-table')) {
    return { type: 'card-table', term: type.slice('card-table'.length).trim(), table: parseTable(body) };
  }
  return { type, text: body };
}

function parseTable(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
}

const FIELD_HEADER_RE = /^###\s+(CFR-list|CFR|Usage|Notes)\s*$/;

function parseCard(term, text) {
  if (!text) return { type: 'card', term, plain: [] };
  const lines = text.split('\n');
  const fields = {};
  let curField = null, curLines = [];
  const flush = () => { if (curField) fields[curField] = curLines.join('\n').trim(); };
  for (const line of lines) {
    const m = line.match(FIELD_HEADER_RE);
    if (m) { flush(); curField = m[1]; curLines = []; }
    else if (curField) curLines.push(line);
  }
  flush();
  if (Object.keys(fields).length === 0) {
    const plain = text.split(/\n\s*\n/).map(p => p.replace(/\n/g, ' ').trim()).filter(Boolean);
    return { type: 'card', term, plain };
  }
  if (fields['CFR-list'] != null) {
    const { sections, cite } = parseCfrList(fields['CFR-list']);
    return { type: 'listcard', term, sections, cite, usage: fields.Usage || '', notes: fields.Notes || '' };
  }
  return { type: 'card', term, def: fields.CFR || '', usage: fields.Usage || '', notes: fields.Notes || '' };
}

function parseCfrList(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '');
  const sections = [];
  let current = null, cite = '';
  for (const line of lines) {
    if (line.startsWith('- ')) {
      if (!current) { current = { label: null, items: [] }; sections.push(current); }
      current.items.push(line.slice(2).trim());
    } else if (line.startsWith('(')) {
      current = { label: line, items: [] };
      sections.push(current);
    } else {
      cite = line;
    }
  }
  return { sections, cite };
}

// ── Inline formatting ────────────────────────────────────────────────────
function inline(s) {
  if (!s) return '';
  s = s.replace(/\[\[([\w.]+):([^\]]+)\]\]/g, (_, key, label) =>
    `(<a href="${CFR_URL[key]}" target="_blank" rel="noopener">${label}</a>)`);
  s = s.replace(/__(.+?)__/g, '<u>$1</u>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*]+?)\*(?!\*)/g, '$1<i>$2</i>');
  s = s.replace(/`([^`]+?)`/g, '<code>$1</code>');
  return s;
}

// Field/fence text -> paragraphs (blank line = paragraph break, joined <br><br>)
function fmt(text) {
  if (!text) return '';
  return text.split(/\n\s*\n/).map(p => inline(p.replace(/\n/g, ' ').trim())).join('<br><br>');
}

// ── Rendering ─────────────────────────────────────────────────────────────
export function renderBlocks(blocks) {
  return blocks.map(renderBlock).join('');
}

function renderBlock(b) {
  switch (b.type) {
    case 'card': return renderCard(b);
    case 'listcard': return renderListCard(b);
    case 'card-table': return `<div class="defcard"><h4>${b.term}</h4>${renderTable(b.table)}</div>`;
    case 'lead': return `<p class="lead">${fmt(b.text)}</p>`;
    case 'example': return `<div class="example">${fmt(b.text)}</div>`;
    case 'callout': return `<div class="callout">${fmt(b.text)}</div>`;
    case 'aside': return `<div class="aside">${fmt(b.text)}</div>`;
    case 'table': return renderTable(b.table);
    case 'grid2': return `<div class="grid2">${b.cards.map(renderCard).join('')}</div>`;
    default: return '';
  }
}

function renderCard(b) {
  if (b.plain) {
    return `<div class="defcard"><h4>${b.term}</h4>${b.plain.map(p => `<p>${inline(p)}</p>`).join('')}</div>`;
  }
  return `<div class="defcard"><h4>${b.term}</h4>
    <p class="cfr-def">${fmt(b.def)}</p>
    <p class="cfr-usage">Usage: ${fmt(b.usage)}</p>
    <p class="cfr-notes"><b>Notes:</b>${b.notes ? ' ' + fmt(b.notes) : ''}</p></div>`;
}

function renderListCard(b) {
  const sectionsHtml = b.sections.map(s =>
    (s.label ? `<p><b>${inline(s.label)}</b></p>` : '') +
    `<ul>${s.items.map(i => `<li>${inline(i)}</li>`).join('')}</ul>`
  ).join('');
  return `<div class="defcard"><h4>${b.term}</h4>
    <div class="cfr-def">${sectionsHtml}<p>${inline(b.cite)}</p></div>
    <p class="cfr-usage">Usage: ${fmt(b.usage)}</p>
    <p class="cfr-notes"><b>Notes:</b>${b.notes ? ' ' + fmt(b.notes) : ''}</p></div>`;
}

function renderTable(rows) {
  const [header, ...body] = rows;
  return `<table class="primer"><tr>${header.map(h => `<th>${inline(h)}</th>`).join('')}</tr>${
    body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}
