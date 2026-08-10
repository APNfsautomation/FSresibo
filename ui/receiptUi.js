const draftKey = 'receipt-match-draft-v2';
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const dateFormatter = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });
export const defaultOptimizationToolbarState = () => ({ search: '', store: '', startDate: '', endDate: '', minAmount: '', maxAmount: '', sort: 'default' });
export const normalizeOptimizationText = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
export const readableOptimizationText = value => String(value || '').trim().replace(/\s+/g, ' ');
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
    const matchesSearch = !query || [receipt.store, receipt.invoice, receipt.tin, receipt.address, entry.receiptId, `Receipt ${entry.receiptId}`].some(value => normalizeOptimizationText(value).includes(query));
    if (!matchesSearch || (state.store && normalizeOptimizationText(receipt.store) !== state.store)) return false;
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

export function createReceiptUi({ elements, findBest, optimizationStrategies, toCents, scanPrintedDetails, receiptService }) {
  let currentUser;
  let selectedReceiptIndexes = new Set();
  let toolbarState = defaultOptimizationToolbarState();
  let selectedStrategy = optimizationStrategies.closest;
  let searchDebounce;
  const format = cents => money.format(cents / 100);
  const strategyDetails = {
    [optimizationStrategies.closest]: { label: 'Closest Match', helper: 'Finds the combination nearest to your target.' },
    [optimizationStrategies.fewest]: { label: 'Fewest Receipts', helper: 'Prioritizes using fewer physical receipts.' },
    [optimizationStrategies.withoutExceeding]: { label: 'Do Not Exceed Target', helper: 'Finds the closest total without going over your target.' }
  };
  const formatDate = value => {
    const date = calendarReceiptDate(value);
    if (!date) return 'Date not set';
    const [year, month, day] = date.split('-').map(Number);
    return dateFormatter.format(new Date(year, month - 1, day));
  };
  const rowValues = row => Object.fromEntries(['amount', 'receiptDate', 'vat', 'invoice', 'store', 'address', 'tin'].map(key => [key, row.querySelector(`.receipt-${key}`).value]));
  const clearSelection = () => { selectedReceiptIndexes = new Set(); };
  const workspaceStorageKey = () => currentUser?.id ? `fsresibo-workspace-${currentUser.id}` : null;
  const toolbarStorageKey = () => currentUser?.id ? `fsresibo-optimization-toolbar-${currentUser.id}` : null;
  const strategyStorageKey = () => currentUser?.id ? `fsresibo-optimization-strategy-${currentUser.id}` : null;
  const hasActiveToolbarState = state => Object.entries(defaultOptimizationToolbarState()).some(([key, value]) => state[key] !== value);
  const readToolbarState = () => ({
    search: elements.optimizationSearch.value,
    store: elements.optimizationStoreFilter.value,
    startDate: elements.optimizationStartDate.value,
    endDate: elements.optimizationEndDate.value,
    minAmount: elements.optimizationMinAmount.value,
    maxAmount: elements.optimizationMaxAmount.value,
    sort: elements.optimizationSort.value || 'default'
  });
  const syncToolbarControls = () => {
    elements.optimizationSearch.value = toolbarState.search;
    elements.optimizationStartDate.value = toolbarState.startDate;
    elements.optimizationEndDate.value = toolbarState.endDate;
    elements.optimizationMinAmount.value = toolbarState.minAmount;
    elements.optimizationMaxAmount.value = toolbarState.maxAmount;
    elements.optimizationSort.value = toolbarState.sort;
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
  const syncStrategyControl = () => {
    const details = strategyDetails[selectedStrategy] || strategyDetails[optimizationStrategies.closest];
    elements.optimizationStrategy.value = selectedStrategy;
    elements.optimizationStrategyHelper.textContent = details.helper;
  };
  const restoreStrategy = () => {
    selectedStrategy = optimizationStrategies.closest;
    const key = strategyStorageKey();
    if (key) try {
      const stored = sessionStorage.getItem(key);
      if (strategyDetails[stored]) selectedStrategy = stored;
    } catch { /* Ignore unavailable browser-session state. */ }
    syncStrategyControl();
  };
  const persistStrategy = () => {
    const key = strategyStorageKey();
    if (key) try { sessionStorage.setItem(key, selectedStrategy); } catch { /* Ignore unavailable browser-session state. */ }
  };
  const updateResultSummary = ({ target, matched = null, difference = null, receiptCount = 0 } = {}) => {
    const details = strategyDetails[selectedStrategy] || strategyDetails[optimizationStrategies.closest];
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
  const refreshSummary = row => {
    const id = row.dataset.receiptId || '1';
    const store = row.querySelector('.receipt-store').value.trim() || 'Store not set';
    const amount = toCents(row.querySelector('.receipt-amount').value);
    row.querySelector('.summary-id').textContent = `Receipt ${id}`;
    row.querySelector('.summary-store').textContent = store;
    row.querySelector('.summary-amount').textContent = format(amount);
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
    const receipt = rowValues(row);
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
      card.querySelector('.compact-store').textContent = entry.receipt.store.trim() || 'Store not set';
      card.querySelector('.compact-date').textContent = formatDate(entry.receipt.receiptDate);
      card.querySelector('.compact-amount').textContent = format(entry.amount);
      card.querySelector('.selected-badge').hidden = !selected;
      card.classList.toggle('is-selected', selected);
      card.querySelector('.compact-edit').addEventListener('click', () => openEditModal(entry.index));
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
  };
  const setWorkspace = (workspace, persist = true) => {
    const encoding = workspace !== 'optimization';
    elements.encodingWorkspace.hidden = !encoding;
    elements.optimizationWorkspace.hidden = encoding;
    elements.encodingTab.setAttribute('aria-selected', String(encoding));
    elements.optimizationTab.setAttribute('aria-selected', String(!encoding));
    if (!encoding) refreshOptimizationCards();
    const key = workspaceStorageKey();
    if (persist && key) try { sessionStorage.setItem(key, encoding ? 'encoding' : 'optimization'); } catch { /* Ignore unavailable session storage. */ }
  };
  const closeEditModal = () => { elements.editModal.hidden = true; delete elements.editModal.dataset.receiptIndex; };
  const openEditModal = index => {
    const row = elements.list.children[index];
    if (!row) return;
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
  const addReceipt = (values = {}, { refresh = true } = {}) => {
    const row = elements.template.content.firstElementChild.cloneNode(true);
    if (values.dbId) row.dataset.receiptDbId = values.dbId;
    for (const [key, value] of Object.entries(values)) { const field = row.querySelector(`.receipt-${key}`); if (field) field.value = value; }
    row.querySelector('.receipt-photo').addEventListener('change', event => { const file = event.currentTarget.files[0]; if (file) scanPrintedDetails(file, row, refreshSummary); });
    row.querySelector('.delete-receipt').addEventListener('click', async () => {
      const id = row.dataset.receiptDbId;
      const nextFocus = row.nextElementSibling || row.previousElementSibling;
      const hasDraftContent = Object.values(rowValues(row)).some(value => String(value || '').trim()) || row.querySelector('.receipt-photo').files.length > 0;
      if (id && currentUser) {
        if (!confirm('Delete this saved receipt? This cannot be undone.')) return;
        try { await receiptService.deleteReceipt(id); } catch (error) { alert(`Could not delete this receipt: ${error.message}`); return; }
      } else if (hasDraftContent && !confirm('Discard this unfinished receipt? Its entered details will be lost.')) return;
      row.remove();
      clearSelection();
      refreshReceiptIds();
      refreshOptimizationCards();
      (nextFocus?.querySelector('summary') || elements.floatingAdd).focus({ preventScroll: true });
    });
    row.querySelectorAll('input, select').forEach(field => {
      const refreshView = () => { refreshSummary(row); clearSelection(); refreshOptimizationCards(); };
      field.addEventListener('input', refreshView);
      field.addEventListener('change', refreshView);
    });
    row.addEventListener('toggle', () => refreshToggle(row));
    elements.list.append(row);
    if (refresh) { refreshReceiptIds(); refreshOptimizationCards(); }
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
    if (!currentUser) return alert('Please sign in before saving receipts.');
    try {
      for (const row of elements.list.children) {
        const receipt = rowValues(row);
        if (isBlankUnsavedReceipt(row)) continue;
        const saved = row.dataset.receiptDbId ? await receiptService.updateReceipt(row.dataset.receiptDbId, receipt, currentUser.id) : await receiptService.createReceipt(receipt, currentUser.id);
        row.dataset.receiptDbId = saved.dbId;
      }
      alert('Receipt changes saved.');
    } catch (error) { alert(`Could not save receipt changes: ${error.message}`); }
  };
  const calculate = () => {
    const targetCents = toCents(elements.target.value);
    const receipts = [...elements.list.children].map((row, index) => ({ index, label: `Receipt ${row.dataset.receiptId}`, cents: toCents(row.querySelector('.receipt-amount').value) })).filter(receipt => receipt.cents > 0);
    if (!targetCents || !receipts.length) { clearSelection(); refreshOptimizationCards(); showEmpty(); return; }
    try {
      const best = findBest(receipts, targetCents, selectedStrategy);
      if (!best) {
        clearSelection();
        elements.resultTitle.textContent = selectedStrategy === optimizationStrategies.withoutExceeding ? 'No non-zero match without exceeding' : 'No valid match found';
        elements.resultAmount.textContent = '₱0.00';
        elements.difference.textContent = selectedStrategy === optimizationStrategies.withoutExceeding ? 'No non-zero receipt combination is at or below your requested amount.' : 'No valid receipt combination is available.';
        elements.keptReceipts.replaceChildren();
        elements.adminContent.textContent = 'Adjust the target or choose a different optimization strategy.';
        updateResultSummary({ target: targetCents });
        refreshOptimizationCards();
        return;
      }
      const chosen = best.items.map(index => receipts[index]);
      const difference = best.total - targetCents;
      selectedReceiptIndexes = new Set(chosen.map(receipt => receipt.index));
      elements.resultTitle.textContent = difference === 0 ? 'Exact match found' : selectedStrategy === optimizationStrategies.withoutExceeding ? 'Best match without exceeding' : 'Best available match';
      elements.resultAmount.textContent = format(best.total);
      elements.difference.textContent = difference === 0 ? 'This selection matches your requested amount exactly.' : `${difference > 0 ? 'Over' : 'Under'} by ${format(Math.abs(difference))}.`;
      updateResultSummary({ target: targetCents, matched: best.total, difference, receiptCount: chosen.length });
      const chips = document.createDocumentFragment();
      chosen.forEach(receipt => { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = `${receipt.label} · ${format(receipt.cents)}`; chips.append(chip); });
      elements.keptReceipts.replaceChildren(chips);
      elements.adminContent.replaceChildren();
      const details = document.createElement('p');
      details.innerHTML = `<strong>Selection:</strong> ${chosen.map(receipt => receipt.label).join(' + ')} = <strong>${format(best.total)}</strong>`;
      const rules = document.createElement('ul');
      const strategyMeta = strategyDetails[selectedStrategy] || strategyDetails[optimizationStrategies.closest];
      const rule = selectedStrategy === optimizationStrategies.fewest ? 'Rule: fewest receipts within 2% of the globally closest result, then closest total, then larger total.' : selectedStrategy === optimizationStrategies.withoutExceeding ? 'Rule: closest total at or below the target, then fewer receipts.' : 'Rule: closest total, then larger total, then fewer receipts.';
      ['Strategy: ' + strategyMeta.label, 'Target: ' + format(targetCents), 'Difference: ' + (difference === 0 ? 'Exact' : format(Math.abs(difference)) + (difference > 0 ? ' over' : ' under')), rule].forEach(text => { const item = document.createElement('li'); item.textContent = text; rules.append(item); });
      elements.adminContent.append(details, rules);
      refreshOptimizationCards();
    } catch (error) { alert(error.message); }
  };
  const importLegacyDraft = async user => {
    const draft = localStorage.getItem(draftKey);
    const migrationKey = `${draftKey}-imported-for-${user.id}`;
    if (!draft || localStorage.getItem(migrationKey)) return false;
    let data;
    try { data = JSON.parse(draft); } catch { return false; }
    if (!data.receipts?.length || !confirm(`Import ${data.receipts.length} saved browser receipt(s) into your account? Your local draft will be kept as a backup.`)) return false;
    const imported = await receiptService.importReceipts(data.receipts, user.id);
    localStorage.setItem(migrationKey, 'true');
    if (data.target) elements.target.value = data.target;
    imported.forEach(addReceipt);
    alert('Import completed. Your original browser draft was kept as a backup.');
    return true;
  };
  const saveModalCorrection = async event => {
    event.preventDefault();
    const index = Number(elements.editModal.dataset.receiptIndex);
    const row = elements.list.children[index];
    if (!row) return closeEditModal();
    const values = { amount: elements.editAmount.value, receiptDate: elements.editReceiptDate.value, vat: elements.editVat.value, invoice: elements.editInvoice.value, store: elements.editStore.value, address: elements.editAddress.value, tin: elements.editTin.value };
    if (row.dataset.receiptDbId && currentUser) {
      try { await receiptService.updateReceipt(row.dataset.receiptDbId, values, currentUser.id); } catch (error) { alert(`Could not save correction: ${error.message}`); return; }
    }
    Object.entries(values).forEach(([key, value]) => { row.querySelector(`.receipt-${key}`).value = value; });
    refreshSummary(row);
    closeEditModal();
    refreshOptimizationCards();
  };
  const applyToolbarChange = () => {
    toolbarState = readToolbarState();
    persistToolbarState();
    refreshOptimizationCards();
  };
  const clearFilters = () => {
    toolbarState = defaultOptimizationToolbarState();
    const key = toolbarStorageKey();
    if (key) try { sessionStorage.removeItem(key); } catch { /* Ignore unavailable session storage. */ }
    refreshOptimizationCards();
  };
  return {
    async loadForUser(user) {
      currentUser = user;
      const receipts = await receiptService.loadReceipts();
      elements.list.replaceChildren();
      clearSelection();
      receipts.forEach(receipt => addReceipt(receipt, { refresh: false }));
      refreshReceiptIds();
      restoreToolbarState();
      restoreStrategy();
      showEmpty();
      setWorkspace((() => { try { return sessionStorage.getItem(workspaceStorageKey()) || 'encoding'; } catch { return 'encoding'; } })(), false);
    },
    clearForLogout() { currentUser = undefined; toolbarState = defaultOptimizationToolbarState(); selectedStrategy = optimizationStrategies.closest; syncStrategyControl(); elements.list.replaceChildren(); elements.target.value = ''; clearSelection(); refreshReceiptIds(); refreshOptimizationCards(); showEmpty(); closeEditModal(); },
    importLegacyDraft,
    start() {
      elements.calculate.addEventListener('click', calculate);
      elements.saveDraft.addEventListener('click', saveDraft);
      elements.clearAll.addEventListener('click', () => {
        if (!elements.list.children.length || confirm('Clear all receipts from this form? Saved receipts remain in your account and return after a refresh.')) { elements.list.replaceChildren(); clearSelection(); refreshReceiptIds(); refreshOptimizationCards(); showEmpty(); }
      });
      elements.encodingTab.addEventListener('click', () => setWorkspace('encoding'));
      elements.optimizationTab.addEventListener('click', () => setWorkspace('optimization'));
      elements.floatingAdd.addEventListener('click', addReceiptForEncoding);
      elements.editForm.addEventListener('submit', saveModalCorrection);
      elements.closeEditModal.addEventListener('click', closeEditModal);
      elements.cancelEditModal.addEventListener('click', closeEditModal);
      elements.editModalBackdrop.addEventListener('click', closeEditModal);
      elements.optimizationStrategy.addEventListener('change', () => { selectedStrategy = strategyDetails[elements.optimizationStrategy.value] ? elements.optimizationStrategy.value : optimizationStrategies.closest; persistStrategy(); syncStrategyControl(); });
      elements.optimizationSearch.addEventListener('input', () => { clearTimeout(searchDebounce); searchDebounce = setTimeout(applyToolbarChange, 120); });
      [elements.optimizationStoreFilter, elements.optimizationStartDate, elements.optimizationEndDate, elements.optimizationMinAmount, elements.optimizationMaxAmount, elements.optimizationSort].forEach(field => field.addEventListener('change', applyToolbarChange));
      [elements.optimizationMinAmount, elements.optimizationMaxAmount].forEach(field => field.addEventListener('input', applyToolbarChange));
      elements.clearOptimizationSearch.addEventListener('click', () => { clearTimeout(searchDebounce); elements.optimizationSearch.value = ''; applyToolbarChange(); elements.optimizationSearch.focus(); });
      elements.clearOptimizationFilters.addEventListener('click', clearFilters);
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && !elements.editModal.hidden) closeEditModal(); });
      refreshReceiptIds();
      syncStrategyControl();
      refreshOptimizationCards();
      showEmpty();
    }
  };
}
