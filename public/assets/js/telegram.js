const state = {
  config:null,
  spreadsheets:[],
  sheets:[],
  channels:[],
  groups:[],
  selectedChannels:new Set(),
  activeGroup:'All',
  jobs:new Map(),
  timers:new Map(),
  actionRows:[],
  selectedActionRowIndex:null,
  selectedActionRows:new Set(),
  isCollectionsRoute:false,
  collectionSearch:'',
  collectionView:'toggle',
  collectionListSort:'sheet',
  openCollectionToggles:new Set(),
  collectionRowOrder:new Map(),
  collectionIncludedRows:new Map(),
  draggingCollectionRow:null,
  actionPresets:[],
  selectedPresetId:'',
  presetManagerOpen:false,
  addChannelSaving:false,
};
const MAX_POLL_ERRORS = 5;
const POLL_INTERVAL = 3000;
const STORAGE_KEY = 'telegram_fetcher_ui_v1';
const actionHelper = window.TelegramActionBuilder;
const els = {
  spreadsheetSelect: document.getElementById('spreadsheetSelect'),
  sheetSelect: document.getElementById('sheetSelect'),
  sheetHint: document.getElementById('sheetHint'),
  groupBar: document.getElementById('groupBar'),
  channelSearch: document.getElementById('channelSearch'),
  channelList: document.getElementById('channelList'),
  selectedCount: document.getElementById('selectedCount'),
  refreshChannelsFromTelegramBtn: document.getElementById('refreshChannelsFromTelegramBtn'),
  addChannelBtn: document.getElementById('addChannelBtn'),
  addChannelModal: document.getElementById('addChannelModal'),
  addChannelForm: document.getElementById('addChannelForm'),
  addChannelNameInput: document.getElementById('addChannelNameInput'),
  addChannelLinkInput: document.getElementById('addChannelLinkInput'),
  addChannelStatus: document.getElementById('addChannelStatus'),
  closeAddChannelModalBtn: document.getElementById('closeAddChannelModalBtn'),
  cancelAddChannelBtn: document.getElementById('cancelAddChannelBtn'),
  saveAddChannelBtn: document.getElementById('saveAddChannelBtn'),
  workerPill: document.getElementById('workerPill'),
  workerSummary: document.getElementById('workerSummary'),
  jobs: document.getElementById('jobs'),
  log: document.getElementById('log'),
  dateFromInput: document.getElementById('dateFromInput'),
  startMessageInput: document.getElementById('startMessageInput'),
  endMessageInput: document.getElementById('endMessageInput'),
  fetchCommentsInput: document.getElementById('fetchCommentsInput'),
  maxCommentsInput: document.getElementById('maxCommentsInput'),
  openSheetBtn: document.getElementById('openSheetBtn'),
  loadActionRowsBtn: document.getElementById('loadActionRowsBtn'),
  saveActionRowBtn: document.getElementById('saveActionRowBtn'),
  createGroupBtn: document.getElementById('createGroupBtn'),
  ungroupRowsBtn: document.getElementById('ungroupRowsBtn'),
  actionBuilderSummary: document.getElementById('actionBuilderSummary'),
  actionRowList: document.getElementById('actionRowList'),
  actionEditorStatus: document.getElementById('actionEditorStatus'),
  actionModeSelect: document.getElementById('actionModeSelect'),
  actionRawWrap: document.getElementById('actionRawWrap'),
  actionRawActionInput: document.getElementById('actionRawActionInput'),
  actionGroupedInput: document.getElementById('actionGroupedInput'),
  actionDestinationInput: document.getElementById('actionDestinationInput'),
  actionDestinationSuggestions: document.getElementById('actionDestinationSuggestions'),
  actionExtraMsgInput: document.getElementById('actionExtraMsgInput'),
  actionTransferModeSelect: document.getElementById('actionTransferModeSelect'),
  actionPubLnkEnabledInput: document.getElementById('actionPubLnkEnabledInput'),
  actionPubLinkModeSelect: document.getElementById('actionPubLinkModeSelect'),
  actionPubLinkBody: document.getElementById('actionPubLinkBody'),
  actionNumSequenceInput: document.getElementById('actionNumSequenceInput'),
  actionPunctBlankInput: document.getElementById('actionPunctBlankInput'),
  actionPunctControlsWrap: document.getElementById('actionPunctControlsWrap'),
  actionPunctPresetSelect: document.getElementById('actionPunctPresetSelect'),
  actionPunctValueInput: document.getElementById('actionPunctValueInput'),
  actionJoinUsInput: document.getElementById('actionJoinUsInput'),
  actionJoinUsBody: document.getElementById('actionJoinUsBody'),
  actionCommentJoinUsModeSelect: document.getElementById('actionCommentJoinUsModeSelect'),
  actionPreviewOutput: document.getElementById('actionPreviewOutput'),
  actionPreviewSummary: document.getElementById('actionPreviewSummary'),
  collectionSearchInput: document.getElementById('collectionSearchInput'),
  collectionViewTabs: document.getElementById('collectionViewTabs'),
  collectionSortTools: document.getElementById('collectionSortTools'),
  collectionSnapshot: document.getElementById('collectionSnapshot'),
  presetSelect: document.getElementById('presetSelect'),
  applyPresetBtn: document.getElementById('applyPresetBtn'),
  savePresetBtn: document.getElementById('savePresetBtn'),
  togglePresetManagerBtn: document.getElementById('togglePresetManagerBtn'),
  presetStatus: document.getElementById('presetStatus'),
  presetManager: document.getElementById('presetManager'),
  presetModeStructuredRadio: document.getElementById('presetModeStructuredRadio'),
  presetModeRawRadio: document.getElementById('presetModeRawRadio'),
  presetNameInput: document.getElementById('presetNameInput'),
  presetDescriptionInput: document.getElementById('presetDescriptionInput'),
  presetModeSelect: document.getElementById('presetModeSelect'),
  presetRawActionInput: document.getElementById('presetRawActionInput'),
  presetGroupedInput: document.getElementById('presetGroupedInput'),
  presetTransferModeSelect: document.getElementById('presetTransferModeSelect'),
  presetPubLnkEnabledInput: document.getElementById('presetPubLnkEnabledInput'),
  presetPubLinkModeSelect: document.getElementById('presetPubLinkModeSelect'),
  presetNumSequenceInput: document.getElementById('presetNumSequenceInput'),
  presetPunctBlankInput: document.getElementById('presetPunctBlankInput'),
  presetPunctControlsWrap: document.getElementById('presetPunctControlsWrap'),
  presetPunctPresetSelect: document.getElementById('presetPunctPresetSelect'),
  presetPunctValueInput: document.getElementById('presetPunctValueInput'),
  presetJoinUsInput: document.getElementById('presetJoinUsInput'),
  presetJoinUsBody: document.getElementById('presetJoinUsBody'),
  presetCommentJoinUsModeSelect: document.getElementById('presetCommentJoinUsModeSelect'),
  presetPreviewOutput: document.getElementById('presetPreviewOutput'),
  createPresetBtn: document.getElementById('createPresetBtn'),
  updatePresetBtn: document.getElementById('updatePresetBtn'),
  deletePresetBtn: document.getElementById('deletePresetBtn'),
  selectedPresetMatch: document.getElementById('selectedPresetMatch'),
  fetchWorkspace: document.getElementById('fetchWorkspace'),
  collectionsWorkspace: document.getElementById('collectionsWorkspace'),
  collectionsHero: document.getElementById('collectionsHero'),
  fetchTabLink: document.getElementById('fetchTabLink'),
  collectionsTabLink: document.getElementById('collectionsTabLink'),
  tabSummary: document.getElementById('tabSummary'),
};

const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const DEFAULT_PUNCT_SYMBOLS = ['*', '-', 'â€¢', '>>', 'ًں”¹'];

function getChannelSelectionKey(channel) {
  return channel?.id || channel?.username || channel?.name || '';
}

function normalizeLookupText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[@_\-./\\]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeLookupText(value) {
  return normalizeLookupText(value).split(' ').filter(Boolean);
}

function isSubsequenceMatch(query, target) {
  if (!query) return true;
  let index = 0;
  for (const char of target) {
    if (char === query[index]) index += 1;
    if (index >= query.length) return true;
  }
  return false;
}

function getPunctValueFromControls(selectEl, inputEl) {
  const selectValue = String(selectEl?.value || '').trim();
  if (selectValue === 'custom') return String(inputEl?.value || '').trim();
  return selectValue;
}

function syncPunctControls(selectEl, inputEl, value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    selectEl.value = '';
    inputEl.value = '';
    inputEl.disabled = true;
    return;
  }
  const knownValues = Array.from(selectEl?.options || []).map((option) => option.value).filter((optionValue) => optionValue && optionValue !== 'custom');
  if (knownValues.includes(normalized)) {
    selectEl.value = normalized;
    inputEl.value = '';
    inputEl.disabled = true;
    return;
  }
  selectEl.value = 'custom';
  inputEl.value = normalized;
  inputEl.disabled = false;
}

function updatePunctControls(selectEl, inputEl) {
  const isCustom = String(selectEl?.value || '') === 'custom';
  inputEl.disabled = !isCustom;
  if (!isCustom) inputEl.value = '';
}

function getActionEditorMode() {
  return els.actionModeSelect?.value === 'raw_override' ? 'raw_override' : 'structured';
}

function inferPubLinkMode(model) {
  if (model?.pubLnk?.punctValue) return 'symbol';
  return 'numbered';
}

function syncActionPubLinkMode() {
  const mode = String(els.actionPubLinkModeSelect?.value || 'numbered');
  els.actionNumSequenceInput.checked = mode === 'numbered';
  els.actionPunctBlankInput.checked = true;
  const showSymbols = mode === 'symbol';
  els.actionPunctControlsWrap?.classList.toggle('section-hidden', !showSymbols);
}

function syncActionEditorSections() {
  const rawMode = getActionEditorMode() === 'raw_override';
  els.actionRawWrap?.classList.toggle('section-hidden', !rawMode);

  const pubEnabled = !rawMode && Boolean(els.actionPubLnkEnabledInput?.checked);
  const joinUsEnabled = !rawMode && Boolean(els.actionJoinUsInput?.checked);
  els.actionPubLinkBody?.classList.toggle('config-disabled', !pubEnabled);
  els.actionJoinUsBody?.classList.toggle('config-disabled', !joinUsEnabled);
  els.actionJoinUsBody?.classList.toggle('section-hidden', !joinUsEnabled);

  if (els.actionPubLinkModeSelect) els.actionPubLinkModeSelect.disabled = rawMode || !pubEnabled;
  if (els.actionPunctPresetSelect) els.actionPunctPresetSelect.disabled = rawMode || !pubEnabled || els.actionPubLinkModeSelect.value !== 'symbol';
  if (els.actionPunctValueInput) els.actionPunctValueInput.disabled = rawMode || !pubEnabled || els.actionPubLinkModeSelect.value !== 'symbol' || els.actionPunctPresetSelect.value !== 'custom';
  if (els.actionCommentJoinUsModeSelect) els.actionCommentJoinUsModeSelect.disabled = rawMode || !joinUsEnabled;
  if (els.actionGroupedInput) els.actionGroupedInput.disabled = rawMode;
  if (els.actionTransferModeSelect) els.actionTransferModeSelect.disabled = rawMode;
  syncActionPubLinkMode();
}

function scoreDestinationChannel(query, channel) {
  const rawQuery = String(query || '').trim();
  if (!rawQuery) return 1;
  const normalizedQuery = normalizeLookupText(rawQuery);
  if (!normalizedQuery) return 1;

  const rawValues = [
    channel?.name,
    channel?.username ? `@${channel.username}` : '',
    channel?.id,
    ...(channel?.tags || []),
  ].filter(Boolean);
  const normalizedValues = rawValues.map((value) => normalizeLookupText(value)).filter(Boolean);
  const joined = normalizedValues.join(' ');
  if (!joined) return 0;

  if (normalizedValues.some((value) => value === normalizedQuery)) return 120;
  if (joined.includes(normalizedQuery)) return 95;

  const queryTokens = tokenizeLookupText(rawQuery);
  if (!queryTokens.length) return 0;
  const matchedTokens = queryTokens.filter((token) => joined.includes(token));
  let score = matchedTokens.length * 18;

  if (matchedTokens.length === queryTokens.length) score += 32;
  if (queryTokens.every((token) => normalizedValues.some((value) => value.includes(token)))) score += 14;
  if (isSubsequenceMatch(normalizedQuery.replace(/\s+/g, ''), joined.replace(/\s+/g, ''))) score += 6;

  return score;
}

function getRankedDestinationChannels(query) {
  return state.channels
    .map((channel) => ({ channel, score: scoreDestinationChannel(query, channel) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || getActionDestinationLabel(left.channel).localeCompare(getActionDestinationLabel(right.channel)));
}

function getResolvedDestinationInputValue() {
  const selectedValue = String(els.actionDestinationInput.dataset.destinationValue || '').trim();
  if (selectedValue) return selectedValue;
  const rawValue = String(els.actionDestinationInput.value || '').trim();
  if (!rawValue) return '';
  const ranked = getRankedDestinationChannels(rawValue);
  const best = ranked[0];
  if (best && best.score >= 32) return getActionDestinationValue(best.channel);
  return rawValue;
}

function hideDestinationSuggestions() {
  els.actionDestinationSuggestions.classList.add('hidden');
  els.actionDestinationSuggestions.innerHTML = '';
}

function applyDestinationSelection(channel) {
  els.actionDestinationInput.dataset.destinationValue = getActionDestinationValue(channel);
  els.actionDestinationInput.value = channel?.name || (channel?.username ? `@${channel.username}` : getActionDestinationValue(channel));
  hideDestinationSuggestions();
  renderActionPreview();
}

function normalizeActionEditorLabels() {
  if (els.actionPunctPresetSelect) {
    const options = els.actionPunctPresetSelect.options;
    if (options[0]) options[0].text = 'Choose a symbol';
    if (options[1]) options[1].text = '*  Star';
    if (options[2]) options[2].text = '-  Dash';
    if (options[3]) options[3].text = 'â€¢  Bullet';
    if (options[4]) options[4].text = '>>  Double chevron';
    if (options[5]) options[5].text = 'ًں”¹  Blue diamond';
    if (options[3]) options[3].value = '\u2022';
    if (options[5]) options[5].value = '\u{1F539}';
  }
  if (els.presetPunctPresetSelect) {
    const options = els.presetPunctPresetSelect.options;
    if (options[0]) options[0].text = 'Choose a symbol';
    if (options[1]) options[1].text = '*  Star';
    if (options[2]) options[2].text = '-  Dash';
    if (options[3]) options[3].text = 'â€¢  Bullet';
    if (options[4]) options[4].text = '>>  Double chevron';
    if (options[5]) options[5].text = 'ًں”¹  Blue diamond';
    if (options[3]) options[3].value = '\u2022';
    if (options[5]) options[5].value = '\u{1F539}';
  }
}

normalizeActionEditorLabels();

function getRangeMode() {
  return document.querySelector('input[name="rangeMode"]:checked')?.value || 'date';
}

function loadPersistedUi() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('Failed to load saved Telegram fetcher state.', error);
    return {};
  }
}

function buildPersistedUi() {
  const selectedSheetBySpreadsheet = { ...(state.persisted?.selectedSheetBySpreadsheet || {}) };
  const spreadsheetKey = els.spreadsheetSelect.value || state.persisted?.spreadsheetKey || '';
  if (spreadsheetKey && els.sheetSelect.value) {
    selectedSheetBySpreadsheet[spreadsheetKey] = els.sheetSelect.value;
  }
  return {
    spreadsheetKey,
    selectedSheetBySpreadsheet,
    channelSearch: els.channelSearch.value,
    activeGroup: state.activeGroup,
    selectedChannels: [...state.selectedChannels],
    rangeMode: getRangeMode(),
    dateFrom: els.dateFromInput.value,
    startMessageId: els.startMessageInput.value,
    endMessageId: els.endMessageInput.value,
    fetchComments: els.fetchCommentsInput.checked,
    maxCommentsPerPost: els.maxCommentsInput.value || '50',
  };
}

function savePersistedUi() {
  try {
    state.persisted = buildPersistedUi();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.persisted));
  } catch (error) {
    console.warn('Failed to save Telegram fetcher state.', error);
  }
}

function applyPersistedInputs() {
  state.persisted = loadPersistedUi();
  els.channelSearch.value = state.persisted.channelSearch || '';
  els.dateFromInput.value = state.persisted.dateFrom || '';
  els.startMessageInput.value = state.persisted.startMessageId || '';
  els.endMessageInput.value = state.persisted.endMessageId || '';
  els.fetchCommentsInput.checked = Boolean(state.persisted.fetchComments);
  els.maxCommentsInput.value = state.persisted.maxCommentsPerPost || '50';
  state.activeGroup = state.persisted.activeGroup || 'All';
  state.selectedChannels = new Set(Array.isArray(state.persisted.selectedChannels) ? state.persisted.selectedChannels : []);
  const savedMode = state.persisted.rangeMode === 'message_id' ? 'message_id' : 'date';
  const radio = document.querySelector(`input[name="rangeMode"][value="${savedMode}"]`);
  if (radio) radio.checked = true;
}

function getFilteredActionRows() {
  const search = String(state.collectionSearch || '').trim().toLowerCase();
  const rows = !search ? [...state.actionRows] : state.actionRows.filter((row) => {
    const haystack = [
      row.collection,
      row.title,
      row.preview,
      row.destination,
      row.extraMsg,
      row.actionSummary,
      ...(row.rowIndexes || []).map(String),
    ].join(' ').toLowerCase();
    return haystack.includes(search);
  });
  if (state.collectionListSort === 'az') {
    rows.sort((a, b) => String(a.collection || '').localeCompare(String(b.collection || '')));
  } else {
    rows.sort((a, b) => Number(a.leaderRowIndex || 0) - Number(b.leaderRowIndex || 0));
  }
  return rows;
}

function getCollectionOrder(row) {
  const baseOrder = (row.relatedRows || []).map((item) => Number(item.rowIndex)).filter(Boolean);
  const stored = state.collectionRowOrder.get(row.leaderRowIndex);
  if (!stored || stored.length !== baseOrder.length || stored.some((value) => !baseOrder.includes(value))) {
    state.collectionRowOrder.set(row.leaderRowIndex, [...baseOrder]);
    return baseOrder;
  }
  return [...stored];
}

function getCollectionIncludedSet(row) {
  const allRows = (row.relatedRows || []).map((item) => Number(item.rowIndex)).filter(Boolean);
  const stored = state.collectionIncludedRows.get(row.leaderRowIndex);
  if (!stored || [...stored].some((value) => !allRows.includes(value))) {
    const next = new Set(allRows);
    state.collectionIncludedRows.set(row.leaderRowIndex, next);
    return next;
  }
  if (allRows.some((value) => !stored.has(value))) {
    const merged = new Set([...stored, ...allRows]);
    state.collectionIncludedRows.set(row.leaderRowIndex, merged);
    return merged;
  }
  return stored;
}

function getOrderedRelatedRows(row) {
  const order = getCollectionOrder(row);
  const byIndex = new Map((row.relatedRows || []).map((item) => [Number(item.rowIndex), item]));
  return order.map((rowIndex) => byIndex.get(rowIndex)).filter(Boolean);
}

function buildPresetEditorModel() {
  const presetPubLinkMode = String(els.presetPubLinkModeSelect?.value || 'numbered');
  els.presetNumSequenceInput.checked = presetPubLinkMode === 'numbered';
  els.presetPunctBlankInput.checked = true;
  return {
    grouped: els.presetGroupedInput.checked,
    transferMode: els.presetTransferModeSelect.value,
    pubLnk: {
      enabled: els.presetPubLnkEnabledInput.checked,
      numSequence: els.presetNumSequenceInput.checked,
      punctBlank: els.presetPunctBlankInput.checked,
      punctValue: getPunctValueFromControls(els.presetPunctPresetSelect, els.presetPunctValueInput),
      joinUs: els.presetJoinUsInput.checked,
      commentJoinUsMode: els.presetJoinUsInput.checked ? els.presetCommentJoinUsModeSelect.value : 'none',
    },
  };
}

function syncPresetEditorSections() {
  const rawMode = els.presetModeSelect.value === 'raw_override';
  const pubEnabled = !rawMode && Boolean(els.presetPubLnkEnabledInput?.checked);
  const joinUsEnabled = !rawMode && Boolean(els.presetJoinUsInput?.checked);
  els.presetPunctControlsWrap?.classList.toggle('section-hidden', !pubEnabled || els.presetPubLinkModeSelect?.value !== 'symbol');
  els.presetJoinUsBody?.classList.toggle('section-hidden', !joinUsEnabled);
  if (els.presetPubLinkModeSelect) els.presetPubLinkModeSelect.disabled = rawMode || !pubEnabled;
  if (els.presetPunctPresetSelect) els.presetPunctPresetSelect.disabled = rawMode || !pubEnabled || els.presetPubLinkModeSelect.value !== 'symbol';
  if (els.presetPunctValueInput) els.presetPunctValueInput.disabled = rawMode || !pubEnabled || els.presetPubLinkModeSelect.value !== 'symbol' || els.presetPunctPresetSelect.value !== 'custom';
  if (els.presetCommentJoinUsModeSelect) els.presetCommentJoinUsModeSelect.disabled = rawMode || !joinUsEnabled;
}

function getSelectedCollectionLeaderIndexes() {
  return [...state.selectedActionRows].map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 2);
}

function getTargetCollectionRowsForSave() {
  const selectedLeaderIndexes = getSelectedCollectionLeaderIndexes();
  if (selectedLeaderIndexes.length) {
    const selectedRows = selectedLeaderIndexes
      .map((leaderRowIndex) => getActionRow(leaderRowIndex))
      .filter(Boolean);
    if (selectedRows.length) return selectedRows;
  }
  const activeRow = getSelectedActionRow();
  return activeRow ? [activeRow] : [];
}

function findMatchingPresetForRow(row) {
  if (!row) return null;
  const rowAction = String(row.action || '').trim();
  const structuredPreview = actionHelper.serializeActionModel(row.actionModel || actionHelper.parseActionString(rowAction || ''));
  return state.actionPresets.find((preset) => {
    if (preset.mode === 'raw_override') {
      return String(preset.rawAction || '').trim() === rowAction;
    }
    return String(preset.actionPreview || '').trim() === structuredPreview;
  }) || null;
}

function renderPresetPreview() {
  const mode = els.presetModeSelect.value === 'raw_override' ? 'raw_override' : 'structured';
  els.presetModeStructuredRadio.checked = mode === 'structured';
  els.presetModeRawRadio.checked = mode === 'raw_override';
  els.presetRawActionInput.disabled = mode !== 'raw_override';
  updatePunctControls(els.presetPunctPresetSelect, els.presetPunctValueInput);
  [
    els.presetGroupedInput,
    els.presetTransferModeSelect,
    els.presetPubLnkEnabledInput,
    els.presetNumSequenceInput,
    els.presetPunctBlankInput,
    els.presetPunctPresetSelect,
    els.presetJoinUsInput,
    els.presetCommentJoinUsModeSelect,
  ].forEach((control) => {
    control.disabled = mode === 'raw_override';
  });
  syncPresetEditorSections();
  els.presetPreviewOutput.value = mode === 'raw_override'
    ? (els.presetRawActionInput.value || '').trim()
    : actionHelper.serializeActionModel(buildPresetEditorModel());
}

function populatePresetEditor(preset) {
  const target = preset || {};
  els.presetNameInput.value = target.name || '';
  els.presetDescriptionInput.value = target.description || '';
  els.presetModeSelect.value = target.mode === 'raw_override' ? 'raw_override' : 'structured';
  els.presetRawActionInput.value = target.rawAction || '';
  const model = target.actionModel || { grouped: true, transferMode: 'none', pubLnk: {} };
  els.presetGroupedInput.checked = Boolean(model.grouped ?? true);
  els.presetTransferModeSelect.value = model.transferMode || 'none';
  els.presetPubLnkEnabledInput.checked = target.mode === 'raw_override' ? Boolean(model.pubLnk?.enabled) : true;
  els.presetPubLinkModeSelect.value = inferPubLinkMode(model);
  els.presetNumSequenceInput.checked = Boolean(model.pubLnk?.numSequence);
  els.presetPunctBlankInput.checked = true;
  syncPunctControls(els.presetPunctPresetSelect, els.presetPunctValueInput, model.pubLnk?.punctValue || '');
  els.presetJoinUsInput.checked = Boolean(model.pubLnk?.joinUs);
  els.presetCommentJoinUsModeSelect.value = model.pubLnk?.commentJoinUsMode || 'append_joinus';
  renderPresetPreview();
}

function renderPresetPicker() {
  els.presetSelect.innerHTML = `<option value="">Choose a preset</option>${state.actionPresets.map((preset) =>
    `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`
  ).join('')}`;
  els.presetSelect.value = state.selectedPresetId || '';
  const selectedPreset = state.actionPresets.find((preset) => preset.id === state.selectedPresetId) || null;
  els.presetStatus.textContent = selectedPreset
    ? `${selectedPreset.name}: ${selectedPreset.description || selectedPreset.actionSummary || 'No actions'}`
    : 'Presets are shared across sheets and only change action logic, not destination.';
  if (state.presetManagerOpen) {
    populatePresetEditor(selectedPreset);
  }
}

function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  els.log.textContent = `[${timestamp}] ${message}\n` + els.log.textContent;
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (error) { data = null; }
  if (!response.ok) {
    if (data && data.error) throw new Error(data.error);
    throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 180)}` : ''}`);
  }
  return data || {};
}

function presentError(error, fallback = 'Something went wrong.') {
  const message = String(error?.message || fallback).trim();
  if (message.includes('Google Sheets is temporarily unavailable')) {
    return 'Google Sheets is temporarily unavailable. Please wait a few seconds and try again.';
  }
  if (message.includes('"status":"UNAVAILABLE"') || message.includes('The service is currently unavailable.')) {
    return 'Google Sheets is temporarily unavailable. Please wait a few seconds and try again.';
  }
  if (message.includes('Contacts session is missing or expired')) {
    return 'Your contacts session expired. Reload the page and try again.';
  }
  return message || fallback;
}

function renderWorkerStatus() {
  const health = state.config?.workerHealth || {};
  const connected = Boolean(health.telethonConnected);
  els.workerPill.className = `pill ${connected ? 'ok' : (health.ok ? 'warn' : 'err')}`;
  els.workerPill.textContent = connected ? 'Worker connected' : (health.ok ? 'Worker reachable' : 'Worker unavailable');
  els.workerSummary.textContent = connected
    ? 'Telethon is connected and ready for fetch/action jobs.'
    : (health.error || 'Worker is reachable but Telethon is not fully connected yet.');
}

function renderSpreadsheets() {
  els.spreadsheetSelect.innerHTML = state.spreadsheets.map((entry) => `<option value="${escapeHtml(entry.key)}">${escapeHtml(entry.label)}</option>`).join('');
  const savedSpreadsheetKey = state.persisted?.spreadsheetKey;
  if (savedSpreadsheetKey && state.spreadsheets.some((entry) => entry.key === savedSpreadsheetKey)) {
    els.spreadsheetSelect.value = savedSpreadsheetKey;
  } else if (state.spreadsheets[0]?.key) {
    els.spreadsheetSelect.value = state.spreadsheets[0].key;
  }
  savePersistedUi();
}

function renderSheets() {
  els.sheetSelect.innerHTML = state.sheets.map((sheet) => `<option value="${escapeHtml(sheet.title)}">${escapeHtml(sheet.title)}</option>`).join('');
  const spreadsheetKey = els.spreadsheetSelect.value;
  const savedSheet = state.persisted?.selectedSheetBySpreadsheet?.[spreadsheetKey];
  if (savedSheet && state.sheets.some((sheet) => sheet.title === savedSheet)) {
    els.sheetSelect.value = savedSheet;
  } else if (state.sheets[0]?.title) {
    els.sheetSelect.value = state.sheets[0].title;
  }
  const spreadsheet = state.spreadsheets.find((entry) => entry.key === els.spreadsheetSelect.value);
  els.sheetHint.textContent = spreadsheet
    ? `${spreadsheet.label} â†’ ${spreadsheet.spreadsheetId}`
    : '';
  savePersistedUi();
  if (spreadsheet) {
    els.sheetHint.textContent = `${spreadsheet.label} -> ${spreadsheet.spreadsheetId}`;
  }
}

function applyRouteLayout() {
  state.isCollectionsRoute = window.location.pathname.replace(/\/+$/, '') === '/telegram/collections';
  document.body.classList.toggle('collections-route', state.isCollectionsRoute);
  els.fetchTabLink.classList.toggle('active', !state.isCollectionsRoute);
  els.collectionsTabLink.classList.toggle('active', state.isCollectionsRoute);
  els.fetchWorkspace.classList.toggle('section-hidden', state.isCollectionsRoute);
  els.collectionsHero.classList.toggle('section-hidden', !state.isCollectionsRoute);
  document.title = state.isCollectionsRoute ? 'Telegram Collections' : 'Telegram Fetcher';
  els.tabSummary.textContent = state.isCollectionsRoute
    ? 'Collections tab: all collection groups in one dedicated workspace.'
    : 'Fetch tab: sheets, channels, and jobs with the collection builder kept below.';
}

function renderGroups() {
  const groups = ['All', ...state.groups];
  if (!groups.includes(state.activeGroup)) {
    state.activeGroup = 'All';
  }
  els.groupBar.innerHTML = groups.map((group) => `<button class="group-chip ${group === state.activeGroup ? 'active' : ''}" type="button" data-group="${escapeHtml(group)}">${escapeHtml(group)}</button>`).join('');
}

function getVisibleChannels() {
  const search = els.channelSearch.value.trim().toLowerCase();
  return state.channels.filter((channel) => {
    const matchesGroup = state.activeGroup === 'All' || (channel.tags || []).includes(state.activeGroup);
    const haystack = [channel.name, channel.username, channel.id, ...(channel.tags || [])].join(' ').toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    return matchesGroup && matchesSearch;
  });
}

function renderChannels() {
  const channelKeys = new Set(state.channels.map((channel) => getChannelSelectionKey(channel)).filter(Boolean));
  state.selectedChannels = new Set([...state.selectedChannels].filter((key) => channelKeys.has(key)));
  const visible = getVisibleChannels();
  if (!visible.length) {
    els.channelList.innerHTML = '<div class="channel-row"><div class="muted">No channels match the current filters.</div></div>';
  } else {
    els.channelList.innerHTML = visible.map((channel) => {
      const checked = state.selectedChannels.has(getChannelSelectionKey(channel));
      const tagHtml = (channel.tags || []).map((tag) => `<span class="tag alt">${escapeHtml(tag)}</span>`).join('');
      return `<label class="channel-row">
        <input type="checkbox" class="channel-check" data-channel-key="${escapeHtml(getChannelSelectionKey(channel))}" ${checked ? 'checked' : ''}>
        <div>
          <div class="channel-name">${escapeHtml(channel.name || channel.username || channel.id)}</div>
          <div class="muted">${escapeHtml(channel.username ? `@${channel.username}` : channel.id || '')}</div>
          <div class="channel-tags">${tagHtml}</div>
        </div>
        <div class="muted">${escapeHtml(channel.type || '')}</div>
      </label>`;
    }).join('');
  }
  els.selectedCount.textContent = `${state.selectedChannels.size} channels selected`;
  savePersistedUi();
}

function getActionDestinationValue(channel) {
  if (!channel) return '';
  if (channel.username) return `https://t.me/${channel.username}`;
  if (channel.id) return String(channel.id);
  return channel.name || '';
}

function getActionDestinationLabel(channel) {
  const primary = channel?.name || (channel?.username ? `@${channel.username}` : '') || channel?.id || 'Unknown channel';
  const secondary = channel?.username ? `@${channel.username}` : (channel?.id || '');
  return secondary && secondary !== primary ? `${primary} - ${secondary}` : primary;
}

function syncChannelStateFromResponse(data) {
  state.channels = data.channels || [];
  state.groups = data.groups || [];
  renderGroups();
  renderChannels();
  renderActionDestinationChoices(getSelectedActionRow()?.destination || '');
}

function findChannelByDestinationValue(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return state.channels.find((channel) => {
    const idValue = String(channel?.id || '').trim();
    const usernameValue = channel?.username ? `@${channel.username}` : '';
    const linkValue = channel?.username ? `https://t.me/${channel.username}` : '';
    const httpLinkValue = channel?.username ? `http://t.me/${channel.username}` : '';
    const plainUsernameValue = String(channel?.username || '').trim();
    const nameValue = String(channel?.name || '').trim();
    return normalized === idValue
      || normalized === usernameValue
      || normalized === linkValue
      || normalized === httpLinkValue
      || normalized === plainUsernameValue
      || normalized === nameValue;
  }) || null;
}

function renderActionDestinationChoices(selectedValue = '') {
  const rawSelected = String(selectedValue || '');
  const normalizedSelected = rawSelected.trim();
  const selectedChannel = findChannelByDestinationValue(normalizedSelected);
  if (selectedChannel) {
    els.actionDestinationInput.dataset.destinationValue = getActionDestinationValue(selectedChannel);
    els.actionDestinationInput.value = selectedChannel.name || (selectedChannel.username ? `@${selectedChannel.username}` : getActionDestinationValue(selectedChannel));
    hideDestinationSuggestions();
    return;
  }
  const query = normalizedSelected || String(els.actionDestinationInput.value || '').trim();
  const ranked = getRankedDestinationChannels(query).slice(0, 8);
  delete els.actionDestinationInput.dataset.destinationValue;
  els.actionDestinationInput.value = rawSelected;
  if (!query) {
    hideDestinationSuggestions();
    return;
  }
  if (!ranked.length) {
    els.actionDestinationSuggestions.innerHTML = `<div class="search-suggestion"><div class="search-suggestion-title">No channel match</div><div class="search-suggestion-meta">Keep typing a name, @username, or id.</div></div>`;
    els.actionDestinationSuggestions.classList.remove('hidden');
    return;
  }
  els.actionDestinationSuggestions.innerHTML = ranked.map(({ channel }) => `
    <button type="button" class="search-suggestion" data-destination-value="${escapeHtml(getActionDestinationValue(channel))}">
      <span class="search-suggestion-title">${escapeHtml(channel.name || channel.username || channel.id || 'Unknown channel')}</span>
      <span class="search-suggestion-meta">${escapeHtml(getActionDestinationLabel(channel))}</span>
    </button>
  `).join('');
  els.actionDestinationSuggestions.classList.remove('hidden');
}

function renderJobs() {
  const jobs = [...state.jobs.values()].reverse();
  if (!jobs.length) {
    els.jobs.innerHTML = '<div class="muted">No jobs yet.</div>';
    return;
  }
  els.jobs.innerHTML = jobs.map((job) => {
    const total = Number(job.total || 0);
    const progress = Number(job.progress || 0);
    const pct = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : (job.status === 'done' ? 100 : 0);
    const statusClass = job.status === 'done' ? 'ok' : job.status === 'error' ? 'err' : 'warn';
    return `<div class="job">
      <div class="row" style="justify-content:space-between;">
        <strong>${escapeHtml(job.type)}</strong>
        <span class="pill ${statusClass}">${escapeHtml(job.status || 'queued')}</span>
      </div>
      <div class="muted" style="margin-top:6px;">${escapeHtml(job.channel || '')}</div>
      <div class="muted" style="margin-top:6px;">${escapeHtml(job.summary || job.error || '')}</div>
      <div class="progress"><div style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function getActionRow(rowIndex) {
  return state.actionRows.find((row) => row.leaderRowIndex === rowIndex) || null;
}

function getSelectedActionRow() {
  return getActionRow(state.selectedActionRowIndex);
}

function buildActionEditorModel() {
  syncActionPubLinkMode();
  return {
    grouped: els.actionGroupedInput.checked,
    transferMode: els.actionTransferModeSelect.value,
    pubLnk: {
      enabled: els.actionPubLnkEnabledInput.checked,
      numSequence: els.actionNumSequenceInput.checked,
      punctBlank: els.actionPunctBlankInput.checked,
      punctValue: getPunctValueFromControls(els.actionPunctPresetSelect, els.actionPunctValueInput),
      joinUs: els.actionJoinUsInput.checked,
      commentJoinUsMode: els.actionJoinUsInput.checked ? els.actionCommentJoinUsModeSelect.value : 'none',
    },
  };
}

function buildActionEditorUpdate() {
  if (getActionEditorMode() === 'raw_override') {
    return { action: String(els.actionRawActionInput.value || '').trim() };
  }
  return { actionModel: buildActionEditorModel() };
}

function setActionEditorEnabled(enabled) {
  [
    els.saveActionRowBtn,
    els.actionModeSelect,
    els.actionRawActionInput,
    els.actionGroupedInput,
    els.actionDestinationInput,
    els.actionExtraMsgInput,
    els.actionTransferModeSelect,
    els.actionPubLnkEnabledInput,
    els.actionPubLinkModeSelect,
    els.actionNumSequenceInput,
    els.actionPunctBlankInput,
    els.actionPunctPresetSelect,
    els.actionJoinUsInput,
    els.actionCommentJoinUsModeSelect,
  ].forEach((control) => {
    control.disabled = !enabled;
  });
  els.actionPunctValueInput.disabled = !enabled || els.actionPunctPresetSelect.value !== 'custom';
}

function renderActionPreview() {
  const row = getSelectedActionRow();
  if (!row) {
    els.actionPreviewOutput.value = '';
    els.actionPreviewSummary.textContent = 'No action selected.';
    setActionEditorEnabled(false);
    return;
  }
  setActionEditorEnabled(true);
  updatePunctControls(els.actionPunctPresetSelect, els.actionPunctValueInput);
  syncActionEditorSections();
  if (getActionEditorMode() === 'raw_override') {
    const raw = String(els.actionRawActionInput.value || '').trim();
    els.actionPreviewOutput.value = raw;
    els.actionPreviewSummary.textContent = raw ? 'Raw override mode' : 'Raw override mode - empty action';
    return;
  }
  const model = buildActionEditorModel();
  els.actionPreviewOutput.value = actionHelper.serializeActionModel(model);
  els.actionPreviewSummary.textContent = actionHelper.summarizeActionModel(model);
}

function populateActionEditor(row) {
  if (!row) {
    els.actionEditorStatus.textContent = 'Select a Collection group to edit its action professionally.';
    els.actionModeSelect.value = 'structured';
    els.actionRawActionInput.value = '';
    els.actionGroupedInput.checked = false;
    els.actionDestinationInput.value = '';
    hideDestinationSuggestions();
    els.actionExtraMsgInput.value = '';
    els.actionTransferModeSelect.value = 'comments';
    els.actionPubLnkEnabledInput.checked = true;
    els.actionPubLinkModeSelect.value = 'numbered';
    els.actionNumSequenceInput.checked = true;
    els.actionPunctBlankInput.checked = true;
    syncPunctControls(els.actionPunctPresetSelect, els.actionPunctValueInput, '');
    els.actionJoinUsInput.checked = false;
    els.actionCommentJoinUsModeSelect.value = 'append_joinus';
    renderActionPreview();
    return;
  }
  const rowAction = String(row.action || '').trim();
  const model = row.actionModel || actionHelper.parseActionString(rowAction);
  const canonicalAction = actionHelper.serializeActionModel(model).trim();
  const useRawOverride = Boolean(rowAction) && canonicalAction && canonicalAction !== rowAction;
  els.actionEditorStatus.textContent = `Editing Collection "${row.collection}" (${row.count} item${row.count === 1 ? '' : 's'})`;
  els.actionModeSelect.value = useRawOverride ? 'raw_override' : 'structured';
  els.actionRawActionInput.value = useRawOverride ? rowAction : '';
  els.actionGroupedInput.checked = rowAction ? Boolean(model.grouped) : true;
  els.actionDestinationInput.value = row.destination || '';
  els.actionExtraMsgInput.value = row.extraMsg || '';
  els.actionTransferModeSelect.value = model.transferMode || 'comments';
  els.actionPubLnkEnabledInput.checked = rowAction ? Boolean(model.pubLnk?.enabled) : true;
  els.actionPubLinkModeSelect.value = inferPubLinkMode(model);
  els.actionNumSequenceInput.checked = Boolean(model.pubLnk?.numSequence);
  els.actionPunctBlankInput.checked = Boolean(model.pubLnk?.punctBlank);
  syncPunctControls(els.actionPunctPresetSelect, els.actionPunctValueInput, model.pubLnk?.punctValue || '');
  els.actionJoinUsInput.checked = Boolean(model.pubLnk?.joinUs);
  els.actionCommentJoinUsModeSelect.value = model.pubLnk?.commentJoinUsMode || 'joinus_only';
  renderActionPreview();
}

function renderActionRows() {
  if (!state.actionRows.length) {
    els.actionRowList.innerHTML = '<div class="action-row-card"><div class="muted">No Collection groups found. Only rows with a non-empty Collection value are shown here.</div></div>';
    els.actionBuilderSummary.textContent = 'No Collection groups loaded.';
    populateActionEditor(null);
    return;
  }

  if (!getSelectedActionRow()) {
    state.selectedActionRowIndex = state.actionRows[0].leaderRowIndex;
  }

  els.actionRowList.innerHTML = state.actionRows.map((row) => {
    const active = row.leaderRowIndex === state.selectedActionRowIndex;
    return `<div class="action-row-card ${active ? 'active' : ''}" data-row-index="${row.leaderRowIndex}">
      <div class="action-card-top">
        <label class="row" style="margin:0;">
          <input type="checkbox" class="action-row-select" data-row-index="${row.rowIndex}" ${selected ? 'checked' : ''}>
          <div>
            <div class="action-card-title">Row ${row.rowIndex} آ· ${escapeHtml(row.title || `Row ${row.rowIndex}`)}</div>
            <div class="action-card-preview">${escapeHtml(row.preview || 'No preview available.')}</div>
          </div>
        </label>
        <span class="action-pill neutral">${escapeHtml(row.actionSummary || 'No actions')}</span>
      </div>
      <div class="action-card-meta">
        ${row.destination ? `<span class="action-pill">Dest: ${escapeHtml(row.destination)}</span>` : ''}
        ${row.extraMsg ? `<span class="action-pill neutral">Hub: ${escapeHtml(row.extraMsg)}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  els.actionBuilderSummary.textContent = `${state.actionRows.length} rows loaded آ· ${state.selectedActionRows.size} selected for grouping`;
  populateActionEditor(getSelectedActionRow());
}

async function loadActionRows() {
  const spreadsheetKey = els.spreadsheetSelect.value;
  const sheetName = els.sheetSelect.value;
  if (!spreadsheetKey || !sheetName) {
    alert('Choose spreadsheet and sheet first.');
    return;
  }
  const data = await api(`/api/telegram/fetch/action-rows?spreadsheet=${encodeURIComponent(spreadsheetKey)}&sheet=${encodeURIComponent(sheetName)}`);
  state.actionRows = data.rows || [];
  state.selectedActionRows = new Set();
  state.selectedActionRowIndex = state.actionRows[0]?.rowIndex || null;
  renderActionRows();
  log(`Loaded ${state.actionRows.length} action rows from ${sheetName}.`);
}

async function saveSelectedActionRow() {
  const row = getSelectedActionRow();
  if (!row) {
    alert('Select a row first.');
    return;
  }
  const payload = {
    spreadsheetKey: els.spreadsheetSelect.value,
    sheetName: els.sheetSelect.value,
    updates: [{
      rowIndex: row.rowIndex,
      ...buildActionEditorUpdate(),
      destination: getResolvedDestinationInputValue(),
      extraMsg: els.actionExtraMsgInput.value.trim(),
    }],
  };
  const data = await api('/api/telegram/fetch/action-rows/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  state.actionRows = data.rows || [];
  renderActionRows();
  log(`Saved action row ${row.rowIndex}.`);
}

async function createGroupFromSelection() {
  const rowIndexes = [...state.selectedActionRows].sort((a, b) => a - b);
  if (rowIndexes.length < 2) {
    alert('Select at least two rows to create a group.');
    return;
  }
  const payload = {
    spreadsheetKey: els.spreadsheetSelect.value,
    sheetName: els.sheetSelect.value,
    rowIndexes,
    leaderActionModel: buildActionEditorModel(),
    destination: getResolvedDestinationInputValue(),
    extraMsg: els.actionExtraMsgInput.value.trim(),
  };
  const data = await api('/api/telegram/fetch/action-rows/group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  state.actionRows = data.rows || [];
  state.selectedActionRowIndex = data.leaderRowIndex || rowIndexes[0];
  renderActionRows();
  log(`Created a group from rows ${rowIndexes.join(', ')}.`);
}

async function ungroupSelectedRows() {
  const rowIndexes = [...state.selectedActionRows].sort((a, b) => a - b);
  if (!rowIndexes.length) {
    alert('Select at least one row to ungroup.');
    return;
  }
  const leaderRow = getSelectedActionRow();
  const leaderModel = buildActionEditorModel();
  leaderModel.grouped = false;
  const updates = rowIndexes.map((rowIndex) => {
    if (leaderRow && rowIndex === leaderRow.rowIndex) {
      return {
        rowIndex,
        actionModel: leaderModel,
        destination: getResolvedDestinationInputValue(),
        extraMsg: els.actionExtraMsgInput.value.trim(),
      };
    }
    return {
      rowIndex,
      actionModel: { grouped: false, transferMode: 'none', pubLnk: { enabled: false, numSequence: false, punctBlank: false, joinUs: false, commentJoinUsMode: 'none' } },
      action: '',
      destination: '',
      extraMsg: '',
    };
  });
  const data = await api('/api/telegram/fetch/action-rows/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spreadsheetKey: els.spreadsheetSelect.value,
      sheetName: els.sheetSelect.value,
      updates,
    }),
  });
  state.actionRows = data.rows || [];
  state.selectedActionRows = new Set();
  renderActionRows();
  log(`Ungrouped rows ${rowIndexes.join(', ')}.`);
}

async function loadConfig() {
  state.config = await api('/api/telegram/fetch/config');
  state.spreadsheets = state.config.spreadsheets || [];
  renderWorkerStatus();
  renderSpreadsheets();
}

async function loadSheets() {
  const spreadsheetKey = els.spreadsheetSelect.value;
  if (!spreadsheetKey) {
    state.sheets = [];
    renderSheets();
    return;
  }
  const data = await api(`/api/telegram/fetch/sheets?spreadsheet=${encodeURIComponent(spreadsheetKey)}`);
  state.sheets = data.sheets || [];
  renderSheets();
  if (data.cache?.source) {
    log(`Loaded ${state.sheets.length} sheet tabs from ${data.cache.source === 'cache' ? 'JSON cache' : 'Google Sheets'} for ${spreadsheetKey}.`);
  }
}

async function loadChannels() {
  const data = await api('/api/telegram/fetch/channels');
  syncChannelStateFromResponse(data);
  log(`Loaded ${state.channels.length} channels from ${data.sheetName || 'channel sheet'}.`);
}

async function refreshChannelsFromTelegram() {
  const originalLabel = els.refreshChannelsFromTelegramBtn.textContent;
  els.refreshChannelsFromTelegramBtn.disabled = true;
  els.refreshChannelsFromTelegramBtn.textContent = 'Refreshing...';
  try {
    const data = await api('/api/telegram/fetch/channels/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'telegram' }),
    });
    syncChannelStateFromResponse(data);
    const summary = data.refreshSummary || {};
    log(`Telegram refresh complete: ${summary.discovered || 0} discovered, ${summary.inserted || 0} inserted, ${summary.updated || 0} updated.`);
  } finally {
    els.refreshChannelsFromTelegramBtn.disabled = false;
    els.refreshChannelsFromTelegramBtn.textContent = originalLabel;
  }
}

function setAddChannelSaving(isSaving, message = '') {
  state.addChannelSaving = Boolean(isSaving);
  els.addChannelNameInput.disabled = state.addChannelSaving;
  els.addChannelLinkInput.disabled = state.addChannelSaving;
  els.closeAddChannelModalBtn.disabled = state.addChannelSaving;
  els.cancelAddChannelBtn.disabled = state.addChannelSaving;
  els.saveAddChannelBtn.disabled = state.addChannelSaving;
  els.saveAddChannelBtn.textContent = state.addChannelSaving ? 'Saving...' : 'Save Channel';
  els.addChannelStatus.textContent = message || 'The channel will be upserted into Google Sheets and cached locally right away.';
}

function openAddChannelModal() {
  setAddChannelSaving(false);
  els.addChannelForm.reset();
  els.addChannelStatus.textContent = 'The channel will be upserted into Google Sheets and cached locally right away.';
  els.addChannelModal.classList.remove('section-hidden');
  els.addChannelModal.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => els.addChannelNameInput.focus(), 0);
}

function closeAddChannelModal() {
  if (state.addChannelSaving) return;
  els.addChannelModal.classList.add('section-hidden');
  els.addChannelModal.setAttribute('aria-hidden', 'true');
}

async function submitAddChannelForm(event) {
  event.preventDefault();
  const name = String(els.addChannelNameInput.value || '').trim();
  const link = String(els.addChannelLinkInput.value || '').trim();
  if (!name || !link) {
    els.addChannelStatus.textContent = 'Channel name and channel link are required.';
    return;
  }

  setAddChannelSaving(true, 'Saving channel to Google Sheets and local cache...');
  try {
    const data = await api('/api/telegram/fetch/channels/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, link }),
    });
    syncChannelStateFromResponse(data);
    if (data.addedChannel) {
      state.selectedChannels.add(getChannelSelectionKey(data.addedChannel));
      renderChannels();
      applyDestinationSelection(data.addedChannel);
    }
    setAddChannelSaving(false);
    closeAddChannelModal();
    log(`Channel added: ${name}.`);
  } catch (error) {
    setAddChannelSaving(false, presentError(error));
  }
}

async function loadActionPresets() {
  const data = await api('/api/telegram/fetch/action-presets');
  state.actionPresets = data.presets || [];
  if (state.selectedPresetId && !state.actionPresets.some((preset) => preset.id === state.selectedPresetId)) {
    state.selectedPresetId = '';
  }
  renderPresetPicker();
}

async function saveCurrentAsPreset() {
  const row = getSelectedActionRow();
  if (!row) {
    alert('Select a collection first.');
    return;
  }
  state.presetManagerOpen = true;
  els.presetManager.classList.remove('section-hidden');
  els.presetNameInput.value = row.collection || '';
  els.presetDescriptionInput.value = `Preset saved from collection "${row.collection || row.leaderRowIndex}".`;
  els.presetModeSelect.value = 'structured';
  els.presetRawActionInput.value = '';
  const model = buildActionEditorModel();
  els.presetGroupedInput.checked = Boolean(model.grouped);
  els.presetTransferModeSelect.value = model.transferMode || 'none';
  els.presetPubLnkEnabledInput.checked = Boolean(model.pubLnk?.enabled);
  if (els.presetPubLinkModeSelect) els.presetPubLinkModeSelect.value = inferPubLinkMode(model);
  els.presetNumSequenceInput.checked = Boolean(model.pubLnk?.numSequence);
  els.presetPunctBlankInput.checked = true;
  syncPunctControls(els.presetPunctPresetSelect, els.presetPunctValueInput, model.pubLnk?.punctValue || '');
  els.presetJoinUsInput.checked = Boolean(model.pubLnk?.joinUs);
  els.presetCommentJoinUsModeSelect.value = model.pubLnk?.commentJoinUsMode || 'append_joinus';
  renderPresetPreview();
}

async function createPreset() {
  const payload = {
    name: els.presetNameInput.value.trim(),
    description: els.presetDescriptionInput.value.trim(),
    mode: els.presetModeSelect.value,
    actionModel: buildPresetEditorModel(),
    rawAction: els.presetRawActionInput.value.trim(),
  };
  const data = await api('/api/telegram/fetch/action-presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  state.actionPresets = data.presets || [];
  state.selectedPresetId = data.preset?.id || '';
  renderPresetPicker();
  log(`Created preset "${data.preset?.name || payload.name}".`);
}

async function updatePreset() {
  if (!state.selectedPresetId) {
    alert('Choose a preset first.');
    return;
  }
  const payload = {
    name: els.presetNameInput.value.trim(),
    description: els.presetDescriptionInput.value.trim(),
    mode: els.presetModeSelect.value,
    actionModel: buildPresetEditorModel(),
    rawAction: els.presetRawActionInput.value.trim(),
  };
  const data = await api(`/api/telegram/fetch/action-presets/${encodeURIComponent(state.selectedPresetId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  state.actionPresets = data.presets || [];
  renderPresetPicker();
  log(`Updated preset "${data.preset?.name || payload.name}".`);
}

async function deletePreset() {
  if (!state.selectedPresetId) {
    alert('Choose a preset first.');
    return;
  }
  const presetName = state.actionPresets.find((preset) => preset.id === state.selectedPresetId)?.name || 'preset';
  const data = await api(`/api/telegram/fetch/action-presets/${encodeURIComponent(state.selectedPresetId)}`, {
    method: 'DELETE',
  });
  state.actionPresets = data.presets || [];
  state.selectedPresetId = '';
  renderPresetPicker();
  populatePresetEditor(null);
  log(`Deleted preset "${presetName}".`);
}

async function applyPresetToSelectedCollections() {
  if (!state.selectedPresetId) {
    alert('Choose a preset first.');
    return;
  }
  const leaderRowIndexes = getSelectedCollectionLeaderIndexes();
  if (!leaderRowIndexes.length) {
    alert('Select at least one collection first.');
    return;
  }
  const preset = state.actionPresets.find((entry) => entry.id === state.selectedPresetId);
  if (!preset) {
    alert('The selected preset could not be found.');
    return;
  }
  const resolvedDestination = getResolvedDestinationInputValue();
  const targetRows = leaderRowIndexes
    .map((leaderRowIndex) => getActionRow(leaderRowIndex))
    .filter(Boolean);
  if (!targetRows.length) {
    alert('No matching collection rows were found.');
    return;
  }
  const updates = targetRows.map((row) => {
    const update = {
      leaderRowIndex: row.leaderRowIndex,
      rowIndexes: row.rowIndexes || [row.leaderRowIndex],
      destination: resolvedDestination,
      extraMsg: row.collection || row.extraMsg || '',
    };
    if (preset.mode === 'raw_override') {
      update.action = String(preset.rawAction || '').trim();
    } else {
      update.actionModel = preset.actionModel || {};
    }
    return update;
  });
  const data = await api('/api/telegram/fetch/action-rows/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spreadsheetKey: els.spreadsheetSelect.value,
      sheetName: els.sheetSelect.value,
      updates,
    }),
  });
  state.actionRows = data.rows || [];
  state.selectedActionRowIndex = leaderRowIndexes[0];
  renderActionRows();
  populateActionEditor(getSelectedActionRow());
  renderCollectionSnapshot(getSelectedActionRow());
  log(`Applied preset "${preset.name || state.selectedPresetId}" to ${targetRows.length} collection(s)${resolvedDestination ? ` with destination ${resolvedDestination}` : ''}.`);
}

function getSelectedChannels() {
  return state.channels.filter((channel) => state.selectedChannels.has(channel.id || channel.username || channel.name));
}

function stopPolling(jobId) {
  clearTimeout(state.timers.get(jobId)?.timer);
  state.timers.delete(jobId);
}

async function pollJob(jobId) {
  const meta = state.timers.get(jobId) || { failures: 0 };
  stopPolling(jobId);
  try {
    const job = await api(`/api/telegram/fetch/jobs/${encodeURIComponent(jobId)}`);
    state.jobs.set(jobId, job);
    renderJobs();
    if (!['done', 'error'].includes(job.status)) {
      state.timers.set(jobId, { failures: 0, timer: setTimeout(() => pollJob(jobId), POLL_INTERVAL) });
    } else {
      log(`${job.type} finished with status ${job.status}.`);
    }
  } catch (error) {
    const failures = (meta.failures || 0) + 1;
    if (failures >= MAX_POLL_ERRORS) {
      log(`Lost connection while polling job ${jobId}: ${error.message}`);
      return;
    }
    state.timers.set(jobId, { failures, timer: setTimeout(() => pollJob(jobId), POLL_INTERVAL + 1000) });
  }
}

async function startJob(type) {
  const spreadsheetKey = els.spreadsheetSelect.value;
  const sheetName = els.sheetSelect.value;
  if (!spreadsheetKey || !sheetName) {
    alert('Choose spreadsheet and sheet first.');
    return;
  }
  const payload = { type, spreadsheetKey, sheetName };
  if (type === 'fetch-messages') {
    payload.channels = getSelectedChannels();
    payload.rangeMode = document.querySelector('input[name="rangeMode"]:checked').value;
    payload.dateFrom = els.dateFromInput.value.trim();
    payload.startMessageId = els.startMessageInput.value.trim();
    payload.endMessageId = els.endMessageInput.value.trim();
    payload.fetchComments = els.fetchCommentsInput.checked;
    payload.maxCommentsPerPost = Number(els.maxCommentsInput.value || 50);
  }
  const result = await api('/api/telegram/fetch/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  state.jobs.set(result.jobId, { jobId: result.jobId, type, status: 'queued', channel: sheetName, summary: 'Queued...' });
  renderJobs();
  log(`Started ${type} job ${result.jobId}.`);
  pollJob(result.jobId);
}

function openSheet() {
  const spreadsheet = state.spreadsheets.find((entry) => entry.key === els.spreadsheetSelect.value);
  const sheet = els.sheetSelect.value;
  if (!spreadsheet) return;
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheet.spreadsheetId}/edit#gid=0`;
  window.open(url, '_blank', 'noopener');
}

document.getElementById('reloadChannelsBtn').addEventListener('click', () => loadChannels().catch((error) => alert(presentError(error))));
els.refreshChannelsFromTelegramBtn.addEventListener('click', () => refreshChannelsFromTelegram().catch((error) => alert(presentError(error))));
els.addChannelBtn.addEventListener('click', openAddChannelModal);
els.closeAddChannelModalBtn.addEventListener('click', closeAddChannelModal);
els.cancelAddChannelBtn.addEventListener('click', closeAddChannelModal);
els.addChannelForm.addEventListener('submit', (event) => submitAddChannelForm(event).catch((error) => {
  setAddChannelSaving(false, presentError(error));
}));
els.addChannelModal.addEventListener('mousedown', (event) => {
  if (event.target === els.addChannelModal) closeAddChannelModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.addChannelModal.classList.contains('section-hidden')) {
    closeAddChannelModal();
  }
});
document.getElementById('selectVisibleBtn').addEventListener('click', () => {
  getVisibleChannels().forEach((channel) => state.selectedChannels.add(getChannelSelectionKey(channel)));
  renderChannels();
});
document.getElementById('clearVisibleBtn').addEventListener('click', () => {
  getVisibleChannels().forEach((channel) => state.selectedChannels.delete(getChannelSelectionKey(channel)));
  renderChannels();
});
document.getElementById('fetchMessagesBtn').addEventListener('click', () => startJob('fetch-messages').catch((error) => alert(presentError(error))));
document.getElementById('executeActionsBtn').addEventListener('click', () => startJob('execute-actions').catch((error) => alert(presentError(error))));
document.getElementById('collectionsExecuteActionsBtn').addEventListener('click', () => startJob('execute-actions').catch((error) => alert(presentError(error))));
els.spreadsheetSelect.addEventListener('change', () => {
  savePersistedUi();
  loadSheets()
    .then(() => loadActionRows().catch((error) => log(`Action builder: ${presentError(error)}`)))
    .catch((error) => alert(presentError(error)));
});
els.sheetSelect.addEventListener('change', () => {
  savePersistedUi();
  loadActionRows().catch((error) => log(`Action builder: ${presentError(error)}`));
});
els.channelSearch.addEventListener('input', () => {
  savePersistedUi();
  renderChannels();
});
els.channelList.addEventListener('change', (event) => {
  if (!event.target.classList.contains('channel-check')) return;
  const key = event.target.dataset.channelKey;
  if (event.target.checked) state.selectedChannels.add(key); else state.selectedChannels.delete(key);
  renderChannels();
});
els.groupBar.addEventListener('click', (event) => {
  const button = event.target.closest('[data-group]');
  if (!button) return;
  state.activeGroup = button.dataset.group;
  renderGroups();
  renderChannels();
});
document.querySelectorAll('input[name="rangeMode"]').forEach((input) => input.addEventListener('change', savePersistedUi));
els.dateFromInput.addEventListener('input', savePersistedUi);
els.startMessageInput.addEventListener('input', savePersistedUi);
els.endMessageInput.addEventListener('input', savePersistedUi);
els.fetchCommentsInput.addEventListener('change', savePersistedUi);
els.maxCommentsInput.addEventListener('input', savePersistedUi);
els.loadActionRowsBtn.addEventListener('click', () => loadActionRows().catch((error) => alert(presentError(error))));
els.saveActionRowBtn.addEventListener('click', () => saveSelectedActionRow().catch((error) => alert(presentError(error))));
els.createGroupBtn.addEventListener('click', () => createGroupFromSelection().catch((error) => alert(presentError(error))));
els.ungroupRowsBtn.addEventListener('click', () => ungroupSelectedRows().catch((error) => alert(presentError(error))));
els.collectionSearchInput.addEventListener('input', (event) => {
  state.collectionSearch = event.target.value || '';
  renderActionRows();
});
els.collectionViewTabs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  state.collectionView = button.dataset.view || 'toggle';
  renderActionRows();
});
els.collectionSortTools.addEventListener('click', (event) => {
  const button = event.target.closest('[data-sort]');
  if (!button) return;
  state.collectionListSort = button.dataset.sort === 'az' ? 'az' : 'sheet';
  els.collectionSortTools.querySelectorAll('[data-sort]').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.sort === state.collectionListSort);
  });
  renderActionRows();
});
els.presetSelect.addEventListener('change', (event) => {
  state.selectedPresetId = event.target.value || '';
  renderPresetPicker();
  if (state.presetManagerOpen) {
    const preset = state.actionPresets.find((entry) => entry.id === state.selectedPresetId) || null;
    populatePresetEditor(preset);
  }
});
els.applyPresetBtn.addEventListener('click', () => applyPresetToSelectedCollections().catch((error) => alert(presentError(error))));
els.savePresetBtn.addEventListener('click', () => saveCurrentAsPreset().catch((error) => alert(presentError(error))));
els.togglePresetManagerBtn.addEventListener('click', () => {
  state.presetManagerOpen = !state.presetManagerOpen;
  els.presetManager.classList.toggle('section-hidden', !state.presetManagerOpen);
  if (state.presetManagerOpen) {
    populatePresetEditor(state.actionPresets.find((preset) => preset.id === state.selectedPresetId) || null);
  }
});
[
  els.presetModeStructuredRadio,
  els.presetModeRawRadio,
].forEach((radio) => radio.addEventListener('change', () => {
  if (!radio.checked) return;
  els.presetModeSelect.value = radio.value;
  renderPresetPreview();
}));
[
  els.presetModeSelect,
  els.presetRawActionInput,
  els.presetGroupedInput,
  els.presetTransferModeSelect,
  els.presetPubLnkEnabledInput,
  els.presetNumSequenceInput,
  els.presetPunctBlankInput,
  els.presetPunctPresetSelect,
  els.presetPunctValueInput,
  els.presetJoinUsInput,
  els.presetCommentJoinUsModeSelect,
  els.presetPubLinkModeSelect,
].forEach((control) => {
  control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', renderPresetPreview);
  if (control.type === 'checkbox') control.addEventListener('change', renderPresetPreview);
});
els.presetPubLinkModeSelect?.addEventListener('change', renderPresetPreview);
els.createPresetBtn.addEventListener('click', () => createPreset().catch((error) => alert(presentError(error))));
els.updatePresetBtn.addEventListener('click', () => updatePreset().catch((error) => alert(presentError(error))));
els.deletePresetBtn.addEventListener('click', () => deletePreset().catch((error) => alert(presentError(error))));
[
  els.actionModeSelect,
  els.actionRawActionInput,
  els.actionGroupedInput,
  els.actionDestinationInput,
  els.actionExtraMsgInput,
  els.actionTransferModeSelect,
  els.actionPubLnkEnabledInput,
  els.actionPubLinkModeSelect,
  els.actionNumSequenceInput,
  els.actionPunctBlankInput,
  els.actionPunctPresetSelect,
  els.actionPunctValueInput,
  els.actionJoinUsInput,
  els.actionCommentJoinUsModeSelect,
].forEach((control) => {
  control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', renderActionPreview);
  if (control.type === 'checkbox') {
    control.addEventListener('change', renderActionPreview);
  }
});
els.presetPunctPresetSelect.addEventListener('change', () => updatePunctControls(els.presetPunctPresetSelect, els.presetPunctValueInput));
els.actionPunctPresetSelect.addEventListener('change', () => updatePunctControls(els.actionPunctPresetSelect, els.actionPunctValueInput));
els.actionModeSelect.addEventListener('change', renderActionPreview);
els.actionPubLinkModeSelect.addEventListener('change', renderActionPreview);
els.actionDestinationInput.addEventListener('focus', () => renderActionDestinationChoices(els.actionDestinationInput.value));
els.actionDestinationInput.addEventListener('input', () => {
  delete els.actionDestinationInput.dataset.destinationValue;
  renderActionDestinationChoices(els.actionDestinationInput.value);
});
els.actionDestinationInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideDestinationSuggestions();
    return;
  }
  if (event.key !== 'Enter') return;
  const ranked = getRankedDestinationChannels(els.actionDestinationInput.value.trim());
  if (!ranked.length) return;
  event.preventDefault();
  applyDestinationSelection(ranked[0].channel);
});
els.actionDestinationInput.addEventListener('blur', () => {
  window.setTimeout(() => {
    const resolved = getResolvedDestinationInputValue();
    if (resolved) {
      const channel = findChannelByDestinationValue(resolved);
      if (channel) {
        els.actionDestinationInput.dataset.destinationValue = getActionDestinationValue(channel);
        els.actionDestinationInput.value = channel.name || (channel.username ? `@${channel.username}` : getActionDestinationValue(channel));
      } else {
        els.actionDestinationInput.value = resolved;
      }
    }
    hideDestinationSuggestions();
  }, 120);
});
els.actionDestinationSuggestions.addEventListener('mousedown', (event) => {
  const button = event.target.closest('[data-destination-value]');
  if (!button) return;
  event.preventDefault();
  const selected = state.channels.find((channel) => getActionDestinationValue(channel) === button.dataset.destinationValue);
  if (selected) applyDestinationSelection(selected);
});
els.actionRowList.addEventListener('click', (event) => {
  const linkPill = event.target.closest('.link-pill');
  if (linkPill) {
    event.preventDefault();
    event.stopPropagation();
    window.open(linkPill.href, '_blank', 'noopener');
    return;
  }
  if (event.target.closest('.action-row-select')) {
    event.stopPropagation();
    return;
  }
  const summary = event.target.closest('summary');
  if (summary) {
    const details = summary.closest('[data-row-index]');
    if (!details) return;
    const rowIndex = Number(details.dataset.rowIndex);
    state.selectedActionRowIndex = rowIndex;
    populateActionEditor(getSelectedActionRow());
    renderCollectionSnapshot(getSelectedActionRow());
    requestAnimationFrame(() => {
      if (details.open) state.openCollectionToggles.add(rowIndex);
      else state.openCollectionToggles.delete(rowIndex);
    });
    return;
  }
  if (event.target.closest('.related-row-include') || event.target.closest('.drag-handle')) {
    return;
  }
  const card = event.target.closest('[data-row-index]');
  if (!card) return;
  state.selectedActionRowIndex = Number(card.dataset.rowIndex);
  renderActionRows();
});
els.actionRowList.addEventListener('change', (event) => {
  if (!event.target.classList.contains('related-row-include')) return;
  const leaderRowIndex = Number(event.target.dataset.leaderRowIndex);
  const relatedRowIndex = Number(event.target.dataset.relatedRowIndex);
  const row = state.actionRows.find((entry) => entry.leaderRowIndex === leaderRowIndex);
  if (!row) return;
  const included = getCollectionIncludedSet(row);
  if (event.target.checked) included.add(relatedRowIndex);
  else included.delete(relatedRowIndex);
});
els.actionRowList.addEventListener('dragstart', (event) => {
  const row = event.target.closest('.related-row');
  if (!row) return;
  state.draggingCollectionRow = {
    leaderRowIndex: Number(row.dataset.leaderRowIndex),
    relatedRowIndex: Number(row.dataset.relatedRowIndex),
  };
  row.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
});
els.actionRowList.addEventListener('dragend', (event) => {
  event.target.closest('.related-row')?.classList.remove('dragging');
  els.actionRowList.querySelectorAll('.drop-target').forEach((node) => node.classList.remove('drop-target'));
  state.draggingCollectionRow = null;
});
els.actionRowList.addEventListener('dragover', (event) => {
  const target = event.target.closest('.related-row');
  if (!target || !state.draggingCollectionRow) return;
  if (Number(target.dataset.leaderRowIndex) !== state.draggingCollectionRow.leaderRowIndex) return;
  event.preventDefault();
  els.actionRowList.querySelectorAll('.drop-target').forEach((node) => node.classList.remove('drop-target'));
  target.classList.add('drop-target');
});
els.actionRowList.addEventListener('drop', (event) => {
  const target = event.target.closest('.related-row');
  if (!target || !state.draggingCollectionRow) return;
  event.preventDefault();
  const leaderRowIndex = Number(target.dataset.leaderRowIndex);
  if (leaderRowIndex !== state.draggingCollectionRow.leaderRowIndex) return;
  const order = getCollectionOrder(state.actionRows.find((entry) => entry.leaderRowIndex === leaderRowIndex));
  const fromIndex = order.indexOf(state.draggingCollectionRow.relatedRowIndex);
  const toIndex = order.indexOf(Number(target.dataset.relatedRowIndex));
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
  const nextOrder = [...order];
  const [moved] = nextOrder.splice(fromIndex, 1);
  nextOrder.splice(toIndex, 0, moved);
  state.collectionRowOrder.set(leaderRowIndex, nextOrder);
  state.openCollectionToggles.add(leaderRowIndex);
  renderActionRows();
});
els.actionRowList.addEventListener('change', (event) => {
  if (!event.target.classList.contains('action-row-select')) return;
  const rowIndex = Number(event.target.dataset.rowIndex);
  if (event.target.checked) state.selectedActionRows.add(rowIndex);
  else state.selectedActionRows.delete(rowIndex);
  if (!state.selectedActionRowIndex) state.selectedActionRowIndex = rowIndex;
  renderActionRows();
});
els.openSheetBtn.addEventListener('click', openSheet);
window.addEventListener('pagehide', () => [...state.timers.keys()].forEach(stopPolling));

(async function init() {
  try {
    applyPersistedInputs();
    applyRouteLayout();
    await loadConfig();
    await loadSheets();
    await loadChannels();
    await loadActionPresets().catch((error) => log(`Presets: ${presentError(error)}`));
    await loadActionRows().catch((error) => log(`Action builder: ${presentError(error)}`));
    renderPresetPreview();
  } catch (error) {
    const message = presentError(error);
    alert(message);
    log(message);
  }
})();

getActionRow = function getActionRowCollection(rowIndex) {
  return state.actionRows.find((row) => row.leaderRowIndex === rowIndex) || null;
};

getSelectedActionRow = function getSelectedActionRowCollection() {
  return getActionRow(state.selectedActionRowIndex);
};

setActionEditorEnabled = function setActionEditorEnabledCollection(enabled) {
  [
    els.saveActionRowBtn,
    els.actionGroupedInput,
    els.actionDestinationInput,
    els.actionExtraMsgInput,
    els.actionTransferModeSelect,
    els.actionPubLnkEnabledInput,
    els.actionNumSequenceInput,
    els.actionPunctBlankInput,
    els.actionJoinUsInput,
    els.actionCommentJoinUsModeSelect,
  ].forEach((control) => {
    control.disabled = !enabled;
  });
};

populateActionEditor = function populateActionEditorCollection(row) {
  if (!row) {
    els.actionEditorStatus.textContent = 'Select a Collection group to edit its action professionally.';
    els.selectedPresetMatch.textContent = 'Preset match will appear here when the selected collection matches a saved preset.';
    els.actionModeSelect.value = 'structured';
    els.actionRawActionInput.value = '';
    els.actionGroupedInput.checked = true;
    renderActionDestinationChoices('');
    hideDestinationSuggestions();
    els.actionExtraMsgInput.value = '';
    els.actionTransferModeSelect.value = 'comments';
    els.actionPubLnkEnabledInput.checked = true;
    els.actionPubLinkModeSelect.value = 'numbered';
    els.actionNumSequenceInput.checked = true;
    els.actionPunctBlankInput.checked = true;
    syncPunctControls(els.actionPunctPresetSelect, els.actionPunctValueInput, '');
    els.actionJoinUsInput.checked = false;
    els.actionCommentJoinUsModeSelect.value = 'append_joinus';
    renderActionPreview();
    return;
  }
  const rowAction = String(row.action || '').trim();
  const model = row.actionModel || actionHelper.parseActionString(rowAction);
  const canonicalAction = actionHelper.serializeActionModel(model).trim();
  const useRawOverride = Boolean(rowAction) && canonicalAction && canonicalAction !== rowAction;
  const matchedPreset = findMatchingPresetForRow(row);
  els.actionEditorStatus.textContent = `Editing Collection "${row.collection}" (${row.count} item${row.count === 1 ? '' : 's'})`;
  els.selectedPresetMatch.textContent = matchedPreset
    ? `Matches preset: ${matchedPreset.name}`
    : 'This collection currently does not match a saved preset exactly.';
  els.actionModeSelect.value = useRawOverride ? 'raw_override' : 'structured';
  els.actionRawActionInput.value = useRawOverride ? rowAction : '';
  els.actionGroupedInput.checked = row.action ? Boolean(model.grouped) : true;
  renderActionDestinationChoices(row.destination || '');
  els.actionExtraMsgInput.value = row.extraMsg || '';
  els.actionTransferModeSelect.value = model.transferMode || 'comments';
  els.actionPubLnkEnabledInput.checked = row.action ? Boolean(model.pubLnk?.enabled) : true;
  els.actionPubLinkModeSelect.value = inferPubLinkMode(model);
  els.actionNumSequenceInput.checked = Boolean(model.pubLnk?.numSequence);
  els.actionPunctBlankInput.checked = Boolean(model.pubLnk?.punctBlank);
  syncPunctControls(els.actionPunctPresetSelect, els.actionPunctValueInput, model.pubLnk?.punctValue || '');
  els.actionJoinUsInput.checked = Boolean(model.pubLnk?.joinUs);
  els.actionCommentJoinUsModeSelect.value = model.pubLnk?.commentJoinUsMode || 'append_joinus';
  renderActionPreview();
};

function renderCollectionSnapshot(row) {
  if (!row) {
    els.collectionSnapshot.innerHTML = '<div class="collection-empty">Pick a collection to inspect its grouped overview, routing, row span, and saved action details.</div>';
    return;
  }
  const rowIndexes = row.rowIndexes || [row.leaderRowIndex];
  const destination = row.destination || 'Not set';
  const pubLinkTitle = row.pubLinkTitle || row.collection || 'Not set';
  const preview = row.preview || 'No preview available.';
  els.collectionSnapshot.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:flex-start;">
      <div>
        <div class="action-card-title">${escapeHtml(row.collection || 'Untitled Collection')}</div>
        <div class="action-card-preview">${escapeHtml(preview)}</div>
      </div>
      <span class="action-pill">${escapeHtml(row.actionSummary || 'No actions')}</span>
    </div>
    <div class="snapshot-grid">
      <div class="snapshot-card">
        <div class="snapshot-label">Items</div>
        <div class="snapshot-value">${escapeHtml(String(row.count || rowIndexes.length || 0))}</div>
      </div>
      <div class="snapshot-card">
        <div class="snapshot-label">Leader Row</div>
        <div class="snapshot-value">${escapeHtml(String(row.leaderRowIndex || ''))}</div>
      </div>
      <div class="snapshot-card">
        <div class="snapshot-label">Destination</div>
        <div class="snapshot-value">${escapeHtml(destination)}</div>
      </div>
      <div class="snapshot-card">
        <div class="snapshot-label">Pub-link Title</div>
        <div class="snapshot-value">${escapeHtml(pubLinkTitle)}</div>
      </div>
      <div class="snapshot-card snapshot-wide">
        <div class="snapshot-label">Grouped Rows</div>
        <div class="snapshot-value">${escapeHtml(rowIndexes.join(', '))}</div>
      </div>
      <div class="snapshot-card snapshot-wide">
        <div class="snapshot-label">Collection Preview</div>
        <div class="action-card-preview" style="margin-top:6px;">${escapeHtml(preview)}</div>
      </div>
    </div>
  `;
}

renderActionRows = function renderActionRowsCollection() {
  const rows = getFilteredActionRows();
  if (!rows.length) {
    els.actionRowList.innerHTML = '<div class="action-row-card"><div class="muted">No Collection groups found. Only rows with a non-empty Collection value are shown here.</div></div>';
    els.actionBuilderSummary.textContent = state.actionRows.length
      ? 'No collections match the current search.'
      : 'No Collection groups loaded.';
    populateActionEditor(null);
    renderCollectionSnapshot(null);
    return;
  }

  if (!rows.some((row) => row.leaderRowIndex === state.selectedActionRowIndex)) {
    state.selectedActionRowIndex = rows[0].leaderRowIndex;
  }

  els.collectionViewTabs.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.collectionView);
  });
  els.collectionSortTools.querySelectorAll('[data-sort]').forEach((button) => {
    button.classList.toggle('active', button.dataset.sort === state.collectionListSort);
  });

  els.actionRowList.innerHTML = rows.map((row) => {
    const active = row.leaderRowIndex === state.selectedActionRowIndex;
    const selected = state.selectedActionRows.has(row.leaderRowIndex);
    const modeClass = state.collectionView === 'toggle'
      ? ''
      : state.collectionView === 'board'
        ? 'board'
        : '';
    const metaBits = `
      <span class="action-pill neutral">${escapeHtml(`${row.count} item${row.count === 1 ? '' : 's'}`)}</span>
      <span class="action-pill neutral">${escapeHtml(`Leader row ${row.leaderRowIndex}`)}</span>
      ${row.destination ? `<span class="action-pill">Dest: ${escapeHtml(row.destination)}</span>` : ''}
    `;
    if (state.collectionView === 'toggle') {
      const includedSet = getCollectionIncludedSet(row);
      const relatedRows = getOrderedRelatedRows(row).map((item) => `
        <div class="related-row" draggable="true" data-leader-row-index="${row.leaderRowIndex}" data-related-row-index="${item.rowIndex}">
          <div class="related-row-top">
            <div class="related-row-title">${escapeHtml(item.title || `Row ${item.rowIndex}`)}</div>
            <div class="related-row-tail">
              <span class="drag-handle" title="Drag to reorder">â‹®â‹®</span>
              <span class="action-pill neutral">${escapeHtml(`Row ${item.rowIndex}`)}</span>
              ${item.messageLink ? `<a class="link-pill" href="${escapeHtml(item.messageLink)}" target="_blank" rel="noopener">Post</a>` : ''}
              <label class="include-check">
                <input type="checkbox" class="related-row-include" data-leader-row-index="${row.leaderRowIndex}" data-related-row-index="${item.rowIndex}" ${includedSet.has(Number(item.rowIndex)) ? 'checked' : ''}>
                Include
              </label>
            </div>
          </div>
        </div>
      `).join('');
      const leaderLink = row.messageLink || row.relatedRows?.[0]?.messageLink || '';
      return `<details class="collection-toggle" data-row-index="${row.leaderRowIndex}" ${state.openCollectionToggles.has(row.leaderRowIndex) ? 'open' : ''}>
        <summary>
          <input type="checkbox" class="collection-select action-row-select" data-row-index="${row.leaderRowIndex}" ${selected ? 'checked' : ''} aria-label="Select collection">
          <div class="toggle-head">
            <div class="toggle-title-wrap">
              <div class="action-card-title">${escapeHtml(row.collection || 'Untitled Collection')}</div>
            </div>
          </div>
          <div class="toggle-summary-meta">
            <span class="action-pill neutral">${escapeHtml(String(row.count || 0))}</span>
            ${leaderLink ? `<a class="link-pill" href="${escapeHtml(leaderLink)}" target="_blank" rel="noopener">Link</a>` : ''}
          </div>
        </summary>
        <div class="toggle-body">
          ${relatedRows || '<div class="muted">No related rows found.</div>'}
        </div>
      </details>`;
    }
    return `<div class="action-row-card ${modeClass} ${active ? 'active' : ''}" data-row-index="${row.leaderRowIndex}">
      <div class="action-card-top">
        <div class="row" style="margin:0;align-items:flex-start;">
          <input type="checkbox" class="collection-select action-row-select" data-row-index="${row.leaderRowIndex}" ${selected ? 'checked' : ''} aria-label="Select collection">
          <div>
          <div class="action-card-title">${escapeHtml(row.collection || 'Untitled Collection')}</div>
          <div class="action-card-preview">${escapeHtml(row.title || row.preview || 'No preview available.')}</div>
        </div>
        </div>
        <span class="action-pill neutral">${escapeHtml(row.actionSummary || 'No actions')}</span>
      </div>
      <div class="action-card-meta">
        ${metaBits}
      </div>
      <div class="action-card-preview">${escapeHtml(row.preview || 'No preview available.')}</div>
    </div>`;
  }).join('');

  const selectedRow = getSelectedActionRow();
  els.actionBuilderSummary.textContent = `${rows.length} Collection group${rows.length === 1 ? '' : 's'} shown${rows.length !== state.actionRows.length ? ` of ${state.actionRows.length}` : ''} - ${state.selectedActionRows.size} selected`;
  populateActionEditor(selectedRow);
  renderCollectionSnapshot(selectedRow);
};

loadActionRows = async function loadActionRowsCollection() {
  const spreadsheetKey = els.spreadsheetSelect.value;
  const sheetName = els.sheetSelect.value;
  if (!spreadsheetKey || !sheetName) {
    alert('Choose spreadsheet and sheet first.');
    return;
  }
  const data = await api(`/api/telegram/fetch/action-rows?spreadsheet=${encodeURIComponent(spreadsheetKey)}&sheet=${encodeURIComponent(sheetName)}`);
  state.actionRows = data.rows || [];
  state.selectedActionRowIndex = state.actionRows[0]?.leaderRowIndex || null;
  renderActionRows();
  log(`Loaded ${state.actionRows.length} Collection groups from ${sheetName}.`);
};

saveSelectedActionRow = async function saveSelectedActionRowCollection() {
  const targetRows = getTargetCollectionRowsForSave();
  if (!targetRows.length) {
    alert('Select a Collection group first.');
    return;
  }
  const resolvedDestination = getResolvedDestinationInputValue();
  const updates = [];

  for (const row of targetRows) {
    const includedSet = getCollectionIncludedSet(row);
    const includedRowIndexes = getCollectionOrder(row).filter((rowIndex) => includedSet.has(rowIndex));
    const excludedRowIndexes = getCollectionOrder(row).filter((rowIndex) => !includedSet.has(rowIndex));
    if (!includedRowIndexes.length) {
      alert(`Keep at least one related row included for collection "${row.collection || row.leaderRowIndex}".`);
      return;
    }
    const resolvedExtraMsg = row.collection || els.actionExtraMsgInput.value.trim();
    updates.push({
      leaderRowIndex: row.leaderRowIndex,
      rowIndexes: includedRowIndexes,
      ...buildActionEditorUpdate(),
      destination: resolvedDestination,
      extraMsg: resolvedExtraMsg,
    });
    excludedRowIndexes.forEach((rowIndex) => {
      updates.push({
        rowIndex,
        action: '',
        destination: '',
        extraMsg: '',
      });
    });
  }
  const payload = {
    spreadsheetKey: els.spreadsheetSelect.value,
    sheetName: els.sheetSelect.value,
    updates,
  };
  const data = await api('/api/telegram/fetch/action-rows/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  state.actionRows = data.rows || [];
  state.selectedActionRowIndex = targetRows[0].leaderRowIndex;
  renderActionRows();
  log(`Saved ${targetRows.length} collection${targetRows.length === 1 ? '' : 's'}${resolvedDestination ? ` with destination ${resolvedDestination}` : ''}.`);
};

els.createGroupBtn.style.display = 'none';
els.ungroupRowsBtn.style.display = 'none';
els.actionBuilderSummary.textContent = 'No Collection groups loaded.';
renderActionDestinationChoices('');

if (state.actionRows.length) {
  if (!state.selectedActionRowIndex && state.actionRows[0]?.leaderRowIndex) {
    state.selectedActionRowIndex = state.actionRows[0].leaderRowIndex;
  }
  renderActionRows();
} else {
  populateActionEditor(null);
}

