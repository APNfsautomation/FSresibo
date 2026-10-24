// Behavioral fixture: the real createMonthlyFilingUi driven against a minimal fake DOM and an in-memory monthly_filing_receipts table (CP10-C3E-5).
// It mirrors the fixture inside monthlyFilingWorkspace.test.mjs, but exposes the table and injectable gates so cross-session behavior can be exercised.
import { createMonthlyFilingUi } from '../../ui/monthlyFilingUi.js';
import { normalizeMoneyAmount } from '../../domain/moneyAmount.js';

export const savedMonthly = (id, extra = {}) => ({ dbId: id, sharedStoreId: '', store: `Store ${id}`, address: '', tin: '', vat: '', amount: '100.00', receiptDate: '', invoice: '', status: 'active', persistedStoreFingerprint: '', ...extra });

export function monthlyFixture({ records = [], confirm = async () => true, sharedStoreService = { listActiveSharedStores: async () => [] } } = {}) {
  const state = { activeElement: null }; const focusLog = [];
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = callback => { callback(); return 0; };
  const node = (extra = {}) => {
    const children = new Map();
    const self = {
      hidden: false, value: '', disabled: false, textContent: '', title: '', id: '', className: '', dataset: {}, attrs: {}, listeners: {}, kids: [], tabIndex: 0, get children() { return this.kids; },
      classList: { classes: new Set(), add(name) { this.classes.add(name); }, remove(name) { this.classes.delete(name); }, toggle(name, on) { on ? this.classes.add(name) : this.classes.delete(name); }, contains(name) { return this.classes.has(name); } },
      addEventListener(name, listener) { (self.listeners[name] ??= []).push(listener); },
      emit(name, event = {}) { return Promise.all((self.listeners[name] ?? []).map(listener => listener({ currentTarget: self, target: self, preventDefault() {}, ...event }))); },
      setAttribute(name, value) { self.attrs[name] = String(value); }, getAttribute: name => self.attrs[name] ?? null, removeAttribute(name) { delete self.attrs[name]; },
      append(...nodes) { self.kids.push(...nodes); }, replaceChildren(...nodes) { self.kids = nodes; },
      focus() { state.activeElement = self; focusLog.push(self); }, scrollIntoView() {},
      querySelector(selector) { if (!children.has(selector)) children.set(selector, node()); return children.get(selector); },
      querySelectorAll: () => [], matches: () => false, getClientRects: () => [{}], contains: () => false, closest: () => null,
      ...extra
    };
    return self;
  };
  globalThis.document = { createElement: () => node(), get activeElement() { return state.activeElement; }, body: node() };
  const list = node({ append(row) { list.kids.push(row); }, replaceChildren(...rows) { list.kids = rows; } });
  Object.defineProperty(list, 'children', { get: () => list.kids });
  const fieldKeys = ['store', 'address', 'tin', 'vat', 'amount', 'receiptDate', 'invoice'];
  const makeRow = () => {
    const row = node({ matches: selector => selector === '.monthly-card' });
    row.querySelectorAll = selector => selector === 'input, select' ? fieldKeys.map(key => row.querySelector(`.monthly-${key}`)) : [];
    return row;
  };
  const elements = { workspace: node(), list, template: { content: { firstElementChild: { cloneNode: () => makeRow() } } }, activeTab: node(), archivedTab: node(), activeActions: node(), archivedActions: node(), exportHelper: node(), add: node(), save: node(), exportActive: node(), clearArchived: node(), clearAll: node(), feedback: node(), unsavedNote: node(), activeTotal: node(), activeTotalMain: node(), activeTotalDetail: node() };
  const table = new Map(records.map(record => [record.dbId, { ...record }]));
  const calls = { create: [], update: [], archive: [], workbook: [], load: 0, remove: [], returned: [], clearArchived: [], clearAll: [], associate: [], writes: [] };
  // A gate is a promise the service awaits before answering: a test holds it to model a slow or never-answered request, then settles it.
  const gates = { create: null, update: null, load: null, archive: null, remove: null, returnToActive: null, clearArchived: null, clearAll: null, associate: null };
  let sequence = 0;
  const stored = (receipt, dbId, status) => ({ ...receipt, amount: String(normalizeMoneyAmount(receipt.amount) ?? ''), dbId, status });
  const service = {
    loadMonthlyFilingReceipts: async () => { calls.load += 1; const snapshot = [...table.values()].map(record => ({ ...record })); if (gates.load) await gates.load; return snapshot; },
    createMonthlyFilingReceipt: async (receipt, userId) => { calls.create.push({ ...receipt }); calls.writes.push({ op: 'create', userId }); if (gates.create) await gates.create; const row = stored(receipt, `new-${++sequence}`, 'active'); table.set(row.dbId, row); return { ...row }; },
    updateMonthlyFilingReceipt: async (id, receipt, userId) => { calls.update.push([id, { ...receipt }]); calls.writes.push({ op: 'update', userId }); if (gates.update) await gates.update; const row = stored(receipt, id, 'active'); table.set(id, row); return { ...row }; },
    deleteMonthlyFilingReceipt: async id => { calls.remove.push(id); if (gates.remove) await gates.remove; table.delete(id); },
    archiveMonthlyFilingReceipts: async ids => { calls.archive.push([...ids]); if (gates.archive) await gates.archive; return ids.map(id => { const row = { ...table.get(id), status: 'archived' }; table.set(id, row); return { ...row }; }); },
    returnMonthlyFilingReceiptToActive: async id => { calls.returned.push(id); if (gates.returnToActive) await gates.returnToActive; const row = { ...table.get(id), status: 'active' }; table.set(id, row); return { ...row }; },
    clearArchivedMonthlyFilingReceipts: async (userId, ids) => { calls.clearArchived.push({ userId, ids: [...ids] }); if (gates.clearArchived) await gates.clearArchived; ids.forEach(id => table.delete(id)); return [...ids]; },
    clearMonthlyFilingReceipts: async userId => { calls.clearAll.push(userId); if (gates.clearAll) await gates.clearAll; table.clear(); },
    associateMonthlyFilingSharedStore: async (id, storeId) => { calls.associate.push([id, storeId]); if (gates.associate) await gates.associate; const row = { ...table.get(id), sharedStoreId: storeId }; table.set(id, row); return { ...row }; }
  };
  const ui = createMonthlyFilingUi({
    elements, monthlyFilingService: service, sharedStoreService,
    downloadExpenseDetailedReport: snapshot => { calls.workbook.push(snapshot.map(record => ({ ...record }))); },
    confirmAction: async options => confirm(options)
  });
  ui.start();
  const cards = () => list.kids.filter(kid => kid.matches('.monthly-card'));
  const field = (card, key) => card.querySelector(`.monthly-${key}`);
  const edit = (card, key, value) => { const input = field(card, key); input.value = value; return input.emit('input'); };
  const click = async target => { await target.emit('click', { currentTarget: target }); await new Promise(resolve => setTimeout(resolve, 5)); };
  return { ui, elements, calls, gates, table, cards, field, edit, click, focusLog, state };
}
