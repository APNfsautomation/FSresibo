export const monthlyFilingProfileSnapshot = profile => ({ sharedStoreId: profile.id, store: profile.storeName, address: profile.address || '', tin: profile.tin || '', vat: profile.vat || '' });
export const clearsSharedStoreAssociation = (before, after) => ['store', 'address', 'tin'].some(key => String(before[key] || '').trim() !== String(after[key] || '').trim());
export const monthlyFilingIsReadOnly = receipt => receipt.status === 'archived';

export function createMonthlyFilingUi({ elements, monthlyFilingService, sharedStoreService, confirmAction = async () => false }) {
  let currentUser;
  let records = [];
  let profiles = [];
  let loading = false;
  const feedback = text => { elements.feedback.textContent = text || ''; };
  const values = row => Object.fromEntries(['store', 'address', 'tin', 'vat', 'amount', 'receiptDate', 'invoice'].map(key => [key, row.querySelector(`.monthly-${key}`).value]));
  const render = () => {
    elements.list.replaceChildren();
    if (!records.length) { const empty = document.createElement('p'); empty.className = 'monthly-empty'; empty.textContent = 'No Monthly Filing receipts yet. Add one to begin.'; elements.list.append(empty); return; }
    records.forEach(record => {
      const row = elements.template.content.firstElementChild.cloneNode(true);
      row.dataset.monthlyId = record.dbId || '';
      row.dataset.sharedStoreId = record.sharedStoreId || '';
      row.dataset.status = record.status;
      Object.entries(record).forEach(([key, value]) => { const field = row.querySelector(`.monthly-${key}`); if (field) field.value = value || ''; });
      const archived = monthlyFilingIsReadOnly(record);
      row.querySelector('.monthly-status').textContent = archived ? 'Archived' : 'Active';
      row.querySelector('.monthly-status').hidden = !archived;
      row.querySelectorAll('input, select').forEach(field => { field.disabled = archived; });
      row.querySelector('.monthly-delete').hidden = archived;
      const store = row.querySelector('.monthly-store');
      const suggestions = row.querySelector('.monthly-suggestions');
      const showSuggestions = () => {
        const query = store.value.trim().toLowerCase();
        suggestions.replaceChildren();
        if (!query || archived) return suggestions.hidden = true;
        profiles.filter(profile => profile.storeName.toLowerCase().includes(query)).slice(0, 6).forEach(profile => { const option = document.createElement('button'); option.type = 'button'; option.textContent = [profile.storeName, profile.address, profile.tin].filter(Boolean).join(' · '); option.addEventListener('click', () => { const snapshot = monthlyFilingProfileSnapshot(profile); Object.entries(snapshot).forEach(([key, value]) => { if (key === 'sharedStoreId') row.dataset.sharedStoreId = value; else row.querySelector(`.monthly-${key}`).value = value; }); suggestions.hidden = true; }); suggestions.append(option); });
        suggestions.hidden = !suggestions.children.length;
      };
      store.addEventListener('input', showSuggestions);
      ['store', 'address', 'tin'].forEach(key => row.querySelector(`.monthly-${key}`).addEventListener('input', () => { if (row.dataset.sharedStoreId) row.dataset.sharedStoreId = ''; }));
      row.querySelector('.monthly-delete').addEventListener('click', async event => {
        if (!record.dbId || archived || !await confirmAction({ title: 'Delete Monthly Filing receipt?', message: 'This removes this receipt from Monthly Filing only.', confirmLabel: 'Delete Receipt', cancelLabel: 'Cancel', danger: true, trigger: event.currentTarget })) return;
        try { await monthlyFilingService.deleteMonthlyFilingReceipt(record.dbId); records = records.filter(item => item.dbId !== record.dbId); render(); feedback('Monthly Filing receipt deleted.'); } catch (error) { feedback(`Could not delete Monthly Filing receipt: ${error.message}`); }
      });
      elements.list.append(row);
    });
  };
  const add = () => { records.push({ dbId: '', sharedStoreId: '', store: '', address: '', tin: '', vat: '', amount: '', receiptDate: '', invoice: '', status: 'active' }); render(); };
  const save = async () => {
    if (loading || !currentUser) return;
    loading = true; elements.save.disabled = true;
    try {
      const rows = [...elements.list.children].filter(row => row.matches('.monthly-card') && row.dataset.status !== 'archived');
      for (const row of rows) { const receipt = { ...values(row), sharedStoreId: row.dataset.sharedStoreId || '' }; const saved = row.dataset.monthlyId ? await monthlyFilingService.updateMonthlyFilingReceipt(row.dataset.monthlyId, receipt, currentUser.id) : await monthlyFilingService.createMonthlyFilingReceipt(receipt, currentUser.id); const index = records.findIndex(item => item.dbId === row.dataset.monthlyId); if (index >= 0) records[index] = saved; else records.push(saved); }
      records = records.filter(record => record.dbId); render(); feedback('Monthly Filing changes saved.');
    } catch (error) { feedback(`Could not save Monthly Filing changes: ${error.message}`); } finally { loading = false; elements.save.disabled = false; }
  };
  return {
    async loadForUser(user) { currentUser = user; feedback('Loading Monthly Filing…'); try { records = await monthlyFilingService.loadMonthlyFilingReceipts(); } catch (error) { records = []; feedback(`Could not load Monthly Filing receipts: ${error.message}`); } try { profiles = await sharedStoreService.listActiveSharedStores(); if (!elements.feedback.textContent.startsWith('Could not')) feedback(''); } catch { profiles = []; feedback('Company Directory is temporarily unavailable. You can still enter store details manually.'); } render(); },
    clearForLogout() { currentUser = undefined; records = []; profiles = []; feedback(''); render(); },
    setVisible(visible) { elements.workspace.hidden = !visible; },
    start() { elements.add.addEventListener('click', add); elements.save.addEventListener('click', save); render(); }
  };
}
