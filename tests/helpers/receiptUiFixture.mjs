// Behavioral fixture: the real createReceiptUi driven against a minimal fake DOM and an in-memory receipts database (CP10-C3E-1).
import { createReceiptUi } from '../../ui/receiptUi.js';
import { findBest, optimizationStrategies } from '../../services/optimizationService.js';
import { parseMoneyAmount } from '../../domain/moneyAmount.js';

export const storage = new Map();
globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.Option = class { constructor(label, value) { this.label = label; this.value = value; } };

export const settle = () => new Promise(resolve => setTimeout(resolve, 5));
export async function receiptFixture({ loaded = [], confirm = async () => true, modalFocus = null } = {}) {
  storage.clear(); // toolbar filters are kept in session storage per user: every fixture starts from a clean browser session
  globalThis.window = { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = callback => { callback(); return 0; };
  const state = { activeElement: null }; const focusLog = [];
  const node = (extra = {}) => {
    const self = {
      hidden: false, value: '', disabled: false, textContent: '', title: '', dataset: {}, style: {}, getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0, left: 0, right: 0 }), children: [], files: [], open: false, listeners: {}, attrs: {},
      classList: { classes: new Set(), add(name) { this.classes.add(name); }, remove(...names) { names.forEach(name => this.classes.delete(name)); }, toggle(name, on) { on ? this.classes.add(name) : this.classes.delete(name); }, contains(name) { return this.classes.has(name); } },
      addEventListener(name, listener) { (self.listeners[name] ??= []).push(listener); },
      emit(name, event = {}) { return Promise.all((self.listeners[name] ?? []).map(listener => listener({ currentTarget: self, target: self, preventDefault() {}, ...event }))); },
      setAttribute(name, value) { self.attrs[name] = String(value); }, getAttribute: name => self.attrs[name] ?? null, removeAttribute(name) { delete self.attrs[name]; },
      append(...nodes) { self.children.push(...nodes); }, replaceChildren(...nodes) { self.children = nodes; },
      focus(options) { focusLog.push(self); state.activeElement = self; }, scrollIntoView() {}, closest: () => null, contains: () => false, querySelectorAll: () => [], querySelector: () => null,
      ...extra
    };
    return self;
  };
  const fieldSelectors = ['.receipt-amount', '.receipt-receiptDate', '.receipt-vat', '.receipt-invoice', '.receipt-store', '.receipt-address', '.receipt-tin', '.receipt-photo'];
  const makeRow = () => {
    const parts = new Map();
    const part = selector => { if (!parts.has(selector)) parts.set(selector, node({ value: '', files: [] })); return parts.get(selector); };
    return node({ open: false, querySelector: part, querySelectorAll: selector => selector === 'input, select' ? fieldSelectors.map(part) : [], part });
  };
  globalThis.document = { createDocumentFragment: () => ({ children: [], append(...nodes) { this.children.push(...nodes); } }), createElement: () => node({ className: '' }), addEventListener() {}, get activeElement() { return state.activeElement; } };
  const list = node({ append(row) { list.children.push(row); }, replaceChildren(...rows) { list.children = rows; } });
  const overrides = {
    list, template: { content: { firstElementChild: { cloneNode: () => makeRow() } } }, optimizationTemplate: { content: { firstElementChild: { cloneNode: () => makeRow() } } },
    receiptStatusFilter: node({ value: 'available' }), optimizationSort: node({ value: 'default' }), optimizationStrategy: node({ value: optimizationStrategies.closest }), encodingAmountCompartment: node({ value: 'all' })
  };
  const elements = new Proxy(overrides, { get: (target, key) => key in target ? target[key] : (target[key] = node()) });
  const calls = { create: [], update: [], consume: [], download: [], snapshot: [] }; let sequence = 0; let clock = 0;
  // An in-memory receipts table. Tests change `db` directly to simulate another session, and set `fails.*` to inject failures.
  const stamp = () => `2026-10-18T00:00:${String(++clock).padStart(2, '0')}Z`;
  const db = new Map(loaded.map(item => [item.dbId, { amount: '', receiptDate: '', vat: '', invoice: '', store: '', address: '', tin: '', status: 'available', ...item, updatedAt: item.updatedAt ?? stamp() }]));
  const fails = { snapshot: null, consume: null, download: null, afterDownload: null, consumeResponseLost: null, gate: null, save: null };
  const copy = row => ({ ...row });
  const storedAmount = raw => { const parsed = parseMoneyAmount(raw); return parsed.blank ? '' : parsed.valid ? parsed.amount : raw; };
  const receiptService = {
    loadReceipts: async () => [...db.values()].map(copy),
    loadReceiptsByIds: async ids => { calls.snapshot.push([...ids]); if (fails.snapshot) throw fails.snapshot; return ids.filter(id => db.has(id)).map(id => copy(db.get(id))); },
    updateReceiptStatus: async (id, status) => { const row = { ...db.get(id), status, updatedAt: stamp() }; db.set(id, row); return copy(row); },
    createReceipt: async values => { calls.create.push({ ...values }); if (fails.save) throw fails.save; const row = { ...values, amount: storedAmount(values.amount), dbId: `new-${++sequence}`, status: 'available', updatedAt: stamp() }; db.set(row.dbId, row); return copy(row); },
    updateReceipt: async (id, values) => { calls.update.push([id, { ...values }]); if (fails.save) throw fails.save; const row = { ...db.get(id), ...values, amount: storedAmount(values.amount), dbId: id, status: 'available', updatedAt: stamp() }; db.set(id, row); return copy(row); },
    consumeReceipts: async ids => {
      calls.consume.push([...ids]);
      if (fails.gate) await fails.gate;
      if (fails.consume) throw fails.consume;
      if (ids.some(id => db.get(id)?.status !== 'available')) throw new Error('One or more selected receipts are no longer available. Refresh and review the result before exporting again.');
      const updated = ids.map(id => { const row = { ...db.get(id), status: 'consumed', updatedAt: stamp() }; db.set(id, row); return copy(row); });
      if (fails.consumeResponseLost) throw fails.consumeResponseLost; // the update was committed, the answer never arrived
      return updated;
    }
  };
  elements.exportConfirmModal.hidden = true; elements.editModal.hidden = true;
  const ui = createReceiptUi({ elements, findBest, optimizationStrategies, toCents: value => Math.round(Number(String(value || 0).replace(/[^0-9.]/g, '')) * 100), scanPrintedDetails: async () => ({}), downloadSelectedReceipts: receipts => { if (fails.download) throw fails.download; calls.download.push(receipts.map(item => ({ ...item }))); fails.afterDownload?.(); }, receiptService, sharedStoreService: { listActiveSharedStores: async () => [] }, confirmAction: confirm, modalFocus });
  ui.start(); await ui.loadForUser({ id: 'user-1' });
  const rows = () => list.children;
  const field = (row, name) => row.part(`.receipt-${name}`);
  const type = (row, name, value) => { const input = field(row, name); input.value = value; return input.emit('input'); };
  const click = async target => { await target.emit('click'); await settle(); };
  const cards = () => elements.optimizationList.children[0]?.children ?? [];
  return { elements, ui, rows, field, type, click, calls, focusLog, db, fails, stamp, list, cards };
}
