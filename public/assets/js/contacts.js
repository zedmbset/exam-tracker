const MAX_POLL_ERRORS = 5;
const POLL_INTERVAL_MS = 3000;
const RELOAD_DEBOUNCE_MS = 1000;
const state = { config: null, botInfo: null, webhookInfo: null, botPanelMessage: '', contacts: [], unmatchedJoins: [], channels: [], jobs: [], editing: null, channelsOpen: true, jobTimers: new Map(), jobPollErrors: new Map(), refreshTimer: null, pendingRefresh: false };
const els = {
  contactsBody: document.getElementById('contactsBody'), unmatchedBody: document.getElementById('unmatchedBody'), channelsBody: document.getElementById('channelsBody'), jobsBody: document.getElementById('jobsBody'),
  contactsCount: document.getElementById('contactsCount'), joinsCount: document.getElementById('joinsCount'), workerPill: document.getElementById('workerPill'), workerHint: document.getElementById('workerHint'),
  configStatus: document.getElementById('configStatus'), searchInput: document.getElementById('searchInput'), resultsLabel: document.getElementById('resultsLabel'), channelsNotice: document.getElementById('channelsNotice'),
  channelsWrap: document.getElementById('channelsWrap'), toggleChannelsBtn: document.getElementById('toggleChannelsBtn'), modal: document.getElementById('contactModal'), modalTitle: document.getElementById('modalTitle'),
  modalMeta: document.getElementById('modalMeta'), fullName: document.getElementById('fullName'), tags: document.getElementById('tags'), notes: document.getElementById('notes'), accountsContainer: document.getElementById('accountsContainer'),
  deleteContactBtn: document.getElementById('deleteContactBtn'),
};
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const formatUnixDate = (seconds) => seconds ? new Date(Number(seconds) * 1000).toLocaleString() : '';
async function api(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  let data = {};
  try { data = rawText ? JSON.parse(rawText) : {}; } catch (error) { data = null; }
  if (!response.ok) {
    if (data && data.error) throw new Error(data.error);
    const snippet = String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    throw new Error(`HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`);
  }
  return data || {};
}
function stopPolling(jobId) { clearTimeout(state.jobTimers.get(jobId)); state.jobTimers.delete(jobId); }
function stopAllPolling() { for (const jobId of state.jobTimers.keys()) stopPolling(jobId); }
function scheduleLoadAll(delay = RELOAD_DEBOUNCE_MS) {
  if (els.modal.classList.contains('open')) { state.pendingRefresh = true; return; }
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => loadAll().catch((error) => console.error(error)), delay);
}
function renderConfigStatus() {
  const workerReady = Boolean(state.config?.telegramWorkerConfigured);
  const workerMessage = workerReady ? 'TELEGRAM_WORKER_URL is configured.' : (state.config?.telegramWorkerError || 'The worker is not connected yet.');
  const botConfigured = Boolean(state.botInfo?.configured);
  const webhookConfigured = Boolean(state.webhookInfo?.configured);
  els.workerPill.className = `pill ${workerReady ? 'ok' : 'warn'}`;
  els.workerPill.textContent = workerReady ? 'Worker connected' : 'Worker unavailable';
  els.workerHint.textContent = workerReady ? 'Moderators can sync channels and fetch members from this page.' : workerMessage;
  const botCard = !botConfigured ? `<div class=\"notice warn\"><strong>Telegram bot</strong><br>TELEGRAM_BOT_TOKEN is missing, so bot info and webhook registration are unavailable.</div>` : `<div class=\"notice info\"><strong>${escapeHtml(state.botInfo.name || 'Telegram bot')}</strong><br><span class=\"small\">@${escapeHtml(state.botInfo.username || '')}</span><div class=\"small\" style=\"margin-top:8px;\">Webhook URL: ${escapeHtml(webhookConfigured ? (state.webhookInfo.url || 'Registered without URL') : 'Not registered')}</div><div class=\"small\">Pending updates: ${escapeHtml(state.webhookInfo?.pendingUpdateCount || 0)}</div><div class=\"small\">Last error: ${escapeHtml(state.webhookInfo?.lastErrorMessage || 'None')}</div><div class=\"small\">${escapeHtml(formatUnixDate(state.webhookInfo?.lastErrorDate) || '')}</div><div style=\"margin-top:10px;\"><button class=\"btn primary\" id=\"registerWebhookBtn\" type=\"button\">Register Webhook</button></div>${state.botPanelMessage ? `<div class=\"small\" style=\"margin-top:8px;\">${escapeHtml(state.botPanelMessage)}</div>` : ''}</div>`;
  els.configStatus.innerHTML = [`<div class=\"notice ${state.config?.contactsConfigured ? 'info' : 'warn'}\"><strong>Contacts sheet</strong><br>${state.config?.contactsConfigured ? 'CONTACTS_SHEET_ID is configured.' : 'CONTACTS_SHEET_ID is missing.'}</div>`, botCard, `<div class=\"notice ${workerReady ? 'info' : 'warn'}\"><strong>Telethon worker</strong><br>${escapeHtml(workerMessage)}</div>`].join('');
  els.channelsNotice.className = `notice ${workerReady ? 'info' : 'warn'}`;
  els.channelsNotice.innerHTML = workerReady ? 'Use \"Sync channel list\" to refresh the Telethon-visible channels cache, then fetch members channel by channel.' : escapeHtml(workerMessage);
}
function getFilteredContacts() { const query = els.searchInput.value.trim().toLowerCase(); if (!query) return state.contacts; return state.contacts.filter((contact) => [contact.fullName, contact.notes, contact.tags, ...contact.accounts.flatMap((account) => [account.type, account.value, account.tgUsername, account.tgUserId, account.tgDisplayName]), ...contact.joins.flatMap((join) => [join.channelName, join.channelUsername, join.tgUsername])].join(' ').toLowerCase().includes(query)); }
function renderContacts() {
  const contacts = getFilteredContacts(); els.contactsCount.textContent = state.contacts.length; els.joinsCount.textContent = state.unmatchedJoins.length; els.resultsLabel.textContent = `${contacts.length} contact${contacts.length === 1 ? '' : 's'}`;
  if (!contacts.length) { els.contactsBody.innerHTML = '<tr><td colspan=\"5\" class=\"empty\">No contacts match the current search.</td></tr>'; return; }
  els.contactsBody.innerHTML = contacts.map((contact) => `<tr><td><strong>${escapeHtml(contact.fullName)}</strong><br><span class=\"small\">${escapeHtml(contact.notes || 'No notes')}</span>${contact.tags ? `<div style=\"margin-top:6px;\">${contact.tags.split(',').filter(Boolean).map((tag) => `<span class=\"tag\">${escapeHtml(tag.trim())}</span>`).join('')}</div>` : ''}</td><td>${contact.accounts.length ? contact.accounts.map((account) => `<div style=\"margin-bottom:6px;\"><strong>${escapeHtml(account.type)}</strong>: ${escapeHtml(account.value || account.tgUsername || account.tgUserId || account.tgDisplayName || '')}</div>`).join('') : '<span class=\"small\">No linked accounts</span>'}</td><td>${contact.joins.length ? contact.joins.map((join) => `<span class=\"tag join\">${escapeHtml(join.channelName || join.channelUsername || 'Joined')}</span>`).join('') : '<span class=\"small\">No matched joins</span>'}</td><td><span class=\"small\">${escapeHtml(contact.updatedAt || contact.createdAt || '')}</span></td><td><button class=\"btn edit-contact-btn\" type=\"button\" data-contact-id=\"${escapeHtml(contact.id)}\">Edit</button></td></tr>`).join('');
}
function renderUnmatchedJoins() {
  if (!state.unmatchedJoins.length) { els.unmatchedBody.innerHTML = '<div class=\"empty\">No unmatched joiners right now.</div>'; return; }
  const options = state.contacts.map((contact) => `<option value=\"${escapeHtml(contact.id)}\">${escapeHtml(contact.fullName)}</option>`).join('');
  els.unmatchedBody.innerHTML = state.unmatchedJoins.map((join) => `<div class=\"panel\"><strong>${escapeHtml(join.tgDisplayName || join.tgUsername || join.tgUserId || 'Unknown joiner')}</strong><div class=\"small\" style=\"margin-top:4px;\">${escapeHtml(join.channelName || join.channelUsername || 'Unknown channel')} â€¢ ${escapeHtml(join.joinedAt || '')}</div><div class=\"controls\" style=\"margin-top:10px;\"><select class=\"join-contact-select\" data-join-id=\"${escapeHtml(join.id)}\"><option value=\"\">Choose contact...</option>${options}</select><button class=\"btn link-join-btn\" type=\"button\" data-join-id=\"${escapeHtml(join.id)}\">Link</button></div></div>`).join('');
}
function renderChannels() {
  els.channelsWrap.hidden = !state.channelsOpen; els.toggleChannelsBtn.textContent = state.channelsOpen ? 'Close panel' : 'Open panel';
  if (!state.channelsOpen) { els.channelsBody.innerHTML = ''; return; }
  if (!state.channels.length) { els.channelsBody.innerHTML = '<tr><td colspan=\"5\" class=\"empty\">No channels cached yet.</td></tr>'; return; }
  els.channelsBody.innerHTML = state.channels.map((channel) => `<tr><td><strong>${escapeHtml(channel.name || channel.username || channel.id)}</strong><br><span class=\"small\">${escapeHtml(channel.username || channel.id || '')}</span></td><td>${escapeHtml(channel.type || '')}</td><td>${escapeHtml(channel.membersCount || '')}</td><td>${escapeHtml(channel.lastSync || '')}</td><td><button class=\"btn fetch-members-btn\" type=\"button\" ${state.config?.telegramWorkerConfigured ? '' : 'disabled'} data-channel-id=\"${escapeHtml(channel.id || '')}\" data-channel-username=\"${escapeHtml(channel.username || '')}\" data-channel-name=\"${escapeHtml(channel.name || '')}\">Fetch members</button></td></tr>`).join('');
}
function renderJobs() {
  if (!state.jobs.length) { els.jobsBody.innerHTML = '<div class=\"empty\">No worker jobs recorded yet.</div>'; return; }
  const hasPollingError = [...state.jobPollErrors.values()].some((count) => count >= MAX_POLL_ERRORS);
  els.jobsBody.innerHTML = `${hasPollingError ? '<div class=\"notice err\">Lost connection to worker while polling job status.</div>' : ''}${state.jobs.slice().reverse().slice(0, 8).map((job) => { const progress = Number(job.progress || 0); const total = Number(job.total || 0); const pct = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : (job.status === 'done' ? 100 : 0); return `<div class=\"job-row\"><div style=\"display:flex;justify-content:space-between;gap:10px;align-items:flex-start;\"><div><strong>${escapeHtml(job.type || 'job')}</strong><div class=\"small\">${escapeHtml(job.channel || '')}</div></div><span class=\"pill ${job.status === 'done' ? 'ok' : job.status === 'error' ? 'err' : 'warn'}\">${escapeHtml(job.status || 'pending')}</span></div><div class=\"small\" style=\"margin-top:6px;\">${escapeHtml(job.summary || job.error || '')}</div><div class=\"progress\"><div style=\"width:${pct}%;\"></div></div></div>`; }).join('')}`;
}
function makeAccountRow(account = {}) { const wrapper = document.createElement('div'); wrapper.className = 'account-row'; wrapper.innerHTML = `<select class=\"account-type\"><option value=\"telegram\">telegram</option><option value=\"email\">email</option><option value=\"phone\">phone</option><option value=\"other\">other</option></select><input class=\"account-value\" placeholder=\"@username / email / phone\"><input class=\"account-user-id\" placeholder=\"TG user id\"><input class=\"account-display\" placeholder=\"Display name\"><button class=\"btn danger\" type=\"button\">Remove</button>`; wrapper.dataset.id = account.id || ''; wrapper.querySelector('.account-type').value = account.type || 'telegram'; wrapper.querySelector('.account-value').value = account.value || ''; wrapper.querySelector('.account-user-id').value = account.tgUserId || ''; wrapper.querySelector('.account-display').value = account.tgDisplayName || ''; wrapper.querySelector('button').addEventListener('click', () => wrapper.remove()); els.accountsContainer.appendChild(wrapper); }
function collectAccounts() { return [...els.accountsContainer.querySelectorAll('.account-row')].map((row) => ({ id: row.dataset.id || '', type: row.querySelector('.account-type').value, value: row.querySelector('.account-value').value.trim(), tgUserId: row.querySelector('.account-user-id').value.trim(), tgDisplayName: row.querySelector('.account-display').value.trim(), source: 'manual' })).filter((account) => account.value || account.tgUserId || account.tgDisplayName); }
function openContactModal(contactId = null) { const contact = state.contacts.find((entry) => entry.id === contactId) || null; state.editing = contact; els.modalTitle.textContent = contact ? 'Edit contact' : 'Add contact'; els.modalMeta.textContent = contact ? `Created ${contact.createdAt || ''}` : 'New contact'; els.fullName.value = contact?.fullName || ''; els.tags.value = contact?.tags || ''; els.notes.value = contact?.notes || ''; els.accountsContainer.innerHTML = ''; (contact?.accounts?.length ? contact.accounts : [{}]).forEach((account) => makeAccountRow(account)); els.deleteContactBtn.style.display = contact ? 'inline-flex' : 'none'; els.modal.classList.add('open'); }
function closeContactModal() { els.modal.classList.remove('open'); state.editing = null; if (state.pendingRefresh) { state.pendingRefresh = false; loadAll().catch((error) => console.error(error)); } }
async function saveContact() { const fullName = els.fullName.value.trim(); if (!fullName) return alert('Full name is required.'); const payload = { fullName, tags: els.tags.value.trim(), notes: els.notes.value.trim(), updatedBy: 'web-ui', accounts: collectAccounts() }; if (state.editing) payload.version = state.editing.version; try { if (state.editing) { await api(`/api/contacts/${state.editing.rowIndex}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } else { await api('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } closeContactModal(); await loadAll(); } catch (error) { alert(error.message); } }
async function deleteContact() { if (!state.editing || !confirm(`Delete ${state.editing.fullName}?`)) return; try { await api(`/api/contacts/${state.editing.rowIndex}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: state.editing.version }) }); closeContactModal(); await loadAll(); } catch (error) { alert(error.message); } }
async function linkJoin(joinId) { const select = els.unmatchedBody.querySelector(`select[data-join-id=\"${joinId}\"]`); if (!select?.value) return alert('Choose a contact first.'); await api(`/api/telegram/joins/${joinId}/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactId: select.value }) }); await loadAll(); }
async function runJob(type, payload = {}) { if (!state.config?.telegramWorkerConfigured) return alert(state.config?.telegramWorkerError || 'TELEGRAM_WORKER_URL is not configured yet.'); const result = await api('/api/telegram/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, ...payload }) }); if (result.jobId && state.channelsOpen) { state.jobPollErrors.set(result.jobId, 0); pollJob(result.jobId); } scheduleLoadAll(250); }
async function pollJob(jobId) { stopPolling(jobId); if (!state.channelsOpen) return; try { const result = await api(`/api/telegram/jobs/${jobId}`); state.jobPollErrors.set(jobId, 0); if (!['done', 'error'].includes(result.status)) { state.jobTimers.set(jobId, setTimeout(() => pollJob(jobId), POLL_INTERVAL_MS)); } else { scheduleLoadAll(); } } catch (error) { const failures = (state.jobPollErrors.get(jobId) || 0) + 1; state.jobPollErrors.set(jobId, failures); if (failures >= MAX_POLL_ERRORS) return renderJobs(); state.jobTimers.set(jobId, setTimeout(() => pollJob(jobId), POLL_INTERVAL_MS + 1000)); } }
async function fetchMembers(channelId, channelUsername, channelName) { await runJob('fetch-members', { channelId, channelUsername, channelName }); }
async function loadConfig() { state.config = await api('/api/config'); }
async function loadBotStatus() { const [botInfo, webhookInfo] = await Promise.all([api('/api/telegram/bot-info').catch((error) => ({ configured: false, error: error.message })), api('/api/telegram/webhook-info').catch((error) => ({ configured: false, error: error.message }))]); state.botInfo = botInfo; state.webhookInfo = webhookInfo; }
async function registerWebhook() { try { const result = await api('/api/telegram/register-webhook', { method: 'POST' }); state.botPanelMessage = result.description || `Webhook set to ${result.url}`; } catch (error) { state.botPanelMessage = error.message; } await loadBotStatus(); renderConfigStatus(); }
async function refreshEverything() { await Promise.all([loadConfig(), loadBotStatus()]); renderConfigStatus(); await loadAll(); }
async function loadAll() {
  if (els.modal.classList.contains('open')) { state.pendingRefresh = true; return; }
  const data = await api('/api/contacts');
  state.contacts = data.contacts || [];
  state.unmatchedJoins = data.unmatchedJoins || [];
  state.channels = data.channels || [];
  state.jobs = data.jobs || [];
  if (state.editing) {
    state.editing = state.contacts.find((entry) => entry.id === state.editing.id) || null;
  }
  renderContacts();
  renderUnmatchedJoins();
  renderChannels();
  renderJobs();
}
function toggleChannelsPanel() { state.channelsOpen = !state.channelsOpen; if (!state.channelsOpen) stopAllPolling(); renderChannels(); }
document.getElementById('addContactBtn').addEventListener('click', () => openContactModal());
document.getElementById('closeModalBtn').addEventListener('click', closeContactModal);
document.getElementById('saveContactBtn').addEventListener('click', saveContact);
document.getElementById('deleteContactBtn').addEventListener('click', deleteContact);
document.getElementById('addAccountBtn').addEventListener('click', () => makeAccountRow({}));
document.getElementById('refreshBtn').addEventListener('click', refreshEverything);
document.getElementById('reloadChannelsBtn').addEventListener('click', loadAll);
document.getElementById('syncChannelsBtn').addEventListener('click', () => runJob('list-channels'));
els.toggleChannelsBtn.addEventListener('click', toggleChannelsPanel);
els.searchInput.addEventListener('input', renderContacts);
els.modal.addEventListener('click', (event) => { if (event.target === els.modal) closeContactModal(); });
els.contactsBody.addEventListener('click', (event) => { const button = event.target.closest('.edit-contact-btn'); if (button) openContactModal(button.dataset.contactId); });
els.unmatchedBody.addEventListener('click', async (event) => { const button = event.target.closest('.link-join-btn'); if (button) await linkJoin(button.dataset.joinId); });
els.channelsBody.addEventListener('click', async (event) => { const button = event.target.closest('.fetch-members-btn'); if (button) await fetchMembers(button.dataset.channelId, button.dataset.channelUsername, button.dataset.channelName); });
els.configStatus.addEventListener('click', async (event) => { if (event.target.id === 'registerWebhookBtn') await registerWebhook(); });
window.addEventListener('pagehide', stopAllPolling);
(async function init() { try { await refreshEverything(); } catch (error) { document.body.innerHTML = `<div class=\"page\"><div class=\"panel notice err\">Could not load Contacts UI: ${escapeHtml(error.message)}</div></div>`; } })();

