const draftKey = 'receipt-match-draft-v2';
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const dateFormatter = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });
export const optimizationStrategyDetails = Object.freeze({
  closest: { label: 'Closest Match', helper: 'Finds the combination nearest to your target.' },
  fewest: { label: 'Fewest Receipts', helper: 'Prioritizes using fewer physical receipts.' },
  'without-exceeding': { label: 'Do Not Exceed Target', helper: 'Finds the closest total without going over your target.' }
});
export const optimizationStrategyRules = Object.freeze({
  closest: 'Rule: closest total, then larger total, then fewer receipts.',
  fewest: 'Rule: fewest receipts within 2% of the globally closest result, then closest total, then larger total.',
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
      setFeedback(feedbackTarget, `Could not delete this receipt: ${error.message}`);
    } finally {
      deletePending = false;
      trigger.disabled = false;
    }
  };
}
export const normalizeStoreTin = value => String(value || '').replace(/\D/g, '');
export function combineStoreProfiles(sharedProfiles, historyProfiles) {
  const shared = sharedProfiles.map(profile => ({ ...profile, source: 'shared', store: profile.storeName, normalizedStore: normalizeStoreText(profile.storeName), addressKey: normalizeStoreText(profile.address), tinKey: normalizeStoreTin(profile.tin) }));
  const identity = profile => `${profile.normalizedStore || normalizeStoreText(profile.store)}\u0000${profile.addressKey || normalizeStoreText(profile.address)}\u0000${profile.tinKey || normalizeStoreTin(profile.tin)}`;
  const sharedIds = new Set(shared.map(identity));
  return [...shared, ...historyProfiles.filter(profile => !sharedIds.has(identity(profile))).map(profile => ({ ...profile, source: 'history', normalizedStore: profile.normalizedStore || normalizeStoreText(profile.store) }))];
}

export function createReceiptUi({ elements, findBest, optimizationStrategies, toCents, scanPrintedDetails, downloadSelectedReceipts, receiptService, sharedStoreService = {}, confirmAction = async () => false }) {
  let currentUser;
  let selectedReceiptIndexes = new Set();
  let selectedReceiptIds = [];
  let toolbarState = defaultOptimizationToolbarState();
  let encodingDisplayState = { compartment: 'all' };
  let searchDebounce;
  let storeSourceReceipts = [];
  let storeProfiles = [];
  let sharedStoreProfiles = [];
  let storeSuggestionSequence = 0;
  let savePending = false;
  let importPending = false;
  let editSavePending = false;
  const format = cents => money.format(cents / 100);
  const setFeedback = (target, text = '') => { if (target) target.textContent = text; };
  const formatDate = value => {
    const date = calendarReceiptDate(value);
    if (!date) return 'Date not set';
    const [year, month, day] = date.split('-').map(Number);
    return dateFormatter.format(new Date(year, month - 1, day));
  };
  const rowValues = row => Object.fromEntries(['amount', 'receiptDate', 'vat', 'invoice', 'store', 'address', 'tin'].map(key => [key, row.querySelector(`.receipt-${key}`).value]));
  const rebuildStoreProfiles = () => { storeProfiles = buildStoreProfiles(storeSourceReceipts); };
  const sharedProfile = profile => ({ ...profile, storeName: profile.storeName || profile.store, address: profile.address || '', tin: profile.tin || '' });
  const profileIdentity = profile => `${normalizeStoreText(profile.storeName || profile.store)}\u0000${normalizeStoreText(profile.address)}\u0000${normalizeStoreTin(profile.tin)}`;
  const combinedStoreProfiles = () => combineStoreProfiles(sharedStoreProfiles, storeProfiles);
  const reloadSharedStores = async () => {
    try { sharedStoreProfiles = await sharedStoreService.listActiveSharedStores(); return true; }
    catch { setFeedback(elements.encodingFeedback, 'Company Store Directory is temporarily unavailable. Your receipt history is still available.'); return false; }
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
  const clearSelection = () => { selectedReceiptIndexes = new Set(); selectedReceiptIds = []; updateExportAction(); };
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
    summary.setAttribute('aria-label', `${row.open ? 'Collapse' : 'Show'} receipt details`);
    summary.title = `${row.open ? 'Collapse' : 'Show'} receipt details`;
  };
  const receiptStatus = row => normalizeReceiptStatus(row.dataset.receiptStatus);
  const refreshSummary = row => {
    const id = row.dataset.receiptId || '1';
    const store = row.querySelector('.receipt-store').value.trim() || 'Store not set';
    const amount = toCents(row.querySelector('.receipt-amount').value);
    row.querySelector('.summary-id').textContent = `Receipt ${id}`;
    row.querySelector('.summary-store').textContent = store;
    row.querySelector('.summary-amount').textContent = format(amount);
  };
  const updateExportAction = () => {
    const count = selectedReceiptIds.length === selectedReceiptIndexes.size ? selectedReceiptIds.length : 0;
    elements.exportSelected.disabled = count === 0;
    elements.exportSelected.textContent = `Export Selected (${count})`;
  };
  const refreshEncodingCards = () => {
    [...elements.list.children].forEach(row => {
      const matchesStatus = toolbarState.status === 'all' || receiptStatus(row) === toolbarState.status;
      const matchesCompartment = receiptMatchesEncodingAmountCompartment(toCents(row.querySelector('.receipt-amount').value), encodingDisplayState.compartment);
      row.hidden = !matchesStatus || !matchesCompartment;
    });
    const total = availableReceiptTotalCents(storeSourceReceipts.map(receipt => ({ status: receipt.status, cents: toCents(receipt.amount) })));
    elements.availableTotal.textContent = `Available Total — ${format(total)}`;
  };
  const applyReceiptStatusState = row => {
    const consumed = receiptStatus(row) === 'consumed';
    row.classList.toggle('is-consumed', consumed);
    row.querySelector('.receipt-status-badge').hidden = !consumed;
    row.querySelector('.delete-receipt').hidden = consumed;
    row.querySelector('.restore-receipt').hidden = !consumed;
    row.querySelectorAll('input, select').forEach(field => { field.disabled = consumed; });
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
  const refreshOptimizationCards = () => {
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
    visible.forEach(entry => {
      const card = elements.optimizationTemplate.content.firstElementChild.cloneNode(true);
      const selected = selectedReceiptIndexes.has(entry.index);
      const consumed = entry.receipt.status === 'consumed';
      card.querySelector('.compact-store').textContent = entry.receipt.store.trim() || 'Store not set';
      card.querySelector('.compact-date').textContent = formatDate(entry.receipt.receiptDate);
      card.querySelector('.compact-amount').textContent = format(entry.amount);
      card.querySelector('.compact-status').hidden = !consumed;
      card.querySelector('.selected-badge').hidden = !selected;
      card.classList.toggle('is-selected', selected);
      card.classList.toggle('is-consumed', consumed);
      card.querySelector('.compact-edit').hidden = consumed;
      card.querySelector('.compact-restore').hidden = !consumed;
      if (consumed) card.querySelector('.compact-restore').addEventListener('click', event => restoreReceipt(entry.index, event.currentTarget));
      else card.querySelector('.compact-edit').addEventListener('click', () => openEditModal(entry.index));
      fragment.append(card);
    });
    elements.optimizationList.replaceChildren(fragment);
    const hiddenSelected = [...selectedReceiptIndexes].filter(index => !visible.some(entry => entry.index === index)).length;
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
  const closeEditModal = () => { elements.editModal.hidden = true; delete elements.editModal.dataset.receiptIndex; };
  const openEditModal = index => {
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
      const values = storeProfileFields(profile);
      input.value = values.store;
      if (values.address) row.querySelector('.receipt-address').value = values.address;
      if (values.tin) row.querySelector('.receipt-tin').value = values.tin;
      if (values.vat) row.querySelector('.receipt-vat').value = values.vat;
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
    if (values.dbId) row.dataset.receiptDbId = values.dbId;
    if (values.updatedAt) row.dataset.receiptUpdatedAt = values.updatedAt;
    row.dataset.receiptStatus = normalizeReceiptStatus(values.status);
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
      const values = rowValues(row);
      if (!currentUser || !values.store.trim() || (!values.address.trim() && !values.tin.trim())) return setFeedback(elements.encodingFeedback, 'Add a Store Name and either an Address or TIN before contributing.');
      const candidate = { storeName: values.store, address: values.address, tin: values.tin, vat: values.vat };
      const normalized = sharedProfile(candidate);
      const existing = sharedStoreProfiles.map(sharedProfile).find(profile => profileIdentity(profile) === profileIdentity(normalized));
      if (existing) return setFeedback(elements.encodingFeedback, 'This store already exists in the Company Store Directory.');
      event.currentTarget.disabled = true;
      try {
        await sharedStoreService.contributeSharedStore(candidate, currentUser.id);
        await reloadSharedStores();
        setFeedback(elements.encodingFeedback, 'Store added to the Company Store Directory.');
      } catch (error) {
        if (error?.name === 'SharedStoreDuplicateError') { await reloadSharedStores(); setFeedback(elements.encodingFeedback, 'This store was already added to the Company Store Directory.'); }
        else setFeedback(elements.encodingFeedback, `Could not add this store: ${error.message}`);
      } finally { event.currentTarget.disabled = false; }
    });
    row.querySelector('.restore-receipt').addEventListener('click', event => restoreReceipt([...elements.list.children].indexOf(row), event.currentTarget));
    installStoreAutocomplete(row);
    const storeInput = row.querySelector('.receipt-store');
    row.querySelectorAll('input, select').forEach(field => {
      const refreshView = () => { refreshSummary(row); clearSelection(); refreshEncodingCards(); refreshOptimizationCards(); };
      field.addEventListener('input', field === storeInput ? () => refreshSummary(row) : refreshView);
      field.addEventListener('change', refreshView);
    });
    row.addEventListener('toggle', () => refreshToggle(row));
    elements.list.append(row);
    applyReceiptStatusState(row);
    if (refresh) { refreshReceiptIds(); refreshEncodingCards(); refreshOptimizationCards(); }
    return row;
  };
  const isBlankUnsavedReceipt = row => !row.dataset.receiptDbId && Object.values(rowValues(row)).every(value => !String(value || '').trim());
  const focusReceiptForEncoding = row => {
    row.open = true;
    requestAnimationFrame(() => {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.querySelector('.receipt-store').focus({ preventScroll: true });
    });
  };
  const addReceiptForEncoding = () => {
    const pendingReceipt = [...elements.list.children].find(isBlankUnsavedReceipt);
    focusReceiptForEncoding(pendingReceipt || addReceipt());
  };
  const saveDraft = async () => {
    if (savePending) return;
    if (!currentUser) return setFeedback(elements.encodingFeedback, 'Please sign in before saving receipts.');
    savePending = true;
    elements.saveDraft.disabled = true;
    try {
      for (const row of elements.list.children) {
        if (receiptStatus(row) === 'consumed') continue;
        const receipt = rowValues(row);
        if (isBlankUnsavedReceipt(row)) continue;
        const saved = row.dataset.receiptDbId ? await receiptService.updateReceipt(row.dataset.receiptDbId, receipt, currentUser.id) : await receiptService.createReceipt(receipt, currentUser.id);
        row.dataset.receiptDbId = saved.dbId;
        if (saved.updatedAt) row.dataset.receiptUpdatedAt = saved.updatedAt;
        upsertStoreSourceReceipt(saved);
      }
      refreshEncodingCards();
      refreshOptimizationCards();
      setFeedback(elements.encodingFeedback, 'Receipt changes saved.');
    } catch (error) { setFeedback(elements.encodingFeedback, `Could not save receipt changes: ${error.message}`); }
    finally { savePending = false; elements.saveDraft.disabled = false; }
  };
  const calculate = () => {
    const targetCents = toCents(elements.target.value);
    const receipts = availableOptimizerReceipts([...elements.list.children].map((row, index) => ({ index, dbId: row.dataset.receiptDbId, label: `Receipt ${row.dataset.receiptId}`, cents: toCents(row.querySelector('.receipt-amount').value), status: receiptStatus(row), ...rowValues(row) })));
    if (!targetCents || !receipts.length) { clearSelection(); refreshOptimizationCards(); showEmpty(); return; }
    try {
      const strategy = setActiveStrategy(getActiveStrategy());
      const best = findBest(receipts, targetCents, strategy);
      if (!best) {
        clearSelection();
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
      selectedReceiptIndexes = new Set(chosen.map(receipt => receipt.index));
      selectedReceiptIds = chosen.map(receipt => receipt.dbId).filter(Boolean);
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
      setFeedback(elements.encodingFeedback, 'Import completed. Your original browser draft was kept as a backup.');
      return true;
    } catch (error) {
      setFeedback(elements.encodingFeedback, `Could not import saved browser receipts: ${error.message}`);
      return false;
    } finally { importPending = false; }
  };
  let exportPending = false;
  const closeExportConfirmation = ({ force = false } = {}) => {
    if (exportPending && !force) return;
    elements.exportConfirmModal.hidden = true;
    elements.confirmExport.disabled = false;
    elements.confirmExport.removeAttribute('aria-busy');
    elements.confirmExport.textContent = 'Export & Mark Consumed';
  };
  const selectedReceiptsForExport = () => selectedReceiptIds.map(id => {
    const row = [...elements.list.children].find(candidate => candidate.dataset.receiptDbId === id);
    return row && receiptStatus(row) === 'available' ? { ...rowValues(row), dbId: id, status: 'available' } : null;
  }).filter(Boolean);
  const openExportConfirmation = () => {
    const receipts = selectedReceiptsForExport();
    if (!receipts.length || receipts.length !== selectedReceiptIndexes.size) return setFeedback(elements.difference, 'Run Find Best Match with saved Available receipts before exporting.');
    elements.exportConfirmMessage.textContent = `Export ${receipts.length} selected receipt${receipts.length === 1 ? '' : 's'}? After the export is prepared, these receipts will be marked as Consumed and excluded from future optimization.`;
    elements.exportConfirmModal.hidden = false;
    elements.confirmExport.focus();
  };
  const exportAndConsume = async () => {
    if (exportPending) return;
    exportPending = true;
    elements.confirmExport.disabled = true;
    elements.confirmExport.setAttribute('aria-busy', 'true');
    elements.confirmExport.textContent = 'Preparing export…';
    const receipts = selectedReceiptsForExport();
    if (!receipts.length || receipts.length !== selectedReceiptIndexes.size) { exportPending = false; closeExportConfirmation(); return setFeedback(elements.difference, 'The selected result is no longer exportable. Run Find Best Match again.'); }
    try { downloadSelectedReceipts(receipts); } catch (error) { exportPending = false; closeExportConfirmation(); return setFeedback(elements.difference, `Could not prepare the XLSX export: ${error.message}`); }
    try {
      const consumed = await receiptService.consumeReceipts(receipts.map(receipt => receipt.dbId));
      consumed.forEach(saved => {
        const row = [...elements.list.children].find(candidate => candidate.dataset.receiptDbId === saved.dbId);
        if (row) { row.dataset.receiptStatus = saved.status; row.dataset.receiptUpdatedAt = saved.updatedAt || ''; applyReceiptStatusState(row); }
        upsertStoreSourceReceipt(saved);
      });
      exportPending = false;
      closeExportConfirmation();
      clearSelection();
      refreshReceiptIds();
      refreshEncodingCards();
      refreshOptimizationCards();
      showEmpty();
      elements.resultTitle.textContent = 'Export complete';
      elements.difference.textContent = `${consumed.length} receipt${consumed.length === 1 ? '' : 's'} exported and marked as Consumed.`;
    } catch (error) {
      exportPending = false;
      closeExportConfirmation();
      setFeedback(elements.difference, `The XLSX export was prepared, but receipt status could not be updated: ${error.message} Review the receipt status before exporting again.`);
    }
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
      setFeedback(elements.encodingFeedback, 'Receipt marked as Available.');
    } catch (error) { setFeedback(elements.encodingFeedback, `Could not restore this receipt: ${error.message}`); if (trigger) trigger.disabled = false; }
  };
  const saveModalCorrection = async event => {
    event.preventDefault();
    if (editSavePending) return;
    const index = Number(elements.editModal.dataset.receiptIndex);
    const row = elements.list.children[index];
    if (!row) return closeEditModal();
    if (receiptStatus(row) === 'consumed') return closeEditModal();
    const values = { amount: elements.editAmount.value, receiptDate: elements.editReceiptDate.value, vat: elements.editVat.value, invoice: elements.editInvoice.value, store: elements.editStore.value, address: elements.editAddress.value, tin: elements.editTin.value };
    editSavePending = true;
    const submitButton = event.submitter;
    if (submitButton) submitButton.disabled = true;
    if (row.dataset.receiptDbId && currentUser) {
      try {
        const saved = await receiptService.updateReceipt(row.dataset.receiptDbId, values, currentUser.id);
        if (saved.updatedAt) row.dataset.receiptUpdatedAt = saved.updatedAt;
        upsertStoreSourceReceipt(saved);
      } catch (error) { setFeedback(elements.editFeedback, `Could not save correction: ${error.message}`); editSavePending = false; if (submitButton) submitButton.disabled = false; return; }
    }
    Object.entries(values).forEach(([key, value]) => { row.querySelector(`.receipt-${key}`).value = value; });
    refreshSummary(row);
    closeEditModal();
    refreshEncodingCards();
    refreshOptimizationCards();
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
    clearForLogout() { currentUser = undefined; sharedStoreProfiles = []; toolbarState = defaultOptimizationToolbarState(); encodingDisplayState = { compartment: 'all' }; storeSourceReceipts = []; rebuildStoreProfiles(); syncToolbarControls(); elements.encodingAmountCompartment.value = 'all'; setActiveStrategy(optimizationStrategies.closest, { persist: false }); elements.list.replaceChildren(); elements.target.value = ''; clearSelection(); refreshReceiptIds(); refreshEncodingCards(); refreshOptimizationCards(); showEmpty(); closeEditModal(); closeExportConfirmation({ force: true }); },
    importLegacyDraft,
    start() {
      renderEncodingAmountCompartmentOptions();
      elements.calculate.addEventListener('click', calculate);
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
      elements.receiptStatusFilter.addEventListener('change', applyToolbarChange);
      elements.encodingAmountCompartment.addEventListener('change', () => {
        encodingDisplayState.compartment = normalizeEncodingAmountCompartment(elements.encodingAmountCompartment.value);
        persistEncodingDisplayState();
        refreshEncodingCards();
      });
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && !elements.editModal.hidden) closeEditModal(); else if (event.key === 'Escape' && !elements.exportConfirmModal.hidden) closeExportConfirmation(); });
      refreshReceiptIds();
      setActiveStrategy(getActiveStrategy(), { persist: false });
      refreshOptimizationCards();
      refreshEncodingCards();
      showEmpty();
    }
  };
}
