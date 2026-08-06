const draftKey = 'receipt-match-draft-v2';
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const dateFormatter = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });

export function createReceiptUi({ elements, findBest, toCents, scanPrintedDetails, receiptService }) {
  let currentUser;
  let selectedReceiptIndexes = new Set();
  const format = cents => money.format(cents / 100);
  const formatDate = date => date ? dateFormatter.format(new Date(`${date}T00:00:00`)) : 'Date not set';
  const rowValues = row => Object.fromEntries(['amount', 'receiptDate', 'vat', 'invoice', 'store', 'address', 'tin'].map(key => [key, row.querySelector(`.receipt-${key}`).value]));
  const clearSelection = () => { selectedReceiptIndexes = new Set(); };
  const refreshToggle = row => {
    const action = row.open ? 'Collapse' : 'Details';
    const summary = row.querySelector('summary');
    row.querySelector('.toggle-label').textContent = action;
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
    [...elements.list.children].forEach((row, index) => { row.dataset.receiptId = index + 1; refreshSummary(row); });
    elements.receiptCount.textContent = elements.list.children.length ? `${elements.list.children.length} receipt${elements.list.children.length === 1 ? '' : 's'}` : 'No receipts added';
  };
  const showEmpty = () => {
    elements.resultTitle.textContent = 'Add receipts to begin';
    elements.resultAmount.textContent = '₱0.00';
    elements.difference.textContent = 'Enter a target and receipt amounts.';
    elements.keptReceipts.replaceChildren();
    elements.adminContent.textContent = 'Run a calculation to view the selection logic.';
  };
  const refreshOptimizationCards = () => {
    const fragment = document.createDocumentFragment();
    const rows = [...elements.list.children];
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'optimization-empty';
      empty.textContent = 'No receipts have been encoded yet.';
      fragment.append(empty);
    }
    rows.forEach((row, index) => {
      const card = elements.optimizationTemplate.content.firstElementChild.cloneNode(true);
      const receipt = rowValues(row);
      const selected = selectedReceiptIndexes.has(index);
      card.querySelector('.compact-store').textContent = receipt.store.trim() || 'Store not set';
      card.querySelector('.compact-date').textContent = formatDate(receipt.receiptDate);
      card.querySelector('.compact-amount').textContent = format(toCents(receipt.amount));
      card.querySelector('.selected-badge').hidden = !selected;
      card.classList.toggle('is-selected', selected);
      card.querySelector('.compact-edit').addEventListener('click', () => openEditModal(index));
      fragment.append(card);
    });
    elements.optimizationList.replaceChildren(fragment);
  };
  const workspaceStorageKey = () => currentUser ? `fsresibo-workspace-${currentUser.id}` : null;
  const setWorkspace = (workspace, persist = true) => {
    const encoding = workspace !== 'optimization';
    elements.encodingWorkspace.hidden = !encoding;
    elements.optimizationWorkspace.hidden = encoding;
    elements.encodingTab.setAttribute('aria-selected', String(encoding));
    elements.optimizationTab.setAttribute('aria-selected', String(!encoding));
    if (!encoding) refreshOptimizationCards();
    if (persist && workspaceStorageKey()) sessionStorage.setItem(workspaceStorageKey(), encoding ? 'encoding' : 'optimization');
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
  const addReceipt = (values = {}) => {
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
      } else if (hasDraftContent && !confirm('Discard this unfinished receipt? Its entered details will be lost.')) {
        return;
      }
      row.remove();
      clearSelection();
      refreshReceiptIds();
      refreshOptimizationCards();
      (nextFocus?.querySelector('summary') || elements.floatingAdd).focus({ preventScroll: true });
    });
    row.querySelectorAll('input, select').forEach(field => {
      const refresh = () => { refreshSummary(row); clearSelection(); refreshOptimizationCards(); };
      field.addEventListener('input', refresh);
      field.addEventListener('change', refresh);
    });
    row.addEventListener('toggle', () => refreshToggle(row));
    elements.list.append(row);
    refreshReceiptIds();
    refreshOptimizationCards();
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
        const saved = row.dataset.receiptDbId
          ? await receiptService.updateReceipt(row.dataset.receiptDbId, receipt, currentUser.id)
          : await receiptService.createReceipt(receipt, currentUser.id);
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
      const best = findBest(receipts, targetCents);
      const chosen = best.items.map(index => receipts[index]);
      const difference = best.total - targetCents;
      selectedReceiptIndexes = new Set(chosen.map(receipt => receipt.index));
      elements.resultTitle.textContent = difference === 0 ? 'Exact match found' : 'Best available match';
      elements.resultAmount.textContent = format(best.total);
      elements.difference.textContent = difference === 0 ? 'This selection matches your requested amount exactly.' : `${difference > 0 ? 'Over' : 'Under'} by ${format(Math.abs(difference))}.`;
      const chips = document.createDocumentFragment();
      chosen.forEach(receipt => { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = `${receipt.label} · ${format(receipt.cents)}`; chips.append(chip); });
      elements.keptReceipts.replaceChildren(chips);
      elements.adminContent.replaceChildren();
      const details = document.createElement('p');
      details.innerHTML = `<strong>Selection:</strong> ${chosen.map(receipt => receipt.label).join(' + ')} = <strong>${format(best.total)}</strong>`;
      const rules = document.createElement('ul');
      ['Target: ' + format(targetCents), 'Difference: ' + (difference === 0 ? 'Exact' : format(Math.abs(difference)) + (difference > 0 ? ' over' : ' under')), 'Rule: closest total, then larger total, then fewer receipts.'].forEach(text => { const item = document.createElement('li'); item.textContent = text; rules.append(item); });
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
    clearSelection();
    showEmpty();
    closeEditModal();
    refreshOptimizationCards();
  };
  return {
    async loadForUser(user) {
      currentUser = user;
      const receipts = await receiptService.loadReceipts();
      elements.list.replaceChildren();
      clearSelection();
      receipts.forEach(addReceipt);
      showEmpty();
      setWorkspace(sessionStorage.getItem(workspaceStorageKey()) || 'encoding', false);
    },
    clearForLogout() { currentUser = undefined; elements.list.replaceChildren(); elements.target.value = ''; clearSelection(); refreshReceiptIds(); refreshOptimizationCards(); showEmpty(); closeEditModal(); },
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
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && !elements.editModal.hidden) closeEditModal(); });
      refreshReceiptIds();
      refreshOptimizationCards();
      showEmpty();
    }
  };
}
