let COLS = {
  ID_Exams:0, Wilaya:1, Year:2, Level:3, ExamSession:4, Rotation:4, Period:5,
  categoryId:6, Module:7, ExamDate:8, Status:9,
  OrigPDF:10, AffichagePDF:11, Quiz_Tbl:12, Membre:13, Tags:14, Quiz_Link:15,
  Admin_Report:16, Public_Report:17,
};

const HEADER_ALIASES = {
  ID_Exams: ['ID_Exams'],
  Wilaya: ['Wilaya'],
  Year: ['Year'],
  Level: ['Level'],
  ExamSession: ['ExamSession'],
  Rotation: ['Rotation'],
  Period: ['Period'],
  categoryId: ['categoryId'],
  Module: ['Module'],
  ExamDate: ['ExamDate', 'Exam Date', 'ExamDate '],
  Status: ['Status'],
  OrigPDF: ['OrigPDF', 'Orig_PDF'],
  AffichagePDF: ['AffichagePDF', 'Affichage_PDF'],
  Quiz_Tbl: ['Quiz_Tbl', 'QuizTbl', 'Quiz Table'],
  Membre: ['Membre'],
  Tags: ['Tags'],
  Quiz_Link: ['Quiz_Link', 'QuizLink'],
  Admin_Report: ['Admin_Report'],
  Public_Report: ['Public_Report'],
};

const REQUIRED_HEADERS = ['ID_Exams', 'Year', 'Wilaya', 'Level', 'Module', 'Quiz_Tbl'];

const LEVELS = [
  { key: '1A', label: '1ere Annee' },
  { key: '2A', label: '2eme Annee' },
  { key: '3A', label: '3eme Annee' },
  { key: '4A', label: '4eme Annee' },
  { key: '5A', label: '5eme Annee' },
  { key: '6A', label: '6eme Annee' },
];

let allRows = [];
let years = [];
let wilayas = [];
const DEFAULT_AVAILABILITY_YEAR = '2026';
const DEFAULT_AVAILABILITY_WILAYA = 'Setif';

const qs = new URLSearchParams(location.search);

function resolveCols(headerRow) {
  const norm = s => String(s || '').trim().toLowerCase();
  const map = {};
  (headerRow || []).forEach((h, i) => { map[norm(h)] = i; });
  const next = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = map[norm(alias)];
      if (idx !== undefined) {
        next[key] = idx;
        break;
      }
    }
  }
  const missing = REQUIRED_HEADERS.filter(k => next[k] === undefined);
  if (missing.length > 0) {
    const err = new Error('Missing required sheet column(s): ' + missing.join(', '));
    err.code = 'MISSING_COLUMNS';
    throw err;
  }
  return next;
}

function cell(row, name) {
  const i = COLS[name];
  return row && row[i] !== undefined ? String(row[i] || '').trim() : '';
}

function isPresent(v) {
  return String(v || '').trim() !== '';
}

function isCompleted(row) {
  return getRowStatus(row) === STATUS_COMPLETED;
}

const STATUS_COMPLETED = ExamStatusUtils.STATUS_COMPLETED;
const STATUS_PENDING = ExamStatusUtils.STATUS_PENDING;
const STATUS_NEW_EXAM = ExamStatusUtils.STATUS_NEW_EXAM;
const STATUS_MISSING = ExamStatusUtils.STATUS_MISSING;

function normalizeStatusValue(value) {
  return ExamStatusUtils.normalizeStatusValue(value);
}

function parseExamDateValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;
  const normalized = raw.replace(/\./g, '/').replace(/-/g, '/');
  const parts = normalized.split('/').map(part => part.trim()).filter(Boolean);
  if (parts.length === 3) {
    const [day, month, year] = parts.map(Number);
    if (Number.isInteger(day) && Number.isInteger(month) && Number.isInteger(year)) {
      const alt = new Date(year, month - 1, day);
      if (!Number.isNaN(alt.getTime())) return alt;
    }
  }
  return null;
}

function deriveStatusForRow(row) {
  return ExamStatusUtils.deriveEffectiveStatus(row, cell);
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

function driveOpenInSheetsUrl(url) {
  if (!url) return '';
  const match = String(url).match(/\/d\/([^\/?#]+)/) || String(url).match(/[?&]id=([^&]+)/);
  if (!match) return '';
  return `https://docs.google.com/spreadsheets/d/${match[1]}/edit`;
}

function getRowStatus(row) {
  return deriveStatusForRow(row);
}

function fillOptions(selectEl, items) {
  selectEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const value of items) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    frag.appendChild(opt);
  }
  selectEl.appendChild(frag);
}

function getExamSessionForRow(row) {
  if (!row || !window.ExamSessionUtils) return null;
  return window.ExamSessionUtils.parseExamSession(cell(row, 'ExamSession'), {
    level: cell(row, 'Level'),
    legacyRotation: cell(row, 'Rotation'),
    legacyPeriod: cell(row, 'Period'),
  });
}

function getRawExamSessionToken(row) {
  return String(cell(row, 'ExamSession') || '').trim().toUpperCase();
}

function getSessionBaseLabel(session, row) {
  if (!session || !session.isValid) {
    const rawToken = getRawExamSessionToken(row);
    if (rawToken === 'UEI' || rawToken === 'EMD') return rawToken;
    return '';
  }
  if (session.phase === 'preclinical') return String(session.groupValue || '').trim();
  if (session.phase === 'special') return String(session.specialType || '').trim();
  if (session.phase === 'clinical') {
    if (session.period === 'UNK') return String(session.groupValue || '').trim();
    return String(session.period || '').trim();
  }
  return '';
}

function isClinicalKnownPeriod(session) {
  return !!(session && session.phase === 'clinical' && session.period && session.period !== 'UNK');
}

function getSessionSortRank(session) {
  if (!session || !session.isValid) return 999;
  if (session.phase === 'preclinical') {
    if (session.groupValue === 'S1') return 10;
    if (session.groupValue === 'S2') return 11;
  }
  if (session.phase === 'clinical') {
    if (session.period === 'P1') return 20;
    if (session.period === 'P2') return 21;
    if (session.period === 'P3') return 22;
    if (session.period === 'UNK' && session.groupValue === 'R1') return 30;
    if (session.period === 'UNK' && session.groupValue === 'R2') return 31;
    if (session.period === 'UNK' && session.groupValue === 'R3') return 32;
  }
  if (session.phase === 'special') {
    if (session.specialType === 'RTRPG') return 40;
    if (session.specialType === 'SYNTH') return 41;
  }
  return 90;
}

function getFallbackSessionSortRank(row) {
  const rawToken = getRawExamSessionToken(row);
  if (rawToken === 'UEI') return 12;
  if (rawToken === 'EMD') return 13;
  return 999;
}

function indexToLetters(index) {
  let current = index + 1;
  let out = '';
  while (current > 0) {
    const rem = (current - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    current = Math.floor((current - 1) / 26);
  }
  return out;
}

function buildButtonItems(rows) {
  const items = rows.map(row => {
    const session = getExamSessionForRow(row);
    const baseLabel = getSessionBaseLabel(session, row);
    if (!baseLabel) return null;
    return {
      row,
      session,
      baseLabel,
      label: baseLabel,
      sortRank: session && session.isValid ? getSessionSortRank(session) : getFallbackSessionSortRank(row),
      examId: cell(row, 'ID_Exams'),
      completed: isCompleted(row),
      code: String(session?.code || getRawExamSessionToken(row) || ''),
      examDate: cell(row, 'ExamDate'),
    };
  }).filter(Boolean);

  items.sort((a, b) => {
    const rank = a.sortRank - b.sortRank;
    if (rank) return rank;
    const label = a.baseLabel.localeCompare(b.baseLabel, 'fr');
    if (label) return label;
    const code = a.code.localeCompare(b.code, 'fr');
    if (code) return code;
    const date = a.examDate.localeCompare(b.examDate, 'fr');
    if (date) return date;
    return a.examId.localeCompare(b.examId, 'fr');
  });

  const duplicateGroups = new Map();
  for (const item of items) {
    if (!isClinicalKnownPeriod(item.session)) continue;
    const key = item.baseLabel;
    if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
    duplicateGroups.get(key).push(item);
  }
  duplicateGroups.forEach(group => {
    if (group.length <= 1) return;
    group.forEach((item, index) => {
      item.label = item.baseLabel + ' ' + indexToLetters(index);
    });
  });

  return items;
}

function buttonHtml(item, moduleName) {
  const rowStatus = getRowStatus(item.row);
  const stateClass = rowStatus === STATUS_COMPLETED
    ? 'done'
    : (rowStatus === STATUS_MISSING ? 'missing' : 'pending');
  const visibleLabel = escapeHtml(item.label);
  const availabilityLabel = rowStatus === STATUS_COMPLETED ? 'disponible' : 'non disponible';
  const aria = escapeHtml(moduleName + ' ' + item.label + ' - ' + availabilityLabel);
  if (item.examId) {
    return `<button type="button" class="session-btn ${stateClass}" onclick="openExamPreview('${escapeHtml(item.examId)}')" aria-label="${aria}" title="${aria}">${visibleLabel}</button>`;
  }
  return `<span class="session-btn-static ${stateClass}" aria-label="${aria}" title="${aria}">${visibleLabel}</span>`;
}

function findRowByExamId(examId) {
  const wanted = String(examId || '').trim();
  return allRows.find(row => cell(row, 'ID_Exams') === wanted) || null;
}

function closeExamPreview() {
  document.getElementById('examPreviewModal')?.classList.remove('open');
}

function emptyDetail(label) {
  return `<span class="detail-empty">${escapeHtml(label)}</span>`;
}

function textDetail(value, emptyLabel) {
  const clean = String(value || '').trim();
  return clean ? escapeHtml(clean) : emptyDetail(emptyLabel);
}

function openExamPreview(examId) {
  const row = findRowByExamId(examId);
  if (!row) return;

  const session = getExamSessionForRow(row);
  const modal = document.getElementById('examPreviewModal');
  const title = document.getElementById('examPreviewTitle');
  const sub = document.getElementById('examPreviewSub');
  const body = document.getElementById('examPreviewBody');
  const openLink = document.getElementById('examPreviewOpenLink');
  if (!modal || !title || !sub || !body || !openLink) return;

  title.textContent = `${cell(row, 'Module')} - ${cell(row, 'Wilaya')} ${cell(row, 'Year')}`;
  const chips = [
    cell(row, 'Level'),
    session?.label || getSessionBaseLabel(session, row),
    getRowStatus(row),
  ].filter(Boolean).map(value => `<span class="modal-sub-chip">${escapeHtml(value)}</span>`).join('');
  sub.innerHTML = chips;

  const status = getRowStatus(row);
  const quizTableUrl = cell(row, 'Quiz_Tbl');
  const quizTableOpenUrl = driveOpenInSheetsUrl(quizTableUrl) || quizTableUrl;
  const items = [
    { label: 'Module', html: textDetail(cell(row, 'Module'), 'Not set') },
    { label: 'Session', html: textDetail(session?.label || getSessionBaseLabel(session, row), 'Not set') },
    { label: 'Status', html: getStatusBadgeHtml(status) },
    { label: 'Exam Date', html: textDetail(cell(row, 'ExamDate'), 'Not set') },
    { label: 'Original PDF', html: cell(row, 'OrigPDF') ? `<a href="${escapeHtml(cell(row, 'OrigPDF'))}" target="_blank" rel="noopener">Drive link</a>` : emptyDetail('No PDF') },
    { label: 'Quiz Table', html: quizTableUrl ? `<a href="${escapeHtml(quizTableOpenUrl)}" target="_blank" rel="noopener">Quiz table</a>` : emptyDetail('No quiz table') },
  ];

  body.innerHTML = items.map(item => `
    <div class="detail-item">
      <div class="detail-label">${escapeHtml(item.label)}</div>
      <div class="detail-value">${item.html || item.value}</div>
    </div>
  `).join('');

  openLink.href = `/exam?id=${encodeURIComponent(examId)}`;
  modal.classList.add('open');
}

async function loadData() {
  try {
    const res = await fetch('/api/sheet');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const values = data.values || [];
    if (values.length === 0) throw new Error('Sheet is empty');
    COLS = resolveCols(values[0]);
    allRows = values.slice(1).filter(r => isPresent(cell(r, 'Level')));

    years = [...new Set(allRows.map(r => cell(r, 'Year')).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    wilayas = [...new Set(allRows.map(r => cell(r, 'Wilaya')).filter(Boolean))].sort();

    const fYear = document.getElementById('fYear');
    const fWilaya = document.getElementById('fWilaya');

    fillOptions(fYear, years);
    fillOptions(fWilaya, wilayas);

    const urlYear = qs.get('year');
    const urlWilaya = qs.get('wilaya');
    fYear.value = (urlYear && years.includes(urlYear))
      ? urlYear
      : (years.includes(DEFAULT_AVAILABILITY_YEAR) ? DEFAULT_AVAILABILITY_YEAR : (years[0] || ''));
    fWilaya.value = (urlWilaya && wilayas.includes(urlWilaya))
      ? urlWilaya
      : (wilayas.includes(DEFAULT_AVAILABILITY_WILAYA) ? DEFAULT_AVAILABILITY_WILAYA : (wilayas[0] || ''));

    if (!urlYear && !urlWilaya) {
      const params = new URLSearchParams();
      if (fYear.value) params.set('year', fYear.value);
      if (fWilaya.value) params.set('wilaya', fWilaya.value);
      history.replaceState(null, '', '?' + params.toString());
    }

    document.getElementById('loading').style.display = 'none';
    document.getElementById('cardsGrid').style.display = '';
    render();
  } catch (err) {
    document.getElementById('loading').style.display = 'none';
    const box = document.getElementById('errorBox');
    box.style.display = '';
    document.getElementById('errorDetails').textContent = err.message || String(err);
  }
}

function showToast(message, type = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast ${type} show`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.remove('show'), 3800);
}

async function reloadSheetRowsForAvailability() {
  const res = await fetch('/api/sheet');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const values = data.values || [];
  if (values.length === 0) throw new Error('Sheet is empty');
  COLS = resolveCols(values[0]);
  allRows = values.slice(1).filter(r => isPresent(cell(r, 'Level')));
}

async function refreshAvailabilityStatuses() {
  const btn = document.getElementById('refreshStatusBtn');
  const textEl = document.getElementById('refreshStatusBtnText');
  const originalText = textEl ? textEl.textContent : 'Refresh Status';
  if (btn) btn.disabled = true;
  if (textEl) textEl.textContent = 'Refreshing...';

  try {
    const response = await fetch('/api/status/refresh', { method: 'POST' });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || 'HTTP ' + response.status);

    await reloadSheetRowsForAvailability();
    render();
    showToast(
      `Statuses refreshed: ${result.changedRows || 0} updated, ${result.manualCompletedPreserved || 0} manual Completed preserved`,
      'success'
    );
  } catch (error) {
    showToast('Status refresh failed: ' + (error.message || error), 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (textEl) textEl.textContent = originalText;
  }
}

function onFilterChange() {
  const year = document.getElementById('fYear').value;
  const wilaya = document.getElementById('fWilaya').value;
  const params = new URLSearchParams();
  if (year) params.set('year', year);
  if (wilaya) params.set('wilaya', wilaya);
  history.replaceState(null, '', '?' + params.toString());
  render();
}

function render() {
  const year = document.getElementById('fYear').value;
  const wilaya = document.getElementById('fWilaya').value;
  document.getElementById('pageTitle').textContent =
    `QCM ${year || ''} - Maintenant Disponibles sur la Plateforme`.replace(/\s+/g, ' ').trim();

  const scope = allRows.filter(row =>
    cell(row, 'Year') === year && cell(row, 'Wilaya') === wilaya
  );

  document.getElementById('cardsGrid').innerHTML = LEVELS.map(level => renderCard(level, scope)).join('');
}

function renderCard(level, scope) {
  const rows = scope.filter(row => cell(row, 'Level') === level.key);
  const modules = [...new Set(rows.map(row => cell(row, 'Module')).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'fr'));

  let body = `<div class="empty-card-msg">Aucun module configure</div>`;
  if (modules.length > 0) {
    const moduleRows = modules.map(moduleName => {
      const buttonItems = buildButtonItems(rows.filter(row => cell(row, 'Module') === moduleName));
      const buttonsHtml = buttonItems.length
        ? buttonItems.map(item => buttonHtml(item, moduleName)).join('')
        : `<span class="session-btn-static pending" aria-label="${escapeHtml(moduleName + ' - aucun examen exploitable')}" title="${escapeHtml(moduleName + ' - aucun examen exploitable')}">-</span>`;
      return `
        <div class="module-row">
          <div class="module-name">${escapeHtml(moduleName)}</div>
          <div class="session-buttons">${buttonsHtml}</div>
        </div>`;
    }).join('');
    body = `<div class="module-rows">${moduleRows}</div>`;
  }

  return `
    <div class="card">
      <div class="card-title">${level.label}</div>
      ${body}
    </div>`;
}

const PNG_SCALE_KEY = 'availability.pngScale';
const PNG_SCALE_ALLOWED = ['1', '2', '3'];
const PNG_SCALE_DEFAULT = '2';

function readPngScale() {
  try {
    const value = localStorage.getItem(PNG_SCALE_KEY);
    if (PNG_SCALE_ALLOWED.includes(value)) return value;
  } catch (e) {}
  return PNG_SCALE_DEFAULT;
}

function writePngScale(value) {
  if (!PNG_SCALE_ALLOWED.includes(value)) return;
  try { localStorage.setItem(PNG_SCALE_KEY, value); } catch (e) {}
}

function initPngScaleSelect() {
  const sel = document.getElementById('fPngScale');
  if (sel) sel.value = readPngScale();
}

function onPngScaleChange() {
  const sel = document.getElementById('fPngScale');
  if (sel) writePngScale(sel.value);
}

const PNG_BG_KEY = 'availability.pngBg';
const PNG_BG_ALLOWED = ['gradient', 'transparent'];
const PNG_BG_DEFAULT = 'gradient';

function readPngBg() {
  try {
    const value = localStorage.getItem(PNG_BG_KEY);
    if (PNG_BG_ALLOWED.includes(value)) return value;
  } catch (e) {}
  return PNG_BG_DEFAULT;
}

function writePngBg(value) {
  if (!PNG_BG_ALLOWED.includes(value)) return;
  try { localStorage.setItem(PNG_BG_KEY, value); } catch (e) {}
}

function initPngBgSelect() {
  const sel = document.getElementById('fPngBg');
  if (sel) sel.value = readPngBg();
}

function onPngBgChange() {
  const sel = document.getElementById('fPngBg');
  if (sel) writePngBg(sel.value);
}

async function renderExportCanvas(opts) {
  const scale = (opts && Number(opts.scale)) || 2;
  const transparent = !!(opts && opts.transparent);
  const titleEl = document.getElementById('pageTitle');
  const grid = document.getElementById('cardsGrid');
  if (!grid || grid.style.display === 'none') return null;

  const wrap = document.createElement('div');
  wrap.className = 'export-render';
  if (opts && opts.cols === 2) wrap.classList.add('cols-2');
  if (transparent) wrap.style.background = 'transparent';
  wrap.style.position = 'fixed';
  wrap.style.left = '-10000px';
  wrap.style.top = '0';

  const banner = document.createElement('div');
  banner.className = 'title-banner';
  const h1 = document.createElement('h1');
  h1.textContent = titleEl.textContent;
  banner.appendChild(h1);

  const gridClone = grid.cloneNode(true);
  gridClone.style.display = '';

  wrap.appendChild(banner);
  wrap.appendChild(gridClone);
  document.body.appendChild(wrap);

  try {
    const wrapRect = wrap.getBoundingClientRect();
    const bannerRect = banner.getBoundingClientRect();
    const bannerHeightCss = bannerRect.bottom - wrapRect.top;
    const rowMap = new Map();
    gridClone.querySelectorAll('.card').forEach(card => {
      const rect = card.getBoundingClientRect();
      const topKey = Math.round(rect.top - wrapRect.top);
      const bottom = rect.bottom - wrapRect.top;
      const existing = rowMap.get(topKey);
      if (!existing) rowMap.set(topKey, { top: rect.top - wrapRect.top, bottom });
      else existing.bottom = Math.max(existing.bottom, bottom);
    });
    const sortedRows = Array.from(rowMap.values()).sort((a, b) => a.top - b.top);
    const rowCutsCss = [];
    for (let i = 0; i < sortedRows.length - 1; i += 1) {
      rowCutsCss.push((sortedRows[i].bottom + sortedRows[i + 1].top) / 2);
    }

    const canvas = await html2canvas(wrap, {
      backgroundColor: null,
      scale,
      useCORS: true,
      logging: false,
      windowWidth: wrap.scrollWidth,
      windowHeight: wrap.scrollHeight,
    });

    const rowCuts = rowCutsCss
      .map(value => Math.round(value * scale))
      .filter(value => value > 0 && value < canvas.height);
    const bannerHeightPx = Math.max(1, Math.round(bannerHeightCss * scale));
    return { canvas, rowCuts, bannerHeightPx };
  } finally {
    document.body.removeChild(wrap);
  }
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, '-');
}

const PDF_PREFS_KEY = 'availability.pdfPrefs';
const PDF_FORMATS = ['a4', 'letter'];
const PDF_ORIENTATIONS = ['auto', 'landscape', 'portrait'];

function getPdfPrefs() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(PDF_PREFS_KEY) || '{}') || {}; } catch (e) { stored = {}; }
  const format = PDF_FORMATS.includes(stored.format) ? stored.format : 'a4';
  const orientation = PDF_ORIENTATIONS.includes(stored.orientation) ? stored.orientation : 'auto';
  return { format, orientation };
}

function onPdfPrefsChange() {
  const format = document.getElementById('pdfPageSize').value;
  const orientation = document.getElementById('pdfOrientation').value;
  try { localStorage.setItem(PDF_PREFS_KEY, JSON.stringify({ format, orientation })); } catch (e) {}
}

function initPdfPrefsUI() {
  const prefs = getPdfPrefs();
  const sizeEl = document.getElementById('pdfPageSize');
  const orEl = document.getElementById('pdfOrientation');
  if (sizeEl) sizeEl.value = prefs.format;
  if (orEl) orEl.value = prefs.orientation;
}

async function exportAsImage() {
  const btn = document.getElementById('exportBtn');
  const btnText = document.getElementById('exportBtnText');
  if (typeof html2canvas !== 'function') {
    alert("Le module d'export n'a pas pu etre charge.");
    return;
  }
  const year = document.getElementById('fYear').value || 'all';
  const wilaya = document.getElementById('fWilaya').value || 'all';

  btn.disabled = true;
  const originalText = btnText.textContent;
  btnText.textContent = 'Export...';

  try {
    const scale = Number(readPngScale());
    const bg = readPngBg();
    const transparent = bg === 'transparent';
    const result = await renderExportCanvas({ scale, transparent });
    if (!result) return;
    const canvas = result.canvas;
    const bgSuffix = transparent ? '_transparent' : '';
    const filename = `qcm-disponibles_${safeName(year)}_${safeName(wilaya)}_${scale}x${bgSuffix}.png`;
    canvas.toBlob(blob => {
      if (!blob) {
        alert("Echec de la generation de l'image.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  } catch (err) {
    console.error('Export failed:', err);
    alert("Echec de l'export: " + (err && err.message ? err.message : err));
  } finally {
    btn.disabled = false;
    btnText.textContent = originalText;
  }
}

async function exportAsPdf() {
  const btn = document.getElementById('exportPdfBtn');
  const btnText = document.getElementById('exportPdfBtnText');
  const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (typeof html2canvas !== 'function' || typeof jsPDFCtor !== 'function') {
    alert("Le module d'export PDF n'a pas pu etre charge.");
    return;
  }
  const year = document.getElementById('fYear').value || 'all';
  const wilaya = document.getElementById('fWilaya').value || 'all';

  btn.disabled = true;
  const originalText = btnText.textContent;
  btnText.textContent = 'Export...';

  try {
    const prefs = getPdfPrefs();
    let rendered = await renderExportCanvas({ scale: 2 });
    if (!rendered) return;
    let canvas = rendered.canvas;
    let rowCuts = rendered.rowCuts;
    let bannerHeightPx = rendered.bannerHeightPx;

    let orientation = prefs.orientation;
    if (orientation === 'auto') {
      if (canvas.width >= canvas.height) {
        orientation = 'landscape';
      } else {
        orientation = 'portrait';
        const narrow = await renderExportCanvas({ cols: 2, scale: 2 });
        if (narrow) {
          canvas = narrow.canvas;
          rowCuts = narrow.rowCuts;
          bannerHeightPx = narrow.bannerHeightPx;
        }
      }
    }

    const pdf = new jsPDFCtor({ orientation, unit: 'mm', format: prefs.format });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;
    const mmPerPx = maxW / canvas.width;
    const fullImgH = canvas.height * mmPerPx;

    if (fullImgH <= maxH) {
      const imgW = maxW;
      const imgH = fullImgH;
      const x = margin;
      const y = (pageH - imgH) / 2;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      pdf.addImage(dataUrl, 'JPEG', x, y, imgW, imgH, undefined, 'FAST');
    } else {
      const bannerMM = bannerHeightPx * mmPerPx;
      const bannerCanvas = document.createElement('canvas');
      bannerCanvas.width = canvas.width;
      bannerCanvas.height = bannerHeightPx;
      bannerCanvas.getContext('2d').drawImage(
        canvas, 0, 0, canvas.width, bannerHeightPx,
        0, 0, canvas.width, bannerHeightPx
      );
      const bannerDataUrl = bannerCanvas.toDataURL('image/jpeg', 0.92);

      const sliceMaxPxFirst = Math.floor(maxH / mmPerPx);
      const sliceMaxPxRest = Math.max(1, Math.floor((maxH - bannerMM) / mmPerPx));
      const sortedCuts = rowCuts.slice().sort((a, b) => a - b);

      const splits = [];
      let startY = 0;
      let guard = 0;
      while (startY < canvas.height && guard < 400) {
        guard += 1;
        const sliceMaxPx = splits.length === 0 ? sliceMaxPxFirst : sliceMaxPxRest;
        const remaining = canvas.height - startY;
        let endY;
        if (remaining <= sliceMaxPx) {
          endY = canvas.height;
        } else {
          const target = startY + sliceMaxPx;
          let best = -1;
          for (const cut of sortedCuts) {
            if (cut > startY && cut <= target) best = cut;
            else if (cut > target) break;
          }
          endY = best > 0 ? best : target;
        }
        if (endY <= startY) endY = Math.min(canvas.height, startY + sliceMaxPx);
        splits.push({ startY, endY });
        startY = endY;
      }
      const totalPages = splits.length;

      splits.forEach((part, idx) => {
        const isFirst = idx === 0;
        const sliceH = part.endY - part.startY;
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = sliceH;
        slice.getContext('2d').drawImage(
          canvas, 0, part.startY, canvas.width, sliceH,
          0, 0, canvas.width, sliceH
        );
        const dataUrl = slice.toDataURL('image/jpeg', 0.92);
        const imgW = maxW;
        const imgH = sliceH * mmPerPx;
        if (!isFirst) pdf.addPage(prefs.format, orientation);
        if (isFirst) {
          pdf.addImage(dataUrl, 'JPEG', margin, margin, imgW, imgH, undefined, 'FAST');
        } else {
          pdf.addImage(bannerDataUrl, 'JPEG', margin, margin, imgW, bannerMM, undefined, 'FAST');
          pdf.addImage(dataUrl, 'JPEG', margin, margin + bannerMM, imgW, imgH, undefined, 'FAST');
        }
        try {
          pdf.setFontSize(9);
          pdf.setTextColor(120);
          pdf.text(`Page ${idx + 1} / ${totalPages}`, pageW - margin, pageH - margin / 2, { align: 'right' });
        } catch (e) {}
      });
    }
    pdf.save(`qcm-disponibles_${safeName(year)}_${safeName(wilaya)}.pdf`);
  } catch (err) {
    console.error('PDF export failed:', err);
    alert("Echec de l'export PDF: " + (err && err.message ? err.message : err));
  } finally {
    btn.disabled = false;
    btnText.textContent = originalText;
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

initPdfPrefsUI();
initPngScaleSelect();
initPngBgSelect();
document.getElementById('examPreviewModal')?.addEventListener('click', event => {
  if (event.target === event.currentTarget) closeExamPreview();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const modal = document.getElementById('examPreviewModal');
  if (!modal?.classList.contains('open')) return;
  closeExamPreview();
});
loadData();

