import { deduplicateDirectoryCandidates, persistedStoreFingerprint, postSaveDirectoryDecision, resolveSharedContributionCandidate } from '../domain/sharedStoreProfiles.js';

export const monthlyFilingEditableFields = Object.freeze(['store', 'address', 'tin', 'vat', 'amount', 'receiptDate', 'invoice']);
export const monthlyFilingProfileSnapshot = profile => ({ sharedStoreId: profile.id, store: profile.storeName, address: profile.address || '', tin: profile.tin || '', vat: profile.vat || '' });
export const clearsSharedStoreAssociation = (before, after) => ['store', 'address', 'tin'].some(key => String(before[key] || '').trim() !== String(after[key] || '').trim());
export const isBlankUnsavedMonthlyFilingRecord = record => !record.dbId && monthlyFilingEditableFields.every(key => !String(record[key] || '').trim());
export const monthlyFilingIsReadOnly = receipt => receipt.status === 'archived';
export const activeMonthlyFilingSnapshot = records => records.filter(record => record.dbId && record.status === 'active').map(record => ({ ...record }));
export const monthlyFilingExportFilename = (date = new Date()) => `fsresibo-monthly-filing-${date.toISOString().slice(0, 10)}.xlsx`;
export const synchronizeMonthlyFilingRow = (row, saved) => {
  row.dataset.monthlyId = saved.dbId;
  row.dataset.sharedStoreId = saved.sharedStoreId || '';
  row.dataset.status = saved.status;
};
export function createMonthlyFilingLifecycleState() {
  let pending = false;
  let archiveUncertain = false;
  return {
    beginExport: () => { if (pending || archiveUncertain) return false; pending = true; return true; },
    finishExport: () => { pending = false; },
    markArchiveUncertain: () => { archiveUncertain = true; },
    clearArchiveUncertain: () => { archiveUncertain = false; },
    exportBlocked: () => pending || archiveUncertain,
    clearBlocked: () => pending || archiveUncertain
  };
}
export async function runMonthlyFilingExport({ save, snapshot, generateWorkbook, archive }) {
  if (!await save()) return { state: 'save-failed' };
  const records = snapshot();
  if (!records.length) return { state: 'empty' };
  try { generateWorkbook(records); } catch (error) { return { state: 'generation-failed', error }; }
  try { return { state: 'archived', records, archived: await archive(records.map(record => record.dbId)) }; }
  catch (error) { return { state: 'archive-failed', records, error }; }
}
export async function persistMonthlyFilingRows(rows, persistRow) {
  const saved = [];
  for (const row of rows) { try { saved.push(await persistRow(row)); } catch (error) { return { saved, error }; } }
  return { saved, error: undefined };
}

export function createMonthlyFilingUi({ elements, monthlyFilingService, sharedStoreService, downloadExpenseDetailedReport, confirmAction = async () => false }) {
  let currentUser; let records = []; let profiles = []; let loading = false;
  const lifecycle = createMonthlyFilingLifecycleState();
  const feedback = text => { elements.feedback.textContent = text || ''; };
  const activeRecords = () => activeMonthlyFilingSnapshot(records);
  const hasExportableActiveRecord = () => records.some(record => record.status === 'active' && !isBlankUnsavedMonthlyFilingRecord(record));
  const updateActions = () => { elements.exportActive.disabled = lifecycle.exportBlocked() || !hasExportableActiveRecord(); elements.clear.disabled = lifecycle.clearBlocked() || records.length === 0; };
  const values = row => Object.fromEntries(monthlyFilingEditableFields.map(key => [key, row.querySelector(`.monthly-${key}`).value]));
  const setRecord = (index, saved, fingerprint) => { records[index] = { ...saved, persistedStoreFingerprint: fingerprint ?? records[index]?.persistedStoreFingerprint ?? '' }; };
  const reloadSharedStores = async () => { profiles = await sharedStoreService.listActiveSharedStores(); return profiles; };
  const candidateMessage = candidate => {
    const details = [candidate.address && `Address: ${candidate.address}`, candidate.tin && `TIN: ${candidate.tin}`].filter(Boolean);
    return `“${candidate.storeName}” is not currently in the Company Directory. Adding it will make its store details available to other FSResibo users.${details.length ? ` ${details.join(' · ')}` : ''}`;
  };
  const render = () => {
    elements.list.replaceChildren(); updateActions();
    if (!records.length) { const empty = document.createElement('p'); empty.className = 'monthly-empty'; empty.textContent = 'No Monthly Filing receipts yet. Add one to begin.'; elements.list.append(empty); return; }
    records.forEach((record, recordIndex) => {
      const row = elements.template.content.firstElementChild.cloneNode(true);
      row.dataset.monthlyId = record.dbId || ''; row.dataset.sharedStoreId = record.sharedStoreId || ''; row.dataset.status = record.status; row.dataset.persistedStoreFingerprint = record.persistedStoreFingerprint || '';
      Object.entries(record).forEach(([key, value]) => { const field = row.querySelector(`.monthly-${key}`); if (field) field.value = value || ''; });
      const archived = monthlyFilingIsReadOnly(record);
      row.querySelector('.monthly-status').textContent = archived ? 'Archived' : 'Active'; row.querySelector('.monthly-status').hidden = !archived;
      row.querySelectorAll('input, select').forEach(field => { field.disabled = archived; });
      row.querySelector('.monthly-delete').hidden = archived;
      const returnButton = row.querySelector('.monthly-return-active'); returnButton.hidden = !archived;
      returnButton.addEventListener('click', async event => {
        if (!archived || !await confirmAction({ title: 'Return receipt to Active?', message: 'This receipt will become editable again and will be included in the next Monthly Filing export.', confirmLabel: 'Return to Active', cancelLabel: 'Cancel', trigger: event.currentTarget })) return;
        try { setRecord(recordIndex, await monthlyFilingService.returnMonthlyFilingReceiptToActive(record.dbId)); render(); feedback('Monthly Filing receipt returned to Active.'); } catch (error) { feedback(`Could not return receipt to Active: ${error.message}`); }
      });
      const store = row.querySelector('.monthly-store'); const suggestions = row.querySelector('.monthly-suggestions');
      const showSuggestions = () => {
        const query = store.value.trim().toLowerCase(); suggestions.replaceChildren();
        if (!query || archived) return suggestions.hidden = true;
        profiles.filter(profile => profile.storeName.toLowerCase().includes(query)).slice(0, 6).forEach(profile => { const option = document.createElement('button'); option.type = 'button'; option.textContent = [profile.storeName, profile.address, profile.tin].filter(Boolean).join(' · '); option.addEventListener('click', () => { const snapshot = monthlyFilingProfileSnapshot(profile); Object.entries(snapshot).forEach(([key, value]) => { if (key === 'sharedStoreId') row.dataset.sharedStoreId = value; else row.querySelector(`.monthly-${key}`).value = value; }); suggestions.hidden = true; }); suggestions.append(option); });
        suggestions.hidden = !suggestions.children.length;
      };
      store.addEventListener('input', showSuggestions);
      ['store', 'address', 'tin'].forEach(key => row.querySelector(`.monthly-${key}`).addEventListener('input', () => { if (row.dataset.sharedStoreId) row.dataset.sharedStoreId = ''; }));
      row.querySelector('.monthly-delete').addEventListener('click', async event => {
        if (archived) return;
        if (!record.dbId) { records.splice(recordIndex, 1); render(); feedback('Unsaved Monthly Filing receipt removed.'); return; }
        if (!await confirmAction({ title: 'Delete Monthly Filing receipt?', message: 'This removes this receipt from Monthly Filing only.', confirmLabel: 'Delete Receipt', cancelLabel: 'Cancel', danger: true, trigger: event.currentTarget })) return;
        try { await monthlyFilingService.deleteMonthlyFilingReceipt(record.dbId); records = records.filter(item => item.dbId !== record.dbId); render(); feedback('Monthly Filing receipt deleted.'); } catch (error) { feedback(`Could not delete Monthly Filing receipt: ${error.message}`); }
      });
      elements.list.append(row);
    });
  };
  const associateEntry = async (entry, profile) => {
    if (!profile?.id || entry.saved.sharedStoreId === profile.id) return;
    try {
      const associated = await monthlyFilingService.associateMonthlyFilingSharedStore(entry.saved.dbId, profile.id);
      entry.saved = associated; setRecord(entry.recordIndex, associated, entry.fingerprint); synchronizeMonthlyFilingRow(entry.row, associated);
    } catch (error) { feedback(`Monthly Filing saved, but its Company Directory association could not be recorded: ${error.message}`); }
  };
  const associateMatchingEntries = async (entries, candidate, profile) => {
    const key = persistedStoreFingerprint(candidate);
    for (const entry of entries.filter(item => persistedStoreFingerprint(item.decision.candidate) === key)) await associateEntry(entry, profile);
  };
  const processDirectoryDecisions = async entries => {
    for (const entry of entries) {
      entry.decision = postSaveDirectoryDecision({ values: entry.receipt, previousFingerprint: entry.previousFingerprint, profiles });
      entry.fingerprint = entry.decision.fingerprint;
      entry.row.dataset.persistedStoreFingerprint = entry.fingerprint;
      records[entry.recordIndex].persistedStoreFingerprint = entry.fingerprint;
      if (entry.decision.status === 'existing') await associateEntry(entry, entry.decision.profile);
    }
    for (const decision of deduplicateDirectoryCandidates(entries.map(entry => entry.decision).filter(decision => decision.status === 'new' || decision.status === 'ambiguous'))) {
      if (decision.status === 'ambiguous') { feedback('Monthly Filing saved. Multiple Company profiles match this store; add more identifying information before adding it to the directory.'); continue; }
      const confirmed = await confirmAction({ title: 'Add store to Company Directory?', message: candidateMessage(decision.candidate), confirmLabel: 'Add to Company Directory', cancelLabel: 'Keep only in Monthly Filing', trigger: elements.save });
      if (!confirmed) { feedback('Monthly Filing saved. Store kept only in Monthly Filing.'); continue; }
      try {
        const profile = await sharedStoreService.contributeSharedStore(decision.candidate, currentUser.id);
        await reloadSharedStores();
        await associateMatchingEntries(entries, decision.candidate, profile);
        feedback('Monthly Filing saved. Store added to the Company Directory.');
      } catch (error) {
        if (error?.name === 'SharedStoreDuplicateError') {
          try {
            await reloadSharedStores();
            const resolved = resolveSharedContributionCandidate(decision.candidate, profiles);
            if (resolved.status === 'existing') await associateMatchingEntries(entries, decision.candidate, resolved.profile);
            feedback('Monthly Filing saved. This store is already in the Company Directory.');
          } catch { feedback('Monthly Filing saved. The Company Directory changed; refresh before trying this store again.'); }
        } else feedback(`Monthly Filing saved, but the store could not be added to the Company Directory: ${error.message}`);
      }
    }
  };
  const add = () => { records.push({ dbId: '', sharedStoreId: '', store: '', address: '', tin: '', vat: '', amount: '', receiptDate: '', invoice: '', status: 'active', persistedStoreFingerprint: '' }); render(); };
  const save = async ({ successFeedback = true, fromExport = false } = {}) => {
    if (loading || !currentUser || (lifecycle.exportBlocked() && !fromExport)) return false;
    loading = true; elements.save.disabled = true;
    try {
      const rows = [...elements.list.children].filter(row => row.matches('.monthly-card') && row.dataset.status !== 'archived' && !isBlankUnsavedMonthlyFilingRecord({ dbId: row.dataset.monthlyId, ...values(row) }));
      const { saved, error } = await persistMonthlyFilingRows(rows, async row => {
        const recordIndex = [...elements.list.children].indexOf(row); const receipt = { ...values(row), sharedStoreId: row.dataset.sharedStoreId || '' }; const previousFingerprint = row.dataset.persistedStoreFingerprint;
        const stored = row.dataset.monthlyId ? await monthlyFilingService.updateMonthlyFilingReceipt(row.dataset.monthlyId, receipt, currentUser.id) : await monthlyFilingService.createMonthlyFilingReceipt(receipt, currentUser.id);
        setRecord(recordIndex, stored, previousFingerprint);
        synchronizeMonthlyFilingRow(row, stored);
        return { row, recordIndex, receipt, previousFingerprint, saved: stored };
      });
      if (error) throw error;
      await processDirectoryDecisions(saved);
      render(); if (successFeedback) feedback('Monthly Filing changes saved.'); return true;
    } catch (error) { feedback(`Could not save Monthly Filing changes: ${error.message}`); return false; } finally { loading = false; elements.save.disabled = false; }
  };
  const exportActive = async event => {
    if (!lifecycle.beginExport()) return;
    updateActions();
    try {
    const count = records.filter(record => record.status === 'active' && !isBlankUnsavedMonthlyFilingRecord(record)).length;
    if (!count) return feedback('There are no Active Monthly Filing receipts to export.');
    if (!await confirmAction({ title: 'Export Active Monthly Filing receipts?', message: `This will generate the Expense Detailed Report for all ${count} currently Active Monthly Filing receipt${count === 1 ? '' : 's'}. After the workbook is generated successfully, those receipts will be Archived and become read-only.`, confirmLabel: 'Export & Archive', cancelLabel: 'Cancel', trigger: event.currentTarget })) return;
    const result = await runMonthlyFilingExport({ save: () => save({ successFeedback: false, fromExport: true }), snapshot: activeRecords, generateWorkbook: snapshot => downloadExpenseDetailedReport(snapshot, monthlyFilingExportFilename()), archive: ids => monthlyFilingService.archiveMonthlyFilingReceipts(ids) });
    if (result.state === 'save-failed') return;
    if (result.state === 'empty') return feedback('There are no persisted Active Monthly Filing receipts to export.');
    if (result.state === 'generation-failed') return feedback(`Could not prepare the XLSX export: ${result.error.message}`);
    if (result.state === 'archive-failed') { lifecycle.markArchiveUncertain(); return feedback(`Workbook generated, but archive status could not be confirmed. Refresh Monthly Filing before exporting again. (${result.error.message})`); }
    const archivedById = new Map(result.archived.map(record => [record.dbId, record])); records = records.map(record => archivedById.has(record.dbId) ? { ...archivedById.get(record.dbId), persistedStoreFingerprint: record.persistedStoreFingerprint } : record); render(); feedback(`Exported and archived ${result.records.length} Monthly Filing receipt${result.records.length === 1 ? '' : 's'}.`);
    } finally { lifecycle.finishExport(); updateActions(); }
  };
  const clear = async event => {
    if (!records.length || !currentUser || lifecycle.clearBlocked()) return;
    if (!await confirmAction({ title: 'Clear Monthly Filing?', message: 'This permanently deletes all Active and Archived Monthly Filing receipts from your account. Long-term Receipts and the Company Directory are not affected.', confirmLabel: 'Clear Monthly Filing', cancelLabel: 'Cancel', danger: true, trigger: event.currentTarget })) return;
    try { await monthlyFilingService.clearMonthlyFilingReceipts(currentUser.id); records = []; render(); feedback('Monthly Filing cleared.'); } catch (error) { feedback(`Could not clear Monthly Filing: ${error.message}`); }
  };
  return {
    async loadForUser(user) { currentUser = user; feedback('Loading Monthly Filing…'); try { records = await monthlyFilingService.loadMonthlyFilingReceipts(); lifecycle.clearArchiveUncertain(); } catch (error) { records = []; feedback(`Could not load Monthly Filing receipts: ${error.message}`); } try { await reloadSharedStores(); if (!elements.feedback.textContent.startsWith('Could not')) feedback(''); } catch { profiles = []; feedback('Company Directory is temporarily unavailable. You can still enter store details manually.'); } render(); },
    clearForLogout() { currentUser = undefined; records = []; profiles = []; feedback(''); render(); }, setVisible(visible) { elements.workspace.hidden = !visible; },
    start() { elements.add.addEventListener('click', add); elements.save.addEventListener('click', () => { void save(); }); elements.exportActive.addEventListener('click', exportActive); elements.clear.addEventListener('click', clear); render(); }
  };
}
