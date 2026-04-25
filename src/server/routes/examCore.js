function registerExamCoreRoutes(app, deps) {
  const {
    ACTION_PRESETS_PATH,
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
    writeFetchChannelsCache,
    writeFetchSheetsCache,
    writeJsonFileSafe,
    writeWholeSheet
  } = deps;

app.get('/api/sheet', async (req, res) => {
  try {
    const token = await getAccessToken();
    res.json(await googleJson(buildSheetsUrl(SHEET_ID, SHEET_TAB), { headers: { Authorization: `Bearer ${token}` } }));
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.put('/api/sheet/:rowIndex', async (req, res) => {
  try {
    const token = await getAccessToken();
    const rowIndex = parseInt(req.params.rowIndex, 10);
    const cells = Array.isArray(req.body?.cells) ? req.body.cells : [];
    await updateSheetValues(token, SHEET_ID, `${SHEET_TAB}!A${rowIndex}`, [cells]);
    res.json({ ok: true });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.post('/api/status/refresh', async (req, res) => {
  try {
    const token = await getAccessToken();
    const summary = await refreshExamStatuses(token);
    res.json({ ok: true, ...summary });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const token = await getDriveAccessToken();
    if (!req.file) return res.status(400).json({ error: 'Missing uploaded file.' });
    const uploaded = await uploadBufferToDrive(req.file.buffer, req.body.filename || req.file.originalname, token);
    res.json({ url: uploaded.url });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.post('/api/report-pdf', async (req, res) => {
  try {
    const token = await getDriveAccessToken();
    const { type, data } = req.body || {};
    if (!['admin', 'public'].includes(type)) return res.status(400).json({ error: 'Invalid report type. Use "admin" or "public".' });
    if (!data || !data.module || !data.wilaya || !data.year) return res.status(400).json({ error: 'Missing report data.' });

    const baseName = buildBaseReportFilename(data);
    const suffix = type === 'admin' ? 'Admin_Report' : 'Public_Report';
    const existingUrl = type === 'admin' ? data.adminReportUrl : data.publicReportUrl;
    let existingName = '';
    if (existingUrl) {
      const existingId = extractDriveFileId(existingUrl);
      if (existingId) {
        try {
          const meta = await getDriveFileMeta(existingId, token);
          existingName = meta.name || '';
        } catch (error) {}
      }
    }
    const filename = buildNextVersionedFilename(`${baseName}_${suffix}`, 'pdf', existingName);
    const pdfBuffer = type === 'admin' ? buildAdminReportBuffer(data) : buildPublicReportBuffer(data);
    const uploaded = await uploadBufferToDrive(pdfBuffer, filename, token);
    res.json({ type, filename, url: uploaded.url });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.get('/api/drive-download', async (req, res) => {
  const fileId = compactString(req.query.id).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!fileId) return res.status(400).json({ error: 'Missing file id' });
  try {
    const token = await getDriveAccessToken();
    const { name, mimeType } = await getDriveFileMeta(fileId, token);
    const fileRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!fileRes.ok) throw new Error(await fileRes.text());
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name || fileId)}"`);
    fileRes.body.pipe(res);
  } catch (error) {
    console.warn(`Drive download fallback for ${fileId}: ${safeErrorMessage(error)}`);
    res.redirect(buildPublicDriveDownloadUrl(fileId));
  }
});

app.get('/api/drive-meta', async (req, res) => {
  const fileId = compactString(req.query.id).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!fileId) return res.status(400).json({ error: 'Missing file id' });
  try {
    const token = await getDriveAccessToken();
    res.json(await getDriveFileMeta(fileId, token));
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    sheetTab: SHEET_TAB,
    headerRow: HEADER_ROW,
    googleClientId: GOOGLE_CLIENT_ID,
    contactsConfigured: Boolean(CONTACTS_SHEET_ID),
    telegramBotConfigured: Boolean(TELEGRAM_BOT_TOKEN),
    telegramWorkerConfigured: Boolean(TELEGRAM_WORKER_URL) && WORKER_URL_VALID,
    telegramWorkerError: WORKER_PROXY_ERROR,
  });
});
}

module.exports = { registerExamCoreRoutes };
