function registerTelegramFetchRoutes(app, deps) {
  const {
    ACTION_PRESETS_PATH,
    ACTION_PRESETS_CACHE_PATH,
    ACTION_PRESETS_CACHE_TTL_MS,
    ACTION_PRESETS_SHEET_NAME,
    ACTION_PRESETS_SPREADSHEET_ID,
    aggregateContacts,
    APP_URL,
    appendSheetObject,
    assertContactVersion,
    base64url,
    batchUpdateSheetRanges,
    batchUpdateSpreadsheet,
    buildActionCellUpdates,
    buildActionPresetSummary,
    buildActionRowPayload,
    buildChannelTags,
    buildCollectionActionGroups,
    buildFetchChannelLookupKeys,
    buildFetchChannelsResponse,
    buildFollowerActionModel,
    buildNextVersionedFilename,
    buildPublicDriveDownloadUrl,
    buildSheetsUrl,
    cachedOwnerDriveToken,
    cachedToken,
    canUseOwnerDriveOAuth,
    clearSheetRow,
    colToLetter,
    compactString,
    CONTACTS_HEADERS,
    CONTACTS_SESSION_SECRET,
    CONTACTS_SHEET_ID,
    cors,
    createContactsSessionToken,
    crypto,
    didJoinFromChatMember,
    DRAFT_SPREADSHEET_ID,
    DRIVE_FOLDER_ID,
    ensureContactsInfra,
    ensureContactsSessionCookie,
    ensureFetchChannelsCacheDir,
    ensureFetchChannelSheetShape,
    ensureRuntimeDataDir,
    ensureSheetTab,
    EXAM_STATUS_HEADER_ALIASES,
    ExamStatusUtils,
    expandCollectionActionUpdates,
    express,
    extractAppendedRowIndex,
    extractJoinRow,
    fetch,
    FETCH_CHANNELS_CACHE_PATH,
    FETCH_SHEETS_CACHE_PATH,
    FETCH_SHEETS_CACHE_TTL_MS,
    FETCH_SPREADSHEET_OPTIONS,
    findHeaderIndex,
    FormData,
    fs,
    getAccessToken,
    getAppBaseUrl,
    getCell,
    getDriveAccessToken,
    getDriveFileMeta,
    getExamStatusCell,
    getFetchSpreadsheetByKey,
    getFetchSpreadsheetOptions,
    getOwnerDriveAccessToken,
    getSheetValues,
    getSpreadsheetMetadata,
    getWorkerHealth,
    GOOGLE_CLIENT_ID,
    googleJson,
    HEADER_ROW,
    HIDDEN_FETCH_CHANNEL_TAG,
    inferActionSheetColumns,
    inferFetchChannelColumns,
    isHiddenFetchChannel,
    isMemberStatus,
    isRecoverableOwnerDriveError,
    jsonResponseSafe,
    listSpreadsheetTabs,
    listSpreadsheetTabsCached,
    loadActionSheetRows,
    loadContactsState,
    loadDiscoveredChannelsFromWorkerStore,
    loadFetchChannels,
    loadFetchChannelSheetState,
    loadSheetObjects,
    loadSharedActionPresets,
    makeContactVersion,
    makeId,
    matchJoinToContactId,
    mergeDiscoveredChannelsIntoSheet,
    multer,
    normalizeAccountValue,
    normalizeActionPreset,
    normalizeChannelRecord,
    normalizeFetchTagValue,
    normalizeHeaderName,
    normalizeManualChannelLink,
    normalizeTelegramUsername,
    nowIso,
    objectToRow,
    OWNER_GOOGLE_CLIENT_ID,
    OWNER_GOOGLE_CLIENT_SECRET,
    OWNER_GOOGLE_REFRESH_TOKEN,
    ownerDriveTokenExpiry,
    parseCookies,
    path,
    proxyWorker,
    quoteSheetName,
    RAW_TELEGRAM_WORKER_URL,
    readActionPresets,
    readFetchChannelsCache,
    readFetchSheetsCache,
    readJsonFileSafe,
    rebuildFetchChannelsCacheFromSheet,
    redactSensitiveText,
    refreshExamStatuses,
    requireContactsSession,
    resolveExamStatusColumns,
    resolveMergedChannel,
    rollbackSheetChanges,
    ROOT_DIR,
    rowsToObjects,
    safeErrorMessage,
    sanitizeFetchJobPayload,
    sendSafeError,
    serializePresetForResponse,
    SERVICE_ACCOUNT,
    SHEET_ID,
    SHEET_TAB,
    signSessionPayload,
    sleep,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_FETCH_CHANNELS_SHEET_NAME,
    TELEGRAM_FETCH_CHANNELS_SPREADSHEET_ID,
    TELEGRAM_FETCH_DEFAULT_SHEET,
    TELEGRAM_SPREADSHEET_ID,
    TELEGRAM_WEBHOOK_SECRET,
    TELEGRAM_WORKER_URL,
    telegramApi,
    tokenExpiry,
    updateSheetObject,
    updateSheetValues,
    upload,
    uploadBufferToDrive,
    validateContactPayload,
    verifyContactsSessionToken,
    waitForWorkerJob,
    WORKER_AUTH_TOKEN,
    WORKER_PROXY_ERROR,
    WORKER_URL_VALID,
    writeActionPresets,
    writeActionPresetsCache,
    writeFetchChannelsCache,
    writeFetchSheetsCache,
    writeJsonFileSafe,
    writeWholeSheet,
    saveSharedActionPresets
  } = deps;

app.get('/api/telegram/fetch/config', async (req, res) => {
  try {
    res.json({
      channelsSheetName: TELEGRAM_FETCH_CHANNELS_SHEET_NAME,
      defaultSheetName: TELEGRAM_FETCH_DEFAULT_SHEET,
      spreadsheets: getFetchSpreadsheetOptions(),
    });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.get('/api/telegram/fetch/worker-health', async (req, res) => {
  try {
    const workerHealth = await getWorkerHealth();
    res.json({ workerHealth });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.get('/api/telegram/fetch/spreadsheets', async (req, res) => {
  try {
    res.json({ spreadsheets: getFetchSpreadsheetOptions() });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.get('/api/telegram/fetch/sheets', async (req, res) => {
  try {
    const spreadsheet = getFetchSpreadsheetByKey(compactString(req.query.spreadsheet));
    if (!spreadsheet) return res.status(400).json({ error: 'Unknown spreadsheet.' });
    const token = await getAccessToken();
    const forceFresh = ['1', 'true', 'yes'].includes(compactString(req.query.refresh).toLowerCase());
    const result = await listSpreadsheetTabsCached(token, spreadsheet, { forceFresh });
    res.json({ spreadsheet, sheets: result.sheets, cache: result.cache });
  } catch (error) {
    if ([429, 500, 502, 503, 504].includes(Number(error?.status))) {
      return res.status(503).json({ error: 'Google Sheets is temporarily unavailable. Please try again in a few seconds.' });
    }
    sendSafeError(res, 500, error);
  }
});

app.get('/api/telegram/fetch/channels', async (req, res) => {
  try {
    const cached = readFetchChannelsCache();
    if (cached?.channels?.length) {
      return res.json(buildFetchChannelsResponse(cached.channels, cached));
    }
    const token = await getAccessToken();
    return res.json(await rebuildFetchChannelsCacheFromSheet(token));
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.post('/api/telegram/fetch/channels/refresh', async (req, res) => {
  try {
    const mode = compactString(req.body?.mode).toLowerCase() || 'telegram';
    if (!['telegram', 'sheet'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be "telegram" or "sheet".' });
    }

    const token = await getAccessToken();

    if (mode === 'sheet') {
      const response = await rebuildFetchChannelsCacheFromSheet(token);
      return res.json({
        ok: true,
        mode,
        ...response,
        refreshSummary: {
          mode,
          discovered: 0,
          inserted: 0,
          updated: 0,
          hidden: response.summary.hiddenChannels,
          cacheRebuilt: true,
        },
      });
    }

    if (!WORKER_URL_VALID) {
      return res.status(503).json({ error: WORKER_PROXY_ERROR || 'Telegram worker not configured.' });
    }

    const job = await proxyWorker('/jobs/list-channels', 'POST', {});
    const snapshot = await waitForWorkerJob(job.jobId);
    if (compactString(snapshot.status) !== 'done') {
      return res.status(502).json({ error: snapshot.error || 'Telegram worker could not list channels.' });
    }

    const discoveredChannels = await loadDiscoveredChannelsFromWorkerStore(token);
    const currentSheet = await loadFetchChannelSheetState(token);
    const merged = mergeDiscoveredChannelsIntoSheet(currentSheet.headers, currentSheet.rows, discoveredChannels);
    const writeRange = `${TELEGRAM_FETCH_CHANNELS_SHEET_NAME}!A1:${colToLetter(merged.headers.length - 1)}${merged.rows.length + 1}`;
    await updateSheetValues(token, TELEGRAM_FETCH_CHANNELS_SPREADSHEET_ID, writeRange, [merged.headers, ...merged.rows]);
    const cache = writeFetchChannelsCache(merged.channels, {
      source: 'telegram',
      inserted: merged.inserted,
      updated: merged.updated,
      discovered: discoveredChannels.length,
    });
    const response = buildFetchChannelsResponse(cache.channels, cache);
    res.json({
      ok: true,
      mode,
      ...response,
      refreshSummary: {
        mode,
        discovered: discoveredChannels.length,
        inserted: merged.inserted,
        updated: merged.updated,
        hidden: response.summary.hiddenChannels,
        cacheRebuilt: true,
      },
    });
  } catch (error) {
    if ([429, 500, 502, 503, 504].includes(Number(error?.status))) {
      return res.status(503).json({ error: 'Channel refresh is temporarily unavailable. Please try again in a few seconds.' });
    }
    sendSafeError(res, 500, error);
  }
});

app.post('/api/telegram/fetch/channels/add', async (req, res) => {
  try {
    const name = compactString(req.body?.name);
    const linkInput = compactString(req.body?.link);
    if (!name) return res.status(400).json({ error: 'Channel name is required.' });
    if (!linkInput) return res.status(400).json({ error: 'Channel link is required.' });
    if (!WORKER_URL_VALID) {
      return res.status(503).json({ error: WORKER_PROXY_ERROR || 'Telegram worker not configured.' });
    }

    const normalizedLink = normalizeManualChannelLink(linkInput);
    const token = await getAccessToken();
    const resolved = await proxyWorker('/resolve/channel', 'POST', {
      name,
      link: normalizedLink.normalized,
    });

    const workerChannel = resolved?.channel || {};
    const addedCandidate = {
      id: compactString(workerChannel.id),
      name: compactString(workerChannel.name) || name,
      username: normalizeTelegramUsername(workerChannel.username),
      type: compactString(workerChannel.type),
      membersCount: compactString(workerChannel.membersCount),
      tags: [],
    };

    if (!addedCandidate.id && !addedCandidate.username && !addedCandidate.name) {
      return res.status(502).json({ error: 'Worker did not return a usable channel record.' });
    }
    if (!workerChannel.resolved && !workerChannel.fallbackAllowed) {
      return res.status(400).json({ error: 'Channel link could not be resolved.' });
    }

    const currentSheet = await loadFetchChannelSheetState(token);
    const merged = mergeDiscoveredChannelsIntoSheet(currentSheet.headers, currentSheet.rows, [addedCandidate]);
    const writeRange = `${TELEGRAM_FETCH_CHANNELS_SHEET_NAME}!A1:${colToLetter(merged.headers.length - 1)}${merged.rows.length + 1}`;
    await updateSheetValues(token, TELEGRAM_FETCH_CHANNELS_SPREADSHEET_ID, writeRange, [merged.headers, ...merged.rows]);

    const cache = writeFetchChannelsCache(merged.channels, {
      source: 'manual_add',
      inserted: merged.inserted,
      updated: merged.updated,
      discovered: 1,
    });
    const response = buildFetchChannelsResponse(cache.channels, cache);
    const addedChannel = resolveMergedChannel(cache.channels, addedCandidate) || addedCandidate;

    res.json({
      ok: true,
      addedChannel,
      ...response,
    });
  } catch (error) {
    if ([429, 500, 502, 503, 504].includes(Number(error?.status))) {
      return res.status(503).json({ error: 'Channel add is temporarily unavailable. Please try again in a few seconds.' });
    }
    sendSafeError(res, 500, error);
  }
});

app.get('/api/telegram/fetch/action-presets', async (req, res) => {
  try {
    const token = await getAccessToken();
    const forceFresh = ['1', 'true', 'yes'].includes(compactString(req.query.refresh).toLowerCase());
    const result = await loadSharedActionPresets(token, { forceFresh, returnMeta: true });
    const presets = (result.presets || []).map(serializePresetForResponse);
    res.json({ presets, cache: result.cache || null });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.post('/api/telegram/fetch/action-presets', async (req, res) => {
  try {
    const token = await getAccessToken();
    const preset = normalizeActionPreset(req.body || {});
    if (!preset.name) return res.status(400).json({ error: 'Preset name is required.' });
    const presets = await loadSharedActionPresets(token, { forceFresh: true });
    presets.push(preset);
    await saveSharedActionPresets(token, presets);
    const snapshot = await loadSharedActionPresets(token, { returnMeta: true });
    res.json({ ok: true, preset: serializePresetForResponse(preset), presets: snapshot.presets.map(serializePresetForResponse), cache: snapshot.cache || null });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.put('/api/telegram/fetch/action-presets/:id', async (req, res) => {
  try {
    const token = await getAccessToken();
    const presetId = compactString(req.params.id);
    const presets = await loadSharedActionPresets(token, { forceFresh: true });
    const index = presets.findIndex((entry) => compactString(entry.id) === presetId);
    if (index < 0) return res.status(404).json({ error: 'Preset not found.' });
    const nextPreset = normalizeActionPreset(req.body || {}, presets[index]);
    if (!nextPreset.name) return res.status(400).json({ error: 'Preset name is required.' });
    presets[index] = nextPreset;
    await saveSharedActionPresets(token, presets);
    const snapshot = await loadSharedActionPresets(token, { returnMeta: true });
    res.json({ ok: true, preset: serializePresetForResponse(nextPreset), presets: snapshot.presets.map(serializePresetForResponse), cache: snapshot.cache || null });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.delete('/api/telegram/fetch/action-presets/:id', async (req, res) => {
  try {
    const token = await getAccessToken();
    const presetId = compactString(req.params.id);
    const presets = await loadSharedActionPresets(token, { forceFresh: true });
    const nextPresets = presets.filter((entry) => compactString(entry.id) !== presetId);
    if (nextPresets.length === presets.length) return res.status(404).json({ error: 'Preset not found.' });
    await saveSharedActionPresets(token, nextPresets);
    const snapshot = await loadSharedActionPresets(token, { returnMeta: true });
    res.json({ ok: true, presets: snapshot.presets.map(serializePresetForResponse), cache: snapshot.cache || null });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.get('/api/telegram/fetch/action-rows', async (req, res) => {
  try {
    const spreadsheet = getFetchSpreadsheetByKey(compactString(req.query.spreadsheet));
    const sheetName = compactString(req.query.sheet);
    if (!spreadsheet) return res.status(400).json({ error: 'Unknown spreadsheet.' });
    if (!sheetName) return res.status(400).json({ error: 'sheet is required.' });
    const token = await getAccessToken();
    const data = await loadActionSheetRows(token, spreadsheet.spreadsheetId, sheetName);
    res.json({
      spreadsheet,
      sheetName,
      headers: data.headers,
      columns: data.columns,
      rows: data.rows,
    });
  } catch (error) {
    if ([429, 500, 502, 503, 504].includes(Number(error?.status))) {
      return res.status(503).json({ error: 'Google Sheets is temporarily unavailable. Please try again in a few seconds.' });
    }
    sendSafeError(res, 500, error);
  }
});

app.post('/api/telegram/fetch/action-presets/apply', async (req, res) => {
  try {
    const spreadsheet = getFetchSpreadsheetByKey(compactString(req.body?.spreadsheetKey));
    const sheetName = compactString(req.body?.sheetName);
    const presetId = compactString(req.body?.presetId);
    const destination = compactString(req.body?.destination);
    const extraMsgOverride = compactString(req.body?.extraMsg);
    const leaderRowIndexes = Array.isArray(req.body?.leaderRowIndexes)
      ? [...new Set(req.body.leaderRowIndexes.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 2))]
      : [];
    const collectionNames = Array.isArray(req.body?.collectionNames)
      ? [...new Set(req.body.collectionNames.map((value) => compactString(value)).filter(Boolean))]
      : [];
    if (!spreadsheet) return res.status(400).json({ error: 'Choose a valid spreadsheet.' });
    if (!sheetName) return res.status(400).json({ error: 'sheetName is required.' });
    if (!presetId) return res.status(400).json({ error: 'presetId is required.' });
    if (!leaderRowIndexes.length && !collectionNames.length) {
      return res.status(400).json({ error: 'Choose at least one collection to apply the preset to.' });
    }

    const token = await getAccessToken();
    const preset = (await loadSharedActionPresets(token)).find((entry) => compactString(entry.id) === presetId);
    if (!preset) return res.status(404).json({ error: 'Preset not found.' });
    const actionSheet = await loadActionSheetRows(token, spreadsheet.spreadsheetId, sheetName);
    const targetCollections = actionSheet.rows.filter((row) =>
      leaderRowIndexes.includes(Number(row.leaderRowIndex)) || collectionNames.includes(compactString(row.collection))
    );
    if (!targetCollections.length) {
      return res.status(404).json({ error: 'No matching collections were found in this sheet.' });
    }

    const updates = targetCollections.map((row) => {
      const update = {
        leaderRowIndex: row.leaderRowIndex,
        rowIndexes: row.rowIndexes || [row.leaderRowIndex],
        destination: destination || '',
        extraMsg: extraMsgOverride || row.collection || row.extraMsg || '',
      };
      if (compactString(preset.mode) === 'raw_override') {
        update.action = compactString(preset.rawAction);
      } else {
        update.actionModel = preset.actionModel || {};
      }
      return update;
    });
    const expanded = expandCollectionActionUpdates(updates);
    const ranges = buildActionCellUpdates(actionSheet.headers, sheetName, expanded);
    if (!ranges.length) return res.status(400).json({ error: 'No editable action changes were produced from this preset.' });
    await batchUpdateSheetRanges(token, spreadsheet.spreadsheetId, ranges);
    const refreshed = await loadActionSheetRows(token, spreadsheet.spreadsheetId, sheetName);
    res.json({
      ok: true,
      preset: serializePresetForResponse(preset),
      appliedCount: targetCollections.length,
      rows: refreshed.rows,
    });
  } catch (error) {
    if ([429, 500, 502, 503, 504].includes(Number(error?.status))) {
      return res.status(503).json({ error: 'Google Sheets is temporarily unavailable. Please try again in a few seconds.' });
    }
    sendSafeError(res, 500, error);
  }
});

app.post('/api/telegram/fetch/action-rows/update', async (req, res) => {
  try {
    const spreadsheet = getFetchSpreadsheetByKey(compactString(req.body?.spreadsheetKey));
    const sheetName = compactString(req.body?.sheetName);
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    if (!spreadsheet) return res.status(400).json({ error: 'Choose a valid spreadsheet.' });
    if (!sheetName) return res.status(400).json({ error: 'sheetName is required.' });
    if (!updates.length) return res.status(400).json({ error: 'updates are required.' });

    const token = await getAccessToken();
    const actionSheet = await loadActionSheetRows(token, spreadsheet.spreadsheetId, sheetName);
    const normalizedUpdates = expandCollectionActionUpdates(updates);
    const ranges = buildActionCellUpdates(actionSheet.headers, sheetName, normalizedUpdates);
    if (!ranges.length) return res.status(400).json({ error: 'No editable action changes were provided.' });
    await batchUpdateSheetRanges(token, spreadsheet.spreadsheetId, ranges);
    const refreshed = await loadActionSheetRows(token, spreadsheet.spreadsheetId, sheetName);
    res.json({ ok: true, rows: refreshed.rows });
  } catch (error) {
    if ([429, 500, 502, 503, 504].includes(Number(error?.status))) {
      return res.status(503).json({ error: 'Google Sheets is temporarily unavailable. Please try again in a few seconds.' });
    }
    sendSafeError(res, 500, error);
  }
});

app.post('/api/telegram/fetch/action-rows/group', async (req, res) => {
  try {
    const spreadsheet = getFetchSpreadsheetByKey(compactString(req.body?.spreadsheetKey));
    const sheetName = compactString(req.body?.sheetName);
    const rowIndexes = Array.isArray(req.body?.rowIndexes)
      ? req.body.rowIndexes.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 2)
      : [];
    if (!spreadsheet) return res.status(400).json({ error: 'Choose a valid spreadsheet.' });
    if (!sheetName) return res.status(400).json({ error: 'sheetName is required.' });
    if (rowIndexes.length < 2) return res.status(400).json({ error: 'Choose at least two rows to create a group.' });

    const sorted = [...new Set(rowIndexes)].sort((a, b) => a - b);
    const leaderRowIndex = sorted[0];
    const updates = sorted.map((rowIndex, index) => ({
      rowIndex,
      actionModel: index === 0
        ? { ...(req.body?.leaderActionModel || {}), grouped: true }
        : { grouped: true, transferMode: 'none', pubLnk: { enabled: false, numSequence: false, punctBlank: false, punctValue: '', joinUs: false, commentJoinUsMode: 'none' } },
      destination: index === 0 ? compactString(req.body?.destination) : '',
      extraMsg: index === 0 ? compactString(req.body?.extraMsg) : '',
    }));

    const token = await getAccessToken();
    const actionSheet = await loadActionSheetRows(token, spreadsheet.spreadsheetId, sheetName);
    const ranges = buildActionCellUpdates(actionSheet.headers, sheetName, updates);
    await batchUpdateSheetRanges(token, spreadsheet.spreadsheetId, ranges);
    const refreshed = await loadActionSheetRows(token, spreadsheet.spreadsheetId, sheetName);
    res.json({ ok: true, leaderRowIndex, rows: refreshed.rows });
  } catch (error) {
    if ([429, 500, 502, 503, 504].includes(Number(error?.status))) {
      return res.status(503).json({ error: 'Google Sheets is temporarily unavailable. Please try again in a few seconds.' });
    }
    sendSafeError(res, 500, error);
  }
});
app.post('/api/telegram/fetch/jobs', async (req, res) => {
  try {
    if (!WORKER_URL_VALID) {
      return res.status(503).json({ error: WORKER_PROXY_ERROR || 'Telegram worker not configured.' });
    }
    const type = compactString(req.body?.type);
    if (!['fetch-messages', 'execute-actions'].includes(type)) {
      return res.status(400).json({ error: 'Unsupported fetch job type.' });
    }

    const spreadsheet = getFetchSpreadsheetByKey(compactString(req.body?.spreadsheetKey));
    if (!spreadsheet) return res.status(400).json({ error: 'Choose a valid spreadsheet.' });

    if (type === 'fetch-messages') {
      const payload = sanitizeFetchJobPayload(req.body || {}, spreadsheet);
      return res.json(await proxyWorker('/jobs/fetch-messages', 'POST', payload));
    }

    const sheetName = compactString(req.body?.sheetName);
    if (!sheetName) return res.status(400).json({ error: 'sheetName is required.' });
    return res.json(await proxyWorker('/jobs/execute-actions', 'POST', {
      spreadsheetKey: spreadsheet.key,
      spreadsheetId: spreadsheet.spreadsheetId,
      sheetName,
    }));
  } catch (error) {
    sendSafeError(res, 503, error);
  }
});

app.get('/api/telegram/fetch/jobs/:jobId', async (req, res) => {
  try {
    if (!WORKER_URL_VALID) {
      return res.status(503).json({ error: WORKER_PROXY_ERROR || 'Telegram worker not configured.' });
    }
    res.json(await proxyWorker(`/jobs/${encodeURIComponent(req.params.jobId)}`, 'GET'));
  } catch (error) {
    sendSafeError(res, 503, error);
  }
});

}

module.exports = { registerTelegramFetchRoutes };

