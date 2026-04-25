function registerContactRoutes(app, deps) {
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

app.get('/api/contacts', async (req, res) => {
  try {
    const token = await getAccessToken();
    const state = await loadContactsState(token);
    const aggregated = aggregateContacts(state);
    res.json({
      contacts: aggregated.contacts,
      unmatchedJoins: aggregated.unmatchedJoins,
      channels: aggregated.channels.map((channel) => ({
        rowIndex: channel._rowIndex,
        id: channel.ID_Channel,
        name: channel.Channel_Name,
        username: channel.Username,
        type: channel.Type,
        membersCount: channel.Members_Count,
        lastSync: channel.Last_Sync,
      })),
      jobs: aggregated.jobs.map((job) => ({
        rowIndex: job._rowIndex,
        id: job.ID_Job,
        type: job.Type,
        channel: job.Channel,
        status: job.Status,
        progress: job.Progress,
        total: job.Total,
        started: job.Started,
        finished: job.Finished,
        error: job.Error,
        summary: job.Summary_JSON,
        workerJobId: job.Worker_Job_ID,
      })),
    });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.post('/api/contacts', async (req, res) => {
  try {
    const token = await getAccessToken();
    const payload = validateContactPayload(req.body || {});
    const timestamp = nowIso();
    const contactId = makeId('contact');
    const contactRow = {
      ID_Contact: contactId,
      Full_Name: payload.fullName,
      Notes: payload.notes,
      Tags: payload.tags,
      Created_At: timestamp,
      Updated_At: timestamp,
      Created_By: payload.updatedBy,
      Updated_By: payload.updatedBy,
    };

    await appendSheetObject(token, CONTACTS_SHEET_ID, 'ZED_Contacts', CONTACTS_HEADERS.ZED_Contacts, contactRow);
    for (const account of payload.accounts) {
      await appendSheetObject(token, CONTACTS_SHEET_ID, 'ZED_Accounts', CONTACTS_HEADERS.ZED_Accounts, {
        ID_Account: makeId('acct'),
        ID_Contact: contactId,
        Account_Type: account.type,
        Value: account.value,
        Normalized_Value: account.normalizedValue,
        TG_User_ID: account.tgUserId,
        TG_Username: account.tgUsername,
        TG_Display_Name: account.tgDisplayName,
        Source: account.source,
        Created_At: timestamp,
        Updated_At: timestamp,
      });
    }
    res.json({ ok: true, id: contactId });
  } catch (error) {
    sendSafeError(res, 400, error);
  }
});

app.put('/api/contacts/:rowIndex', async (req, res) => {
  try {
    const token = await getAccessToken();
    const rowIndex = parseInt(req.params.rowIndex, 10);
    const payload = validateContactPayload(req.body || {});
    const state = await loadContactsState(token);
    const contact = state.contacts.find((entry) => entry._rowIndex === rowIndex);
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });
    assertContactVersion(contact, req.body?.version);

    const timestamp = nowIso();
    const originalContact = { ...contact };
    const rollbackChanges = [];
    contact.Full_Name = payload.fullName;
    contact.Notes = payload.notes;
    contact.Tags = payload.tags;
    contact.Updated_At = timestamp;
    contact.Updated_By = payload.updatedBy;

    const existingAccounts = state.accounts.filter((account) => account.ID_Contact === contact.ID_Contact);
    const existingById = new Map(existingAccounts.map((account) => [account.ID_Account, account]));
    const seenAccountIds = new Set();
    const refreshedAccounts = payload.accounts.map((account) => {
      const existing = existingById.get(account.id) || null;
      if (existing?.ID_Account) seenAccountIds.add(existing.ID_Account);
      return {
        ID_Account: existing?.ID_Account || makeId('acct'),
        ID_Contact: contact.ID_Contact,
        Account_Type: account.type,
        Value: account.value,
        Normalized_Value: account.normalizedValue,
        TG_User_ID: account.tgUserId,
        TG_Username: account.tgUsername,
        TG_Display_Name: account.tgDisplayName,
        Source: account.source,
        Created_At: existing?.Created_At || timestamp,
        Updated_At: timestamp,
        _rowIndex: existing?._rowIndex,
      };
    });

    const allAccounts = refreshedAccounts.concat(state.accounts.filter((account) => account.ID_Contact !== contact.ID_Contact));
    const joinsToUpdate = [];
    for (const join of state.joins) {
      const nextMatch = (join.Matched_ID_Contact === contact.ID_Contact || !join.Matched_ID_Contact)
        ? matchJoinToContactId(join, allAccounts)
        : join.Matched_ID_Contact;
      if (join.Matched_ID_Contact !== nextMatch) {
        joinsToUpdate.push({ original: { ...join }, updated: { ...join, Matched_ID_Contact: nextMatch } });
        join.Matched_ID_Contact = nextMatch;
      }
    }

    try {
      rollbackChanges.push({ kind: 'restore', tabName: 'ZED_Contacts', headers: CONTACTS_HEADERS.ZED_Contacts, rowIndex: contact._rowIndex, row: originalContact });
      await updateSheetObject(token, CONTACTS_SHEET_ID, 'ZED_Contacts', CONTACTS_HEADERS.ZED_Contacts, contact._rowIndex, contact);

      for (const account of refreshedAccounts) {
        if (account._rowIndex) {
          const original = existingById.get(account.ID_Account);
          rollbackChanges.push({ kind: 'restore', tabName: 'ZED_Accounts', headers: CONTACTS_HEADERS.ZED_Accounts, rowIndex: account._rowIndex, row: { ...original } });
          await updateSheetObject(token, CONTACTS_SHEET_ID, 'ZED_Accounts', CONTACTS_HEADERS.ZED_Accounts, account._rowIndex, account);
        } else {
          const appendResult = await appendSheetObject(token, CONTACTS_SHEET_ID, 'ZED_Accounts', CONTACTS_HEADERS.ZED_Accounts, account);
          const appendedRowIndex = extractAppendedRowIndex(appendResult);
          if (appendedRowIndex) {
            rollbackChanges.push({ kind: 'clear', tabName: 'ZED_Accounts', headers: CONTACTS_HEADERS.ZED_Accounts, rowIndex: appendedRowIndex });
          }
        }
      }

      for (const existing of existingAccounts) {
        if (!seenAccountIds.has(existing.ID_Account)) {
          rollbackChanges.push({ kind: 'restore', tabName: 'ZED_Accounts', headers: CONTACTS_HEADERS.ZED_Accounts, rowIndex: existing._rowIndex, row: { ...existing } });
          await clearSheetRow(token, CONTACTS_SHEET_ID, 'ZED_Accounts', CONTACTS_HEADERS.ZED_Accounts, existing._rowIndex);
        }
      }

      for (const joinChange of joinsToUpdate) {
        rollbackChanges.push({ kind: 'restore', tabName: 'Telegram_Joins', headers: CONTACTS_HEADERS.Telegram_Joins, rowIndex: joinChange.original._rowIndex, row: joinChange.original });
        await updateSheetObject(token, CONTACTS_SHEET_ID, 'Telegram_Joins', CONTACTS_HEADERS.Telegram_Joins, joinChange.updated._rowIndex, joinChange.updated);
      }
    } catch (writeError) {
      await rollbackSheetChanges(token, rollbackChanges);
      const error = new Error(`Contact update could not be fully applied and was rolled back. Please reload and try again. ${safeErrorMessage(writeError)}`);
      error.statusCode = 409;
      throw error;
    }
    res.json({ ok: true, id: contact.ID_Contact });
  } catch (error) {
    sendSafeError(res, error.statusCode || 400, error);
  }
});

app.delete('/api/contacts/:rowIndex', async (req, res) => {
  try {
    const token = await getAccessToken();
    const rowIndex = parseInt(req.params.rowIndex, 10);
    const state = await loadContactsState(token);
    const contact = state.contacts.find((entry) => entry._rowIndex === rowIndex);
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });
    assertContactVersion(contact, req.body?.version || req.query?.version);
    const rollbackChanges = [];
    const originalContact = { ...contact };
    const contactAccounts = state.accounts.filter((entry) => entry.ID_Contact === contact.ID_Contact);
    const joinsToUnlink = state.joins.filter((entry) => entry.Matched_ID_Contact === contact.ID_Contact).map((join) => ({ original: { ...join }, updated: { ...join, Matched_ID_Contact: '' } }));

    try {
      rollbackChanges.push({ kind: 'restore', tabName: 'ZED_Contacts', headers: CONTACTS_HEADERS.ZED_Contacts, rowIndex: contact._rowIndex, row: originalContact });
      await clearSheetRow(token, CONTACTS_SHEET_ID, 'ZED_Contacts', CONTACTS_HEADERS.ZED_Contacts, contact._rowIndex);

      for (const account of contactAccounts) {
        rollbackChanges.push({ kind: 'restore', tabName: 'ZED_Accounts', headers: CONTACTS_HEADERS.ZED_Accounts, rowIndex: account._rowIndex, row: { ...account } });
        await clearSheetRow(token, CONTACTS_SHEET_ID, 'ZED_Accounts', CONTACTS_HEADERS.ZED_Accounts, account._rowIndex);
      }

      for (const joinChange of joinsToUnlink) {
        rollbackChanges.push({ kind: 'restore', tabName: 'Telegram_Joins', headers: CONTACTS_HEADERS.Telegram_Joins, rowIndex: joinChange.original._rowIndex, row: joinChange.original });
        await updateSheetObject(token, CONTACTS_SHEET_ID, 'Telegram_Joins', CONTACTS_HEADERS.Telegram_Joins, joinChange.updated._rowIndex, joinChange.updated);
      }
    } catch (writeError) {
      await rollbackSheetChanges(token, rollbackChanges);
      const error = new Error(`Contact delete could not be fully applied and was rolled back. Please reload and try again. ${safeErrorMessage(writeError)}`);
      error.statusCode = 409;
      throw error;
    }
    res.json({ ok: true });
  } catch (error) {
    sendSafeError(res, error.statusCode || 400, error);
  }
});
}

module.exports = { registerContactRoutes };
