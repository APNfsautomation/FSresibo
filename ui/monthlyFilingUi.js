import { installTablistKeyboard } from './tablistKeyboard.js';
import { trackTextEntry } from './textEntryFocus.js';
import { deduplicateDirectoryCandidates, persistedStoreFingerprint, postSaveDirectoryDecision, resolveSharedContributionCandidate } from '../domain/sharedStoreProfiles.js';

export const monthlyFilingEditableFields = Object.freeze(['store', 'address', 'tin', 'vat', 'amount', 'receiptDate', 'invoice']);
export const monthlyFilingProfileSnapshot = profile => ({ sharedStoreId: profile.id, store: profile.storeName, address: profile.address || '', tin: profile.tin || '', vat: profile.vat || '' });
export const clearsSharedStoreAssociation = (before, after) => ['store', 'address', 'tin'].some(key => String(before[key] || '').trim() !== String(after[key] || '').trim());
export const isBlankUnsavedMonthlyFilingRecord = record => !record.dbId && monthlyFilingEditableFields.every(key => !String(record[key] || '').trim());
export const monthlyFilingIsReadOnly = receipt => receipt.status === 'archived';
export const monthlyFilingActiveExportCount = records => records.filter(record => record.status === 'active' && !isBlankUnsavedMonthlyFilingRecord(record)).length;
export const monthlyFilingTabCounts = records => ({ active: monthlyFilingActiveExportCount(records), archived: records.filter(record => record.dbId && record.status === 'archived').length });
export const monthlyFilingRecordsForTab = (records, tab) => records.filter(record => tab === 'archived' ? record.dbId && record.status === 'archived' : record.status === 'active');
export const reconcileArchivedMonthlyFilingDeletion = (records, deletedIds) => {
  const deleted = new Set(deletedIds);
  return records.filter(record => !deleted.has(record.dbId));
};
export const monthlyFilingLocalEditableFields = Object.freeze(['store', 'address', 'tin', 'vat', 'amount', 'receiptDate', 'invoice', 'sharedStoreId', 'persistedStoreFingerprint']);
export const reconcileMonthlyFilingReload = (localRecords, reloadedRecords) => {
  const localActive = new Map(localRecords.filter(record => record.dbId && record.status === 'active').map(record => [record.dbId, record]));
  const drafts = localRecords.filter(record => !record.dbId && record.status === 'active');
  return [
    ...reloadedRecords.map(record => {
      const local = localActive.get(record.dbId);
      if (!local || record.status !== 'active') return record;
      return { ...record, ...Object.fromEntries(monthlyFilingLocalEditableFields.map(key => [key, local[key] ?? record[key] ?? ''])) };
    }),
    ...drafts
  ];
};
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
export function createMonthlyFilingMutationState() {
  let operation = '';
  return {
    begin: next => { if (operation) return false; operation = next; return true; },
    permitsInternalExportSave: () => operation === 'export',
    pending: () => Boolean(operation),
    current: () => operation,
    finish: () => { operation = ''; }
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
// Presentation-only record state. Receipts are identified by database id when they have one and by a client-side draft key while unsaved,
// never by array position, so expansion, labels and unsaved markers follow the right receipt across re-renders, saves and deletions.
export const monthlyFilingSignature = record => monthlyFilingEditableFields.map(key => String(record[key] ?? '')).join('\u0001');
export function createMonthlyFilingViewState() {
  const draftKeys = new WeakMap(); const expanded = new Set(); const labels = new Map(); const baselines = new Map();
  let draftSequence = 0; let labelSequence = 0;
  const keyOf = record => {
    if (record.dbId) return `db:${record.dbId}`;
    if (!draftKeys.has(record)) draftKeys.set(record, `draft:${++draftSequence}`);
    return draftKeys.get(record);
  };
  const move = (from, to) => {
    if (from === to) return;
    if (expanded.delete(from)) expanded.add(to);
    if (labels.has(from)) { labels.set(to, labels.get(from)); labels.delete(from); }
  };
  return {
    keyOf,
    // Stable per-receipt number for this session; never reused or renumbered when other receipts are deleted.
    labelOf: record => { const key = keyOf(record); if (!labels.has(key)) labels.set(key, ++labelSequence); return labels.get(key); },
    isExpanded: record => expanded.has(keyOf(record)),
    setExpanded: (record, open) => { if (open) expanded.add(keyOf(record)); else expanded.delete(keyOf(record)); },
    // A record object was replaced by an edited copy or by the saved version: the receipt keeps its identity and its state.
    replace: (previous, next) => { const from = keyOf(previous); if (!next.dbId) draftKeys.set(next, from); move(from, keyOf(next)); },
    markPersisted: record => { if (record.dbId && record.status === 'active') baselines.set(keyOf(record), monthlyFilingSignature(record)); },
    markPersistedIfNew: record => { if (record.dbId && record.status === 'active' && !baselines.has(keyOf(record))) baselines.set(keyOf(record), monthlyFilingSignature(record)); },
    // 'new' = a not-yet-saved receipt with content; 'edited' = a saved Active receipt that differs from what was last persisted; Archived is never dirty.
    dirtyState: record => {
      if (record.status !== 'active') return 'clean';
      if (!record.dbId) return isBlankUnsavedMonthlyFilingRecord(record) ? 'clean' : 'new';
      return baselines.get(keyOf(record)) === undefined || baselines.get(keyOf(record)) === monthlyFilingSignature(record) ? 'clean' : 'edited';
    },
    forget: record => { const key = keyOf(record); expanded.delete(key); labels.delete(key); baselines.delete(key); }
  };
}
const pesoFormat = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
export const monthlyFilingAmountText = value => { const amount = Number(String(value ?? '').replaceAll(',', '')); return String(value ?? '').trim() && Number.isFinite(amount) ? pesoFormat.format(amount) : '₱0.00'; };
export const monthlyFilingDirtyLabel = state => state === 'new' ? 'New, unsaved' : state === 'edited' ? 'Unsaved changes' : '';
export const monthlyFilingSummaryName = ({ number, store, amountText, date, archived, dirty }) =>
  [`Monthly receipt ${number}`, store, amountText, date || 'no date', archived ? 'archived' : '', monthlyFilingDirtyLabel(dirty).toLowerCase()].filter(Boolean).join(', ');
export const matchingDirectoryEntries = (entries, candidate) => {
  const key = persistedStoreFingerprint(candidate);
  return entries.filter(entry => entry.decision?.candidate && persistedStoreFingerprint(entry.decision.candidate) === key);
};
export const directoryOutcomeFeedback = outcomes => outcomes.map(outcome => outcome.message).filter(Boolean).join(' ');

export function createMonthlyFilingUi({ elements, monthlyFilingService, sharedStoreService, downloadExpenseDetailedReport, confirmAction = async () => false }) {
  let currentUser; let records = []; let profiles = []; let loading = false; let lastDirectoryFeedback = ''; let activeTab = 'active'; let view = createMonthlyFilingViewState(); let contentSequence = 0;
  const lifecycle = createMonthlyFilingLifecycleState();
  const mutations = createMonthlyFilingMutationState();
  const feedback = text => { elements.feedback.textContent = text || ''; };
  const activeRecords = () => activeMonthlyFilingSnapshot(records);
  const values = row => Object.fromEntries(monthlyFilingEditableFields.map(key => [key, row.querySelector(`.monthly-${key}`).value]));
  const synchronizeActiveRow = row => {
    const index = Number(row.dataset.recordIndex);
    if (!Number.isInteger(index) || !records[index] || row.dataset.status !== 'active') return;
    const previous = records[index];
    records[index] = { ...previous, ...values(row), sharedStoreId: row.dataset.sharedStoreId || '', persistedStoreFingerprint: row.dataset.persistedStoreFingerprint || '' };
    view.replace(previous, records[index]);
  };
  const synchronizeVisibleActiveDrafts = () => [...elements.list.children].filter(row => row.matches('.monthly-card') && row.dataset.status === 'active').forEach(synchronizeActiveRow);
  const updateTabControls = () => {
    const counts = monthlyFilingTabCounts(records);
    elements.activeTab.textContent = `Active (${counts.active})`; elements.archivedTab.textContent = `Archived (${counts.archived})`;
    elements.activeTab.setAttribute('aria-selected', String(activeTab === 'active')); elements.archivedTab.setAttribute('aria-selected', String(activeTab === 'archived'));
    elements.activeTab.tabIndex = activeTab === 'active' ? 0 : -1; elements.archivedTab.tabIndex = activeTab === 'archived' ? 0 : -1;
    elements.activeActions.hidden = activeTab !== 'active'; elements.exportHelper.hidden = activeTab !== 'active'; elements.archivedActions.hidden = activeTab !== 'archived';
  };
  const monthlyCards = () => [...elements.list.children].filter(row => row.matches?.('.monthly-card'));
  const refreshRowPresentation = row => {
    const record = records[Number(row.dataset.recordIndex)];
    if (!record) return;
    const dirty = view.dirtyState(record); const archived = monthlyFilingIsReadOnly(record);
    const store = String(record.store || '').trim() || 'Store not set'; const amountText = monthlyFilingAmountText(record.amount);
    const open = view.isExpanded(record); const number = view.labelOf(record); const label = monthlyFilingDirtyLabel(dirty);
    row.classList.toggle('is-unsaved', dirty !== 'clean'); row.classList.toggle('is-collapsed', !open);
    row.querySelector('.monthly-receipt-id').textContent = `Receipt ${number}`;
    const unsaved = row.querySelector('.monthly-unsaved'); unsaved.textContent = label; unsaved.hidden = !label;
    const summary = row.querySelector('.monthly-summary');
    summary.querySelector('.monthly-summary-id').textContent = `Receipt ${number}`;
    summary.querySelector('.monthly-summary-store').textContent = store; summary.querySelector('.monthly-summary-store').title = store;
    summary.querySelector('.monthly-summary-amount').textContent = amountText;
    summary.querySelector('.monthly-summary-date').textContent = record.receiptDate || 'No date';
    const flags = summary.querySelector('.monthly-summary-flags'); flags.replaceChildren(...[archived && 'Archived', label].filter(Boolean).map(text => { const flag = document.createElement('span'); flag.className = 'monthly-flag'; flag.textContent = text; return flag; }));
    summary.setAttribute('aria-expanded', String(open));
    summary.setAttribute('aria-label', monthlyFilingSummaryName({ number, store, amountText, date: record.receiptDate, archived, dirty }));
  };
  const refreshPresentation = () => {
    monthlyCards().forEach(refreshRowPresentation);
    if (elements.unsavedNote) {
      const count = records.filter(record => view.dirtyState(record) !== 'clean').length;
      elements.unsavedNote.hidden = count === 0; elements.unsavedNote.textContent = count ? `${count} unsaved ${count === 1 ? 'receipt' : 'receipts'}` : '';
    }
  };
  const afterRender = callback => (globalThis.requestAnimationFrame ?? (task => setTimeout(task, 0)))(callback);
  const prefersReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const isShown = element => Boolean(element) && (typeof element.getClientRects !== 'function' || element.getClientRects().length > 0);
  // Focus a field of a receipt after a re-render. The receipt is expanded first; if its field is still not shown (collapsed card), its summary takes focus instead.
  const focusReceipt = (record, selector = '.monthly-store') => afterRender(() => {
    const key = view.keyOf(record); const row = monthlyCards().find(card => card.dataset.recordKey === key);
    if (!row) return;
    row.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    const field = row.querySelector(selector);
    (isShown(field) ? field : row.querySelector('.monthly-summary'))?.focus({ preventScroll: true });
  });
  const updateActions = () => { const counts = monthlyFilingTabCounts(records); const blocked = mutations.pending(); elements.save.disabled = blocked || counts.active === 0; elements.add.disabled = blocked; elements.exportActive.disabled = blocked || lifecycle.exportBlocked() || counts.active === 0; elements.clearArchived.disabled = blocked || lifecycle.clearBlocked() || counts.archived === 0; elements.clearAll.disabled = blocked || lifecycle.clearBlocked() || records.length === 0; updateTabControls(); refreshPresentation(); };
  const setRecord = (index, saved, fingerprint) => {
    const previous = records[index];
    records[index] = { ...saved, persistedStoreFingerprint: fingerprint ?? previous?.persistedStoreFingerprint ?? '' };
    if (previous) view.replace(previous, records[index]);
    view.markPersisted(records[index]);
  };
  const reloadSharedStores = async () => { profiles = await sharedStoreService.listActiveSharedStores(); return profiles; };
  const candidateMessage = candidate => {
    const details = [candidate.address && `Address: ${candidate.address}`, candidate.tin && `TIN: ${candidate.tin}`].filter(Boolean);
    return `“${candidate.storeName}” is not currently in the Company Directory. Adding it will make its store details available to other users.${details.length ? ` ${details.join(' · ')}` : ''}`;
  };
  const render = () => {
    elements.list.replaceChildren(); updateActions();
    const visibleRecords = monthlyFilingRecordsForTab(records, activeTab);
    if (!visibleRecords.length) { const empty = document.createElement('p'); empty.className = 'monthly-empty'; empty.textContent = activeTab === 'active' ? 'No Active Monthly Filing receipts yet. Add one to begin.' : 'No Archived Monthly Filing receipts.'; elements.list.append(empty); return; }
    records.forEach(record => view.labelOf(record));
    visibleRecords.forEach(record => {
      const recordIndex = records.indexOf(record);
      const row = elements.template.content.firstElementChild.cloneNode(true);
      row.dataset.recordKey = view.keyOf(record);
      const content = row.querySelector('.receipt-content'); content.id = `monthly-card-content-${++contentSequence}`;
      row.querySelector('.monthly-summary').setAttribute('aria-controls', content.id);
      row.querySelector('.monthly-summary').addEventListener('click', () => { const current = records[Number(row.dataset.recordIndex)]; if (!current) return; view.setExpanded(current, !view.isExpanded(current)); refreshRowPresentation(row); });
      row.dataset.recordIndex = String(recordIndex);
      const currentRecord = () => records[Number(row.dataset.recordIndex)] ?? record; row.dataset.monthlyId = record.dbId || ''; row.dataset.sharedStoreId = record.sharedStoreId || ''; row.dataset.status = record.status; row.dataset.persistedStoreFingerprint = record.persistedStoreFingerprint || '';
      Object.entries(record).forEach(([key, value]) => { const field = row.querySelector(`.monthly-${key}`); if (field) field.value = value || ''; });
      const archived = monthlyFilingIsReadOnly(record);
      row.querySelector('.monthly-status').textContent = archived ? 'Archived' : 'Active'; row.querySelector('.monthly-status').hidden = !archived;
      row.querySelectorAll('input, select').forEach(field => { field.disabled = archived; });
      row.querySelector('.monthly-delete').hidden = archived;
      const returnButton = row.querySelector('.monthly-return-active'); returnButton.hidden = !archived;
      returnButton.addEventListener('click', async event => {
        const record = currentRecord(); const recordIndex = Number(row.dataset.recordIndex);
        if (!archived || lifecycle.clearBlocked() || !mutations.begin('return-to-active')) return;
        updateActions();
        try {
          if (!await confirmAction({ title: 'Return receipt to Active?', message: 'This receipt will become editable again and will be included in the next Monthly Filing export.', confirmLabel: 'Return to Active', cancelLabel: 'Cancel', trigger: event.currentTarget })) return;
          setRecord(recordIndex, await monthlyFilingService.returnMonthlyFilingReceiptToActive(record.dbId)); view.setExpanded(records[recordIndex], true); activeTab = 'active'; render(); focusReceipt(records[recordIndex]); feedback('Monthly Filing receipt returned to Active.');
        } catch (error) { feedback(`Could not return receipt to Active: ${error.message}`); } finally { mutations.finish(); updateActions(); }
      });
      const store = row.querySelector('.monthly-store'); const suggestions = row.querySelector('.monthly-suggestions');
      const showSuggestions = () => {
        const query = store.value.trim().toLowerCase(); suggestions.replaceChildren();
        if (!query || archived) return suggestions.hidden = true;
        profiles.filter(profile => profile.storeName.toLowerCase().includes(query)).slice(0, 6).forEach(profile => { const option = document.createElement('button'); option.type = 'button'; option.textContent = [profile.storeName, profile.address, profile.tin].filter(Boolean).join(' · '); option.addEventListener('click', () => { const snapshot = monthlyFilingProfileSnapshot(profile); Object.entries(snapshot).forEach(([key, value]) => { if (key === 'sharedStoreId') row.dataset.sharedStoreId = value; else row.querySelector(`.monthly-${key}`).value = value; }); synchronizeActiveRow(row); updateActions(); suggestions.hidden = true; }); suggestions.append(option); });
        suggestions.hidden = !suggestions.children.length;
      };
      store.addEventListener('input', showSuggestions);
      ['store', 'address', 'tin'].forEach(key => row.querySelector(`.monthly-${key}`).addEventListener('input', () => { if (row.dataset.sharedStoreId) row.dataset.sharedStoreId = ''; }));
      row.querySelectorAll('input, select').forEach(field => { const sync = () => { synchronizeActiveRow(row); updateActions(); }; field.addEventListener('input', sync); field.addEventListener('change', sync); });
      row.querySelector('.monthly-delete').addEventListener('click', async event => {
        const record = currentRecord(); const recordIndex = Number(row.dataset.recordIndex);
        if (archived) return;
        if (!mutations.begin('delete')) return;
        updateActions();
        try {
          const position = monthlyCards().indexOf(row);
          if (!record.dbId) { view.forget(records[recordIndex]); records.splice(recordIndex, 1); render(); restoreListFocus(position); feedback('Unsaved Monthly Filing receipt removed.'); return; }
          if (!await confirmAction({ title: 'Delete Monthly Filing receipt?', message: 'This removes this receipt from Monthly Filing only.', confirmLabel: 'Delete Receipt', cancelLabel: 'Cancel', danger: true, trigger: event.currentTarget })) return;
          await monthlyFilingService.deleteMonthlyFilingReceipt(record.dbId); view.forget(record); records = records.filter(item => item.dbId !== record.dbId); render(); restoreListFocus(position); feedback('Monthly Filing receipt deleted.');
        } catch (error) { feedback(`Could not delete Monthly Filing receipt: ${error.message}`); } finally { mutations.finish(); updateActions(); }
      });
      elements.list.append(row);
    });
    updateActions();
  };
  // After a delete the focused button is gone: focus the receipt now in that position (summary on phones, Store on wide screens), else the Add button.
  const restoreListFocus = position => afterRender(() => {
    const cards = monthlyCards(); const next = cards[Math.min(Math.max(position, 0), cards.length - 1)];
    const target = next ? (isShown(next.querySelector('.monthly-store')) ? next.querySelector('.monthly-store') : next.querySelector('.monthly-summary')) : [elements.add, elements.activeTab].find(element => element && !element.disabled);
    target?.focus({ preventScroll: true });
  });
  const associateEntry = async (entry, profile) => {
    if (!profile?.id || entry.saved.sharedStoreId === profile.id) return undefined;
    try {
      const associated = await monthlyFilingService.associateMonthlyFilingSharedStore(entry.saved.dbId, profile.id);
      entry.saved = associated; setRecord(entry.recordIndex, associated, entry.fingerprint); if (entry.row) synchronizeMonthlyFilingRow(entry.row, associated);
    } catch (error) { return { type: 'association-failed', message: `Monthly Filing saved, but its Company Directory association could not be recorded: ${error.message}` }; }
  };
  const associateMatchingEntries = async (entries, candidate, profile) => {
    const outcomes = [];
    for (const entry of matchingDirectoryEntries(entries, candidate)) {
      const outcome = await associateEntry(entry, profile);
      if (outcome) outcomes.push(outcome);
    }
    return outcomes;
  };
  const processDirectoryDecisions = async entries => {
    const outcomes = [];
    for (const entry of entries) {
      entry.decision = postSaveDirectoryDecision({ values: entry.receipt, previousFingerprint: entry.previousFingerprint, profiles });
      entry.fingerprint = entry.decision.fingerprint;
      if (entry.row) entry.row.dataset.persistedStoreFingerprint = entry.fingerprint;
      records[entry.recordIndex].persistedStoreFingerprint = entry.fingerprint;
      if (entry.decision.status === 'existing') {
        const outcome = await associateEntry(entry, entry.decision.profile);
        if (outcome) outcomes.push(outcome);
      }
    }
    for (const decision of deduplicateDirectoryCandidates(entries.map(entry => entry.decision).filter(decision => decision.status === 'new' || decision.status === 'ambiguous'))) {
      if (decision.status === 'ambiguous') { outcomes.push({ type: 'ambiguous', message: 'Monthly Filing saved. Multiple Company profiles match this store; add more identifying information before adding it to the directory.' }); continue; }
      const confirmed = await confirmAction({ title: 'Add store to Company Directory?', message: candidateMessage(decision.candidate), confirmLabel: 'Add to Company Directory', cancelLabel: 'Keep only in Monthly Filing', trigger: elements.save });
      if (!confirmed) { outcomes.push({ type: 'declined', message: 'Monthly Filing saved. Store kept only in Monthly Filing.' }); continue; }
      try {
        const profile = await sharedStoreService.contributeSharedStore(decision.candidate, currentUser.id);
        await reloadSharedStores();
        outcomes.push({ type: 'contributed', message: 'Monthly Filing saved. Store added to the Company Directory.' }, ...await associateMatchingEntries(entries, decision.candidate, profile));
      } catch (error) {
        if (error?.name === 'SharedStoreDuplicateError') {
          try {
            await reloadSharedStores();
            const resolved = resolveSharedContributionCandidate(decision.candidate, profiles);
            if (resolved.status === 'existing') outcomes.push(...await associateMatchingEntries(entries, decision.candidate, resolved.profile));
            outcomes.push({ type: 'duplicate-reused', message: 'Monthly Filing saved. This store is already in the Company Directory.' });
          } catch { outcomes.push({ type: 'directory-failed', message: 'Monthly Filing saved. The Company Directory changed; refresh before trying this store again.' }); }
        } else outcomes.push({ type: 'directory-failed', message: `Monthly Filing saved, but the store could not be added to the Company Directory: ${error.message}` });
      }
    }
    return outcomes;
  };
  const add = () => {
    synchronizeVisibleActiveDrafts();
    let record = records.find(candidate => candidate.status === 'active' && isBlankUnsavedMonthlyFilingRecord(candidate));
    if (!record) { record = { dbId: '', sharedStoreId: '', store: '', address: '', tin: '', vat: '', amount: '', receiptDate: '', invoice: '', status: 'active', persistedStoreFingerprint: '' }; records.push(record); }
    view.setExpanded(record, true);
    render(); focusReceipt(record);
  };
  const save = async ({ successFeedback = true, fromExport = false } = {}) => {
    if (loading || !currentUser || (lifecycle.exportBlocked() && !fromExport) || (fromExport ? !mutations.permitsInternalExportSave() : !mutations.begin('save'))) return false;
    loading = true; elements.save.disabled = true;
    try {
      synchronizeVisibleActiveDrafts();
      const rowsByIndex = new Map([...elements.list.children].filter(row => row.matches('.monthly-card')).map(row => [Number(row.dataset.recordIndex), row]));
      const pending = records.map((record, recordIndex) => ({ record, recordIndex, row: rowsByIndex.get(recordIndex) })).filter(({ record }) => record.status === 'active' && !isBlankUnsavedMonthlyFilingRecord(record));
      const { saved, error } = await persistMonthlyFilingRows(pending, async entry => {
        const { record, recordIndex, row } = entry; const receipt = { ...record }; const previousFingerprint = record.persistedStoreFingerprint || '';
        const stored = record.dbId ? await monthlyFilingService.updateMonthlyFilingReceipt(record.dbId, receipt, currentUser.id) : await monthlyFilingService.createMonthlyFilingReceipt(receipt, currentUser.id);
        setRecord(recordIndex, stored, previousFingerprint);
        if (row) { synchronizeMonthlyFilingRow(row, stored); row.dataset.recordKey = view.keyOf(records[recordIndex]); }
        return { row, recordIndex, receipt, previousFingerprint, saved: stored };
      });
      if (error) throw error;
      lastDirectoryFeedback = directoryOutcomeFeedback(await processDirectoryDecisions(saved));
      render(); if (successFeedback) feedback(lastDirectoryFeedback || 'Monthly Filing changes saved.'); return true;
    } catch (error) { feedback(`Could not save Monthly Filing changes: ${error.message}`); return false; } finally { loading = false; if (!fromExport) mutations.finish(); updateActions(); }
  };
  const exportActive = async event => {
    if (!lifecycle.beginExport()) return;
    if (!mutations.begin('export')) { lifecycle.finishExport(); return; }
    updateActions();
    try {
    synchronizeVisibleActiveDrafts();
    const count = monthlyFilingActiveExportCount(records);
    if (!count) return feedback('There are no Active Monthly Filing receipts to export.');
    if (!await confirmAction({ title: 'Export Active Monthly Filing receipts?', message: `This will generate the Expense Detailed Report for all ${count} currently Active Monthly Filing receipt${count === 1 ? '' : 's'}. After the workbook is generated successfully, those receipts will be Archived and become read-only.`, confirmLabel: 'Export & Archive', cancelLabel: 'Cancel', trigger: event.currentTarget })) return;
    const result = await runMonthlyFilingExport({ save: () => save({ successFeedback: false, fromExport: true }), snapshot: activeRecords, generateWorkbook: snapshot => downloadExpenseDetailedReport(snapshot, monthlyFilingExportFilename()), archive: ids => monthlyFilingService.archiveMonthlyFilingReceipts(ids) });
    if (result.state === 'save-failed') return;
    if (result.state === 'empty') return feedback('There are no persisted Active Monthly Filing receipts to export.');
    if (result.state === 'generation-failed') return feedback(`Could not prepare the XLSX export: ${result.error.message}`);
    if (result.state === 'archive-failed') { lifecycle.markArchiveUncertain(); return feedback(`Workbook generated, but archive status could not be confirmed. Refresh Monthly Filing before exporting again. (${result.error.message})${lastDirectoryFeedback ? ` ${lastDirectoryFeedback}` : ''}`); }
    const archivedById = new Map(result.archived.map(record => [record.dbId, record])); records = records.map(record => archivedById.has(record.dbId) ? { ...archivedById.get(record.dbId), persistedStoreFingerprint: record.persistedStoreFingerprint } : record); render(); feedback(`Exported and archived ${result.records.length} Monthly Filing receipt${result.records.length === 1 ? '' : 's'}.${lastDirectoryFeedback ? ` ${lastDirectoryFeedback}` : ''}`);
    } finally { lifecycle.finishExport(); mutations.finish(); updateActions(); keepFocusReachable(); }
  };
  // A closing dialog returns focus to its trigger, which may have just become disabled: look again after the frame.
  const keepFocusReachable = () => afterRender(() => {
    const active = globalThis.document?.activeElement;
    if (active && active !== globalThis.document.body && !active.disabled && isShown(active)) return;
    [elements.exportActive, elements.add, elements.activeTab].find(element => element && !element.disabled)?.focus?.({ preventScroll: true });
  });
  const clearArchived = async event => {
    const snapshotIds = records.filter(record => record.dbId && record.status === 'archived').map(record => record.dbId);
    if (!snapshotIds.length || !currentUser || lifecycle.clearBlocked() || !mutations.begin('clear-archived')) return;
    updateActions();
    try {
      if (!await confirmAction({ title: 'Clear Archived receipts?', message: `This permanently deletes your ${snapshotIds.length} Archived Monthly Filing receipt${snapshotIds.length === 1 ? '' : 's'}. Active receipts will be preserved.`, confirmLabel: 'Clear Archived', cancelLabel: 'Cancel', danger: true, trigger: event.currentTarget })) return;
      const deletedIds = await monthlyFilingService.clearArchivedMonthlyFilingReceipts(currentUser.id, snapshotIds);
      records = reconcileArchivedMonthlyFilingDeletion(records, deletedIds);
      if (deletedIds.length === snapshotIds.length) feedback('Archived Monthly Filing receipts cleared. Active receipts were preserved.');
      else {
        try { records = reconcileMonthlyFilingReload(records, await monthlyFilingService.loadMonthlyFilingReceipts()); records.forEach(record => view.markPersistedIfNew(record)); feedback('Archived receipts changed in another session. Confirmed deletions were reconciled and local Active edits were preserved.'); }
        catch { feedback('Archived receipts changed in another session. Confirmed deletions were reconciled; refresh Monthly Filing before further cleanup.'); }
      }
      render();
    } catch (error) { feedback(`Could not clear Archived Monthly Filing receipts: ${error.message}`); } finally { mutations.finish(); updateActions(); }
  };
  const clearAll = async event => {
    if (!records.length || !currentUser || lifecycle.clearBlocked() || !mutations.begin('clear-all')) return;
    updateActions();
    const counts = monthlyFilingTabCounts(records);
    try {
      if (!await confirmAction({ title: 'Clear ALL Monthly Filing receipts?', message: `This permanently deletes ALL your Monthly Filing receipts, including ${counts.active} Active and ${counts.archived} Archived receipt${counts.active + counts.archived === 1 ? '' : 's'}. This cannot be undone. Long-term Receipts and the Company Directory are not affected.`, confirmLabel: 'Clear All Monthly Filing', cancelLabel: 'Cancel', danger: true, trigger: event.currentTarget })) return;
      await monthlyFilingService.clearMonthlyFilingReceipts(currentUser.id); records = []; view = createMonthlyFilingViewState(); activeTab = 'active'; render(); feedback('All Monthly Filing receipts cleared.');
    } catch (error) { feedback(`Could not clear all Monthly Filing receipts: ${error.message}`); } finally { mutations.finish(); updateActions(); }
  };
  const switchTab = tab => {
    if (tab === activeTab || mutations.pending()) return;
    synchronizeVisibleActiveDrafts(); activeTab = tab; render();
    (tab === 'active' ? elements.activeTab : elements.archivedTab).focus({ preventScroll: true });
  };
  return {
    async loadForUser(user) { currentUser = user; activeTab = 'active'; feedback('Loading Monthly Filing…'); try { view = createMonthlyFilingViewState(); records = await monthlyFilingService.loadMonthlyFilingReceipts(); records.forEach(record => view.markPersisted(record)); lifecycle.clearArchiveUncertain(); } catch (error) { records = []; feedback(`Could not load Monthly Filing receipts: ${error.message}`); } try { await reloadSharedStores(); if (!elements.feedback.textContent.startsWith('Could not')) feedback(''); } catch { profiles = []; feedback('Company Directory is temporarily unavailable. You can still enter store details manually.'); } render(); },
    clearForLogout() { currentUser = undefined; records = []; view = createMonthlyFilingViewState(); profiles = []; activeTab = 'active'; feedback(''); render(); }, setVisible(visible) { elements.workspace.hidden = !visible; },
    start() { trackTextEntry(elements.workspace); elements.activeTab.addEventListener('click', () => switchTab('active')); elements.archivedTab.addEventListener('click', () => switchTab('archived')); installTablistKeyboard({ tabs: [elements.activeTab, elements.archivedTab], activate: index => { if (mutations.pending()) return false; switchTab(index === 0 ? 'active' : 'archived'); } }); elements.add.addEventListener('click', add); elements.save.addEventListener('click', () => { void save(); }); elements.exportActive.addEventListener('click', exportActive); elements.clearArchived.addEventListener('click', clearArchived); elements.clearAll.addEventListener('click', clearAll); render(); }
  };
}
