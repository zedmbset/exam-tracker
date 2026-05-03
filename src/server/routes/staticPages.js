function registerStaticRoutes(app, deps) {
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

app.get('/exam', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(ROOT_DIR, 'public', 'exam.html'));
});

app.get(['/contacts', '/contacts/', '/contacts/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  ensureContactsSessionCookie(req, res);
  res.sendFile(path.join(ROOT_DIR, 'public', 'contacts', 'index.html'));
});

app.get(['/telegram', '/telegram/', '/telegram/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  ensureContactsSessionCookie(req, res);
  res.sendFile(path.join(ROOT_DIR, 'public', 'telegram', 'index.html'));
});

app.get('/telegram/collections', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  ensureContactsSessionCookie(req, res);
  res.sendFile(path.join(ROOT_DIR, 'public', 'telegram', 'index.html'));
});

app.get(['/telegram/cache', '/telegram/cache/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  ensureContactsSessionCookie(req, res);
  res.sendFile(path.join(ROOT_DIR, 'public', 'telegram', 'index.html'));
});

app.get('/lib/examSession.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.type('application/javascript');
  res.sendFile(path.join(ROOT_DIR, 'src', 'shared', 'examSession.js'));
});

app.get('/lib/status.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.type('application/javascript');
  res.sendFile(path.join(ROOT_DIR, 'src', 'shared', 'status.js'));
});

app.use(express.static(path.join(ROOT_DIR, 'public'), {
  setHeaders(res, path) {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  },
}));
}

module.exports = { registerStaticRoutes };
