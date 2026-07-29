const draftKey = 'receipt-match-draft-v2';
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

export function createReceiptUi({ elements, findBest, toCents, scanPrintedDetails, receiptService }) {
  let currentUser;
  const format = cents => money.format(cents / 100);
  const refreshToggle = row => { row.querySelector('.toggle-label').textContent = row.open ? 'Close' : 'Details'; };
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
  const showEmpty = () => { elements.resultTitle.textContent='Add receipts to begin'; elements.resultAmount.textContent='₱0.00'; elements.difference.textContent='Enter a target and receipt amounts.'; elements.keptReceipts.innerHTML=''; };
  const addReceipt = (values = {}) => {
    const row = elements.template.content.firstElementChild.cloneNode(true);
    if (values.dbId) row.dataset.receiptDbId = values.dbId;
    for (const [key, value] of Object.entries(values)) { const field = row.querySelector(`.receipt-${key}`); if (field) field.value = value; }
    row.querySelector('.receipt-photo').addEventListener('change', event => { const file = event.currentTarget.files[0]; if (file) scanPrintedDetails(file, row, refreshSummary); });
    row.querySelector('.remove').addEventListener('click', async () => {
      const id = row.dataset.receiptDbId;
      if (id && currentUser) {
        try { await receiptService.deleteReceipt(id); } catch (error) { return alert(`Could not delete this receipt: ${error.message}`); }
      }
      row.remove(); refreshReceiptIds();
    });
    row.querySelectorAll('input, select').forEach(field => {
      field.addEventListener('input', () => refreshSummary(row));
      field.addEventListener('change', () => refreshSummary(row));
    });
    row.addEventListener('toggle', () => refreshToggle(row));
    elements.list.append(row); refreshReceiptIds();
  };
  const rowValues = row => Object.fromEntries(['amount','vat','invoice','store','address','tin'].map(key => [key, row.querySelector(`.receipt-${key}`).value]));
  const saveDraft = async () => {
    if (!currentUser) return alert('Please sign in before saving receipts.');
    try {
      for (const row of elements.list.children) {
        const receipt = rowValues(row);
        const saved = row.dataset.receiptDbId
          ? await receiptService.updateReceipt(row.dataset.receiptDbId, receipt, currentUser.id)
          : await receiptService.createReceipt(receipt, currentUser.id);
        row.dataset.receiptDbId = saved.dbId;
      }
      alert('Receipt changes saved.');
    } catch (error) { alert(`Could not save receipt changes: ${error.message}`); }
  };
  const calculate = () => {
    const targetCents=toCents(elements.target.value);
    const receipts=[...elements.list.children].map(row=>({ label:`Receipt ${row.dataset.receiptId}`, cents:toCents(row.querySelector('.receipt-amount').value) })).filter(r=>r.cents>0);
    if(!targetCents||!receipts.length)return showEmpty();
    try {
      const best=findBest(receipts,targetCents), chosen=best.items.map(i=>receipts[i]), difference=best.total-targetCents;
      elements.resultTitle.textContent=difference===0?'Exact match found':'Best available match';
      elements.resultAmount.textContent=format(best.total);
      elements.difference.textContent=difference===0?'This selection matches your requested amount exactly.':`${difference>0?'Over':'Under'} by ${format(Math.abs(difference))}.`;
      elements.keptReceipts.innerHTML=chosen.map(r=>`<span class="chip">${r.label} · ${format(r.cents)}</span>`).join('');
      elements.adminContent.innerHTML=`<p><strong>Selection:</strong> ${chosen.map(r=>r.label).join(' + ')} = <strong>${format(best.total)}</strong></p><ul><li>Target: ${format(targetCents)}</li><li>Difference: ${difference===0?'Exact':format(Math.abs(difference))+(difference>0?' over':' under')}</li><li>Rule: closest total, then larger total, then fewer receipts.</li></ul>`;
    } catch(error) { alert(error.message); }
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

  return {
    async loadForUser(user) {
      currentUser = user;
      const receipts = await receiptService.loadReceipts();
      elements.list.innerHTML = '';
      receipts.forEach(addReceipt);
      showEmpty();
    },
    clearForLogout() { currentUser = undefined; elements.list.innerHTML = ''; elements.target.value = ''; refreshReceiptIds(); showEmpty(); },
    importLegacyDraft,
    start() {
      elements.addReceipt.addEventListener('click', () => addReceipt());
      elements.calculate.addEventListener('click', calculate);
      elements.saveDraft.addEventListener('click', saveDraft);
      elements.loadDraft.addEventListener('click', async () => {
        if (!currentUser) return alert('Please sign in before importing a local draft.');
        try { await importLegacyDraft(currentUser); } catch (error) { alert(`Could not import the local draft: ${error.message}`); }
      });
      elements.clearAll.addEventListener('click', () => { elements.target.value=''; elements.list.innerHTML=''; refreshReceiptIds(); showEmpty(); });
      refreshReceiptIds();
      showEmpty();
    }
  };
}
