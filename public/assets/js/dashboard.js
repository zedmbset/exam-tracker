// â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const API = '';  // empty = same origin

const COLS = {
  ID_Exams:0, Wilaya:1, Year:2, Level:3, ExamSession:4, Rotation:4, Period:5,
  categoryId:6, Module:7, Start:8, End:9, ExamDate:10, Status:11,
  OrigPDF:12, AffichagePDF:13, Quiz_Tbl:14, Membre:15, Tags:16, Quiz_Link:17,
  Admin_Report:18, Public_Report:19,
};
const STATUS_COMPLETED = ExamStatusUtils.STATUS_COMPLETED;
const STATUS_PENDING = ExamStatusUtils.STATUS_PENDING;
const STATUS_NEW_EXAM = ExamStatusUtils.STATUS_NEW_EXAM;
const STATUS_MISSING = ExamStatusUtils.STATUS_MISSING;
const EXAM_STATUS_OPTIONS  = ExamStatusUtils.STATUS_OPTIONS;

function normalizeStatusValue(value) {
  return ExamStatusUtils.normalizeStatusValue(value);
}

// â”€â”€ Date helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function toDateInputValue(str) {
  if (!str) return '';
  str = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const a = parseInt(m[1]), b = parseInt(m[2]), yr = m[3];
    if (b > 12) return `${yr}-${String(a).padStart(2,'0')}-${String(b).padStart(2,'0')}`;
    if (a > 12) return `${yr}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`;
    return `${yr}-${String(a).padStart(2,'0')}-${String(b).padStart(2,'0')}`;
  }
  const d = new Date(str);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return '';
}

function parseDateOnly(value) {
  const iso = toDateInputValue(value);
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function getTodayDateOnly() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isPresent(value) {
  return String(value || '').trim() !== '';
}

function getRawExamDate(row) {
  return cell(row, 'ExamDate') || cell(row, 'Exam Date') || '';
}

function deriveStatusForRow(row) {
  return ExamStatusUtils.deriveEffectiveStatus(row, cell);
}

function syncDerivedStatus(row) {
  return ExamStatusUtils.syncEffectiveStatus(row, cell, setCell);
}

function getRowStatus(row) {
  return deriveStatusForRow(row);
}

// â”€â”€ Annotations parser/serializer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Syntax: "3m, 7s, 15-17m, 20s"  â€” m=missing, s=schema/table
function parseAnnotations(str) {
  const missingPos = [], schemaQsts = [];
  if (!str || !str.trim()) return { missingPos, schemaQsts, missingQsts: 0 };
  str.split(',').forEach(part => {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?([ms])$/i);
    if (!m) return;
    const from = parseInt(m[1]), to = m[2] ? parseInt(m[2]) : from;
    const tag = m[3].toLowerCase();
    for (let i = from; i <= to; i++) {
      if (tag === 'm') missingPos.push(i);
      else if (tag === 's') schemaQsts.push(i);
    }
  });
  return { missingPos, schemaQsts, missingQsts: missingPos.length };
}
function annotationsToString(tags) {
  const entries = [];
  (tags.missingPos || []).forEach(p => entries.push({ pos: +p, tag: 'm' }));
  (tags.schemaQsts  || []).forEach(p => entries.push({ pos: +p, tag: 's' }));
  entries.sort((a, b) => a.pos - b.pos);
  return entries.map(e => e.pos + e.tag).join(', ');
}

function tsvToCsv(tsv) {
  return tsv.trim().split('\n').map(line =>
    line.split('\t').map(v => {
      v = v.trim();
      if (v.includes(',') || v.includes('"') || v.includes('\n')) return '"' + v.replace(/"/g, '""') + '"';
      return v;
    }).join(',')
  ).join('\n');
}

function parseRangeInput(str) {
  if (!str || !str.trim()) return [];
  const result = [];
  str.split(',').forEach(part => {
    const m = part.trim().match(/^(\d+)-(\d+)$/);
    if (m) { for (let i=+m[1]; i<=+m[2]; i++) result.push(i); }
    else if (/^\d+$/.test(part.trim())) result.push(parseInt(part.trim(), 10));
  });
  return result;
}

let sheetData    = [];
let headers      = [];
let sheetTab     = 'Sheet1';
let headerRow    = 1;
let activeRowIdx = null;
let pendingFile  = null;
let isApplyingFilterState = false;

let filterState = {
  q: '', wilayas: [],
  yearMode: 'all', yearSingle: '', yearFrom: '', yearTo: '',
  sessions: [], statuses: [], completion: '',
};
let sortState = { col: null, dir: 'asc' };
let activeDropdown = null;
const multiSelectControls = {};
let yearFilterControl = null;

document.addEventListener('click', () => {
  if (activeDropdown) { activeDropdown.classList.remove('is-open'); activeDropdown = null; }
});

// â”€â”€ Boot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function boot() {
  updateIdentityBtn();
  try {
    const cfg = await (await fetch(`${API}/api/config`)).json();
    sheetTab  = cfg.sheetTab  || 'Sheet1';
    headerRow = cfg.headerRow || 1;
    document.getElementById('sheetName').textContent = sheetTab;
  } catch(e) { /* config fetch failed, use defaults */ }
  loadSheet();
}

async function loadSheet() {
  setSyncStatus('syncing','Loading...');
  try {
    const data = await (await fetch(`${API}/api/sheet`)).json();
    if (data.error) throw new Error(data.error);
    const rows = data.values || [];
    const hi   = headerRow - 1;
    headers    = rows[hi] || [];
    sheetData  = rows.slice(hi + 1).map((r, i) => {
      while (r.length < headers.length) r.push('');
      return { _rowIndex: hi + 2 + i, cells: r };
    });
    showDashboard();
    setSyncStatus('synced','Synced');
    notify('Data loaded - ' + sheetData.length + ' rows', 'success');
  } catch(e) {
    setSyncStatus('error','Error');
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('errorScreen').style.display   = 'block';
    document.getElementById('errorMsg').textContent = e.message;
  }
}

async function refreshAllStatuses() {
  const btn = document.getElementById('refreshStatusBtn');
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
  }
  setSyncStatus('syncing', 'Refreshing statuses...');

  try {
    const response = await fetch(`${API}/api/status/refresh`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);

    await loadSheet();
    notify(
      `Statuses refreshed: ${result.changedRows || 0} updated, ${result.manualCompletedPreserved || 0} manual Completed preserved`,
      'success'
    );
  } catch (error) {
    setSyncStatus('error', 'Error');
    notify('Status refresh failed: ' + (error.message || error), 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText || 'Refresh Status';
    }
  }
}

function showDashboard() {
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('errorScreen').style.display   = 'none';
  document.getElementById('dashboard').style.display     = 'block';
  populateFilters();
  applyFilterStateFromUrl();
  Object.values(multiSelectControls).forEach(c => c?.refreshBtn());
  yearFilterControl?.refreshBtn();
  renderChips();
  renderStats();
  renderTableHeader();
  renderTable();
}

// â”€â”€ Column helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function colIdx(name) {
  const i = headers.indexOf(name);
  if (i >= 0) return i;
  for (const [k,v] of Object.entries(COLS)) { if (headers[v] && k===name) return v; }
  return headers.findIndex(h => h && h.toLowerCase().replace(/[\s_]/g,'') === name.toLowerCase().replace(/[\s_]/g,''));
}
function rawCell(row, n)    { const i=colIdx(n); return i>=0?(row.cells[i]||''):''; }
function cell(row, n) {
  if (n === 'Rotation') {
    const sessionLabel = getExamSessionForRow(row)?.shortLabel || '';
    return sessionLabel || rawCell(row, n);
  }
  if (n === 'Period') {
    return getExamSessionForRow(row)?.phase === 'clinical'
      ? (getExamSessionForRow(row)?.period || '')
      : rawCell(row, n);
  }
  return rawCell(row, n);
}
function setCell(row, n, v) { const i=colIdx(n); if(i>=0){while(row.cells.length<=i)row.cells.push('');row.cells[i]=v;} }
function getExamSessionForRow(row) {
  if (!row || !window.ExamSessionUtils) return null;
  return window.ExamSessionUtils.parseExamSession(rawCell(row,'ExamSession'), {
    level: rawCell(row,'Level'),
    legacyRotation: rawCell(row,'Rotation'),
    legacyPeriod: rawCell(row,'Period'),
  });
}
function getSessionLabel(row) { return getExamSessionForRow(row)?.shortLabel || ''; }
function getSessionLongLabel(row) { return getExamSessionForRow(row)?.label || getSessionLabel(row) || ''; }
function getSessionRef(row) { return getExamSessionForRow(row)?.ref || ''; }

function parseTags(row) {
  let tags = {};
  const raw = cell(row, 'Tags');
  if (raw) { try { tags = JSON.parse(raw); } catch(e) { /* not JSON */ } }
  return tags;
}

// â”€â”€ Multi-select dropdown builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CARET_SVG = `<svg class="fd-caret" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="4 6 8 10 12 6"/></svg>`;

function buildMultiSelect(wrapId, label, getSelected, setSelected, getOpts) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return null;
  wrap.innerHTML = '';

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'fd-btn';

  const panel = document.createElement('div');
  panel.className = 'fd-panel';
  wrap.appendChild(btn); wrap.appendChild(panel);

  function refreshBtn() {
    const sel = getSelected();
    if (!sel.length) {
      btn.className = 'fd-btn';
      btn.innerHTML = `${label} ${CARET_SVG}`;
    } else if (sel.length === 1) {
      btn.className = 'fd-btn is-active';
      btn.innerHTML = `${label}: <strong>${escapeHtml(sel[0])}</strong> ${CARET_SVG}`;
    } else {
      btn.className = 'fd-btn is-active';
      btn.innerHTML = `${label} <span class="fd-badge">${sel.length}</span> ${CARET_SVG}`;
    }
  }

  function openPanel() {
    const opts = getOpts();
    const sel = getSelected();
    panel.innerHTML = `
      <div class="fd-panel-search"><input type="text" placeholder="Search..." id="${wrapId}-srch" autocomplete="off"></div>
      <div class="fd-panel-opts" id="${wrapId}-opts"></div>
      <div class="fd-panel-footer">
        <span class="fd-footer-count" id="${wrapId}-cnt">${sel.length} selected</span>
        <button type="button" class="fd-clear-btn" id="${wrapId}-clr">Clear all</button>
      </div>`;
    const srch = document.getElementById(`${wrapId}-srch`);
    const optsEl = document.getElementById(`${wrapId}-opts`);
    const cntEl = document.getElementById(`${wrapId}-cnt`);

    function renderOpts(filter) {
      const visible = filter ? opts.filter(o => o.toLowerCase().includes(filter.toLowerCase())) : opts;
      if (!visible.length) { optsEl.innerHTML = `<div class="fd-no-opts">No options</div>`; return; }
      const cur = getSelected();
      optsEl.innerHTML = visible.map(o => `
        <label class="fd-opt">
          <input type="checkbox" value="${escapeHtml(o)}" ${cur.includes(o)?'checked':''}>
          <span>${escapeHtml(o)}</span>
        </label>`).join('');
      optsEl.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', e => {
          e.stopPropagation();
          const cur2 = getSelected().slice();
          if (cb.checked) { if (!cur2.includes(cb.value)) cur2.push(cb.value); }
          else { const i = cur2.indexOf(cb.value); if (i >= 0) cur2.splice(i,1); }
          setSelected(cur2);
          cntEl.textContent = cur2.length + ' selected';
          refreshBtn(); renderChips(); renderTable();
        });
      });
    }

    renderOpts('');
    setTimeout(() => srch.focus(), 40);
    srch.addEventListener('input', () => renderOpts(srch.value));
    srch.addEventListener('click', e => e.stopPropagation());
    optsEl.addEventListener('click', e => e.stopPropagation());
    document.getElementById(`${wrapId}-clr`).addEventListener('click', e => {
      e.stopPropagation();
      setSelected([]);
      cntEl.textContent = '0 selected';
      refreshBtn(); renderOpts(srch.value); renderChips(); renderTable();
    });
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = wrap.classList.contains('is-open');
    if (activeDropdown && activeDropdown !== wrap) activeDropdown.classList.remove('is-open');
    if (isOpen) { wrap.classList.remove('is-open'); activeDropdown = null; }
    else { wrap.classList.add('is-open'); activeDropdown = wrap; openPanel(); }
  });
  panel.addEventListener('click', e => e.stopPropagation());
  refreshBtn();
  return { refreshBtn };
}

// â”€â”€ Year dropdown builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildYearFilter(wrapId, getOpts) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return null;
  wrap.innerHTML = '';

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'fd-btn';

  const panel = document.createElement('div');
  panel.className = 'fd-panel'; panel.style.minWidth = '220px';
  wrap.appendChild(btn); wrap.appendChild(panel);

  function refreshBtn() {
    const { yearMode, yearSingle, yearFrom, yearTo } = filterState;
    if (yearMode === 'single' && yearSingle) {
      btn.className = 'fd-btn is-active';
      btn.innerHTML = `Year: <strong>${escapeHtml(yearSingle)}</strong> ${CARET_SVG}`;
    } else if (yearMode === 'range' && (yearFrom || yearTo)) {
      btn.className = 'fd-btn is-active';
      btn.innerHTML = `Year: <strong>${escapeHtml(yearFrom||'...')} - ${escapeHtml(yearTo||'...')}</strong> ${CARET_SVG}`;
    } else {
      btn.className = 'fd-btn';
      btn.innerHTML = `Year ${CARET_SVG}`;
    }
  }

  function openPanel() {
    const opts = getOpts();
    const { yearMode, yearSingle, yearFrom, yearTo } = filterState;
    panel.innerHTML = `
      <div class="fd-tabs">
        <div class="fd-tab ${yearMode==='all'?'is-sel':''}" data-tab="all">All</div>
        <div class="fd-tab ${yearMode==='single'?'is-sel':''}" data-tab="single">Single</div>
        <div class="fd-tab ${yearMode==='range'?'is-sel':''}" data-tab="range">Range</div>
      </div>
      <div class="fd-year-body" id="${wrapId}-body"></div>`;
    const body = document.getElementById(`${wrapId}-body`);

    function renderBody(mode) {
      const { yearSingle, yearFrom, yearTo } = filterState;
      if (mode === 'all') {
        body.innerHTML = `<div style="padding:10px 8px;font-size:12px;color:var(--text3);text-align:center;">Showing all years</div>`;
      } else if (mode === 'single') {
        body.innerHTML = `<div class="fd-yr-list">${opts.map(y=>`
          <div class="fd-yr-item ${yearSingle===y?'is-sel':''}" data-yr="${escapeHtml(y)}">
            <span class="fd-yr-dot"></span>${escapeHtml(y)}
          </div>`).join('')}</div>`;
        body.querySelectorAll('.fd-yr-item').forEach(el => {
          el.addEventListener('click', e => {
            e.stopPropagation();
            filterState.yearSingle = el.dataset.yr;
            filterState.yearMode = 'single';
            body.querySelectorAll('.fd-yr-item').forEach(x => x.classList.toggle('is-sel', x===el));
            refreshBtn(); renderChips(); renderTable();
          });
        });
      } else {
        const mkOpts = (cur) => opts.map(y=>`<option value="${escapeHtml(y)}" ${cur===y?'selected':''}>${escapeHtml(y)}</option>`).join('');
        body.innerHTML = `<div class="fd-year-range">
          <select id="${wrapId}-from"><option value="">From</option>${mkOpts(yearFrom)}</select>
          <span class="fd-year-range-sep">-</span>
          <select id="${wrapId}-to"><option value="">To</option>${mkOpts(yearTo)}</select>
        </div>`;
        const fromEl = document.getElementById(`${wrapId}-from`);
        const toEl   = document.getElementById(`${wrapId}-to`);
        [fromEl, toEl].forEach(el => {
          el.addEventListener('click', e => e.stopPropagation());
          el.addEventListener('change', e => {
            e.stopPropagation();
            filterState.yearFrom = fromEl.value;
            filterState.yearTo   = toEl.value;
            filterState.yearMode = 'range';
            refreshBtn(); renderChips(); renderTable();
          });
        });
      }
    }

    panel.querySelectorAll('.fd-tab').forEach(tab => {
      tab.addEventListener('click', e => {
        e.stopPropagation();
        const mode = tab.dataset.tab;
        filterState.yearMode = mode;
        if (mode === 'all') { filterState.yearSingle=''; filterState.yearFrom=''; filterState.yearTo=''; refreshBtn(); renderChips(); renderTable(); }
        panel.querySelectorAll('.fd-tab').forEach(t => t.classList.toggle('is-sel', t===tab));
        renderBody(mode);
      });
    });
    renderBody(yearMode);
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = wrap.classList.contains('is-open');
    if (activeDropdown && activeDropdown !== wrap) activeDropdown.classList.remove('is-open');
    if (isOpen) { wrap.classList.remove('is-open'); activeDropdown = null; }
    else { wrap.classList.add('is-open'); activeDropdown = wrap; openPanel(); }
  });
  panel.addEventListener('click', e => e.stopPropagation());
  refreshBtn();
  return { refreshBtn };
}

// â”€â”€ Filter change handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function onFilterChange() {
  filterState.q          = (document.getElementById('searchBox')?.value || '').trim();
  filterState.completion = document.getElementById('fCompletion')?.value || '';
  renderChips(); renderTable();
}

// â”€â”€ Active filter chips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderChips() {
  const el = document.getElementById('filterChips');
  if (!el) return;
  const chips = [];

  if (filterState.q)
    chips.push({ label: `"${filterState.q}"`, key: 'q', clear: () => { filterState.q=''; document.getElementById('searchBox').value=''; } });
  if (filterState.wilayas.length)
    chips.push({ label: `Wilaya: ${filterState.wilayas.join(', ')}`, key: 'w', clear: () => { filterState.wilayas=[]; multiSelectControls['fd-wilaya']?.refreshBtn(); } });
  if (filterState.yearMode !== 'all' && (filterState.yearSingle || filterState.yearFrom || filterState.yearTo)) {
    const yl = filterState.yearMode==='single' ? filterState.yearSingle : `${filterState.yearFrom||'...'} - ${filterState.yearTo||'...'}`;
    chips.push({ label: `Year: ${yl}`, key: 'y', clear: () => { filterState.yearMode='all'; filterState.yearSingle=''; filterState.yearFrom=''; filterState.yearTo=''; yearFilterControl?.refreshBtn(); } });
  }
  if (filterState.sessions.length)
    chips.push({ label: `Session: ${filterState.sessions.join(', ')}`, key: 'r', clear: () => { filterState.sessions=[]; multiSelectControls['fd-session']?.refreshBtn(); } });
  if (filterState.statuses.length)
    chips.push({ label: `Status: ${filterState.statuses.join(', ')}`, key: 's', clear: () => { filterState.statuses=[]; multiSelectControls['fd-status']?.refreshBtn(); } });
  if (filterState.completion)
    chips.push({ label: filterState.completion==='missing' ? 'Has missing fields' : 'Fully complete', key: 'c', clear: () => { filterState.completion=''; document.getElementById('fCompletion').value=''; } });

  if (!chips.length) { el.innerHTML = ''; return; }

  el.innerHTML = chips.map((c,i) =>
    `<span class="f-chip">${escapeHtml(c.label)}<button class="f-chip-x" data-i="${i}" title="Remove">&times;</button></span>`
  ).join('') + `<button class="f-clear-all" id="btnClearAll">Clear all</button>`;

  el.querySelectorAll('.f-chip-x').forEach(b => b.addEventListener('click', () => {
    chips[+b.dataset.i].clear(); renderChips(); renderTable();
  }));
  document.getElementById('btnClearAll')?.addEventListener('click', clearAllFilters);
}

function clearAllFilters() {
  filterState = { q:'', wilayas:[], yearMode:'all', yearSingle:'', yearFrom:'', yearTo:'', sessions:[], statuses:[], completion:'' };
  document.getElementById('searchBox').value = '';
  document.getElementById('fCompletion').value = '';
  Object.values(multiSelectControls).forEach(c => c?.refreshBtn());
  yearFilterControl?.refreshBtn();
  renderChips(); renderTable();
}

// â”€â”€ URL sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getCurrentFilterState() { return { ...filterState }; }

function buildDashboardUrlFromState(state = getCurrentFilterState()) {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.wilayas?.length) p.set('wilaya', state.wilayas.join(','));
  if (state.yearMode==='single' && state.yearSingle) p.set('year', state.yearSingle);
  else if (state.yearMode==='range' && (state.yearFrom || state.yearTo)) p.set('year', `${state.yearFrom||''}-${state.yearTo||''}`);
  if (state.sessions?.length) p.set('session', state.sessions.join(','));
  if (state.statuses?.length) p.set('status', state.statuses.join(','));
  if (state.completion) p.set('completion', state.completion);
  const qs = p.toString();
  return `${location.origin}${location.pathname}${qs ? `?${qs}` : ''}`;
}

function syncFilterStateToUrl() {
  if (isApplyingFilterState) return;
  history.replaceState({}, '', buildDashboardUrlFromState());
}

function applyFilterStateFromUrl() {
  isApplyingFilterState = true;
  try {
    const p = new URLSearchParams(location.search);
    filterState.q = p.get('q') || '';
    document.getElementById('searchBox').value = filterState.q;

    const w = p.get('wilaya') || '';
    filterState.wilayas = w ? w.split(',').map(s=>s.trim()).filter(Boolean) : [];

    const y = p.get('year') || '';
    if (!y) {
      filterState.yearMode='all'; filterState.yearSingle=''; filterState.yearFrom=''; filterState.yearTo='';
    } else if (/^(\d{4})?-(\d{4})?$/.test(y) && y.includes('-')) {
      const [a,b] = y.split('-');
      filterState.yearMode='range'; filterState.yearFrom=a||''; filterState.yearTo=b||''; filterState.yearSingle='';
    } else {
      filterState.yearMode='single'; filterState.yearSingle=y; filterState.yearFrom=''; filterState.yearTo='';
    }

    const session = p.get('session') || p.get('rotation') || '';
    filterState.sessions = session ? session.split(',').map(s=>s.trim()).filter(Boolean) : [];
    const st = p.get('status') || '';
    filterState.statuses = st ? st.split(',').map(s=>s.trim()).filter(Boolean) : [];
    filterState.completion = p.get('completion') || '';
    document.getElementById('fCompletion').value = filterState.completion;
  } finally { isApplyingFilterState = false; }
}

function copyFilteredDashboardLink() {
  navigator.clipboard.writeText(buildDashboardUrlFromState()).then(() => notify('Filtered dashboard link copied!', 'success'));
}

function getMissing(row) {
  const tags = parseTags(row);
  const m=[];
  if (!cell(row,'OrigPDF'))                             m.push('OrigPDF');
  if (!cell(row,'Quiz_Tbl'))                            m.push('Quiz_Tbl');
  if (!tags.nQst)                                       m.push('N° Qst');
  return m;
}
function isComplete(row){ return getMissing(row).length===0; }

// â”€â”€ Stats & filters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderStats() {
  const total   = sheetData.length;
  const done    = sheetData.filter(r => getRowStatus(r) === STATUS_COMPLETED).length;
  const hasOrigPDF = sheetData.filter(r=>cell(r,'OrigPDF')).length;
  const hasQuizTbl = sheetData.filter(r=>cell(r,'Quiz_Tbl')).length;
  const pct     = total?Math.round(done/total*100):0;
  document.getElementById('statsRow').innerHTML=`
    <div class="stat"><div class="stat-label">Total rows</div><div class="stat-val">${total}</div><div class="stat-sub">${[...new Set(sheetData.map(r=>cell(r,'Wilaya')).filter(Boolean))].join(', ')}</div></div>
    <div class="stat"><div class="stat-label">Completed</div><div class="stat-val">${done}</div><div class="stat-sub" style="color:var(--green-text)">${pct}% done</div><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div></div>
    <div class="stat"><div class="stat-label">With OrigPDF</div><div class="stat-val">${hasOrigPDF}</div><div class="stat-sub">${total-hasOrigPDF} missing</div></div>
    <div class="stat"><div class="stat-label">With Quiz_Tbl</div><div class="stat-val">${hasQuizTbl}</div><div class="stat-sub">${total-hasQuizTbl} missing</div></div>`;
}

// â”€â”€ Populate filter dropdowns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function populateFilters() {
  const wilayas  = [...new Set(sheetData.map(r=>cell(r,'Wilaya')))].filter(Boolean).sort();
  const years    = [...new Set(sheetData.map(r=>cell(r,'Year')))].filter(Boolean).sort();
  const sessions = [...new Set(sheetData.map(r=>getSessionLabel(r)).filter(Boolean))].sort();
  const svs      = [...new Set(sheetData.map(r=>getRowStatus(r)).filter(Boolean))];
  const statuses = EXAM_STATUS_OPTIONS.filter(s => svs.includes(s));

  multiSelectControls['fd-wilaya']   = buildMultiSelect('fd-wilaya',  'Wilaya',   () => filterState.wilayas,   v => { filterState.wilayas=v; },   () => wilayas);
  multiSelectControls['fd-session']  = buildMultiSelect('fd-session', 'Session', () => filterState.sessions, v => { filterState.sessions=v; }, () => sessions);
  multiSelectControls['fd-status']   = buildMultiSelect('fd-status',   'Status',   () => filterState.statuses,  v => { filterState.statuses=v; },  () => statuses);
  yearFilterControl = buildYearFilter('fd-year', () => years);
}

// â”€â”€ Filtered rows (reads filterState) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getFiltered() {
  const { q, wilayas, yearMode, yearSingle, yearFrom, yearTo, sessions, statuses, completion } = filterState;
  const ql = q.toLowerCase();
  const qTokens = ql.split(/\s+/).filter(Boolean);
  return sheetData.filter(r => {
    if (qTokens.length) {
      const haystack = `${cell(r,'Wilaya')} ${cell(r,'Module')} ${getSessionLongLabel(r)} ${cell(r,'Level')}`.toLowerCase();
      if (!qTokens.every(token => haystack.includes(token))) return false;
    }
    if (wilayas.length   && !wilayas.includes(cell(r,'Wilaya')))     return false;
    const yr = String(cell(r,'Year') || '');
    if (yearMode==='single' && yearSingle && yr !== yearSingle)       return false;
    if (yearMode==='range') {
      if (yearFrom && yr < yearFrom) return false;
      if (yearTo   && yr > yearTo)   return false;
    }
    if (sessions.length && !sessions.includes(getSessionLabel(r))) return false;
    if (statuses.length  && !statuses.includes(getRowStatus(r))) return false;
    const miss = getMissing(r);
    if (completion==='missing'  && miss.length===0) return false;
    if (completion==='complete' && miss.length>0)   return false;
    return true;
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getStatusBadgeHtml(status) {
  const cleanStatus = normalizeStatusValue(status);
  if (!cleanStatus) return `<span class="badge badge-gray">Empty</span>`;
  let klass = 'badge-gray';
  if (cleanStatus === STATUS_COMPLETED) klass = 'badge-green';
  else if (cleanStatus === STATUS_PENDING) klass = 'badge-amber';
  else if (cleanStatus === STATUS_NEW_EXAM) klass = 'badge-blue';
  else if (cleanStatus === STATUS_MISSING) klass = 'badge-red';
  return `<span class="badge ${klass}">${escapeHtml(cleanStatus)}</span>`;
}

function wilayaBadge(w){
  if(!w)return'';
  const c=w.toLowerCase().includes('stf')?'badge-purple':w.toLowerCase().includes('msila')?'badge-blue':'badge-gray';
  return`<span class="badge ${c}">${w}</span>`;
}

// â”€â”€ Sorting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function setSort(col) {
  sortState.dir = sortState.col === col && sortState.dir === 'asc' ? 'desc' : 'asc';
  sortState.col = col;
  renderTable();
}

function getSortVal(r, col) {
  if (col === 'Status')  return getRowStatus(r);
  if (col === 'nQst')    { const t=parseTags(r); return t.nQst != null ? Number(t.nQst) : -1; }
  if (col === 'Missing') { const t=parseTags(r); return t.missingPos?.length ?? t.missingQsts ?? -1; }
  if (col === 'Session') return String(getSessionLabel(r) || '').toLowerCase();
  return String(cell(r, col) || '').toLowerCase();
}

function sortRows(rows) {
  if (!sortState.col) return rows;
  return rows.slice().sort((a, b) => {
    const va = getSortVal(a, sortState.col), vb = getSortVal(b, sortState.col);
    const cmp = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb));
    return sortState.dir === 'asc' ? cmp : -cmp;
  });
}

// â”€â”€ Table header (with sort indicators) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderTableHeader() {
  const thead = document.querySelector('thead tr');
  if (!thead) return;
  const cols = [
    { key:'Wilaya',   label:'Wilaya' },
    { key:'Year',     label:'Year' },
    { key:'Session',  label:'Session' },
    { key:'Module',   label:'Module' },
    { key:'Status',   label:'Status' },
    { key:null,       label:'OrigPDF' },
    { key:null,       label:'Quiz_Tbl' },
    { key:null,       label:'Saved By' },
    { key:'nQst',     label:'N° Qst' },
    { key:'Missing',  label:'Missing' },
    { key:null,       label:'' },
  ];
  thead.innerHTML = cols.map(c => {
    if (!c.key) return `<th>${c.label}</th>`;
    const active = sortState.col === c.key;
    const arrow  = active ? (sortState.dir==='asc' ? '&uarr;' : '&darr;') : '&varr;';
    return `<th class="sortable${active?' sort-active':''}" onclick="setSort('${c.key}')">${c.label} <i class="sort-icon">${arrow}</i></th>`;
  }).join('');
}

// â”€â”€ Render table rows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderTable() {
  syncFilterStateToUrl();
  const rows = sortRows(getFiltered());
  document.getElementById('rowCount').textContent = rows.length + ' rows';
  renderTableHeader();
  const tbody = document.getElementById('tableBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:var(--text3);padding:2rem;">No rows match filters</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const missing  = getMissing(r);
    const comp     = missing.length === 0;
    const status   = getRowStatus(r);
    const drive    = cell(r,'OrigPDF');
    const quiz     = cell(r,'Quiz_Tbl');
    const tagsR    = parseTags(r);
    const nqst     = tagsR.nQst || '';
    const missingCount = (tagsR.missingPos?.length != null) ? tagsR.missingPos.length : (tagsR.missingQsts ?? null);
    const missingQstsLabel = (missingCount != null)
      ? (missingCount > 0
          ? `<span style="font-size:12px;color:var(--amber-text);font-weight:500;">${missingCount}</span>`
          : `<span style="font-size:11px;color:var(--green-text)">0</span>`)
      : '<span class="empty-val">&mdash;</span>';
    const idx    = sheetData.indexOf(r);
    const examId = cell(r,'ID_Exams') || r._rowIndex;
    return `<tr class="${comp?'complete':'has-missing'}" onclick="location.href='/exam?id='+encodeURIComponent('${examId}')" style="cursor:pointer;">
      <td>${wilayaBadge(cell(r,'Wilaya'))}</td>
      <td>${cell(r,'Year')}</td>
      <td>${cell(r,'Rotation')||'<span class="empty-val">&mdash;</span>'}</td>
      <td style="max-width:170px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${cell(r,'Module')}">${cell(r,'Module')}</td>
      <td>${getStatusBadgeHtml(status)}</td>
      <td>${drive?`<div class="link-cell"><a href="${drive}" target="_blank" onclick="event.stopPropagation()">Drive &nearr;</a></div>`:'<span class="empty-val">&mdash;</span>'}</td>
      <td>${quiz?`<div class="link-cell"><a href="${quiz}" target="_blank" onclick="event.stopPropagation()">Quiz &nearr;</a></div>`:'<span class="empty-val">&mdash;</span>'}</td>
      <td onclick="event.stopPropagation()">${cell(r,'Membre')?`<span class="saver-cell" title="${escapeHtml(cell(r,'Membre'))}">${escapeHtml(cell(r,'Membre'))}</span>`:'<span class="empty-val">&mdash;</span>'}</td>
      <td style="text-align:center;">${nqst||'<span class="empty-val">&mdash;</span>'}</td>
      <td style="text-align:center;">${missingQstsLabel}</td>
      <td onclick="event.stopPropagation()" style="text-align:center;padding:6px 8px;">
        <div class="table-actions">
          <button class="edit-btn" onclick="openFill(${idx});event.stopPropagation()" title="Edit row">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="share-btn" onclick="shareExam('${examId}',event)" title="Copy exam share link">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// â”€â”€ Share â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function shareExam(id, e) {
  if (e) e.stopPropagation();
  // Make sure id is treated as a string
  const safeId = String(id).trim();
  const url = `${location.origin}/exam?id=${encodeURIComponent(safeId)}`;
  navigator.clipboard.writeText(url).then(() => notify('Share link copied!', 'success'));
}
// â”€â”€ Fill modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function writeRowToSheet(row){
  syncDerivedStatus(row);
  const r=await fetch(`${API}/api/sheet/${row._rowIndex}`,{
    method:'PUT',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({cells:row.cells})
  });
  const d=await r.json();
  if(d.error)throw new Error(d.error);
}

function openFill(idx){
  activeRowIdx=idx; pendingFile=null;
  const row=sheetData[idx];
  const missing=getMissing(row);
  document.getElementById('modalTitle').textContent = cell(row,'Module') + ' - ' + cell(row,'Wilaya') + ' ' + cell(row,'Year');

  const chips = [cell(row,'Level'), getSessionLabel(row), missing.length + ' missing field' + (missing.length!==1?'s':'')]
    .filter(Boolean)
    .map(v => `<span class="modal-sub-chip">${v}</span>`)
    .join('');
  document.getElementById('modalSub').innerHTML = chips;

  const examId = cell(row,'ID_Exams') || row._rowIndex;
  document.getElementById('modalOpenLink').href = `${location.origin}/exam?id=${encodeURIComponent(examId)}`;

  const grid = document.getElementById('formGrid');
  grid.innerHTML = '';

  // â”€â”€ Identity chips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const identChips = [
    {label:'Wilaya', val:cell(row,'Wilaya')},
    {label:'Year', val:cell(row,'Year')},
    {label:'Level', val:cell(row,'Level')},
    {label:'Session', val:getSessionLongLabel(row)},
    {label:'Module', val:cell(row,'Module')},
    {label:'Status', val:getRowStatus(row)},
  ].filter(c=>c.val);
  if(identChips.length){
    const chipsHtml = identChips.map(c=>`<div class="id-chip"><span class="id-chip-label">${c.label}</span><span class="id-chip-value">${c.val}</span></div>`).join('');
    grid.insertAdjacentHTML('beforeend', `<div class="identity-chips">${chipsHtml}</div>`);
  }

  // helper to create a section header
  const addSection = (icon, label) => {
    grid.insertAdjacentHTML('beforeend', `
      <div class="form-section">
        <div class="form-section-label">${icon}&nbsp;${label}</div>
        <div class="form-grid" id="section-${label.replace(/\s/g,'-')}"></div>
      </div>`);
    return document.getElementById('section-' + label.replace(/\s/g,'-'));
  };

  // helper to append a form-row into a grid
  const addRow = (container, html, full=false) => {
    const div = document.createElement('div');
    div.className = 'form-row' + (full ? ' full' : '');
    div.innerHTML = html;
    container.appendChild(div);
    return div;
  };

  // â”€â”€ Section 1: Files â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const filesGrid = addSection('📁', 'Files');

  // â”€â”€ OrigPDF â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const origPDFCurrent = cell(row,'OrigPDF');
  const uploadDiv = document.createElement('div');
  uploadDiv.className = 'form-row full';
  uploadDiv.innerHTML = `
    <label>Original exam PDF</label>
    ${origPDFCurrent
      ? `<div class="file-status has-file">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
           File stored &mdash; <a href="${origPDFCurrent}" target="_blank">View PDF &nearr;</a>
           <span style="margin-left:auto;color:var(--text3);font-size:11px;">Replace below</span>
         </div>`
      : `<div class="file-status no-file">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
           No PDF stored yet
         </div>`}
    <div class="upload-zone" id="uploadZone" onclick="document.getElementById('fileInput').click()"
      ondragover="event.preventDefault();this.classList.add('dragover')"
      ondragleave="this.classList.remove('dragover')" ondrop="handleDrop(event)">
      <div class="upload-zone-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text3)">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </div>
      <div class="upload-text">
        <p>${origPDFCurrent ? 'Upload replacement PDF' : 'Click or drag & drop exam PDF'}</p>
        <span>PDF, max 20MB</span>
        <div class="upload-file-name" id="uploadFileName"></div>
      </div>
    </div>
    <input type="file" id="fileInput" accept=".pdf" style="display:none" onchange="handleFileSelect(this)">
    <div style="margin-top:6px;">
      <input type="url" id="field_OrigPDF" value="${origPDFCurrent||''}" placeholder="Or paste Drive URL directly..." style="font-size:12px;">
    </div>`;
  filesGrid.appendChild(uploadDiv);

  // â”€â”€ Section 2: QCM Table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const quizGrid = addSection('📊', 'QCM Table (Quiz_Tbl)');
  const quizCurrent = cell(row,'Quiz_Tbl');

  addRow(quizGrid, `
    <label>Paste QCM data (TSV)</label>
    ${quizCurrent
      ? `<div class="file-status has-file" style="margin-bottom:6px;">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
           CSV stored &mdash; <a href="${quizCurrent}" target="_blank">View file &nearr;</a>
           <span style="margin-left:auto;color:var(--text3);font-size:11px;">Paste below to replace</span>
         </div>`
      : `<div class="file-status no-file" style="margin-bottom:6px;">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
           No CSV stored yet
         </div>`}
    <textarea id="tsv_Quiz_Tbl" placeholder="Paste TSV data here (tab-separated, copied from Excel or Google Sheets)&#10;&#10;Leave empty to keep the existing file."></textarea>
    <div class="field-hint">Paste tab-separated data from Excel/Sheets. It will be converted to CSV and saved to Drive automatically.</div>`, true);

  // â”€â”€ Last saved by â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const membreVal = cell(row,'Membre') || '';
  if (membreVal) {
    addRow(quizGrid, `
      <div class="last-saved-info">
        <span class="ls-icon">👤</span>
        <span><strong>Last saved by:</strong> ${escapeHtml(membreVal)}</span>
      </div>`);
  }

  // â”€â”€ Quiz Link â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const quizLinkCurrent = cell(row,'Quiz_Link') || '';
  addRow(quizGrid, `
    <label>Quiz Link <span style="font-size:11px;font-weight:400;color:var(--text3);">(optional)</span></label>
    <input type="url" id="field_Quiz_Link" value="${quizLinkCurrent}" placeholder="https://app.mbset.co/...">
    <div class="field-hint">Paste the MBset quiz link for this exam</div>`);

  // â”€â”€ Section 3: Tags / Metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const tagsGrid = addSection('🏷️', 'Tags & Metadata');
  const rowTags = parseTags(row);

  const rawExamDate = cell(row,'ExamDate') || cell(row,'Exam Date') || '';
  const examDateVal = toDateInputValue(rawExamDate);
  addRow(tagsGrid, `
    <label>Exam Date</label>
    <input type="date" id="field_ExamDate" value="${examDateVal}">
    <div class="field-hint">Date the exam was originally given to students</div>`);

  addRow(tagsGrid, `
    <label>Number of questions</label>
    <input type="number" id="tags_nQst" value="${rowTags.nQst != null ? rowTags.nQst : ''}" min="0" placeholder="0">
    <div class="field-hint">Total questions in this exam</div>`);

  addRow(tagsGrid, `
    <label>Question annotations</label>
    <input type="text" id="tags_annotations" value="${annotationsToString(rowTags)}" placeholder="e.g. 3m, 7s, 15-17m, 20s">
    <div class="field-hint"><b>m</b> = missing &nbsp;&middot;&nbsp; <b>s</b> = has schema/table &nbsp;&middot;&nbsp; ranges ok (e.g. 5-8m) &nbsp;&middot;&nbsp; missing count is auto-calculated</div>`, true);

  addRow(tagsGrid, `
    <label>Has Corrigé Type (CT)</label>
    <label style="flex-direction:row;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:400;margin-top:2px;cursor:pointer;">
      <input type="checkbox" id="tags_hasCT" ${rowTags.hasCT?'checked':''} style="width:15px;height:15px;accent-color:var(--accent);cursor:pointer;">
      Original PDF includes a correction key
    </label>`);

  addRow(tagsGrid, `
    <label>Has Clinical Cases (Cas cliniques)</label>
    <label style="flex-direction:row;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:400;margin-top:2px;cursor:pointer;">
      <input type="checkbox" id="tags_hasCas" ${rowTags.hasCas?'checked':''} style="width:15px;height:15px;accent-color:var(--accent);cursor:pointer;">
      Exam contains clinical cases
    </label>`);

  addRow(tagsGrid, `
    <label>Has Combination Propositions (e.g. A+B+C)</label>
    <label style="flex-direction:row;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:400;margin-top:2px;cursor:pointer;">
      <input type="checkbox" id="tags_hasComb" ${rowTags.hasComb?'checked':''} style="width:15px;height:15px;accent-color:var(--accent);cursor:pointer;">
      Some answers are combinations of propositions
    </label>`);

  document.getElementById('fillModal').classList.add('open');
}

function handleFileSelect(input){ if(input.files[0])setFile(input.files[0]); }
function handleDrop(e){
  e.preventDefault();
  document.getElementById('uploadZone').classList.remove('dragover');
  if(e.dataTransfer.files[0])setFile(e.dataTransfer.files[0]);
}
function setFile(f){
  pendingFile=f;
  const el=document.getElementById('uploadFileName');
  el.textContent=f.name+' ('+Math.round(f.size/1024)+' KB)';
  el.style.display='block';
}

async function saveRow(){
  if(activeRowIdx===null)return;
  const row=sheetData[activeRowIdx];
  const origPDFEl  = document.getElementById('field_OrigPDF');
  const tsvEl      = document.getElementById('tsv_Quiz_Tbl');
  const nQstEl     = document.getElementById('tags_nQst');

  if(origPDFEl) origPDFEl.classList.remove('invalid');
  if(tsvEl)     tsvEl.classList.remove('invalid');
  if(nQstEl)    nQstEl.classList.remove('invalid');

  // â”€â”€ Identity check â€” prompt if not set, then re-run save â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!getIdentity()) {
    showIdentityModal(() => saveRow(), true);
    return;
  }

  const btn=document.getElementById('saveBtn');
  btn.textContent='Saving...';btn.disabled=true;

  // Save OrigPDF if manually pasted URL
  const origPDFVal = origPDFEl && origPDFEl.value.trim();
  if(origPDFVal) setCell(row,'OrigPDF',origPDFVal);

  // TSV to CSV upload for Quiz_Tbl
  const tsvContent = tsvEl && tsvEl.value.trim();
  if(tsvContent){
    try{
      const csvContent = tsvToCsv(tsvContent);
      const csvBlob = new Blob([csvContent], {type:'text/csv'});
      const _prCsv = getSessionRef(row) || '';
      const baseName = [cell(row,'Wilaya'),cell(row,'Year'),_prCsv||null,cell(row,'Module')]
        .filter(Boolean).join('_').replace(/\s+/g,'_');
      const fname = `${baseName}_QCM_V1.csv`;
      const fd = new FormData();
      fd.append('file', csvBlob, fname);
      fd.append('filename', fname);
      const r = await fetch(`${API}/api/upload`,{method:'POST',body:fd});
      const d = await r.json();
      if(d.error) throw new Error(d.error);
      setCell(row,'Quiz_Tbl',d.url);
      notify('QCM CSV uploaded to Drive OK','success');
    }catch(e){ notify('CSV upload failed: '+e.message,'error'); }
  }

  // Build and save Tags JSON from all tag fields
  const existingTagsIdx = parseTags(row);
  const annot = parseAnnotations(document.getElementById('tags_annotations')?.value||'');
  const nQstRaw = document.getElementById('tags_nQst')?.value || '';
  const parsedNQst = parseInt(nQstRaw, 10);
  const mergedTagsIdx = Object.assign({}, existingTagsIdx, {
    missingPos: annot.missingPos,
    schemaQsts: annot.schemaQsts,
    hasCT:   document.getElementById('tags_hasCT')?.checked   || false,
    hasCas:  document.getElementById('tags_hasCas')?.checked  || false,
    hasComb: document.getElementById('tags_hasComb')?.checked || false,
  });
  if (nQstRaw.trim() && !Number.isNaN(parsedNQst) && parsedNQst >= 0) {
    mergedTagsIdx.nQst = parsedNQst;
  }
  delete mergedTagsIdx.missingQsts;
  setCell(row,'Tags',JSON.stringify(mergedTagsIdx));

  // Save Exam Date
  const examDateEl = document.getElementById('field_ExamDate');
  if(examDateEl && examDateEl.value) setCell(row,'ExamDate',examDateEl.value);
  else if (examDateEl && !examDateEl.value) setCell(row,'ExamDate','');

  // Save Quiz Link
  const quizLinkFieldEl = document.getElementById('field_Quiz_Link');
  if(quizLinkFieldEl) setCell(row,'Quiz_Link', quizLinkFieldEl.value.trim());

  const hasCTIdx = document.getElementById('tags_hasCT')?.checked || false;
  const ctSuffixIdx = hasCTIdx ? '_CT' : '';
  const nQstIdx = parseInt(document.getElementById('tags_nQst')?.value||'')||0;
  const annotIdx = parseAnnotations(document.getElementById('tags_annotations')?.value||'');

  if(pendingFile){
    try{
      const _pr = getSessionRef(row) || '';
      const fname=`${cell(row,'Wilaya')}_${cell(row,'Year')}${_pr?'_'+_pr:''}_${cell(row,'Module')}${ctSuffixIdx}_${nQstIdx}Q_${annotIdx.missingPos.length}miss_V1.pdf`.replace(/\s+/g,'_');
      const fd=new FormData();
      fd.append('file',pendingFile,fname);
      fd.append('filename',fname);
      const r=await fetch(`${API}/api/upload`,{method:'POST',body:fd});
      const d=await r.json();
      if(d.error)throw new Error(d.error);
      setCell(row,'OrigPDF',d.url);
      notify('PDF uploaded to Drive OK','success');
    }catch(e){notify('Drive upload failed: '+e.message,'error');}
  }

  // â”€â”€ Record saver identity in Membre column â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const stamp = buildMembreStamp();
  if (stamp) setCell(row, 'Membre', stamp);

  try{
    await writeRowToSheet(row);
    notify('Row saved successfully OK','success');
  }catch(e){notify('Sheet write failed: '+e.message,'error');}

  btn.textContent='Save to sheet';btn.disabled=false;
  closeModal();renderStats();renderTable();
}

function closeModal(){
  document.getElementById('fillModal').classList.remove('open');
  activeRowIdx=null;pendingFile=null;
}

// â”€â”€ Utils â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function setSyncStatus(state,label){
  const el=document.getElementById('syncStatus');
  el.className='sync-pill '+state;
  el.innerHTML=state==='syncing'?`<div class="spinner"></div><span>${label}</span>`:`<span>${label}</span>`;
}
function notify(msg,type){
  const el=document.getElementById('notif');
  el.textContent=msg;el.className=`notif ${type} show`;
  setTimeout(()=>el.classList.remove('show'),3500);
}

// â”€â”€ Algeria timezone helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function formatAlgeriaTime(date) {
  if (!date) date = new Date();
  if (typeof date === 'string') date = new Date(date);
  return date.toLocaleString('fr-DZ', {
    timeZone: 'Africa/Algiers',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).replace(',', '');
}

// â”€â”€ Identity (localStorage) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const IDENTITY_KEY = 'examtracker_identity';

function getIdentity() { return localStorage.getItem(IDENTITY_KEY) || ''; }
function setIdentity(email) {
  localStorage.setItem(IDENTITY_KEY, email.trim());
  updateIdentityBtn();
}
function updateIdentityBtn() {
  const email = getIdentity();
  const label = document.getElementById('identityBtnLabel');
  if (label) label.textContent = email ? email : 'Set identity';
}

function showIdentityModal(callback, required) {
  const modal = document.getElementById('identityModal');

  // Clone all three interactive elements to wipe any stale listeners
  let inputEl = document.getElementById('identityInput');
  const newInput = inputEl.cloneNode(true);
  inputEl.parentNode.replaceChild(newInput, inputEl);
  const input = newInput;

  let confirmBtnEl = document.getElementById('identityConfirmBtn');
  const newConfirm = confirmBtnEl.cloneNode(true);
  confirmBtnEl.parentNode.replaceChild(newConfirm, confirmBtnEl);
  const confirmBtn = newConfirm;

  let cancelBtnEl = document.getElementById('identityCancelBtn');
  const newCancel = cancelBtnEl.cloneNode(true);
  cancelBtnEl.parentNode.replaceChild(newCancel, cancelBtnEl);
  const cancelBtn = newCancel;

  input.value = getIdentity();
  modal.classList.remove('hidden');
  setTimeout(() => input.focus(), 60);

  function close(proceed) {
    modal.classList.add('hidden');
    if (proceed && callback) callback();
  }

  confirmBtn.addEventListener('click', () => {
    const v = input.value.trim();
    if (!v) { input.focus(); input.style.borderColor = 'var(--red-border)'; return; }
    input.style.borderColor = '';
    setIdentity(v);
    close(true);
  });
  cancelBtn.addEventListener('click', () => {
    if (required) { notify('Please set your identity before saving.', 'error'); }
    close(false);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmBtn.click();
    if (e.key === 'Escape') cancelBtn.click();
  });
}

function changeIdentity() { showIdentityModal(null, false); }

// â”€â”€ Membre stamp â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildMembreStamp() {
  const email = getIdentity();
  if (!email) return '';
  return `${email} - ${formatAlgeriaTime(new Date())}`;
}

boot();

