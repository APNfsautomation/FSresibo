import { deduplicateDirectoryCandidates, finalizeDirectoryPromptFingerprints, findCompatibleSharedProfiles, hasContributableStoreDetails, normalizeStoreTin, persistedStoreFingerprint, postSaveDirectoryDecision, resolveSharedContributionCandidate, sharedProfileIdentity } from '../domain/sharedStoreProfiles.js';

export { deduplicateDirectoryCandidates, finalizeDirectoryPromptFingerprints, findCompatibleSharedProfiles, hasContributableStoreDetails, normalizeStoreTin, persistedStoreFingerprint, postSaveDirectoryDecision, resolveSharedContributionCandidate, sharedProfileIdentity } from '../domain/sharedStoreProfiles.js';

import { makeTemplateIdsUnique, receiptSummaryAccessibleName } from './receiptAccessibility.js';
import { collapseKeptReceiptsOnShortWindows } from './optimizationPresentation.js';
import { trackTextEntry } from './textEntryFocus.js';
import { parseMoneyAmount } from '../domain/moneyAmount.js';
import { outsideRangeNotice, receiptHasUnsavedChanges, releasedHiddenNotice } from './encodingPresentation.js';
import { changedWorkbookFields, classifyExportSnapshot, describeFieldChanges, moveId, partitionExportProblems, sameMembers, summarizeAmounts, workbookFields } from '../domain/exportArrangement.js';
import { buildReviewRow, createExportReview } from './exportReview.js';
import { fillShown, fillShownMessage, hiddenSelectedCount, manualEligibility, manualLimitMessage, maximumManualSelection, pruneManual, summarizeManual, toggleManual } from '../domain/manualSelection.js';
import { createReceiptExportRunner, preflightExport, preflightMessage, snapshotProblemMessage, unsavedValuesNotice } from './receiptExport.js';

const draftKey = 'receipt-match-draft-v2';
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const dateFormatter = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });
export const optimizationStrategyDetails = Object.freeze({
  closest: { label: 'Closest Match', helper: 'Meets the target with at most ₱50 extra; otherwise finds the closest total below target.' },
  fewest: { label: 'Fewest Receipts', helper: 'Uses fewer receipts from target to ₱50 above; otherwise uses a fixed ₱50 window below the closest under-target total.' },
  'without-exceeding': { label: 'Do Not Exceed Target', helper: 'Finds the closest total without going over your target.' }
});
export const optimizationStrategyRules = Object.freeze({
  closest: 'Rule: target-reaching totals up to ₱50 above first; lowest excess, then fewer receipts. Otherwise highest total below target.',
  fewest: 'Rule: fewest receipts from target to ₱50 above, then lowest excess. Otherwise fewest receipts within ₱50 below the closest under-target total, then highest total.',
  'without-exceeding': 'Rule: closest total at or below the target, then fewer receipts.'
});
export function createOptimizationStrategyState({ select, helper, optimizationStrategies, storage, storageKey }) {
  const normalizeStrategy = value => optimizationStrategyDetails[value] && Object.values(optimizationStrategies).includes(value) ? value : optimizationStrategies.closest;
  const getActiveStrategy = () => normalizeStrategy(select.value);
  const setActiveStrategy = (value, { persist = true } = {}) => {
    const strategy = normalizeStrategy(value);
    select.value = strategy;
    helper.textContent = optimizationStrategyDetails[strategy].helper;
    const key = storageKey();
    if (persist && key) try { storage.setItem(key, strategy); } catch { /* Ignore unavailable browser-session state. */ }
    return strategy;
  };
  const restoreActiveStrategy = () => {
    const key = storageKey();
    let stored;
    if (key) try { stored = storage.getItem(key); } catch { /* Ignore unavailable browser-session state. */ }
    return setActiveStrategy(stored, { persist: false });
  };
  return { getActiveStrategy, setActiveStrategy, restoreActiveStrategy };
}
export const defaultOptimizationToolbarState = () => ({ search: '', store: '', startDate: '', endDate: '', minAmount: '', maxAmount: '', sort: 'default', status: 'available' });
export const normalizeOptimizationText = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
export const readableOptimizationText = value => String(value || '').trim().replace(/\s+/g, ' ');
export const normalizeReceiptStatus = value => value === 'consumed' ? 'consumed' : 'available';
export const encodingAmountCompartments = Object.freeze([
  { value: 'all', label: 'All amounts', minimumCents: -Infinity, maximumCents: Infinity },
  { value: 'below-200', label: 'Below ₱200', minimumCents: -Infinity, maximumCents: 20000 },
  ...[200, 300, 400, 500, 600, 700, 800, 900].map(lower => ({ value: `${lower}-${lower + 99}`, label: `₱${lower}–${lower + 99}`, minimumCents: lower * 100, maximumCents: (lower + 100) * 100 })),
  { value: '1000-plus', label: '₱1,000+', minimumCents: 100000, maximumCents: Infinity }
]);
const encodingAmountCompartmentValues = new Set(encodingAmountCompartments.map(({ value }) => value));
export const normalizeEncodingAmountCompartment = value => encodingAmountCompartmentValues.has(value) ? value : 'all';
export const amountCompartmentForCents = cents => {
  const amount = Number(cents);
  if (!Number.isFinite(amount)) return null;
  return encodingAmountCompartments.find(compartment => compartment.value !== 'all' && amount >= compartment.minimumCents && amount < compartment.maximumCents) || null;
};
export const receiptMatchesEncodingAmountCompartment = (cents, compartment) => normalizeEncodingAmountCompartment(compartment) === 'all' || amountCompartmentForCents(cents)?.value === compartment;
export const groupSelectedReceiptsByCompartment = receipts => encodingAmountCompartments
  .filter(compartment => compartment.value !== 'all')
  .map(compartment => ({ ...compartment, receipts: receipts.filter(receipt => amountCompartmentForCents(receipt.cents)?.value === compartment.value) }))
  .filter(group => group.receipts.length);
export const availableReceiptTotalCents = receipts => receipts.reduce((total, receipt) =>
  normalizeReceiptStatus(receipt.status) === 'available' && Number.isFinite(Number(receipt.cents)) ? total + Number(receipt.cents) : total, 0);
export const normalizeStoreText = normalizeOptimizationText;
const storeProfileIdentity = receipt => ({
  store: normalizeStoreText(receipt.store),
  address: normalizeStoreText(receipt.address),
  tin: normalizeStoreText(receipt.tin)
});
const profileSpecificity = profile => Number(Boolean(profile.addressKey)) + Number(Boolean(profile.tinKey));
const compatibleStoreProfile = (first, second) =>
  (!first.addressKey || !second.addressKey || first.addressKey === second.addressKey) &&
  (!first.tinKey || !second.tinKey || first.tinKey === second.tinKey);
const recordTimestamp = (record, fallback) => {
  const timestamp = Date.parse(record.updatedAt || '');
  return Number.isFinite(timestamp) ? timestamp : fallback;
};
const latestNonEmptyStoreValue = (records, field) => [...records]
  .sort((first, second) => recordTimestamp(second, second.index) - recordTimestamp(first, first.index) || second.index - first.index)
  .map(record => readableOptimizationText(record[field]))
  .find(Boolean) || '';
export const storeProfileFields = profile => ({ store: profile.store, address: profile.address, tin: profile.tin, vat: profile.vat });
export const applyStoreProfileSnapshot = (current, profile) => {
  const values = storeProfileFields(profile);
  if (profile.source === 'shared') return values;
  return { store: values.store, address: values.address || current.address, tin: values.tin || current.tin, vat: values.vat || current.vat };
};
export const describeStoreProfile = profile => [profile.address, profile.tin].filter(Boolean).join(' · ');
export function buildStoreProfiles(receipts) {
  const stores = new Map();
  receipts.forEach((receipt, index) => {
    const identity = storeProfileIdentity(receipt);
    if (!identity.store) return;
    const profiles = stores.get(identity.store) || new Map();
    const key = `${identity.address}\u0000${identity.tin}`;
    const profile = profiles.get(key) || { storeKey: identity.store, addressKey: identity.address, tinKey: identity.tin, records: [] };
    profile.records.push({ ...receipt, index });
    profiles.set(key, profile);
    stores.set(identity.store, profiles);
  });
  const result = [];
  stores.forEach(profiles => {
    const candidates = [...profiles.values()];
    candidates.forEach(profile => {
      const matches = candidates.filter(candidate => candidate !== profile && profileSpecificity(candidate) > profileSpecificity(profile) && compatibleStoreProfile(profile, candidate));
      if (matches.length === 1) {
        matches[0].records.push(...profile.records);
        profiles.delete(`${profile.addressKey}\u0000${profile.tinKey}`);
      }
    });
    profiles.forEach(profile => {
      const store = latestNonEmptyStoreValue(profile.records, 'store');
      result.push({
        id: `${profile.storeKey}\u0000${profile.addressKey}\u0000${profile.tinKey}`,
        normalizedStore: profile.storeKey,
        store,
        address: latestNonEmptyStoreValue(profile.records, 'address'),
        tin: latestNonEmptyStoreValue(profile.records, 'tin'),
        vat: latestNonEmptyStoreValue(profile.records, 'vat'),
        updatedAt: Math.max(...profile.records.map(record => recordTimestamp(record, record.index)))
      });
    });
  });
  return result.sort((first, second) => first.store.localeCompare(second.store, undefined, { sensitivity: 'base' }) || describeStoreProfile(first).localeCompare(describeStoreProfile(second), undefined, { sensitivity: 'base' }) || second.updatedAt - first.updatedAt);
}
export function findStoreSuggestions(profiles, query, limit = 6) {
  const normalizedQuery = normalizeStoreText(query);
  if (!normalizedQuery) return [];
  return profiles
    .filter(profile => profile.normalizedStore.includes(normalizedQuery))
    .sort((first, second) => Number(!first.normalizedStore.startsWith(normalizedQuery)) - Number(!second.normalizedStore.startsWith(normalizedQuery)) || first.store.localeCompare(second.store, undefined, { sensitivity: 'base' }) || describeStoreProfile(first).localeCompare(describeStoreProfile(second), undefined, { sensitivity: 'base' }) || second.updatedAt - first.updatedAt)
    .slice(0, limit);
}
export const calendarReceiptDate = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const [year, month, day] = match.slice(1).map(Number);
  const localDate = new Date(year, month - 1, day);
  return localDate.getFullYear() === year && localDate.getMonth() === month - 1 && localDate.getDate() === day ? `${match[1]}-${match[2]}-${match[3]}` : '';
};
const parseOptimizationBound = value => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed.replace(/[^0-9.]/g, ''));
  return /\d/.test(trimmed) && Number.isFinite(numeric) ? Math.round(numeric * 100) : null;
};
const compareMissingLast = (first, second, direction = 1) => {
  if (!first && !second) return 0;
  if (!first) return 1;
  if (!second) return -1;
  return first < second ? -direction : first > second ? direction : 0;
};
export function buildOptimizationView(entries, state) {
  const status = ['available', 'consumed', 'all'].includes(state.status) ? state.status : 'available';
  const startDate = calendarReceiptDate(state.startDate);
  const endDate = calendarReceiptDate(state.endDate);
  const minAmount = parseOptimizationBound(state.minAmount);
  const maxAmount = parseOptimizationBound(state.maxAmount);
  const invalidStartDate = Boolean(String(state.startDate || '').trim() && !startDate);
  const invalidEndDate = Boolean(String(state.endDate || '').trim() && !endDate);
  const invalidMinAmount = Boolean(String(state.minAmount || '').trim() && minAmount === null);
  const invalidMaxAmount = Boolean(String(state.maxAmount || '').trim() && maxAmount === null);
  const invalidDateRange = Boolean(startDate && endDate && startDate > endDate);
  const invalidAmountRange = minAmount !== null && maxAmount !== null && minAmount > maxAmount;
  const messages = [];
  if (invalidStartDate || invalidEndDate) messages.push('Enter valid receipt dates.');
  if (invalidMinAmount || invalidMaxAmount) messages.push('Enter valid amount values.');
  if (invalidDateRange) messages.push('Start date must be on or before end date.');
  if (invalidAmountRange) messages.push('Minimum amount must not exceed maximum amount.');
  const query = normalizeOptimizationText(state.search);
  const visible = entries.filter(entry => {
    const { receipt } = entry;
    const matchesStatus = status === 'all' || normalizeReceiptStatus(receipt.status) === status;
    const matchesSearch = !query || [receipt.store, receipt.invoice, receipt.tin, receipt.address, entry.receiptId, `Receipt ${entry.receiptId}`].some(value => normalizeOptimizationText(value).includes(query));
    if (!matchesStatus || !matchesSearch || (state.store && normalizeOptimizationText(receipt.store) !== state.store)) return false;
    if (!invalidDateRange && !invalidStartDate && !invalidEndDate && (startDate || endDate)) {
      if (!entry.date || (startDate && entry.date < startDate) || (endDate && entry.date > endDate)) return false;
    }
    if (!invalidAmountRange && !invalidMinAmount && !invalidMaxAmount && (minAmount !== null || maxAmount !== null)) {
      if ((minAmount !== null && entry.amount < minAmount) || (maxAmount !== null && entry.amount > maxAmount)) return false;
    }
    return true;
  });
  const compare = (first, second) => {
    let result = 0;
    switch (state.sort) {
      case 'receipt-asc': result = Number(first.receiptId) - Number(second.receiptId); break;
      case 'receipt-desc': result = Number(second.receiptId) - Number(first.receiptId); break;
      case 'date-asc': result = compareMissingLast(first.date, second.date); break;
      case 'date-desc': result = compareMissingLast(first.date, second.date, -1); break;
      case 'amount-asc': result = first.amount - second.amount; break;
      case 'amount-desc': result = second.amount - first.amount; break;
      case 'store-asc': result = compareMissingLast(normalizeOptimizationText(first.receipt.store), normalizeOptimizationText(second.receipt.store)); break;
      case 'store-desc': result = compareMissingLast(normalizeOptimizationText(first.receipt.store), normalizeOptimizationText(second.receipt.store), -1); break;
      default: result = first.index - second.index;
    }
    return result || first.index - second.index;
  };
  return { visible: visible.sort(compare), validation: { startDate, endDate, minAmount, maxAmount, invalidStartDate, invalidEndDate, invalidMinAmount, invalidMaxAmount, invalidDateRange, invalidAmountRange, message: messages.join(' ') } };
}
export const availableOptimizerReceipts = receipts => receipts.filter(receipt => normalizeReceiptStatus(receipt.status) === 'available' && receipt.cents > 0);

export function createReceiptDeleteHandler({ row, triggerFallback, getCurrentUser, getReceiptStatus, hasDraftContent, confirmAction, deleteReceipt, removeStoreSourceReceipt, clearSelection, refreshReceiptIds, refreshEncodingCards, refreshOptimizationCards, setFeedback, feedbackTarget }) {
  let deletePending = false;
  return async event => {
    const trigger = event.currentTarget;
    if (!trigger || trigger.disabled || deletePending) return;
    const id = row.dataset.receiptDbId;
    if (getReceiptStatus() === 'consumed') return;
    const nextFocus = row.nextElementSibling || row.previousElementSibling;
    deletePending = true;
    try {
      if (id && getCurrentUser()) {
        if (!await confirmAction({ title: 'Delete saved receipt?', message: 'This cannot be undone.', confirmLabel: 'Delete receipt', cancelLabel: 'Keep receipt', danger: true, trigger })) return;
        trigger.disabled = true;
        setFeedback(feedbackTarget);
        await deleteReceipt(id);
      } else if (hasDraftContent() && !await confirmAction({ title: 'Discard unfinished receipt?', message: 'Its entered details will be lost.', confirmLabel: 'Discard receipt', cancelLabel: 'Keep editing', danger: true, trigger })) return;
      row.remove();
      if (id) removeStoreSourceReceipt(id);
      clearSelection();
      refreshReceiptIds();
      refreshEncodingCards();
      refreshOptimizationCards();
      (nextFocus?.querySelector('summary') || triggerFallback).focus({ preventScroll: true });
    } catch (error) {
      setFeedback(feedbackTarget, `Could not delete this receipt: ${error.message}`, 'error');
    } finally {
      deletePending = false;
      trigger.disabled = false;
    }
  };
}
// Permanent deletion of a saved Consumed receipt. The row stays in the list until the database has confirmed the deletion.
export function createConsumedDeleteHandler({ row, triggerFallback, getCurrentUser, getReceiptStatus, confirmAction, deleteConsumedReceipt, removeStoreSourceReceipt, clearSelection, refreshReceiptIds, refreshEncodingCards, refreshOptimizationCards, setFeedback, feedbackTarget }) {
  let deletePending = false;
  const visibleNeighbour = (start, step) => { let node = start; while (node && node.hidden) node = node[step]; return node; };
  return async event => {
    const trigger = event.currentTarget;
    if (!trigger || trigger.disabled || deletePending) return;
    const id = row.dataset.receiptDbId;
    if (!id || !getCurrentUser() || getReceiptStatus() !== 'consumed') return;
    const nextFocus = visibleNeighbour(row.nextElementSibling, 'nextElementSibling') || visibleNeighbour(row.previousElementSibling, 'previousElementSibling');
    deletePending = true;
    try {
      if (!await confirmAction({ title: 'Permanently delete this Consumed receipt?', message: 'This permanently deletes the saved receipt. It cannot be undone. Receipts you already exported are not affected.', confirmLabel: 'Delete permanently', cancelLabel: 'Keep receipt', danger: true, trigger })) return;
      trigger.disabled = true;
      setFeedback(feedbackTarget);
      await deleteConsumedReceipt(id);
      row.remove();
      removeStoreSourceReceipt(id);
      clearSelection();
      refreshReceiptIds();
      refreshEncodingCards();
      refreshOptimizationCards();
      setFeedback(feedbackTarget, 'Consumed receipt deleted permanently.', 'success');
      (nextFocus?.querySelector('summary') || triggerFallback)?.focus?.({ preventScroll: true });
    } catch (error) {
      setFeedback(feedbackTarget, `Could not delete this Consumed receipt: ${String(error?.message || 'Unknown error').replace(/[.\s]+$/, '')}. It was not removed from your list.`, 'error');
    } finally {
      deletePending = false;
      trigger.disabled = false;
    }
  };
}
export const floatingAddVisibleForStatus = status => status !== 'consumed';
export async function persistReceiptsBeforeDirectoryPrompts(rows, persistRow) {
  const persisted = [];
  for (const row of rows) {
    try {
      const result = await persistRow(row);
      if (result) persisted.push(result);
    } catch (error) { return { persisted, candidates: [], error }; }
  }
  return { persisted, candidates: persisted.map(result => result.decision).filter(decision => decision?.status === 'new' || decision?.status === 'ambiguous'), error: undefined };
}
export function combineStoreProfiles(sharedProfiles, historyProfiles) {
  const shared = sharedProfiles.map(profile => ({ ...profile, source: 'shared', store: profile.storeName, normalizedStore: normalizeStoreText(profile.storeName), addressKey: normalizeStoreText(profile.address), tinKey: normalizeStoreTin(profile.tin) }));
  const identity = profile => `${profile.normalizedStore || normalizeStoreText(profile.store)}\u0000${profile.addressKey || normalizeStoreText(profile.address)}\u0000${profile.tinKey || normalizeStoreTin(profile.tin)}`;
  const sharedIds = new Set(shared.map(identity));
  return [...shared, ...historyProfiles.filter(profile => !sharedIds.has(identity(profile))).map(profile => ({ ...profile, source: 'history', normalizedStore: profile.normalizedStore || normalizeStoreText(profile.store) }))];
}

export function createReceiptUi({ elements, findBest, optimizationStrategies, toCents, scanPrintedDetails, downloadSelectedReceipts, receiptService, sharedStoreService = {}, confirmAction = async () => false, modalFocus = null }) {
  let currentUser;
  // The optimizer result: { entries: [{ dbId, receiptId, label, used }] } in export order, or null. Saved receipts are identified by database id.
  // An unsaved draft has no id yet: it is kept (by its receipt number) so export can explain why it is blocked instead of silently dropping it.
  // `used` is what the optimizer calculated with (workbook fields), kept to detect that the result no longer applies.
  let selection = null;
  // The temporary export order for the current selection: { selection, initial: [ids], order: [ids] }. Memory only; never stored anywhere.
  // One temporary export arrangement per mode, in memory only: a mode's review never replaces the other's.
  const arrangements = { 'best-match': null, manual: null };
  const activeArrangement = () => arrangements[exportSession?.mode ?? exportMode];
  // Export mode (CP10-C3E-4). Best Match keeps its own result (`selection` above); Manual Selection keeps an ordered list of saved receipt ids in click order.
  // The two never share state: switching modes changes only which one is shown and exported. Memory only; reset on logout, reload and user change.
  let exportMode = 'best-match';
  let manualIds = [];
  let manualSourceCache = null; // rebuilt whenever the ids change, so its identity stands for "this exact manual selection"
  // Receipts a snapshot has proven are gone from the database. Their local rows may still say Available (unsaved fields are never discarded), so they must not be pickable again. Memory only, per session.
  const knownMissingIds = new Set();
  // Eligibility is judged on the SAVED receipt (the local cache of what the database holds), never on the row's display status: that one is normalized to
  // Available/Consumed, so an unknown or empty saved status would otherwise look Available. Exactly 'available' is eligible.
  const manualEligibilityOf = (dbId, savedById = savedReceiptsById()) => {
    if (dbId && knownMissingIds.has(dbId)) return 'missing';
    const saved = dbId ? savedById.get(dbId) : null;
    return manualEligibility({ dbId: saved ? saved.dbId : null, status: saved?.status });
  };
  const setManualIds = ids => { manualIds = ids; manualSourceCache = null; arrangements.manual = null; };
  let toolbarState = defaultOptimizationToolbarState();
  let encodingDisplayState = { compartment: 'all' };
  let searchDebounce;
  let storeSourceReceipts = [];
  let storeProfiles = [];
  let sharedStoreProfiles = [];
  let storeSuggestionSequence = 0;
  let receiptDomSequence = 0;
  let savePending = false;
  let importPending = false;
  let editSavePending = false;
  const format = cents => money.format(cents / 100);
  // Severity is explicit: 'success' | 'warning' | 'error' | 'info' (no severity = a neutral note). It is exposed as data-severity for styling.
  const setFeedback = (target, text = '', severity = '') => {
    if (!target) return;
    target.textContent = text;
    if (text && severity) target.dataset.severity = severity; else delete target.dataset.severity;
  };
  const formatDate = value => {
    const date = calendarReceiptDate(value);
    if (!date) return 'Date not set';
    const [year, month, day] = date.split('-').map(Number);
    return dateFormatter.format(new Date(year, month - 1, day));
  };
  const rowValues = row => Object.fromEntries(['amount', 'receiptDate', 'vat', 'invoice', 'store', 'address', 'tin'].map(key => [key, row.querySelector(`.receipt-${key}`).value]));
  // Strict amount rules shared with the persistence boundary (domain/moneyAmount.js): a malformed non-blank amount is never guessed at.
  const amountProblem = row => { const parsed = parseMoneyAmount(row.querySelector('.receipt-amount').value); return parsed.valid === false ? parsed.message : ''; };
  const amountCents = row => { const parsed = parseMoneyAmount(row.querySelector('.receipt-amount').value); return parsed.valid ? parsed.cents : 0; };
  const rowAmountMessage = (row, problem) => `Receipt ${row.dataset.receiptId || ''}: ${problem}`.replace('Receipt : ', '');
  const rebuildStoreProfiles = () => { storeProfiles = buildStoreProfiles(storeSourceReceipts); };
  const sharedProfile = profile => ({ ...profile, storeName: profile.storeName || profile.store, address: profile.address || '', tin: profile.tin || '' });
  const profileIdentity = sharedProfileIdentity;
  const combinedStoreProfiles = () => combineStoreProfiles(sharedStoreProfiles, storeProfiles);
  const reloadSharedStores = async () => {
    try { sharedStoreProfiles = await sharedStoreService.listActiveSharedStores(); return true; }
    catch { setFeedback(elements.encodingFeedback, 'Company Store Directory is temporarily unavailable. Your receipt history is still available.', 'warning'); return false; }
  };
  const upsertStoreSourceReceipt = receipt => {
    if (!receipt?.dbId) return;
    const index = storeSourceReceipts.findIndex(candidate => candidate.dbId === receipt.dbId);
    if (index >= 0) storeSourceReceipts[index] = receipt;
    else storeSourceReceipts.push(receipt);
    rebuildStoreProfiles();
  };
  const removeStoreSourceReceipt = id => {
    if (!id) return;
    storeSourceReceipts = storeSourceReceipts.filter(receipt => receipt.dbId !== id);
    rebuildStoreProfiles();
  };
  const setUnsavedNotice = (text = '') => {
    const notice = elements.optimizationUnsavedNotice;
    if (!notice) return;
    notice.textContent = text;
    notice.hidden = !text;
  };
  // Clearing the Best Match result never touches the manual selection (or its arrangement).
  const clearSelection = () => { arrangements['best-match'] = null; selection = null; setUnsavedNotice(''); showExportBlockAction(null); updateExportAction(); };
  const selectionEntryMatchesRow = (entry, row) => entry.dbId ? row.dataset.receiptDbId === entry.dbId : row.dataset.receiptId === entry.receiptId;
  const bestIncludesRow = row => Boolean(selection?.entries.some(entry => selectionEntryMatchesRow(entry, row)));
  const manualPosition = row => row.dataset.receiptDbId ? manualIds.indexOf(row.dataset.receiptDbId) + 1 : 0;
  const selectionIncludesRow = row => exportMode === 'manual' ? manualPosition(row) > 0 : bestIncludesRow(row);
  // The selection the Export Selected button of the ACTIVE mode acts on, in the shape the export pipeline expects: { mode, entries: [{ dbId, receiptId, label, used }] }.
  const manualSource = () => {
    if (!manualIds.length) return null;
    if (!manualSourceCache) manualSourceCache = { mode: 'manual', entries: manualIds.map(id => { const number = [...elements.list.children].find(row => row.dataset.receiptDbId === id)?.dataset.receiptId ?? '?'; return { dbId: id, receiptId: number, label: `Receipt ${number}`, used: undefined }; }) };
    return manualSourceCache;
  };
  const exportSource = () => exportMode === 'manual' ? manualSource() : selection;
  const exportButton = () => exportMode === 'manual' ? elements.manualExportSelected : elements.exportSelected;
  const workspaceStorageKey = () => currentUser?.id ? `fsresibo-workspace-${currentUser.id}` : null;
  const toolbarStorageKey = () => currentUser?.id ? `fsresibo-optimization-toolbar-${currentUser.id}` : null;
  const encodingDisplayStorageKey = () => currentUser?.id ? `fsresibo-encoding-display-${currentUser.id}` : null;
  const strategyStorageKey = () => currentUser?.id ? `fsresibo-optimization-strategy-${currentUser.id}` : null;
  const { getActiveStrategy, setActiveStrategy, restoreActiveStrategy } = createOptimizationStrategyState({ select: elements.optimizationStrategy, helper: elements.optimizationStrategyHelper, optimizationStrategies, storage: sessionStorage, storageKey: strategyStorageKey });
  const hasActiveToolbarState = state => Object.entries(defaultOptimizationToolbarState()).some(([key, value]) => state[key] !== value);
  const readToolbarState = () => ({
    search: elements.optimizationSearch.value,
    store: elements.optimizationStoreFilter.value,
    startDate: elements.optimizationStartDate.value,
    endDate: elements.optimizationEndDate.value,
    minAmount: elements.optimizationMinAmount.value,
    maxAmount: elements.optimizationMaxAmount.value,
    sort: elements.optimizationSort.value || 'default',
    status: ['available', 'consumed', 'all'].includes(elements.receiptStatusFilter.value) ? elements.receiptStatusFilter.value : 'available'
  });
  const syncToolbarControls = () => {
    elements.optimizationSearch.value = toolbarState.search;
    elements.optimizationStartDate.value = toolbarState.startDate;
    elements.optimizationEndDate.value = toolbarState.endDate;
    elements.optimizationMinAmount.value = toolbarState.minAmount;
    elements.optimizationMaxAmount.value = toolbarState.maxAmount;
    elements.optimizationSort.value = toolbarState.sort;
    elements.receiptStatusFilter.value = toolbarState.status;
  };
  const persistToolbarState = () => {
    const key = toolbarStorageKey();
    if (!key) return;
    try {
      if (hasActiveToolbarState(toolbarState)) sessionStorage.setItem(key, JSON.stringify(toolbarState));
      else sessionStorage.removeItem(key);
    } catch { /* Session storage can be unavailable in private browser contexts. */ }
  };
  const restoreToolbarState = () => {
    toolbarState = defaultOptimizationToolbarState();
    const key = toolbarStorageKey();
    if (!key) return;
    try {
      const stored = JSON.parse(sessionStorage.getItem(key));
      if (stored && typeof stored === 'object') toolbarState = { ...toolbarState, ...Object.fromEntries(Object.keys(toolbarState).map(keyName => [keyName, typeof stored[keyName] === 'string' ? stored[keyName] : toolbarState[keyName]])) };
    } catch { /* Ignore unavailable or malformed browser-session state. */ }
  };
  const persistEncodingDisplayState = () => {
    const key = encodingDisplayStorageKey();
    if (!key) return;
    try {
      if (encodingDisplayState.compartment === 'all') sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(encodingDisplayState));
    } catch { /* Session storage can be unavailable in private browser contexts. */ }
  };
  const restoreEncodingDisplayState = () => {
    encodingDisplayState = { compartment: 'all' };
    const key = encodingDisplayStorageKey();
    if (key) try {
      const stored = JSON.parse(sessionStorage.getItem(key));
      encodingDisplayState.compartment = normalizeEncodingAmountCompartment(stored?.compartment);
    } catch { /* Ignore unavailable or malformed browser-session state. */ }
    elements.encodingAmountCompartment.value = encodingDisplayState.compartment;
  };
  const renderEncodingAmountCompartmentOptions = () => {
    const selected = normalizeEncodingAmountCompartment(elements.encodingAmountCompartment.value);
    elements.encodingAmountCompartment.replaceChildren(...encodingAmountCompartments.map(compartment => new Option(compartment.label, compartment.value)));
    elements.encodingAmountCompartment.value = selected;
  };
  const updateResultSummary = ({ target, matched = null, difference = null, receiptCount = 0, strategy = getActiveStrategy() } = {}) => {
    const details = optimizationStrategyDetails[strategy];
    elements.optimizationResultSummary.hidden = target === undefined;
    if (target === undefined) return;
    elements.summaryTarget.textContent = format(target);
    elements.summaryMatched.textContent = matched === null ? 'No valid combination' : format(matched);
    elements.summaryDifference.textContent = difference === null ? '—' : format(Math.abs(difference));
    elements.summaryReceiptCount.textContent = String(receiptCount);
    elements.summaryStrategy.textContent = details.label;
  };
  const refreshToggle = row => {
    const summary = row.querySelector('summary');
    row.querySelector('.toggle-label').textContent = row.open ? 'Collapse' : 'Details';
    summary.title = `${row.open ? 'Collapse' : 'Show'} receipt details`;
    refreshSummaryAccessibleName(row);
  };
  // Each summary is named by its stable receipt identity, store, amount and state; kept in sync with edits, status and expansion.
  const refreshSummaryAccessibleName = row => {
    const amountValue = String(row.querySelector('.receipt-amount').value ?? '').trim();
    row.querySelector('summary').setAttribute('aria-label', receiptSummaryAccessibleName({
      id: row.dataset.receiptId || '1',
      store: row.querySelector('.receipt-store').value,
      amountCents: amountValue ? toCents(amountValue) : null,
      status: normalizeReceiptStatus(row.dataset.receiptStatus),
      open: row.open,
      outsideRange: row.classList.contains('is-outside-range'),
      unsavedLabel: unsavedLabels[row.dataset.unsavedKind] ?? ''
    }));
  };
  const receiptStatus = row => normalizeReceiptStatus(row.dataset.receiptStatus);
  const refreshSummary = row => {
    const id = row.dataset.receiptId || '1';
    const store = row.querySelector('.receipt-store').value.trim() || 'Store not set';
    const amount = toCents(row.querySelector('.receipt-amount').value);
    row.querySelector('.summary-id').textContent = `Receipt ${id}`;
    const summaryStore = row.querySelector('.summary-store');
    summaryStore.textContent = store;
    summaryStore.title = store;
    row.querySelector('.summary-amount').textContent = format(amount);
    refreshSummaryAccessibleName(row);
  };
  const updateExportAction = () => {
    const count = selection ? selection.entries.length : 0;
    elements.exportSelected.disabled = count === 0;
    elements.exportSelected.textContent = `Export Selected (${count})`;
    if (elements.manualExportSelected) {
      elements.manualExportSelected.disabled = manualIds.length === 0;
      elements.manualExportSelected.textContent = `Export Selected (${manualIds.length})`;
    }
    renderManualSummary();
  };
  // Edit pins (presentation only, never stored): a receipt being added or edited stays visible even when its amount is outside the selected
  // amount range. A pin overrides the amount range only, never the Available/Consumed view. Pins are released by collapsing the receipt, a successful
  // Save, changing the amount range or the view, Collapse all, and deleting the receipt.
  const pinReceipt = row => { row.dataset.filterPinned = '1'; };
  const releaseEditPins = (rows = [...elements.list.children]) => {
    const pinned = rows.filter(row => row.dataset.filterPinned);
    const outside = pinned.filter(row => row.classList.contains('is-outside-range'));
    pinned.forEach(row => { delete row.dataset.filterPinned; });
    return outside;
  };
  const rangeLabel = () => encodingAmountCompartments.find(compartment => compartment.value === encodingDisplayState.compartment)?.label ?? '';
  const renderFilterNotice = outsideRows => {
    if (!elements.encodingFilterNotice) return;
    elements.encodingFilterNotice.hidden = outsideRows.length === 0;
    if (outsideRows.length) elements.encodingFilterNoticeText.textContent = outsideRangeNotice(outsideRows.map(row => row.dataset.receiptId || ''), rangeLabel());
  };
  const savedReceiptFor = row => row.dataset.receiptDbId ? storeSourceReceipts.find(receipt => receipt.dbId === row.dataset.receiptDbId) : undefined;
  // The summary card shows persisted Available receipts only (all amount ranges); pending edits are announced, never added in.
  // Receipts whose typed values differ from what is saved (new drafts with content count too). Uses the same comparison as before: amounts as exact centavos.
  const rowIsUnsaved = row => {
    if (receiptStatus(row) === 'consumed') return false;
    if (row.dataset.receiptDbId && !savedReceiptFor(row)) return false;
    return receiptHasUnsavedChanges(rowValues(row), savedReceiptFor(row));
  };
  // Export-specific: the workbook writes text untrimmed, so a saved receipt counts as changed when ANY workbook field differs exactly
  // (amounts by exact centavos). The Encoding indicator above keeps its own, trimmed comparison.
  const rowHasUnsavedExportChanges = row => {
    if (receiptStatus(row) === 'consumed') return false;
    if (!row.dataset.receiptDbId) return rowIsUnsaved(row);
    const saved = savedReceiptFor(row);
    return saved ? changedWorkbookFields(saved, rowValues(row), { includeUpdatedAt: false }).length > 0 : false;
  };
  // One definition of "unsaved" for the card flag, the global count and the export preflight: the Encoding comparison (trimmed, exact centavos) OR the export comparison
  // (every workbook field exactly). A receipt the export would refuse for unsaved edits therefore always shows the flag. Consumed receipts are never unsaved.
  const unsavedLabels = { new: 'New, unsaved', changes: 'Unsaved changes' };
  const unsavedKind = row => (rowIsUnsaved(row) || rowHasUnsavedExportChanges(row)) ? (row.dataset.receiptDbId ? 'changes' : 'new') : '';
  const applyUnsavedKind = (row, kind) => {
    if ((row.dataset.unsavedKind || '') === kind) return;
    if (kind) row.dataset.unsavedKind = kind; else delete row.dataset.unsavedKind;
    row.classList.toggle('is-unsaved', Boolean(kind));
    const flag = row.querySelector('.receipt-unsaved-flag');
    if (flag) { flag.textContent = unsavedLabels[kind] ?? ''; flag.hidden = !kind; }
    refreshSummaryAccessibleName(row);
  };
  const countUnsavedReceipts = () => [...elements.list.children].filter(row => unsavedKind(row)).length;
  const refreshUnsavedIndicator = () => {
    let count = 0;
    [...elements.list.children].forEach(row => { const kind = unsavedKind(row); applyUnsavedKind(row, kind); if (kind) count += 1; });
    if (!elements.encodingUnsavedIndicator) return;
    const text = count ? `${count} unsaved receipt${count === 1 ? '' : 's'}` : '';
    if (elements.encodingUnsavedText.textContent !== text) elements.encodingUnsavedText.textContent = text;
    elements.encodingUnsavedIndicator.hidden = count === 0;
  };
  const refreshAvailableSummary = () => {
    const availableSaved = storeSourceReceipts.filter(receipt => normalizeReceiptStatus(receipt.status) === 'available');
    const total = availableReceiptTotalCents(storeSourceReceipts.map(receipt => ({ status: receipt.status, cents: toCents(receipt.amount) })));
    elements.availableTotal.textContent = format(total);
    if (elements.availableCount) elements.availableCount.textContent = String(availableSaved.length);
    refreshUnsavedIndicator();
  };
  const refreshEncodingCards = () => {
    const outsideRows = [];
    [...elements.list.children].forEach(row => {
      const matchesStatus = toolbarState.status === 'all' || receiptStatus(row) === toolbarState.status;
      const matchesCompartment = receiptMatchesEncodingAmountCompartment(toCents(row.querySelector('.receipt-amount').value), encodingDisplayState.compartment);
      const keepVisible = Boolean(row.dataset.filterPinned) && matchesStatus;
      const outsideRange = !matchesCompartment && keepVisible;
      row.hidden = !matchesStatus || (!matchesCompartment && !keepVisible);
      if (row.classList.contains('is-outside-range') !== outsideRange) {
        row.classList.toggle('is-outside-range', outsideRange);
        row.querySelector('.receipt-range-flag').hidden = !outsideRange;
        refreshSummaryAccessibleName(row);
      }
      if (outsideRange) outsideRows.push(row);
    });
    renderFilterNotice(outsideRows);
    refreshAvailableSummary();
    elements.floatingAdd.hidden = !floatingAddVisibleForStatus(toolbarState.status);
  };
  const applyAmountRangeChange = () => {
    encodingDisplayState.compartment = normalizeEncodingAmountCompartment(elements.encodingAmountCompartment.value);
    persistEncodingDisplayState();
    releaseEditPins();
    refreshEncodingCards();
  };
  const showAllAmounts = () => {
    const target = [...elements.list.children].find(row => row.classList.contains('is-outside-range'));
    elements.encodingAmountCompartment.value = 'all';
    applyAmountRangeChange();
    (target && !target.hidden ? (target.open ? target.querySelector('.receipt-store') : target.querySelector('summary')) : elements.encodingAmountCompartment)?.focus?.({ preventScroll: false });
  };
  const visibleReceiptRows = () => [...elements.list.children].filter(row => !row.hidden);
  const expandAllReceipts = () => { visibleReceiptRows().forEach(row => { row.open = true; }); };
  const collapseAllReceipts = () => {
    const rows = visibleReceiptRows();
    const nowHidden = releaseEditPins(rows);
    rows.forEach(row => { row.open = false; });
    refreshEncodingCards();
    const hidden = nowHidden.filter(row => row.hidden).map(row => row.dataset.receiptId || '');
    if (hidden.length) setFeedback(elements.encodingFeedback, releasedHiddenNotice(hidden), 'warning');
  };
  // Collapsing a pinned receipt that is outside the range hides it again; keep keyboard focus on a receipt that is still visible.
  const releasePinAfterCollapse = row => {
    const wasOutside = row.classList.contains('is-outside-range');
    const focusedInside = Boolean(globalThis.document?.activeElement && row.contains?.(globalThis.document.activeElement));
    const visibleRows = visibleReceiptRows(); const position = visibleRows.indexOf(row);
    delete row.dataset.filterPinned;
    refreshEncodingCards();
    if (!wasOutside || !row.hidden) return;
    setFeedback(elements.encodingFeedback, releasedHiddenNotice([row.dataset.receiptId || '']), 'warning');
    if (!focusedInside) return;
    const next = visibleReceiptRows().find(candidate => visibleRows.indexOf(candidate) > position) || visibleReceiptRows().at(-1);
    (next ? next.querySelector('summary') : elements.encodingAmountCompartment)?.focus?.({ preventScroll: true });
  };
  const applyReceiptStatusState = row => {
    const consumed = receiptStatus(row) === 'consumed';
    row.classList.toggle('is-consumed', consumed);
    row.querySelector('.receipt-status-badge').hidden = !consumed;
    row.querySelector('.delete-receipt').hidden = consumed;
    row.querySelector('.delete-consumed').hidden = !consumed;
    row.querySelector('.restore-receipt').hidden = !consumed;
    row.querySelector('.contribute-store').hidden = consumed;
    row.querySelectorAll('input, select').forEach(field => { field.disabled = consumed; });
    refreshSummaryAccessibleName(row);
  };
  const refreshReceiptIds = () => {
    const rows = [...elements.list.children];
    let highestId = rows.reduce((highest, row) => Math.max(highest, Number(row.dataset.receiptId) || 0), 0);
    rows.forEach(row => {
      if (!Number(row.dataset.receiptId)) row.dataset.receiptId = String(++highestId);
      refreshSummary(row);
    });
    elements.receiptCount.textContent = rows.length ? `${rows.length} receipt${rows.length === 1 ? '' : 's'}` : 'No receipts added';
  };
  const showEmpty = () => {
    elements.resultTitle.textContent = 'Add receipts to begin';
    elements.resultAmount.textContent = '₱0.00';
    elements.difference.textContent = 'Enter a target and receipt amounts.';
    elements.keptReceipts.replaceChildren();
    elements.adminContent.textContent = 'Run a calculation to view the selection logic.';
    setUnsavedNotice(''); showExportBlockAction(null);
    updateResultSummary();
  };
  const optimizationEntries = () => [...elements.list.children].map((row, index) => {
    const receipt = { ...rowValues(row), status: receiptStatus(row) };
    return { row, index, receipt, receiptId: row.dataset.receiptId || String(index + 1), date: calendarReceiptDate(receipt.receiptDate), amount: toCents(receipt.amount) };
  });
  const updateStoreOptions = entries => {
    const selected = toolbarState.store;
    const stores = new Map();
    entries.forEach(({ receipt }) => {
      const label = readableOptimizationText(receipt.store);
      const key = normalizeOptimizationText(label);
      if (key && !stores.has(key)) stores.set(key, label);
    });
    const options = [...stores.entries()].sort(([, first], [, second]) => first.localeCompare(second, undefined, { sensitivity: 'base' }));
    elements.optimizationStoreFilter.replaceChildren(new Option('All stores', ''), ...options.map(([key, label]) => new Option(label, key)));
    toolbarState.store = stores.has(selected) ? selected : '';
    elements.optimizationStoreFilter.value = toolbarState.store;
  };
  // ---- Manual Selection (CP10-C3E-4): the rules live in domain/manualSelection.js; this is the screen side. ----
  const rowByDbId = id => [...elements.list.children].find(row => row.dataset.receiptDbId === id);
  const savedReceiptsById = () => new Map(storeSourceReceipts.map(receipt => [receipt.dbId, receipt]));
  const setManualFeedback = (text = '', severity = '') => setFeedback(elements.manualFeedback, text, severity);
  // Export messages go to the panel of the active mode: the recommendation panel for Best Match, the manual panel for Manual Selection.
  // `mode` is the export session's own mode: a late answer must report to the mode that started the export, not to whichever mode is active by then.
  const setExportFeedback = (text = '', severity = '', mode = exportMode) => mode === 'manual' ? setManualFeedback(text, severity) : setFeedback(elements.difference, text, severity);
  let lastVisibleEntries = [];
  let pendingPickFocus = null;
  const shownEligibleIds = () => { const savedById = savedReceiptsById(); return lastVisibleEntries.filter(entry => manualEligibilityOf(entry.row.dataset.receiptDbId, savedById) === 'ok').map(entry => entry.row.dataset.receiptDbId); };
  const renderManualSummary = () => {
    if (!elements.manualSelectedCount) return;
    const summary = summarizeManual(manualIds, savedReceiptsById()); // exact integer centavos; the amounts are the SAVED ones, which is what an export would contain
    elements.manualSelectedCount.textContent = `${summary.count} of ${maximumManualSelection}`;
    elements.manualSelectedTotal.textContent = format(summary.validCents);
    elements.manualNoAmountGroup.hidden = summary.withoutAmount === 0;
    elements.manualNoAmount.textContent = summary.withoutAmount ? `${summary.withoutAmount} (not counted in the total)` : '';
    const hidden = hiddenSelectedCount(manualIds, lastVisibleEntries.map(entry => entry.row.dataset.receiptDbId));
    elements.manualHiddenGroup.hidden = hidden === 0;
    elements.manualHidden.textContent = hidden ? String(hidden) : '';
    elements.manualClearSelection.disabled = manualIds.length === 0;
    elements.manualSelectShown.textContent = `Select shown (${shownEligibleIds().length})`;
  };
  const toggleManualReceipt = (dbId, label, pick) => {
    // A stale or forged change event can never add a receipt that is not eligible now; deselecting is always allowed.
    if (!manualIds.includes(dbId) && manualEligibilityOf(dbId) !== 'ok') { if (pick) pick.checked = false; setManualFeedback(`${label} cannot be selected: it is not a saved, Available receipt.`, 'warning'); return refreshOptimizationCards(); }
    const result = toggleManual(manualIds, dbId);
    if (result.rejected === 'limit') { if (pick) pick.checked = false; return setManualFeedback(manualLimitMessage(), 'warning'); }
    setManualIds(result.ids);
    setManualFeedback(result.action === 'added' ? `${label} selected: number ${manualIds.indexOf(dbId) + 1} in the export order, ${manualIds.length} of ${maximumManualSelection} selected.` : `${label} deselected. ${manualIds.length} of ${maximumManualSelection} selected.`);
    pendingPickFocus = dbId;
    refreshOptimizationCards();
  };
  const selectShownReceipts = () => {
    const ids = shownEligibleIds();
    if (!ids.length) return setManualFeedback('No selectable receipts are shown. Consumed receipts and unsaved drafts cannot be selected.', 'warning');
    // Fills the remaining capacity from the shown receipts, in the visible sort order; never past the limit and never reordering what is already selected.
    const result = fillShown(manualIds, ids, maximumManualSelection);
    if (!result.added.length) return setManualFeedback(fillShownMessage(result, maximumManualSelection), result.wasFull && result.notAdded ? 'warning' : 'info');
    setManualIds(result.ids);
    setManualFeedback(fillShownMessage(result, maximumManualSelection), result.notAdded ? 'warning' : 'success');
    refreshOptimizationCards();
  };
  const clearManualSelection = async event => {
    if (!manualIds.length) return;
    if (manualIds.length >= 25 && !await confirmAction({ title: 'Clear the manual selection?', message: `This deselects all ${manualIds.length} receipts. Your receipts themselves are not changed.`, confirmLabel: 'Clear selection', cancelLabel: 'Keep selection', danger: true, trigger: event?.currentTarget })) return;
    setManualIds([]);
    setManualFeedback('Manual selection cleared.');
    refreshOptimizationCards();
    elements.manualSelectShown?.focus?.({ preventScroll: true });
  };
  // The mode only changes what is shown and exported; both selections stay exactly as they were.
  const applyExportModeView = () => {
    const manual = exportMode === 'manual';
    if (elements.exportModeBestMatch) elements.exportModeBestMatch.checked = !manual;
    if (elements.exportModeManual) elements.exportModeManual.checked = manual;
    if (elements.bestMatchCard) elements.bestMatchCard.hidden = manual;
    if (elements.bestMatchResult) elements.bestMatchResult.hidden = manual;
    if (elements.manualPanel) elements.manualPanel.hidden = !manual;
    if (elements.optimizationHeading) elements.optimizationHeading.textContent = manual ? 'My Receipt Manual Selection' : 'My Receipt Optimization';
  };
  const setExportMode = mode => {
    exportMode = mode === 'manual' ? 'manual' : 'best-match';
    applyExportModeView();
    showExportBlockAction(null);
    refreshOptimizationCards();
  };
  const refreshOptimizationCards = () => {
    // Receipts that were deleted, Consumed elsewhere or removed from the list can no longer stay selected; say so instead of dropping them silently.
    const savedById = savedReceiptsById();
    const pruned = pruneManual(manualIds, id => Boolean(rowByDbId(id)) && manualEligibilityOf(id, savedById) === 'ok');
    if (pruned.removed.length) {
      setManualIds(pruned.ids);
      setManualFeedback(`${pruned.removed.length} selected receipt${pruned.removed.length === 1 ? ' is' : 's are'} no longer in the list or Available and ${pruned.removed.length === 1 ? 'was' : 'were'} removed from the selection.`, 'warning');
    }
    const entries = optimizationEntries();
    updateStoreOptions(entries);
    syncToolbarControls();
    const { visible, validation } = buildOptimizationView(entries, toolbarState);
    const fragment = document.createDocumentFragment();
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'optimization-empty';
      empty.textContent = 'No receipts have been encoded yet.';
      fragment.append(empty);
    } else if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'optimization-empty';
      empty.textContent = 'No receipts match the current search and filters.';
      fragment.append(empty);
    }
    lastVisibleEntries = visible;
    const manualMode = exportMode === 'manual';
    const picks = new Map();
    visible.forEach(entry => {
      const card = elements.optimizationTemplate.content.firstElementChild.cloneNode(true);
      const selected = selectionIncludesRow(entry.row);
      const consumed = entry.receipt.status === 'consumed';
      card.querySelector('.compact-store').textContent = entry.receipt.store.trim() || 'Store not set';
      card.querySelector('.compact-date').textContent = formatDate(entry.receipt.receiptDate);
      // A blank amount is shown as "No amount" in Manual Selection (it is valid there and must never look like zero).
      card.querySelector('.compact-amount').textContent = manualMode && parseMoneyAmount(entry.receipt.amount).blank ? 'No amount' : format(entry.amount);
      card.querySelector('.compact-status').hidden = !consumed;
      card.querySelector('.selected-badge').hidden = !selected;
      if (manualMode && selected) card.querySelector('.selected-badge').textContent = `Selected · ${manualPosition(entry.row)}`;
      card.classList.toggle('has-manual-pick', manualMode);
      const pick = card.querySelector('.manual-select');
      pick.hidden = !manualMode;
      if (manualMode) {
        const dbId = entry.row.dataset.receiptDbId;
        const eligibility = manualEligibilityOf(dbId, savedById);
        const label = `Receipt ${entry.receiptId}`;
        pick.checked = selected;
        // At the limit, receipts that are not selected cannot be added (selected ones stay enabled so they can be deselected and re-open a slot).
        const atCapacity = eligibility === 'ok' && !selected && manualIds.length >= maximumManualSelection;
        pick.disabled = eligibility !== 'ok' || atCapacity;
        pick.setAttribute('aria-label', atCapacity ? `${label} cannot be selected: the limit of ${maximumManualSelection} receipts is reached. Deselect a receipt first` : eligibility === 'ok' ? `Select ${label}, ${entry.receipt.store.trim() || 'Store not set'}` : eligibility === 'consumed' ? `${label} is Consumed and cannot be selected` : eligibility === 'missing' ? `${label} no longer exists in your saved receipts and cannot be selected` : eligibility === 'unavailable' ? `${label} is not Available and cannot be selected` : `${label} is not saved yet. Save it before selecting it`);
        if (eligibility === 'ok') { pick.addEventListener('change', () => toggleManualReceipt(dbId, label, pick)); picks.set(dbId, pick); }
      }
      card.classList.toggle('is-selected', selected);
      card.classList.toggle('is-consumed', consumed);
      card.dataset.receiptIndex = String(entry.index);
      card.querySelector('.compact-edit').hidden = consumed;
      card.querySelector('.compact-restore').hidden = !consumed;
      if (consumed) card.querySelector('.compact-restore').addEventListener('click', event => restoreReceipt(entry.index, event.currentTarget));
      else card.querySelector('.compact-edit').addEventListener('click', event => openEditModal(entry.index, event.currentTarget));
      fragment.append(card);
    });
    elements.optimizationList.replaceChildren(fragment);
    if (pendingPickFocus) { picks.get(pendingPickFocus)?.focus?.({ preventScroll: true }); pendingPickFocus = null; } // the list was rebuilt: keep keyboard focus on the same receipt
    const activeSource = exportSource();
    const hiddenSelected = activeSource ? activeSource.entries.filter(item => !visible.some(entry => selectionEntryMatchesRow(item, entry.row))).length : 0;
    elements.optimizationResultCount.textContent = `Showing ${visible.length} of ${entries.length} receipt${entries.length === 1 ? '' : 's'}`;
    elements.optimizationFilterStatus.hidden = !hasActiveToolbarState(toolbarState);
    elements.optimizationFilterStatus.textContent = hasActiveToolbarState(toolbarState) ? 'Filters active' : '';
    elements.clearOptimizationFilters.hidden = !hasActiveToolbarState(toolbarState);
    elements.clearOptimizationSearch.hidden = !toolbarState.search;
    elements.optimizationRangeValidation.hidden = !validation.message;
    elements.optimizationRangeValidation.textContent = validation.message;
    elements.optimizationHiddenSelected.hidden = hiddenSelected === 0;
    elements.optimizationHiddenSelected.textContent = hiddenSelected ? `${hiddenSelected} selected receipt${hiddenSelected === 1 ? ' is' : 's are'} hidden by the current filters.` : '';
    updateExportAction();
  };
  const setWorkspace = workspace => {
    const encoding = workspace !== 'optimization';
    elements.encodingWorkspace.hidden = !encoding;
    elements.optimizationWorkspace.hidden = encoding;
    elements.encodingTab.setAttribute('aria-selected', String(encoding));
    elements.optimizationTab.setAttribute('aria-selected', String(!encoding));
    if (!encoding) refreshOptimizationCards();
  };
  const setModuleVisible = visible => {
    elements.receiptWorkspaceSwitcher.hidden = !visible;
    elements.receiptStatusControl.hidden = !visible;
    if (!visible) { elements.encodingWorkspace.hidden = true; elements.optimizationWorkspace.hidden = true; }
  };
  const closeEditModal = () => {
    elements.editModal.hidden = true;
    delete elements.editModal.dataset.receiptIndex;
    modalFocus?.close(elements.editModal, { fallback: elements.optimizationSearch });
  };
  // Optimization cards are rebuilt after a correction, so the original Edit button is replaced; focus returns to the same receipt's new Edit button.
  const restoreEditTriggerFocus = index => {
    const edit = elements.optimizationList.querySelector?.(`[data-receipt-index="${index}"] .compact-edit`);
    (edit && !edit.hidden ? edit : elements.optimizationSearch)?.focus?.({ preventScroll: true });
  };
  // The originating Edit button is passed explicitly: browsers do not focus a clicked button everywhere, so document.activeElement is not a reliable trigger.
  const openEditModal = (index, trigger = document.activeElement) => {
    const row = elements.list.children[index];
    if (!row || receiptStatus(row) === 'consumed') return;
    setFeedback(elements.editFeedback);
    const receipt = rowValues(row);
    elements.editModal.dataset.receiptIndex = String(index);
    elements.editAmount.value = receipt.amount;
    elements.editReceiptDate.value = receipt.receiptDate;
    elements.editVat.value = receipt.vat;
    elements.editInvoice.value = receipt.invoice;
    elements.editStore.value = receipt.store;
    elements.editAddress.value = receipt.address;
    elements.editTin.value = receipt.tin;
    elements.editModal.hidden = false;
    modalFocus?.open(elements.editModal, { trigger, fallback: elements.optimizationSearch, onEscape: closeEditModal });
    elements.editStore.focus();
  };
  const installStoreAutocomplete = row => {
    const input = row.querySelector('.receipt-store');
    const list = row.querySelector('.store-suggestions');
    const listId = `store-suggestions-${++storeSuggestionSequence}`;
    let suggestions = [];
    let activeIndex = -1;
    let closeTimer;
    list.id = listId;
    input.setAttribute('aria-controls', listId);
    const closeSuggestions = () => {
      suggestions = [];
      activeIndex = -1;
      list.replaceChildren();
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    };
    const selectSuggestion = profile => {
      if (receiptStatus(row) === 'consumed') return;
      const values = applyStoreProfileSnapshot(rowValues(row), profile);
      input.value = values.store;
      row.querySelector('.receipt-address').value = values.address;
      row.querySelector('.receipt-tin').value = values.tin;
      row.querySelector('.receipt-vat').value = values.vat;
      refreshSummary(row);
      clearSelection();
      refreshOptimizationCards();
      closeSuggestions();
      input.focus({ preventScroll: true });
    };
    const renderSuggestions = () => {
      const fragment = document.createDocumentFragment();
      list.replaceChildren();
      if (!suggestions.length) return closeSuggestions();
      suggestions.forEach((profile, index) => {
        const option = document.createElement('li');
        option.id = `${listId}-option-${index}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(index === activeIndex));
        option.className = 'store-suggestion';
        option.classList.toggle('is-active', index === activeIndex);
        const name = document.createElement('strong');
        name.textContent = profile.store;
        option.append(name);
        const details = [profile.source === 'shared' ? 'Company' : 'My receipt history', describeStoreProfile(profile)].filter(Boolean).join(' · ');
        if (details) { const meta = document.createElement('span'); meta.textContent = details; option.append(meta); }
        option.addEventListener('mousedown', event => { event.preventDefault(); selectSuggestion(profile); });
        fragment.append(option);
      });
      list.append(fragment);
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (activeIndex >= 0) input.setAttribute('aria-activedescendant', `${listId}-option-${activeIndex}`);
      else input.removeAttribute('aria-activedescendant');
    };
    const updateSuggestions = () => {
      activeIndex = -1;
      suggestions = findStoreSuggestions(combinedStoreProfiles(), input.value);
      renderSuggestions();
    };
    input.addEventListener('input', updateSuggestions);
    input.addEventListener('focus', () => { if (input.value.trim()) updateSuggestions(); });
    input.addEventListener('blur', () => { closeTimer = setTimeout(closeSuggestions, 120); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { if (!list.hidden) { event.preventDefault(); closeSuggestions(); } return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
      // Ctrl+Enter is the Add Receipt shortcut: it must never accept a highlighted suggestion (plain Enter still does).
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) return;
      if (!suggestions.length) updateSuggestions();
      if (!suggestions.length) return;
      if (event.key === 'Enter') {
        if (activeIndex >= 0) { event.preventDefault(); selectSuggestion(suggestions[activeIndex]); }
        return;
      }
      event.preventDefault();
      activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      renderSuggestions();
    });
    list.addEventListener('mousedown', () => clearTimeout(closeTimer));
  };
  const addReceipt = (values = {}, { refresh = true } = {}) => {
    const row = elements.template.content.firstElementChild.cloneNode(true);
    makeTemplateIdsUnique(row, `receipt-${++receiptDomSequence}`);
    if (values.dbId) row.dataset.receiptDbId = values.dbId;
    if (values.updatedAt) row.dataset.receiptUpdatedAt = values.updatedAt;
    row.dataset.receiptStatus = normalizeReceiptStatus(values.status);
    if (values.dbId) row.dataset.persistedStoreFingerprint = persistedStoreFingerprint(values);
    for (const [key, value] of Object.entries(values)) { const field = row.querySelector(`.receipt-${key}`); if (field) field.value = value; }
    row.querySelector('.receipt-photo').addEventListener('change', event => { const file = event.currentTarget.files[0]; if (file) scanPrintedDetails(file, row, refreshSummary); });
    row.querySelector('.delete-receipt').addEventListener('click', createReceiptDeleteHandler({
      row,
      triggerFallback: elements.floatingAdd,
      getCurrentUser: () => currentUser,
      getReceiptStatus: () => receiptStatus(row),
      hasDraftContent: () => Object.values(rowValues(row)).some(value => String(value || '').trim()) || row.querySelector('.receipt-photo').files.length > 0,
      confirmAction,
      deleteReceipt: id => receiptService.deleteReceipt(id),
      removeStoreSourceReceipt,
      clearSelection,
      refreshReceiptIds,
      refreshEncodingCards,
      refreshOptimizationCards,
      setFeedback,
      feedbackTarget: elements.encodingFeedback
    }));
    row.querySelector('.contribute-store').addEventListener('click', async event => {
      if (receiptStatus(row) === 'consumed') return;
      const values = rowValues(row);
      if (!currentUser || !values.store.trim() || (!values.address.trim() && !values.tin.trim())) return setFeedback(elements.encodingFeedback, 'Add a Store Name and either an Address or TIN before contributing.', 'warning');
      const candidate = { storeName: values.store, address: values.address, tin: values.tin, vat: values.vat };
      const resolution = resolveSharedContributionCandidate(candidate, sharedStoreProfiles);
      if (resolution.status === 'existing') return setFeedback(elements.encodingFeedback, 'This store already exists in the Company Store Directory.', 'info');
      if (resolution.status === 'ambiguous') return setFeedback(elements.encodingFeedback, 'Multiple Company profiles match. Add an Address or TIN before contributing.', 'warning');
      event.currentTarget.disabled = true;
      try {
        await sharedStoreService.contributeSharedStore(candidate, currentUser.id);
        await reloadSharedStores();
        setFeedback(elements.encodingFeedback, 'Store added to the Company Store Directory.', 'success');
      } catch (error) {
        if (error?.name === 'SharedStoreDuplicateError') { await reloadSharedStores(); resolveSharedContributionCandidate(candidate, sharedStoreProfiles); setFeedback(elements.encodingFeedback, 'This store was already added to the Company Store Directory.', 'info'); }
        else setFeedback(elements.encodingFeedback, `Could not add this store: ${error.message}`, 'error');
      } finally { event.currentTarget.disabled = false; }
    });
    row.querySelector('.restore-receipt').addEventListener('click', event => restoreReceipt([...elements.list.children].indexOf(row), event.currentTarget));
    row.querySelector('.delete-consumed').addEventListener('click', createConsumedDeleteHandler({
      row,
      triggerFallback: elements.receiptStatusFilter,
      getCurrentUser: () => currentUser,
      getReceiptStatus: () => receiptStatus(row),
      confirmAction,
      deleteConsumedReceipt: id => receiptService.deleteConsumedReceipt(id),
      removeStoreSourceReceipt,
      clearSelection,
      refreshReceiptIds,
      refreshEncodingCards,
      refreshOptimizationCards,
      setFeedback,
      feedbackTarget: elements.encodingFeedback
    }));
    installStoreAutocomplete(row);
    const storeInput = row.querySelector('.receipt-store');
    row.querySelectorAll('input, select').forEach(field => {
      const refreshView = () => { if (!row.hidden) pinReceipt(row); refreshSummary(row); clearSelection(); refreshEncodingCards(); refreshOptimizationCards(); };
      field.addEventListener('input', field === storeInput ? () => { if (!row.hidden) pinReceipt(row); refreshSummary(row); refreshAvailableSummary(); } : refreshView);
      field.addEventListener('change', refreshView);
    });
    row.addEventListener('toggle', () => { refreshToggle(row); if (!row.open && row.dataset.filterPinned) releasePinAfterCollapse(row); });
    elements.list.append(row);
    applyReceiptStatusState(row);
    if (refresh) { refreshReceiptIds(); refreshEncodingCards(); refreshOptimizationCards(); }
    return row;
  };
  const isBlankUnsavedReceipt = row => !row.dataset.receiptDbId && Object.values(rowValues(row)).every(value => !String(value || '').trim());
  const prefersReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  // Store name is the first field of a new receipt (same order as Monthly Filing): expand it, bring it into view, then focus Store (focus never scrolls on its own).
  const focusReceiptForEncoding = row => {
    row.open = true;
    requestAnimationFrame(() => {
      row.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      row.querySelector('.receipt-store').focus({ preventScroll: true });
    });
  };
  // Reuse a blank unsaved receipt (visible ones first) instead of stacking up blanks. The receipt is pinned so it stays visible while it is edited,
  // even outside the selected amount range (a notice explains this). Only the Available/Consumed view can still hide it, and then it is not focused.
  const addReceiptForEncoding = () => {
    const rows = [...elements.list.children];
    const row = rows.find(candidate => isBlankUnsavedReceipt(candidate) && !candidate.hidden) || rows.find(isBlankUnsavedReceipt) || addReceipt();
    pinReceipt(row); refreshEncodingCards();
    if (row.hidden) return setFeedback(elements.encodingFeedback, 'The new receipt is hidden by the current view. Choose Available or All in View receipts to see it.', 'warning');
    setFeedback(elements.encodingFeedback);
    focusReceiptForEncoding(row);
  };
  const candidateMessage = candidate => {
    const details = [candidate.address && `Address: ${candidate.address}`, candidate.tin && `TIN: ${candidate.tin}`].filter(Boolean);
    return `“${candidate.storeName}” is not currently in the Company Directory. Adding it will make its store details available to other users.${details.length ? ` ${details.join(' · ')}` : ''}`;
  };
  const contributeAfterReceiptSave = async candidate => {
    try {
      await sharedStoreService.contributeSharedStore(candidate, currentUser.id);
      await reloadSharedStores();
      setFeedback(elements.encodingFeedback, 'Receipt saved. Store added to the Company Directory.', 'success');
    } catch (error) {
      if (error?.name === 'SharedStoreDuplicateError') {
        await reloadSharedStores();
        setFeedback(elements.encodingFeedback, 'Receipt saved. This store is already in the Company Directory.', 'success');
      } else {
        setFeedback(elements.encodingFeedback, `Receipt saved, but the store could not be added to the Company Directory: ${error.message}`, 'warning');
      }
    }
  };
  const processPostSaveDirectoryCandidates = async candidates => {
    for (const decision of deduplicateDirectoryCandidates(candidates)) {
      if (decision.status === 'ambiguous') {
        setFeedback(elements.encodingFeedback, 'Receipt saved. Multiple Company profiles match this store; add more identifying information before adding it to the directory.', 'warning');
        continue;
      }
      if (decision.status !== 'new') continue;
      const confirmed = await confirmAction({
        title: 'Add store to Company Directory?',
        message: candidateMessage(decision.candidate),
        confirmLabel: 'Add to Company Directory',
        cancelLabel: 'Keep in My Receipt History',
        trigger: elements.saveDraft
      });
      if (!confirmed) {
        setFeedback(elements.encodingFeedback, 'Receipt saved. Store kept in My Receipt History.', 'success');
        continue;
      }
      await contributeAfterReceiptSave(decision.candidate);
    }
  };
  const saveDraft = async () => {
    if (savePending) return;
    if (!currentUser) return setFeedback(elements.encodingFeedback, 'Please sign in before saving receipts.', 'warning');
    savePending = true;
    elements.saveDraft.disabled = true;
    try {
      const invalidRow = [...elements.list.children].find(row => receiptStatus(row) !== 'consumed' && !isBlankUnsavedReceipt(row) && amountProblem(row));
      if (invalidRow) {
        invalidRow.open = true; pinReceipt(invalidRow); refreshEncodingCards();
        setFeedback(elements.encodingFeedback, `Could not save receipt changes. ${rowAmountMessage(invalidRow, amountProblem(invalidRow))} Nothing was saved; correct the amount and save again.${invalidRow.hidden ? ' This receipt is hidden by the View receipts filter (your filter was not changed); choose Available or All to see it.' : ''}`, 'error');
        // A receipt hidden by the Available/Consumed view cannot take focus: send focus to the control that explains why instead.
        (invalidRow.hidden ? elements.receiptStatusFilter : invalidRow.querySelector('.receipt-amount')).focus?.({ preventScroll: false });
        return;
      }
      const { persisted, candidates, error } = await persistReceiptsBeforeDirectoryPrompts([...elements.list.children], async row => {
        if (receiptStatus(row) === 'consumed') return undefined;
        const receipt = rowValues(row);
        if (isBlankUnsavedReceipt(row)) return undefined;
        const previousFingerprint = row.dataset.persistedStoreFingerprint;
        const saved = row.dataset.receiptDbId ? await receiptService.updateReceipt(row.dataset.receiptDbId, receipt, currentUser.id) : await receiptService.createReceipt(receipt, currentUser.id);
        row.dataset.receiptDbId = saved.dbId;
        if (saved.updatedAt) row.dataset.receiptUpdatedAt = saved.updatedAt;
        upsertStoreSourceReceipt(saved);
        const fingerprint = persistedStoreFingerprint(receipt);
        return { row, fingerprint, decision: postSaveDirectoryDecision({ values: receipt, previousFingerprint, profiles: sharedStoreProfiles }) };
      });
      if (error) {
        // Earlier rows may already be saved: refresh the saved total, count and unsaved indicator (edit pins and drafts stay as they are).
        refreshEncodingCards();
        refreshOptimizationCards();
        setFeedback(elements.encodingFeedback, `Could not save receipt changes: ${error.message}`, 'error');
        return;
      }
      finalizeDirectoryPromptFingerprints(persisted);
      const released = releaseEditPins();
      refreshEncodingCards();
      refreshOptimizationCards();
      const nowHidden = releasedHiddenNotice(released.filter(row => row.hidden).map(row => row.dataset.receiptId || ''));
      setFeedback(elements.encodingFeedback, `Receipt changes saved.${nowHidden ? ` ${nowHidden}` : ''}`, 'success');
      await processPostSaveDirectoryCandidates(candidates);
    } catch (error) { refreshEncodingCards(); refreshOptimizationCards(); setFeedback(elements.encodingFeedback, `Could not save receipt changes: ${error.message}`, 'error'); }
    finally { savePending = false; elements.saveDraft.disabled = false; }
  };
  // Keyboard-first encoding (CP10-C3E-3K): Ctrl+Enter = Add receipt, Ctrl+S = Save changes, nothing else. The listener sits on the Receipt Encoding workspace
  // only, so it never sees keys typed in other workspaces or in dialogs (those are outside this element), and it reuses the buttons' own handlers.
  const handleEncodingShortcut = event => {
    if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return; // Ctrl is required and is the only modifier
    const key = String(event.key).toLowerCase();
    if (key !== 'enter' && key !== 's') return;
    if (!currentUser || elements.encodingWorkspace.hidden || modalFocus?.isOpen?.()) return;
    if (event.isComposing || event.keyCode === 229) return; // an input method is composing text
    event.preventDefault(); // Ctrl+S must not open the browser's Save Page dialog; Ctrl+Enter has no useful default here
    if (event.repeat) return; // holding the keys down does not repeat the action
    if (key === 's') { if (!elements.saveDraft.disabled) void saveDraft(); return; }
    addReceiptForEncoding();
  };
  const calculate = () => {
    const targetCents = toCents(elements.target.value);
    const invalidRow = [...elements.list.children].find(row => receiptStatus(row) === 'available' && amountProblem(row));
    if (invalidRow) { clearSelection(); refreshOptimizationCards(); showEmpty(); elements.difference.textContent = `${rowAmountMessage(invalidRow, amountProblem(invalidRow))} Correct it before running Find Best Match.`; return; }
    const rows = [...elements.list.children];
    const receipts = availableOptimizerReceipts(rows.map((row, index) => ({ index, dbId: row.dataset.receiptDbId, receiptId: row.dataset.receiptId, label: `Receipt ${row.dataset.receiptId}`, cents: amountCents(row), status: receiptStatus(row), ...rowValues(row) })));
    if (!targetCents || !receipts.length) { clearSelection(); refreshOptimizationCards(); showEmpty(); return; }
    try {
      const strategy = setActiveStrategy(getActiveStrategy());
      const best = findBest(receipts, targetCents, strategy);
      // Informational only: unsaved values may take part in the calculation, but they can never be exported.
      const unsavedLabels = receipts.filter(receipt => rowHasUnsavedExportChanges(rows[receipt.index])).map(receipt => receipt.label);
      if (!best) {
        clearSelection();
        setUnsavedNotice(unsavedValuesNotice({ considered: unsavedLabels }));
        elements.resultTitle.textContent = strategy === optimizationStrategies.withoutExceeding ? 'No non-zero match without exceeding' : 'No valid match found';
        elements.resultAmount.textContent = '₱0.00';
        elements.difference.textContent = strategy === optimizationStrategies.withoutExceeding ? 'No non-zero receipt combination is at or below your requested amount.' : 'No valid receipt combination is available.';
        elements.keptReceipts.replaceChildren();
        elements.adminContent.textContent = 'Adjust the target or choose a different optimization strategy.';
        updateResultSummary({ target: targetCents, strategy });
        refreshOptimizationCards();
        return;
      }
      const chosen = best.items.map(index => receipts[index]);
      const difference = best.total - targetCents;
      arrangements['best-match'] = null; showExportBlockAction(null);
      selection = { mode: 'best-match', entries: chosen.map(receipt => ({ dbId: receipt.dbId || null, receiptId: receipt.receiptId, label: receipt.label, used: workbookFields(receipt) })) };
      setUnsavedNotice(unsavedValuesNotice({ selected: chosen.filter(receipt => unsavedLabels.includes(receipt.label)).map(receipt => receipt.label), considered: unsavedLabels }));
      elements.resultTitle.textContent = difference === 0 ? 'Exact match found' : strategy === optimizationStrategies.withoutExceeding ? 'Best match without exceeding' : 'Best available match';
      elements.resultAmount.textContent = format(best.total);
      elements.difference.textContent = difference === 0 ? 'This selection matches your requested amount exactly.' : `${difference > 0 ? 'Over' : 'Under'} by ${format(Math.abs(difference))}.`;
      updateResultSummary({ target: targetCents, matched: best.total, difference, receiptCount: chosen.length, strategy });
      const groupedReceipts = document.createDocumentFragment();
      groupSelectedReceiptsByCompartment(chosen).forEach(group => {
        const section = document.createElement('section');
        section.className = 'selected-compartment-group';
        const heading = document.createElement('h4');
        heading.textContent = group.label;
        const receipts = document.createElement('div');
        receipts.className = 'selected-compartment-receipts';
        group.receipts.forEach(receipt => {
          const item = document.createElement('div');
          item.className = 'selected-compartment-receipt';
          const title = document.createElement('strong');
          title.textContent = `${receipt.label} · ${format(receipt.cents)}`;
          item.append(title);
          const identity = [receipt.store?.trim(), receipt.invoice?.trim() && `Invoice ${receipt.invoice.trim()}`, calendarReceiptDate(receipt.receiptDate) && formatDate(receipt.receiptDate)].filter(Boolean);
          if (identity.length) {
            const details = document.createElement('span');
            details.textContent = identity.join(' · ');
            item.append(details);
          }
          receipts.append(item);
        });
        section.append(heading, receipts);
        groupedReceipts.append(section);
      });
      elements.keptReceipts.replaceChildren(groupedReceipts);
      elements.adminContent.replaceChildren();
      const details = document.createElement('p');
      details.innerHTML = `<strong>Selection:</strong> ${chosen.map(receipt => receipt.label).join(' + ')} = <strong>${format(best.total)}</strong>`;
      const rules = document.createElement('ul');
      const strategyMeta = optimizationStrategyDetails[strategy];
      const rule = optimizationStrategyRules[strategy];
      ['Strategy: ' + strategyMeta.label, 'Target: ' + format(targetCents), 'Difference: ' + (difference === 0 ? 'Exact' : format(Math.abs(difference)) + (difference > 0 ? ' over' : ' under')), rule].forEach(text => { const item = document.createElement('li'); item.textContent = text; rules.append(item); });
      elements.adminContent.append(details, rules);
      refreshOptimizationCards();
    } catch (error) { elements.difference.textContent = error.message || 'Could not calculate a receipt combination.'; }
  };
  const importLegacyDraft = async user => {
    if (importPending) return false;
    const draft = localStorage.getItem(draftKey);
    const migrationKey = `${draftKey}-imported-for-${user.id}`;
    if (!draft || localStorage.getItem(migrationKey)) return false;
    let data;
    try { data = JSON.parse(draft); } catch { return false; }
    if (!data.receipts?.length || !await confirmAction({ title: 'Import saved browser receipts?', message: `Import ${data.receipts.length} saved browser receipt${data.receipts.length === 1 ? '' : 's'} into your account? Your local draft will be kept as a backup.`, confirmLabel: 'Import receipts', cancelLabel: 'Not now', trigger: document.activeElement })) return false;
    importPending = true;
    try {
      const imported = await receiptService.importReceipts(data.receipts, user.id);
      localStorage.setItem(migrationKey, 'true');
      if (data.target) elements.target.value = data.target;
      imported.forEach(receipt => { addReceipt(receipt); upsertStoreSourceReceipt(receipt); });
      setFeedback(elements.encodingFeedback, 'Import completed. Your original browser draft was kept as a backup.', 'success');
      return true;
    } catch (error) {
      setFeedback(elements.encodingFeedback, `Could not import saved browser receipts: ${error.message}`, 'error');
      return false;
    } finally { importPending = false; }
  };
  let exportPending = false;
  // ---- Review & Arrange (CP10-C3E-2). The view only presents; the order lives in `arrangement`, the dialog's data in `exportSession`. ----
  const showReviewState = () => { if (exportSession) elements.confirmExport.disabled = exportPending || (exportSession.needsAck && !exportSession.acknowledged); };
  const unsavedFieldText = value => value === '' ? '(empty)' : `"${value}"`;
  const changeNotes = (softProblems, reference, snapshotRows) => {
    const byId = new Map(snapshotRows.map(row => [row.dbId, row]));
    return new Map(softProblems.map(problem => {
      const shown = problem.fields.filter(field => field !== 'updatedAt');
      const detail = shown.length ? describeFieldChanges(reference.get(problem.dbId), byId.get(problem.dbId), shown).map(change => `${change.label}: ${unsavedFieldText(change.before)} to ${unsavedFieldText(change.after)}`).join('; ') : 'saved again in another session; the receipt values are unchanged';
      return [problem.dbId, `Updated since selection — ${detail}.`];
    }));
  };
  const renderReview = () => {
    const session = exportSession;
    const arrangement = activeArrangement();
    if (!session || !arrangement) return;
    const saved = new Map(session.baseline.rows.map(row => [row.dbId, row]));
    const entries = new Map(session.entries.map(entry => [entry.dbId, entry]));
    const sums = summarizeAmounts(arrangement.order.map(id => saved.get(id)));
    const changed = session.notes.size;
    reviewView.render({
      rows: arrangement.order.map(id => buildReviewRow(entries.get(id), saved.get(id), session.notes.get(id), { format, formatDate })),
      totalText: format(sums.validCents),
      withoutAmount: sums.withoutAmount,
      canReset: arrangement.order.some((id, index) => id !== arrangement.initial[index]),
      acknowledgement: session.needsAck ? { text: `${changed} receipt${changed === 1 ? ' was' : 's were'} changed in the database after ${changed === 1 ? 'it was' : 'they were'} selected. The values below are the current saved values. Review the highlighted receipt${changed === 1 ? '' : 's'}, then confirm that you have reviewed ${changed === 1 ? 'it' : 'them'} to enable the export.`, checked: session.acknowledged } : null
    });
  };
  const reviewView = createExportReview({
    list: elements.exportReviewList,
    announcer: elements.exportReviewAnnouncer,
    summary: { count: elements.exportReviewCount, total: elements.exportReviewTotal, noAmountGroup: elements.exportReviewNoAmountGroup, noAmount: elements.exportReviewNoAmount },
    acknowledgement: { group: elements.exportReviewAck, text: elements.exportReviewAckText, input: elements.exportReviewAckInput },
    reset: elements.exportReviewReset,
    onMove: (id, toIndex) => { const arrangement = activeArrangement(); if (arrangement) { arrangement.order = moveId(arrangement.order, id, toIndex); renderReview(); } },
    onReset: () => { const arrangement = activeArrangement(); if (arrangement) { arrangement.order = [...arrangement.initial]; renderReview(); } },
    onAcknowledge: checked => { if (exportSession) { exportSession.acknowledged = checked; showReviewState(); } },
    // On a phone the action buttons are pinned over the bottom of the scrolling sheet: the drag's auto-scroll edge is where they start.
    pointerOptions: { obstructions: () => [elements.confirmExport?.parentElement].filter(Boolean) }
  });
  // Unsaved edits, drafts and amounts typed but not saved are fixed in Encoding: say which receipts, and offer the shortcut.
  const blockForEncoding = problems => {
    const fixable = problems.filter(problem => ['unsaved', 'draft', 'resultStale', 'invalidAmount'].includes(problem.type));
    showExportBlockAction(exportSource().entries.filter(entry => fixable.some(problem => problem.label === entry.label)).map(rowForSelectionEntry).filter(Boolean));
    return setExportFeedback(preflightMessage(problems, { mode: exportMode }));
  };
  // "Go to Encoding": offered when unsaved edits (or drafts) block an export. It only navigates and focuses; nothing is saved or discarded.
  let exportBlockRows = [];
  const showExportBlockAction = rows => {
    exportBlockRows = rows ?? [];
    const show = exportBlockRows.length > 0;
    if (elements.exportGoToEncoding) elements.exportGoToEncoding.hidden = !(show && exportMode !== 'manual');
    if (elements.manualGoToEncoding) elements.manualGoToEncoding.hidden = !(show && exportMode === 'manual');
  };
  const goToEncoding = () => {
    const row = exportBlockRows.find(candidate => candidate.isConnected !== false);
    if (!row) return;
    elements.encodingTab.click?.();
    setWorkspace('encoding');
    pinReceipt(row); refreshEncodingCards();
    if (row.hidden) return setFeedback(elements.encodingFeedback, `Receipt ${row.dataset.receiptId || ''} is hidden by the current view. Choose Available or All in View receipts to see it.`, 'warning');
    focusReceiptForEncoding(row);
  };
  // Escape belongs to an active receipt drag first (it cancels the drag and keeps the dialog open); otherwise it closes the dialog as before.
  const escapeReview = () => { if (reviewView.cancelDrag()) return; closeExportConfirmation(); };
  const closeExportConfirmation = ({ force = false } = {}) => {
    if (exportPending && !force) return;
    exportSession = null;
    reviewView.clear();
    elements.exportConfirmModal.hidden = true;
    modalFocus?.close(elements.exportConfirmModal, { fallback: exportMode === 'manual' ? elements.manualSelectShown : elements.calculate });
    elements.confirmExport.disabled = false;
    elements.confirmExport.removeAttribute('aria-busy');
    elements.confirmExport.textContent = 'Export & Mark Consumed';
  };
  // ---- Export (CP10-C3E-1): the workbook is built from database snapshots, never from the values typed on screen. ----
  // Review (Snapshot A) happens before the confirmation dialog opens; the final read (Snapshot B) happens when the user confirms.
  let exportReviewPending = false;
  let exportSession = null; // { selection, entries, baseline } while the confirmation dialog is open
  const newExportRunner = () => createReceiptExportRunner({
    fetchSnapshot: ids => receiptService.loadReceiptsByIds(ids),
    generateWorkbook: rows => downloadSelectedReceipts(rows),
    consume: ids => receiptService.consumeReceipts(ids)
  });
  let exportRunner = newExportRunner();
  const errorText = error => String(error?.message || 'Unknown error').replace(/[.\s]+$/, '');
  const rowForSelectionEntry = entry => [...elements.list.children].find(row => selectionEntryMatchesRow(entry, row));
  const exportEntries = () => exportSource().entries.map(({ dbId, label, used }) => ({ dbId, label, used }));
  // Everything that can be checked from the screen alone. A saved receipt must not carry unsaved edits, and nothing is ever saved or discarded here.
  const preflightSelection = () => preflightExport(exportSource().entries.map(entry => {
    const row = rowForSelectionEntry(entry);
    return {
      label: entry.label,
      dbId: entry.dbId,
      savedSinceResult: Boolean(row?.dataset.receiptDbId),
      present: Boolean(row),
      status: row ? receiptStatus(row) : 'consumed',
      unsaved: row ? rowHasUnsavedExportChanges(row) : false,
      amountProblem: row ? amountProblem(row) : ''
    };
  }));
  // The database is the truth: refresh the on-screen rows that it reports as changed or Consumed. Selected rows have no unsaved edits at this point
  // (the preflight guarantees it), so nothing the user typed is overwritten.
  const syncRowsFromSnapshot = (snapshotRows, problems) => {
    const affected = new Set(problems.filter(problem => problem.type === 'changed' || problem.type === 'unavailable' || problem.type === 'optimizerChanged').map(problem => problem.dbId));
    snapshotRows.filter(saved => affected.has(saved.dbId)).forEach(saved => {
      const row = [...elements.list.children].find(candidate => candidate.dataset.receiptDbId === saved.dbId);
      if (row) {
        ['amount', 'receiptDate', 'vat', 'invoice', 'store', 'address', 'tin'].forEach(key => { row.querySelector(`.receipt-${key}`).value = saved[key] ?? ''; });
        row.dataset.receiptStatus = normalizeReceiptStatus(saved.status); // display state only; the saved record keeps the exact database status
        row.dataset.receiptUpdatedAt = saved.updatedAt || '';
        row.dataset.persistedStoreFingerprint = persistedStoreFingerprint(saved);
        applyReceiptStatusState(row);
        refreshSummary(row);
      }
      upsertStoreSourceReceipt(saved);
    });
  };
  // The optimizer result no longer matches the database: refresh what changed, drop the result and say exactly what to do.
  const rejectStaleResult = (snapshotRows, problems, stage, mode = exportMode) => {
    problems.filter(problem => problem.type === 'missing' && problem.dbId).forEach(problem => knownMissingIds.add(problem.dbId));
    if (mode === 'manual') return rejectManualSelection(snapshotRows, problems, stage);
    syncRowsFromSnapshot(snapshotRows, problems);
    clearSelection();
    refreshEncodingCards();
    refreshOptimizationCards();
    showEmpty();
    elements.resultTitle.textContent = 'Result out of date';
    setFeedback(elements.difference, snapshotProblemMessage(problems, { stage }));
  };
  // Manual Selection: the affected receipts now show their saved values; receipts that are gone or Consumed leave the selection, everything else stays.
  const rejectManualSelection = (snapshotRows, problems, stage) => {
    syncRowsFromSnapshot(snapshotRows, problems);
    const gone = new Set(problems.filter(problem => problem.type === 'missing' || problem.type === 'unavailable').map(problem => problem.dbId));
    if (gone.size) setManualIds(manualIds.filter(id => !gone.has(id)));
    refreshEncodingCards();
    refreshOptimizationCards();
    setManualFeedback(snapshotProblemMessage(problems, { stage, mode: 'manual' }), 'warning');
  };
  const openExportConfirmation = async () => {
    if (exportPending || exportReviewPending) return;
    const source = exportSource();
    if (!source) return setExportFeedback(exportMode === 'manual' ? 'Select at least one receipt before exporting.' : 'Run Find Best Match with saved Available receipts before exporting.');
    showExportBlockAction(null);
    const local = preflightSelection();
    if (!local.ok) return blockForEncoding(local.problems);
    const reviewed = source;
    const mode = exportMode; // the mode and selection this review belongs to: checked again after every await
    const button = exportButton();
    const entries = exportEntries();
    exportReviewPending = true;
    button.setAttribute('aria-busy', 'true');
    try {
      let baseline;
      try { baseline = await exportRunner.loadBaseline(entries.map(entry => entry.dbId)); }
      catch (error) { return setExportFeedback(`Could not load the latest saved receipt values: ${errorText(error)}. Nothing was exported.`, '', mode); }
      if (exportMode !== mode || exportSource() !== reviewed) return setExportFeedback('The selection changed while the receipts were being checked. Nothing was exported; choose Export Selected again.', '', mode);
      const reference = new Map(storeSourceReceipts.map(receipt => [receipt.dbId, receipt]));
      const verdict = classifyExportSnapshot({ entries, snapshotRows: baseline.rows, reference });
      // Missing, Consumed, invalid or an amount that differs from the optimizer's: never acknowledgeable, the result must be recalculated.
      const { hard, soft } = partitionExportProblems(verdict.problems);
      if (hard.length) return rejectStaleResult(baseline.rows, verdict.problems, 'review', mode);
      const notes = changeNotes(soft, reference, baseline.rows);
      if (soft.length) { syncRowsFromSnapshot(baseline.rows, soft); refreshEncodingCards(); refreshOptimizationCards(); }
      const ids = entries.map(entry => entry.dbId);
      const kept = arrangements[mode];
      if (!kept || kept.selection !== reviewed || !sameMembers(kept.order, ids)) arrangements[mode] = { selection: reviewed, initial: ids, order: [...ids] };
      exportSession = { selection: reviewed, mode, entries, baseline, notes, needsAck: soft.length > 0, acknowledged: false };
      const alreadyPrepared = exportRunner.uncertainIds().some(id => entries.some(entry => entry.dbId === id));
      elements.exportConfirmMessage.textContent = `Export ${entries.length} selected receipt${entries.length === 1 ? '' : 's'}? After the export is prepared, these receipts will be marked as Consumed and excluded from future optimization.${alreadyPrepared ? ' A workbook for some of them was already prepared earlier and its status update could not be confirmed. The database now confirms they are still Available. Exporting again downloads another workbook.' : ''}`;
      elements.exportConfirmModal.hidden = false;
      renderReview();
      showReviewState();
      modalFocus?.open(elements.exportConfirmModal, { trigger: button, fallback: mode === 'manual' ? elements.manualSelectShown : elements.calculate, onEscape: escapeReview });
      (exportSession.needsAck ? elements.exportReviewAckInput : elements.confirmExport).focus();
    } finally {
      exportReviewPending = false;
      button.removeAttribute('aria-busy');
    }
  };
  const exportAndConsume = async () => {
    if (exportPending) return;
    if (exportSession?.needsAck && !exportSession.acknowledged) return reviewView.announce('Review the updated values and tick the box before exporting.');
    exportPending = true;
    elements.confirmExport.disabled = true;
    elements.confirmExport.setAttribute('aria-busy', 'true');
    elements.confirmExport.textContent = 'Preparing export…';
    const stop = message => { exportPending = false; closeExportConfirmation(); return setExportFeedback(message, '', session?.mode ?? exportMode); };
    const session = exportSession;
    const source = exportSource();
    if (!session || !source || session.selection !== source || session.mode !== exportMode) return stop((session?.mode ?? exportMode) === 'manual' ? 'The selection changed. Nothing was exported; choose Export Selected again.' : 'The selected result is no longer exportable. Run Find Best Match again.');
    const local = preflightSelection();
    if (!local.ok) { exportPending = false; closeExportConfirmation(); return blockForEncoding(local.problems); }
    // The confirmed order decides the order of the receipts handed to the workbook; membership is the reviewed selection.
    const byId = new Map(session.entries.map(entry => [entry.dbId, entry]));
    const arrangement = arrangements[session.mode];
    const confirmedOrder = arrangement && arrangement.selection === session.selection && sameMembers(arrangement.order, session.entries.map(entry => entry.dbId)) ? arrangement.order : session.entries.map(entry => entry.dbId);
    const result = await exportRunner.run({ entries: confirmedOrder.map(id => byId.get(id)), baseline: session.baseline });
    if (result.state === 'busy') return stop('An export is already in progress.');
    if (result.state === 'verification-required') return stop('Receipt status changed since this review. Choose Export Selected again so the receipts are verified with the database first. Nothing was exported.');
    if (result.state === 'snapshot-failed') return stop(`Could not verify the latest saved receipt values: ${errorText(result.error)}. Nothing was exported or marked Consumed.`);
    if (result.state === 'blocked') {
      const { hard, soft } = partitionExportProblems(result.problems);
      if (hard.length) { exportPending = false; closeExportConfirmation(); return rejectStaleResult(result.snapshotRows, result.problems, 'confirm', session.mode); }
      // Only other workbook fields changed since the reviewed snapshot: stay in the dialog, show the new values and ask for a fresh acknowledgement.
      session.notes = changeNotes(soft, new Map(session.baseline.rows.map(row => [row.dbId, row])), result.snapshotRows);
      syncRowsFromSnapshot(result.snapshotRows, soft); refreshEncodingCards(); refreshOptimizationCards();
      session.baseline = { rows: result.snapshotRows, generation: session.baseline.generation };
      session.needsAck = true; session.acknowledged = false;
      exportPending = false;
      elements.confirmExport.removeAttribute('aria-busy');
      elements.confirmExport.textContent = 'Export & Mark Consumed';
      renderReview(); showReviewState();
      reviewView.announce('Receipt values changed while you were reviewing. Review the updated values, tick the box and confirm again. Nothing was exported.');
      return elements.exportReviewAckInput.focus?.();
    }
    if (result.state === 'generation-failed') return stop(`Could not prepare the XLSX export: ${errorText(result.error)}. No receipt was marked Consumed.`);
    // The outcome is unknown: the update may have failed, or been committed with only the answer lost.
    if (result.state === 'consume-failed') return stop(`The XLSX export was prepared, but the receipt status update could not be confirmed: ${errorText(result.error)}. The workbook may already have been downloaded, and some or all of these receipts may already be Consumed. Check each receipt's status before exporting again; the next export is verified against the database first.`);
    const consumed = result.consumed;
    consumed.forEach(saved => {
      const row = [...elements.list.children].find(candidate => candidate.dataset.receiptDbId === saved.dbId);
      if (row) { row.dataset.receiptStatus = saved.status; row.dataset.receiptUpdatedAt = saved.updatedAt || ''; applyReceiptStatusState(row); }
      upsertStoreSourceReceipt(saved);
    });
    exportPending = false;
    closeExportConfirmation();
    const driftLabels = result.drift.map(item => session.entries.find(entry => entry.dbId === item.dbId)?.label).filter(Boolean);
    const doneText = `${consumed.length} receipt${consumed.length === 1 ? '' : 's'} exported and marked as Consumed.${driftLabels.length ? ` Warning: ${driftLabels.join(', ')} changed in another session while the export was being prepared. Check the workbook against your saved receipts.` : ''}`;
    if (session.mode === 'manual') {
      // Exactly the confirmed receipts are Consumed; the manual selection and its arrangement are finished. A Best Match result that contained any of them is stale now.
      const exported = new Set(consumed.map(saved => saved.dbId));
      const staleBest = Boolean(selection?.entries.some(entry => entry.dbId && exported.has(entry.dbId)));
      setManualIds([]);
      if (staleBest) clearSelection();
      refreshReceiptIds();
      refreshEncodingCards();
      refreshOptimizationCards();
      if (staleBest) { showEmpty(); elements.resultTitle.textContent = 'Result out of date'; elements.difference.textContent = 'Some receipts in this result were exported with Manual Selection. Run Find Best Match again.'; }
      setManualFeedback(doneText, 'success');
      elements.manualSelectShown?.focus?.({ preventScroll: true });
      return;
    }
    clearSelection();
    refreshReceiptIds();
    refreshEncodingCards();
    refreshOptimizationCards(); // also removes any of these receipts from the manual selection (with a message)
    showEmpty();
    elements.resultTitle.textContent = 'Export complete';
    elements.difference.textContent = doneText;
    // The Export button is disabled once the selection is cleared, so keep keyboard focus on a control that still works.
    (elements.exportSelected.disabled ? elements.calculate : elements.exportSelected).focus?.({ preventScroll: true });
  };
  const restoreReceipt = async (index, trigger) => {
    const row = elements.list.children[index];
    if (!row || receiptStatus(row) !== 'consumed' || !row.dataset.receiptDbId) return;
    if (!await confirmAction({ title: 'Mark receipt Available?', message: 'It will return to normal editing and optimization.', confirmLabel: 'Mark Available', cancelLabel: 'Keep Consumed', trigger })) return;
    if (trigger) trigger.disabled = true;
    try {
      const saved = await receiptService.updateReceiptStatus(row.dataset.receiptDbId, 'available');
      row.dataset.receiptStatus = saved.status;
      row.dataset.receiptUpdatedAt = saved.updatedAt || '';
      applyReceiptStatusState(row);
      upsertStoreSourceReceipt(saved);
      refreshEncodingCards();
      refreshOptimizationCards();
      setFeedback(elements.encodingFeedback, 'Receipt marked as Available.', 'success');
    } catch (error) { setFeedback(elements.encodingFeedback, `Could not restore this receipt: ${error.message}`, 'error'); if (trigger) trigger.disabled = false; }
  };
  const saveModalCorrection = async event => {
    event.preventDefault();
    if (editSavePending) return;
    const index = Number(elements.editModal.dataset.receiptIndex);
    const row = elements.list.children[index];
    if (!row) return closeEditModal();
    if (receiptStatus(row) === 'consumed') return closeEditModal();
    const values = { amount: elements.editAmount.value, receiptDate: elements.editReceiptDate.value, vat: elements.editVat.value, invoice: elements.editInvoice.value, store: elements.editStore.value, address: elements.editAddress.value, tin: elements.editTin.value };
    const parsedAmount = parseMoneyAmount(values.amount);
    if (parsedAmount.valid === false) return setFeedback(elements.editFeedback, `Could not save correction: ${parsedAmount.message}`, 'error');
    editSavePending = true;
    const submitButton = event.submitter;
    if (submitButton) submitButton.disabled = true;
    if (row.dataset.receiptDbId && currentUser) {
      try {
        const saved = await receiptService.updateReceipt(row.dataset.receiptDbId, values, currentUser.id);
        if (saved.updatedAt) row.dataset.receiptUpdatedAt = saved.updatedAt;
        upsertStoreSourceReceipt(saved);
      } catch (error) { setFeedback(elements.editFeedback, `Could not save correction: ${error.message}`, 'error'); editSavePending = false; if (submitButton) submitButton.disabled = false; return; }
    }
    // A correction to a receipt in the current Find Best Match result makes that result stale: clear it and say why, rather than exporting different values.
    const staleResultLabel = bestIncludesRow(row) ? `Receipt ${row.dataset.receiptId}` : '';
    Object.entries(values).forEach(([key, value]) => { row.querySelector(`.receipt-${key}`).value = value; });
    refreshSummary(row);
    closeEditModal();
    if (staleResultLabel) {
      clearSelection();
      showEmpty();
      elements.resultTitle.textContent = 'Result out of date';
      setFeedback(elements.difference, `${staleResultLabel} was corrected after Find Best Match ran, so the previous result was cleared. Run Find Best Match again.`);
    }
    refreshEncodingCards();
    refreshOptimizationCards();
    restoreEditTriggerFocus(index);
    editSavePending = false;
  };
  const applyToolbarChange = () => {
    toolbarState = readToolbarState();
    persistToolbarState();
    refreshEncodingCards();
    refreshOptimizationCards();
  };
  const clearFilters = () => {
    toolbarState = defaultOptimizationToolbarState();
    const key = toolbarStorageKey();
    if (key) try { sessionStorage.removeItem(key); } catch { /* Ignore unavailable session storage. */ }
    syncToolbarControls();
    refreshEncodingCards();
    refreshOptimizationCards();
  };
  return {
    async loadForUser(user) {
      currentUser = user;
      const receipts = await receiptService.loadReceipts();
      storeSourceReceipts = receipts;
      rebuildStoreProfiles();
      await reloadSharedStores();
      elements.list.replaceChildren();
      exportRunner = newExportRunner(); exportSession = null;
      exportMode = 'best-match'; knownMissingIds.clear(); setManualIds([]); setManualFeedback(''); applyExportModeView(); // a different user starts with nothing selected
      clearSelection();
      receipts.forEach(receipt => addReceipt(receipt, { refresh: false }));
      refreshReceiptIds();
      restoreToolbarState();
      syncToolbarControls();
      restoreEncodingDisplayState();
      refreshEncodingCards();
      restoreActiveStrategy();
      showEmpty();
      setWorkspace('encoding');
    },
    consumeLegacyWorkspace() {
      const key = workspaceStorageKey();
      if (!key) return 'encoding';
      try {
        const workspace = sessionStorage.getItem(key) === 'optimization' ? 'optimization' : 'encoding';
        sessionStorage.removeItem(key);
        return workspace;
      } catch { return 'encoding'; }
    },
    setWorkspace,
    setModuleVisible,
    clearForLogout() { currentUser = undefined; sharedStoreProfiles = []; toolbarState = defaultOptimizationToolbarState(); encodingDisplayState = { compartment: 'all' }; storeSourceReceipts = []; rebuildStoreProfiles(); syncToolbarControls(); elements.encodingAmountCompartment.value = 'all'; setActiveStrategy(optimizationStrategies.closest, { persist: false }); elements.list.replaceChildren(); elements.target.value = ''; exportRunner = newExportRunner(); exportMode = 'best-match'; knownMissingIds.clear(); setManualIds([]); setManualFeedback(''); applyExportModeView(); clearSelection(); refreshReceiptIds(); refreshEncodingCards(); refreshOptimizationCards(); showEmpty(); closeEditModal(); closeExportConfirmation({ force: true }); },
    importLegacyDraft,
    start() {
      renderEncodingAmountCompartmentOptions();
      elements.calculate.addEventListener('click', calculate);
      reviewView.start();
      elements.exportGoToEncoding?.addEventListener('click', goToEncoding);
      elements.manualGoToEncoding?.addEventListener('click', goToEncoding);
      elements.exportModeBestMatch?.addEventListener('change', () => { if (elements.exportModeBestMatch.checked) setExportMode('best-match'); });
      elements.exportModeManual?.addEventListener('change', () => { if (elements.exportModeManual.checked) setExportMode('manual'); });
      elements.manualExportSelected?.addEventListener('click', openExportConfirmation);
      elements.manualSelectShown?.addEventListener('click', selectShownReceipts);
      elements.manualClearSelection?.addEventListener('click', clearManualSelection);
      elements.exportSelected.addEventListener('click', openExportConfirmation);
      elements.confirmExport.addEventListener('click', exportAndConsume);
      elements.cancelExport.addEventListener('click', closeExportConfirmation);
      elements.exportConfirmBackdrop.addEventListener('click', closeExportConfirmation);
      elements.saveDraft.addEventListener('click', saveDraft);
      elements.clearAll.addEventListener('click', async event => {
        if (!elements.list.children.length || await confirmAction({ title: 'Clear receipts from this form?', message: 'Saved receipts remain in your account and return after a refresh.', confirmLabel: 'Clear form', cancelLabel: 'Keep receipts', danger: true, trigger: event.currentTarget })) { elements.list.replaceChildren(); clearSelection(); refreshReceiptIds(); refreshEncodingCards(); refreshOptimizationCards(); showEmpty(); }
      });
      elements.floatingAdd.addEventListener('click', addReceiptForEncoding);
      elements.editForm.addEventListener('submit', saveModalCorrection);
      elements.closeEditModal.addEventListener('click', closeEditModal);
      elements.cancelEditModal.addEventListener('click', closeEditModal);
      elements.editModalBackdrop.addEventListener('click', closeEditModal);
      const synchronizeStrategy = () => setActiveStrategy(getActiveStrategy());
      elements.optimizationStrategy.addEventListener('input', synchronizeStrategy);
      elements.optimizationStrategy.addEventListener('change', synchronizeStrategy);
      window.addEventListener('pageshow', synchronizeStrategy);
      elements.optimizationSearch.addEventListener('input', () => { clearTimeout(searchDebounce); searchDebounce = setTimeout(applyToolbarChange, 120); });
      [elements.optimizationStoreFilter, elements.optimizationStartDate, elements.optimizationEndDate, elements.optimizationMinAmount, elements.optimizationMaxAmount, elements.optimizationSort].forEach(field => field.addEventListener('change', applyToolbarChange));
      [elements.optimizationMinAmount, elements.optimizationMaxAmount].forEach(field => field.addEventListener('input', applyToolbarChange));
      elements.clearOptimizationSearch.addEventListener('click', () => { clearTimeout(searchDebounce); elements.optimizationSearch.value = ''; applyToolbarChange(); elements.optimizationSearch.focus(); });
      elements.clearOptimizationFilters.addEventListener('click', clearFilters);
      elements.receiptStatusFilter.addEventListener('change', () => { releaseEditPins(); applyToolbarChange(); });
      elements.encodingAmountCompartment.addEventListener('change', applyAmountRangeChange);
      elements.showAllAmounts?.addEventListener('click', showAllAmounts);
      elements.expandAllReceipts?.addEventListener('click', expandAllReceipts);
      elements.collapseAllReceipts?.addEventListener('click', collapseAllReceipts);
      // The same two handlers are reachable from the sticky action bar, so long sessions never need a scroll back to the list header.
      elements.barExpandAllReceipts?.addEventListener('click', expandAllReceipts);
      elements.barCollapseAllReceipts?.addEventListener('click', collapseAllReceipts);
      document.addEventListener('keydown', event => { if (modalFocus) return; if (event.key === 'Escape' && !elements.editModal.hidden) closeEditModal(); else if (event.key === 'Escape' && !elements.exportConfirmModal.hidden) escapeReview(); });
      collapseKeptReceiptsOnShortWindows(elements.keptReceipts);
      trackTextEntry(elements.encodingWorkspace);
      elements.encodingWorkspace.addEventListener('keydown', handleEncodingShortcut);
      refreshReceiptIds();
      setActiveStrategy(getActiveStrategy(), { persist: false });
      refreshOptimizationCards();
      refreshEncodingCards();
      showEmpty();
    }
  };
}
