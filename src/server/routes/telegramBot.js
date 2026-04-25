function registerTelegramBotRoutes(app, deps) {
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

app.post('/api/telegram/joins/:joinId/link', async (req, res) => {
  try {
    const token = await getAccessToken();
    const state = await loadContactsState(token);
    const join = state.joins.find((entry) => entry.ID_Join === req.params.joinId);
    if (!join) return res.status(404).json({ error: 'Join record not found.' });
    const contactId = compactString(req.body?.contactId);
    if (!state.contacts.some((contact) => contact.ID_Contact === contactId)) {
      return res.status(400).json({ error: 'Invalid contact selection.' });
    }
    join.Matched_ID_Contact = contactId;
    await updateSheetObject(token, CONTACTS_SHEET_ID, 'Telegram_Joins', CONTACTS_HEADERS.Telegram_Joins, join._rowIndex, join);
    res.json({ ok: true });
  } catch (error) {
    sendSafeError(res, 400, error);
  }
});

app.post('/api/telegram/webhook', async (req, res) => {
  try {
    if (!TELEGRAM_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'TELEGRAM_WEBHOOK_SECRET is not configured. Webhook ingestion is disabled.' });
    }
    const providedSecret = compactString(req.get('x-telegram-bot-api-secret-token'));
    if (providedSecret !== TELEGRAM_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid Telegram webhook secret.' });
    }
    if (!CONTACTS_SHEET_ID) return res.json({ ok: true, skipped: 'CONTACTS_SHEET_ID not configured' });
    const token = await getAccessToken();
    const state = await loadContactsState(token);
    const payload = req.body || {};
    const updateId = compactString(payload.update_id);
    const candidateUpdates = [];

    if (payload.chat_member && didJoinFromChatMember(payload.chat_member)) {
      candidateUpdates.push({ ...payload.chat_member, _updateId: updateId, _raw: payload });
    }

    if (Array.isArray(payload.message?.new_chat_members)) {
      for (const member of payload.message.new_chat_members) {
        candidateUpdates.push({
          chat: payload.message.chat,
          new_chat_member: { status: 'member', user: member },
          old_chat_member: { status: 'left' },
          _updateId: updateId ? `${updateId}_${member.id}` : `${payload.message.message_id}_${member.id}`,
          _raw: payload,
        });
      }
    }

    let created = 0;
    for (const candidate of candidateUpdates) {
      const exists = state.joins.some((join) => compactString(join.Update_ID) === compactString(candidate._updateId));
      if (exists) continue;
      const joinRow = extractJoinRow(candidate, state.accounts);
      state.joins.push(joinRow);
      await appendSheetObject(token, CONTACTS_SHEET_ID, 'Telegram_Joins', CONTACTS_HEADERS.Telegram_Joins, joinRow);
      created += 1;
    }
    res.json({ ok: true, created });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.get('/api/telegram/bot-info', async (req, res) => {
  try {
    const info = await telegramApi('getMe');
    if (!info.configured) return res.json({ configured: false });
    const bot = info.result || {};
    res.json({
      configured: true,
      id: bot.id,
      name: bot.first_name || '',
      username: bot.username || '',
      canJoinGroups: Boolean(bot.can_join_groups),
      canReadAllGroupMessages: Boolean(bot.can_read_all_group_messages),
      supportsInlineQueries: Boolean(bot.supports_inline_queries),
    });
  } catch (error) {
    sendSafeError(res, 502, error);
  }
});

app.get('/api/telegram/webhook-info', async (req, res) => {
  try {
    const info = await telegramApi('getWebhookInfo');
    if (!info.configured) return res.json({ configured: false });
    const webhook = info.result || {};
    res.json({
      configured: true,
      url: webhook.url || '',
      pendingUpdateCount: webhook.pending_update_count || 0,
      lastErrorDate: webhook.last_error_date || 0,
      lastErrorMessage: webhook.last_error_message || '',
      hasCustomCertificate: Boolean(webhook.has_custom_certificate),
      allowedUpdates: webhook.allowed_updates || [],
    });
  } catch (error) {
    sendSafeError(res, 502, error);
  }
});

app.post('/api/telegram/register-webhook', async (req, res) => {
  try {
    if (!TELEGRAM_BOT_TOKEN) return res.json({ configured: false });
    if (!TELEGRAM_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'TELEGRAM_WEBHOOK_SECRET is required before registering the webhook.' });
    }
    const baseUrl = getAppBaseUrl(req);
    if (!/^https?:\/\//i.test(baseUrl)) {
      return res.status(400).json({ error: 'APP_URL or request host did not produce a valid absolute URL.' });
    }
    const webhookUrl = `${baseUrl.replace(/\/+$/, '')}/api/telegram/webhook`;
    const result = await telegramApi('setWebhook', {
      url: webhookUrl,
      secret_token: TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['chat_member'],
    });
    res.json({
      configured: true,
      ok: Boolean(result.ok),
      description: result.description || '',
      url: webhookUrl,
    });
  } catch (error) {
    sendSafeError(res, 502, error);
  }
});

app.get('/api/telegram/channels', async (req, res) => {
  try {
    const token = await getAccessToken();
    await ensureContactsInfra(token);
    const channels = await loadSheetObjects(token, CONTACTS_SHEET_ID, 'ZED_Channels', CONTACTS_HEADERS.ZED_Channels);
    res.json({
      workerConfigured: Boolean(TELEGRAM_WORKER_URL) && WORKER_URL_VALID,
      channels: channels.map((channel) => ({
        rowIndex: channel._rowIndex,
        id: channel.ID_Channel,
        name: channel.Channel_Name,
        username: channel.Username,
        type: channel.Type,
        membersCount: channel.Members_Count,
        lastSync: channel.Last_Sync,
      })),
    });
  } catch (error) {
    sendSafeError(res, 500, error);
  }
});

app.post('/api/telegram/jobs', async (req, res) => {
  try {
    if (!WORKER_URL_VALID) {
      return res.status(503).json({ error: WORKER_PROXY_ERROR || 'Telegram worker not configured.' });
    }
    const type = compactString(req.body?.type);
    if (!['list-channels', 'fetch-members'].includes(type)) {
      return res.status(400).json({ error: 'Unsupported job type.' });
    }
    const path = type === 'list-channels' ? '/jobs/list-channels' : '/jobs/fetch-members';
    const payload = type === 'fetch-members'
      ? {
          channelId: compactString(req.body?.channelId),
          channelUsername: compactString(req.body?.channelUsername),
          channelName: compactString(req.body?.channelName),
        }
      : {};
    res.json(await proxyWorker(path, 'POST', payload));
  } catch (error) {
    sendSafeError(res, 503, error);
  }
});

app.get('/api/telegram/jobs/:jobId', async (req, res) => {
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

module.exports = { registerTelegramBotRoutes };

