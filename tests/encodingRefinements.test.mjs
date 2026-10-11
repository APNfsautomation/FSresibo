import nodeAssert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { findBest, optimizationStrategies } from '../services/optimizationService.js';
import { createReceiptUi } from '../ui/receiptUi.js';
import { outsideRangeNotice, receiptHasUnsavedChanges, releasedHiddenNotice } from '../ui/encodingPresentation.js';
import { receiptSummaryAccessibleName } from '../ui/receiptAccessibility.js';

// match/doesNotMatch report the pattern, not the whole stylesheet, when they fail.
const assert = { ...nodeAssert, match: (text, pattern, message) => nodeAssert.ok(pattern.test(text), message ?? `expected a match for ${pattern}`), doesNotMatch: (text, pattern, message) => nodeAssert.ok(!pattern.test(text), message ?? `expected no match for ${pattern}`) };
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const html = await read('../index.html');
const staticHtml = html.replace(/<template[\s\S]*?<\/template>/g, '');
const receiptTemplate = html.match(/<template id="receiptTemplate">([\s\S]*?)<\/template>/)[1];
const monthlyTemplate = html.match(/<template id="monthlyFilingReceiptTemplate">([\s\S]*?)<\/template>/)[1];
const css = (await read('../styles.css')).replace(/\r\n/g, '\n');
const count = (text, pattern) => (text.match(pattern) ?? []).length;
const encoding = staticHtml.slice(staticHtml.indexOf('id="encodingWorkspace"'), staticHtml.indexOf('id="optimizationWorkspace"'));

// ---- UI-03 labels ----------------------------------------------------------------------------------------------------------------------------
test('user-facing labels are "My Receipts", "My Receipt Encoding" and "My Receipt Optimization"; identifiers and routes are unchanged', async () => {
  assert.match(staticHtml, /<button class="navigation-item" id="receiptsNavigationItem" type="button" aria-current="page">My Receipts<\/button>/);
  assert.match(staticHtml, /<h1>My Receipt Encoding<\/h1>/); assert.match(staticHtml, /<h1>My Receipt Optimization<\/h1>/);
  assert.doesNotMatch(staticHtml, /<h1>Receipt (Encoding|Optimization)<\/h1>/);
  for (const id of ['receiptsNavigationItem', 'encodingTab', 'optimizationTab', 'encodingWorkspace', 'optimizationWorkspace']) assert.equal(count(staticHtml, new RegExp(`id="${id}"`, 'g')), 1);
  const navigation = await read('../ui/navigationController.js');
  assert.match(navigation, /encoding: 'receipts\/encoding',\s+optimization: 'receipts\/optimization'/, 'route keys are untouched');
});

// ---- markup contracts -------------------------------------------------------------------------------------------------------------------------
test('the Available summary card shows only the saved total and the saved count (the unsaved explanation moved to the Save controls)', () => {
  const card = encoding.slice(encoding.indexOf('class="available-summary"'), encoding.indexOf('class="encoding-compartment-filter"'));
  assert.match(card, /<p class="summary-value" id="availableTotal">₱0\.00<\/p>/); assert.match(card, /<p class="summary-value" id="availableCount">0<\/p>/);
  assert.equal(count(card, /class="summary-metric"/g), 2, 'exactly two metrics');
  assert.doesNotMatch(card, /lowest|highest|minimum|maximum|average/i, 'no lowest/highest amounts');
  assert.doesNotMatch(card, /summary-note|availableSummaryNote|Unsaved changes|not included/i, 'the unsaved explanation lives with the Save controls, not in the card');
  assert.equal(count(card, /<svg class="summary-icon"[^>]*aria-hidden="true"/g), 2, 'decorative inline icons, no dependency');
  assert.doesNotMatch(html, /fontawesome|material-icons|<img[^>]*icon/i);
  const ids = [...staticHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), [], 'no duplicate IDs');
});

test('the out-of-range notice is a status region with an icon, an explanation and an explicit Show all amounts action', () => {
  assert.match(encoding, /<div class="filter-notice" id="encodingFilterNotice" role="status" hidden><svg class="notice-icon"[^>]*aria-hidden="true">[\s\S]*<\/svg><p id="encodingFilterNoticeText"><\/p><button class="secondary" id="showAllAmounts" type="button">Show all amounts<\/button><\/div>/);
  assert.ok(encoding.indexOf('id="encodingFilterNotice"') < encoding.indexOf('id="receiptList"'), 'the notice sits above the list');
});

test('Expand all and Collapse all are real buttons in the list header; chevrons are inline SVG in an outlined control', () => {
  assert.match(encoding, /<button class="ghost list-tool" id="expandAllReceipts" type="button"><svg[^>]*aria-hidden="true">[\s\S]*?<\/svg><span>Expand all<\/span><\/button>/);
  assert.match(encoding, /<button class="ghost list-tool" id="collapseAllReceipts" type="button"><svg[^>]*aria-hidden="true">[\s\S]*?<\/svg><span>Collapse all<\/span><\/button>/);
  assert.match(receiptTemplate, /<span class="summary-toggle" aria-hidden="true"><span class="toggle-label">Details<\/span><svg class="toggle-icon" viewBox="0 0 16 16"/);
  assert.doesNotMatch(receiptTemplate, /⌄/); assert.doesNotMatch(monthlyTemplate, /⌄/);
  assert.match(monthlyTemplate, /<span class="monthly-summary-chevron" aria-hidden="true"><svg class="chevron-icon"/, 'Monthly Filing gets the same decorative icon only');
  assert.match(receiptTemplate, /<summary class="receipt-summary"/, 'the control stays the native summary: expanded state, Enter/Space and focus are built in');
  assert.match(receiptTemplate, /<span class="receipt-range-flag" hidden>Outside range<\/span>/, 'the out-of-range state is text, not colour alone');
});

test('Monthly Filing numbering, totals, export and lifecycle markup were not touched', () => {
  assert.match(monthlyTemplate, /<span class="monthly-summary-id">Receipt 1<\/span>/);
  assert.match(html, /id="monthlyFilingExportActive"/); assert.doesNotMatch(html, /monthlyActiveTotal/);
});

// ---- CSS ---------------------------------------------------------------------------------------------------------------------------------------
test('the one action bar is sticky-top on tall desktop and tablet windows, keeps focused fields clear, and is static on short viewports and zoom', () => {
  assert.ok(css.includes('@media (min-width: 641px) and (min-height: 480px) {\n  #encodingActions { position: sticky; top: var(--space-2); z-index: 12;'));
  assert.ok(css.includes('html:has(#encodingWorkspace:not([hidden])) { scroll-padding-top: 140px; }'), 'focused fields are scrolled clear of the sticky bar');
  assert.ok(css.includes('@media (min-width: 641px) and (max-width: 980px) and (min-height: 480px) {\n  #encodingActions { top: calc(var(--topbar-height) + var(--space-2)); }'), 'on tablets it sits below the fixed top bar');
  assert.match(css, /#encodingActions \.workflow-feedback \{ max-height: 4\.5em; overflow-y: auto; \}/, 'long feedback cannot take over the screen');
  assert.ok(css.includes('@media (max-width: 640px) and (max-height: 479px) {\n  .encoding-workspace > #encodingActions, .encoding-workspace.is-editing > #encodingActions:not(:focus-within) { position: static; opacity: 1; pointer-events: auto; transform: none; box-shadow: none; }'), 'phone bar is static below 480px tall (400% zoom, landscape)');
  assert.equal(count(staticHtml, /id="saveDraft"/g), 1); assert.equal(count(staticHtml, /id="floatingAddReceipt"/g), 1);
  const drawerZ = Number(css.match(/\.application-navigation \{ position: fixed; z-index: (\d+)/)[1]);
  assert.ok(12 < drawerZ);
  assert.ok(css.indexOf('@media (max-width: 640px) and (max-height: 479px)') > css.indexOf('.encoding-workspace > #encodingActions { order: 6;'), 'the short-viewport rule comes after the phone rule so it wins');
});

test('zoom budgets: 200% of a 1440×900 window is 720×450 and 400% of 1280×800 is 320×200 CSS pixels — both fall below the sticky threshold', () => {
  const thresholds = { stickyMinHeight: 480 };
  assert.ok(450 < thresholds.stickyMinHeight && 200 < thresholds.stickyMinHeight);
  assert.ok(css.includes('(min-width: 641px) and (min-height: 480px)'));
});

test('summary card, notice, flag and chevron use semantic tokens only (Light and Dark come from the theme)', () => {
  const start = css.indexOf('/* Saved-data summary card'); const block = css.slice(start, css.indexOf('.encoding-compartment-filter {', start));
  const notice = css.slice(css.indexOf('/* Edit pins:'), css.indexOf('.encoding-list .receipt-card.is-outside-range'));
  const chevron = css.slice(css.indexOf('.summary-toggle {'), css.indexOf('.receipt-card[open] .summary-toggle'));
  for (const part of [block, notice, chevron]) { assert.doesNotMatch(part, /#[0-9a-fA-F]{3,8}\b/, 'no raw colours'); assert.doesNotMatch(part, /!important/); }
  assert.match(block, /\.available-summary \{[^}]*padding: 0; border: 0; background: none;/, 'unboxed: no fill, border or container padding');
  assert.doesNotMatch(block, /box-shadow|border-left|success/, 'no shadow, accent border or green');
  assert.match(block, /\.summary-icon \{[^}]*color: var\(--primary\)/);
  assert.match(notice, /\.filter-notice \{[^}]*border-left: 4px solid var\(--warning\)[^}]*background: var\(--warning-soft\)/);
  assert.match(css, /\.encoding-list \.receipt-card\.is-outside-range\[open\] \{ border-color: var\(--warning\); box-shadow: inset 4px 0 0 var\(--warning\); \}/);
  assert.match(css, /\.summary-toggle \{[^}]*width: 32px; height: 32px; border: var\(--border-width\) solid var\(--border-strong\)[^}]*border-radius: var\(--radius-sm\)/, 'outlined 32px icon button');
  assert.match(css, /\.receipt-card\[open\] \.toggle-icon \{ transform: rotate\(180deg\); \}/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \* \{ transition: none !important; \}/, 'the chevron rotation is not animated for reduced motion');
});

test('the editor is one grid in reading order: 12 columns on desktop, two on tablets, Store and Address full width on phones', () => {
  assert.match(css, /\.encoding-list \.receipt-editor-fields \{ grid-template-columns: repeat\(12, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.receipt-editor-fields \.scan-label \{ align-self: end; \}/);
  assert.match(css, /@media \(max-width: 1100px\) \{\n  \.encoding-list \.receipt-editor-fields \.field-store[^\n]*grid-column: span 6; \}/);
  const phone = css.slice(css.indexOf('@media (max-width: 640px) {\n  .receipts-bar'));
  assert.match(phone, /\.encoding-workspace-tools \{ flex-direction: column; align-items: stretch; \}/);
  assert.match(phone, /\.list-tool \{ min-height: 44px; \}/);
  assert.match(phone, /\.filter-notice button \{ width: 100%; min-height: 44px; \}/);
});

// ---- pure helpers ----------------------------------------------------------------------------------------------------------------------------
test('pending-change detection compares exact centavos and never counts blank new receipts', () => {
  const saved = { amount: 1250.5, store: 'A', address: '', tin: '', vat: '', invoice: '', receiptDate: '' };
  const typed = overrides => ({ amount: '1250.50', store: 'A', address: '', tin: '', vat: '', invoice: '', receiptDate: '', ...overrides });
  assert.equal(receiptHasUnsavedChanges(typed(), saved), false);
  assert.equal(receiptHasUnsavedChanges(typed({ amount: '1,250.50' }), saved), false, 'same amount, different formatting');
  assert.equal(receiptHasUnsavedChanges(typed({ amount: '1250.51' }), saved), true);
  assert.equal(receiptHasUnsavedChanges(typed({ amount: '' }), saved), true); assert.equal(receiptHasUnsavedChanges(typed({ store: 'B' }), saved), true);
  assert.equal(receiptHasUnsavedChanges(typed({ amount: '12,34.50' }), saved), true, 'a malformed amount is a pending change');
  assert.equal(receiptHasUnsavedChanges(typed({ amount: '' }), { ...saved, amount: '' }), false);
  assert.equal(receiptHasUnsavedChanges({ amount: '', store: '', address: '', tin: '', vat: '', invoice: '', receiptDate: '' }, undefined), false);
  assert.equal(receiptHasUnsavedChanges(typed(), undefined), true);
});

test('notice wording and the accessible summary name include the out-of-range state', () => {
  assert.equal(outsideRangeNotice(['3'], 'Below ₱200'), 'Receipt 3 is outside the selected amount range (Below ₱200) and stays visible only while you edit it.');
  assert.equal(outsideRangeNotice(['3', '5'], '₱500–599'), '2 receipts are outside the selected amount range (₱500–599) and stay visible only while you edit them.');
  assert.equal(releasedHiddenNotice([]), ''); assert.match(releasedHiddenNotice(['4']), /^Receipt 4 is outside the selected amount range and is now hidden\./);
  assert.equal(receiptSummaryAccessibleName({ id: 3, store: 'Shell', amountCents: 30000, outsideRange: true, open: true }), 'Receipt 3, Shell, 300.00 pesos, outside the selected amount range, collapse details');
  assert.equal(receiptSummaryAccessibleName({ id: 3, store: 'Shell', amountCents: 30000 }), 'Receipt 3, Shell, 300.00 pesos, show details');
});

// ---- behaviour: the real receipt UI against a DOM fixture ---------------------------------------------------------------------------------------
const storage = new Map();
globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.Option = class { constructor(label, value) { this.label = label; this.value = value; } };
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

async function fixture({ loaded = [], confirm = async () => true, deleteConsumed, failUpdate = () => false } = {}) {
  globalThis.window = { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = callback => { callback(); return 0; };
  storage.clear();   // every test starts without remembered filters
  const state = { activeElement: null }; const focusLog = [];
  const node = (extra = {}) => {
    const self = {
      hidden: false, value: '', disabled: false, textContent: '', title: '', dataset: {}, children: [], files: [], open: false, listeners: {}, attrs: {},
      classList: { classes: new Set(), add(name) { this.classes.add(name); }, remove(name) { this.classes.delete(name); }, toggle(name, on) { on ? this.classes.add(name) : this.classes.delete(name); }, contains(name) { return this.classes.has(name); } },
      addEventListener(name, listener) { (self.listeners[name] ??= []).push(listener); },
      emit(name, event = {}) { return Promise.all((self.listeners[name] ?? []).map(listener => listener({ currentTarget: self, target: self, preventDefault() {}, ...event }))); },
      setAttribute(name, value) { self.attrs[name] = String(value); }, getAttribute: name => self.attrs[name] ?? null, removeAttribute(name) { delete self.attrs[name]; },
      append(...nodes) { self.children.push(...nodes); }, replaceChildren(...nodes) { self.children = nodes; },
      focus() { focusLog.push(self); state.activeElement = self; }, scrollIntoView() {}, closest: () => null, contains: () => false, querySelectorAll: () => [], querySelector: () => null,
      ...extra
    };
    return self;
  };
  const fieldSelectors = ['.receipt-amount', '.receipt-receiptDate', '.receipt-vat', '.receipt-invoice', '.receipt-store', '.receipt-address', '.receipt-tin', '.receipt-photo'];
  const makeRow = () => {
    const parts = new Map();
    const part = selector => { if (!parts.has(selector)) parts.set(selector, node({ value: '', files: [] })); return parts.get(selector); };
    const row = node({ open: false, querySelector: part, querySelectorAll: selector => selector === 'input, select' ? fieldSelectors.map(part) : [], part, remove() { list.children = list.children.filter(item => item !== row); } });
    return row;
  };
  globalThis.document = { createDocumentFragment: () => ({ append() {} }), createElement: () => node({ className: '' }), addEventListener() {}, get activeElement() { return state.activeElement; } };
  const list = node({ append(row) { list.children.push(row); }, replaceChildren(...rows) { list.children = rows; } });
  const overrides = {
    list, template: { content: { firstElementChild: { cloneNode: () => makeRow() } } }, optimizationTemplate: { content: { firstElementChild: { cloneNode: () => makeRow() } } },
    receiptStatusFilter: node({ value: 'available' }), optimizationSort: node({ value: 'default' }), optimizationStrategy: node({ value: optimizationStrategies.closest }), encodingAmountCompartment: node({ value: 'all' })
  };
  const elements = new Proxy(overrides, { get: (target, key) => key in target ? target[key] : (target[key] = node()) });
  const calls = { create: [], update: [], delete: [], deleteConsumed: [], confirmations: [] }; let sequence = 0;
  const receiptService = {
    loadReceipts: async () => loaded.map(item => ({ status: 'available', ...item })),
    createReceipt: async values => { calls.create.push({ ...values }); return { ...values, dbId: `new-${++sequence}`, status: 'available', updatedAt: '' }; },
    updateReceipt: async (id, values) => { if (failUpdate(id)) throw new Error('network unavailable'); calls.update.push([id, { ...values }]); return { ...values, dbId: id, status: 'available', updatedAt: '' }; },
    deleteReceipt: async id => { calls.delete.push(id); },
    deleteConsumedReceipt: async id => { calls.deleteConsumed.push(id); if (deleteConsumed) return deleteConsumed(id); }
  };
  const ui = createReceiptUi({ elements, findBest, optimizationStrategies, toCents: value => Math.round(Number(String(value || 0).replace(/[^0-9.]/g, '')) * 100), scanPrintedDetails: async () => ({}), downloadSelectedReceipts() {}, receiptService, sharedStoreService: { listActiveSharedStores: async () => [] }, confirmAction: async options => { calls.confirmations.push(options); return confirm(options); } });
  ui.start(); await ui.loadForUser({ id: 'user-1' });
  const rows = () => list.children;
  const field = (row, name) => row.part(`.receipt-${name}`);
  const type = (row, name, value) => { const input = field(row, name); input.value = value; return input.emit('input'); };
  const click = async target => { await target.emit('click'); await settle(); };
  const range = async value => { elements.encodingAmountCompartment.value = value; await elements.encodingAmountCompartment.emit('change'); };
  const collapse = row => { row.open = false; return row.emit('toggle'); };
  const money = node => node.textContent.replace(/\s/g, '');
  return { elements, ui, rows, field, type, click, range, collapse, money, calls, focusLog };
}
const loaded = [{ dbId: 'a', amount: 100, store: 'Under 200' }, { dbId: 'b', amount: 300, store: 'Three hundred' }, { dbId: 'c', amount: 550, store: 'Five fifty' }, { dbId: 'd', amount: 999, store: 'Consumed one', status: 'consumed' }];
const visibleStores = f => f.rows().filter(row => !row.hidden).map(row => row.part('.summary-store').textContent);

test('receipts that are not being edited follow the amount range exactly as before', async () => {
  const f = await fixture({ loaded });
  await f.range('below-200');
  assert.deepEqual(visibleStores(f), ['Under 200']);
  await f.range('500-599'); assert.deepEqual(visibleStores(f), ['Five fifty']);
  await f.range('all'); assert.deepEqual(visibleStores(f), ['Under 200', 'Three hundred', 'Five fifty'], 'consumed receipts stay hidden by the Available view');
  assert.equal(f.elements.encodingFilterNotice.hidden, true);
});

test('UX-001: a receipt edited under "Below ₱200" stays visible when typing 300, with a warning, and keeps its draft', async () => {
  const f = await fixture({ loaded });
  await f.range('below-200');
  const [row] = f.rows();
  await f.type(row, 'amount', '300');
  assert.equal(row.hidden, false, 'still visible while being edited');
  assert.equal(row.classList.contains('is-outside-range'), true); assert.equal(row.part('.receipt-range-flag').hidden, false);
  assert.equal(f.elements.encodingFilterNotice.hidden, false);
  assert.match(f.elements.encodingFilterNoticeText.textContent, /Receipt 1 is outside the selected amount range \(Below ₱200\)/);
  assert.equal(f.field(row, 'amount').value, '300');
  assert.deepEqual(visibleStores(f), ['Under 200'], 'the other receipts (300 and 550) are still hidden: pins only cover edited receipts');
});

test('a brand-new receipt stays visible while its amount is typed in and out of the range', async () => {
  const f = await fixture();
  await f.range('below-200');
  await f.click(f.elements.floatingAdd);
  const row = f.rows()[0];
  await f.type(row, 'amount', '150'); assert.equal(row.hidden, false); assert.equal(f.elements.encodingFilterNotice.hidden, true, 'in range: no warning');
  await f.type(row, 'amount', '300'); assert.equal(row.hidden, false); assert.equal(f.elements.encodingFilterNotice.hidden, false);
  await f.type(row, 'amount', '1,500'); assert.equal(row.hidden, false);
  await f.type(row, 'amount', '120'); assert.equal(f.elements.encodingFilterNotice.hidden, true, 'back in range: warning clears by itself');
});

test('multiple edited receipts are all pinned and counted in one notice', async () => {
  const f = await fixture({ loaded });
  await f.range('below-200');
  await f.click(f.elements.floatingAdd); await f.type(f.rows().at(-1), 'amount', '400');
  await f.type(f.rows()[0], 'amount', '900');
  assert.deepEqual(visibleStores(f), ['Under 200', 'Store not set']);
  assert.match(f.elements.encodingFilterNoticeText.textContent, /^2 receipts are outside the selected amount range \(Below ₱200\) and stay visible only while you edit them\.$/);
});

test('pins are released by collapsing the receipt, which hides it again and says so', async () => {
  const f = await fixture({ loaded });
  await f.range('below-200');
  const [row] = f.rows(); await f.type(row, 'amount', '300');
  await f.collapse(row);
  assert.equal(row.hidden, true); assert.equal(row.dataset.filterPinned, undefined);
  assert.equal(f.elements.encodingFilterNotice.hidden, true);
  assert.match(f.elements.encodingFeedback.textContent, /^Receipt 1 is outside the selected amount range and is now hidden\./);
  assert.equal(f.field(row, 'amount').value, '300', 'a hidden receipt keeps its draft values');
});

test('collapsing a receipt that is still within the range changes nothing visible', async () => {
  const f = await fixture({ loaded });
  await f.range('below-200');
  const [row] = f.rows(); await f.type(row, 'amount', '120'); await f.collapse(row);
  assert.equal(row.hidden, false); assert.equal(f.elements.encodingFeedback.textContent, '');
});

test('a successful Save releases the pins, tells the user which receipts are now hidden, and sends the drafts', async () => {
  const f = await fixture({ loaded });
  await f.range('below-200');
  const [row] = f.rows(); await f.type(row, 'amount', '300'); await f.type(row, 'store', 'Edited store');
  await f.click(f.elements.saveDraft);
  assert.deepEqual(f.calls.update.map(([id, values]) => [id, values.amount, values.store]).filter(([id]) => id === 'a'), [['a', '300', 'Edited store']]);
  assert.equal(row.hidden, true);
  assert.match(f.elements.encodingFeedback.textContent, /^Receipt changes saved\. Receipt 1 is outside the selected amount range and is now hidden\. Use the Amount range filter to see it\.$/);
  assert.equal(f.field(row, 'amount').value, '300');
});

test('a failed Save keeps the pins and the visible drafts', async () => {
  const f = await fixture({ loaded });
  await f.range('below-200');
  const [row] = f.rows(); await f.type(row, 'amount', '300');
  await f.type(row, 'amount', '30,0');   // malformed: Save is refused
  await f.click(f.elements.saveDraft);
  assert.equal(row.hidden, false); assert.equal(f.calls.update.length, 0);
  assert.notEqual(row.dataset.filterPinned, undefined);
});

test('changing the amount range or the Available/Consumed view releases pins; a pin never overrides the view', async () => {
  const f = await fixture({ loaded });
  await f.range('below-200');
  const [row] = f.rows(); await f.type(row, 'amount', '300');
  await f.range('500-599');
  assert.equal(row.hidden, true, 'an explicit filter change is honoured immediately'); assert.equal(f.elements.encodingFilterNotice.hidden, true);
  await f.range('all'); await f.type(row, 'amount', '310');
  assert.notEqual(row.dataset.filterPinned, undefined);
  f.elements.receiptStatusFilter.value = 'consumed'; await f.elements.receiptStatusFilter.emit('change');
  assert.equal(row.hidden, true, 'pinned or not, an Available receipt is not shown in the Consumed view');
  assert.deepEqual(visibleStores(f), ['Consumed one']); assert.equal(row.dataset.filterPinned, undefined);
});

test('Show all amounts switches the filter to All amounts on the user\'s request, keeps every draft and returns focus to the receipt', async () => {
  const f = await fixture({ loaded });
  await f.range('below-200');
  const [row] = f.rows(); row.open = true; await f.type(row, 'amount', '300');
  await f.click(f.elements.showAllAmounts);
  assert.equal(f.elements.encodingAmountCompartment.value, 'all');
  assert.equal(f.elements.encodingFilterNotice.hidden, true);
  assert.deepEqual(visibleStores(f), ['Under 200', 'Three hundred', 'Five fifty']);
  assert.equal(f.field(row, 'amount').value, '300');
  assert.equal(f.focusLog.at(-1), row.part('.receipt-store'));
});

test('REVIEW-01: an invalid amount found at Save keeps the receipt visible under the filter, focuses the field and explains why', async () => {
  const f = await fixture({ loaded });
  await f.range('below-200');
  const [row] = f.rows(); await f.type(row, 'amount', '12,34.50');
  await f.range('500-599');                                  // an explicit filter change releases the pin: the invalid receipt is hidden
  assert.equal(row.hidden, true);
  await f.click(f.elements.saveDraft);
  assert.equal(f.calls.update.length + f.calls.create.length, 0, 'nothing saved');
  assert.equal(row.hidden, false, 'visible again for correction');
  assert.equal(f.focusLog.at(-1), f.field(row, 'amount'));
  assert.match(f.elements.encodingFeedback.textContent, /Receipt 1: Invalid amount "12,34\.50"\. Thousands commas must group exactly three digits/);
  assert.equal(f.elements.encodingFilterNotice.hidden, false);
  assert.equal(f.field(row, 'amount').value, '12,34.50');
});

test('Expand all opens only the currently visible receipts; Collapse all closes only those, releases their pins and leaves hidden receipts untouched', async () => {
  const f = await fixture({ loaded });
  await f.range('below-200');
  const [visible, hidden1, hidden2] = f.rows(); hidden1.open = true;
  await f.click(f.elements.expandAllReceipts);
  assert.equal(visible.open, true); assert.equal(hidden1.open, true, 'a hidden receipt keeps its own state'); assert.equal(hidden2.open, false, 'Expand all never opens (or reveals) hidden receipts');
  assert.equal(hidden2.hidden, true); assert.equal(hidden1.hidden, true);
  await f.type(visible, 'amount', '300'); assert.equal(visible.hidden, false);
  await f.click(f.elements.collapseAllReceipts);
  assert.equal(visible.open, false); assert.equal(hidden1.open, true, 'hidden receipt state untouched by Collapse all');
  assert.equal(visible.hidden, true, 'the pin was released');
  assert.match(f.elements.encodingFeedback.textContent, /^Receipt 1 is outside the selected amount range and is now hidden\./);
  assert.equal(f.field(visible, 'amount').value, '300'); assert.equal(f.calls.update.length + f.calls.create.length, 0, 'no data or persistence change');
});

test('Expand all with nothing filtered opens every visible receipt (and no consumed ones in the Available view)', async () => {
  const f = await fixture({ loaded });
  await f.click(f.elements.expandAllReceipts);
  assert.deepEqual(f.rows().map(row => row.open), [true, true, true, false]);
});

// ---- Available summary -------------------------------------------------------------------------------------------------------------------------------
test('the Available summary counts saved Available receipts only, in exact centavos, independent of every filter and of Consumed receipts', async () => {
  const f = await fixture({ loaded: [...loaded, { dbId: 'e', amount: 0.1, store: 'Dime' }, { dbId: 'g', amount: 0.2, store: 'Two dimes' }] });
  assert.equal(f.money(f.elements.availableTotal), '₱950.30', '100 + 300 + 550 + 0.10 + 0.20, Consumed 999 excluded');
  assert.equal(f.elements.availableCount.textContent, '5');
  await f.range('below-200'); assert.equal(f.money(f.elements.availableTotal), '₱950.30'); assert.equal(f.elements.availableCount.textContent, '5');
  f.elements.receiptStatusFilter.value = 'consumed'; await f.elements.receiptStatusFilter.emit('change');
  assert.equal(f.money(f.elements.availableTotal), '₱950.30', 'still the Available total in the Consumed view'); assert.equal(f.elements.availableCount.textContent, '5');
  assert.equal(f.elements.encodingUnsavedIndicator.hidden, true);
});

test('unsaved edits never change the saved totals; the unsaved indicator counts them and the totals follow a successful Save', async () => {
  const f = await fixture({ loaded });
  assert.equal(f.money(f.elements.availableTotal), '₱950.00'); assert.equal(f.elements.availableCount.textContent, '3');
  await f.type(f.rows()[0], 'amount', '1,100');
  assert.equal(f.money(f.elements.availableTotal), '₱950.00', 'saved total unchanged by a pending edit');
  assert.equal(f.elements.encodingUnsavedIndicator.hidden, false); assert.equal(f.elements.encodingUnsavedText.textContent, '1 unsaved receipt');
  await f.click(f.elements.floatingAdd); await f.type(f.rows().at(-1), 'store', 'New draft'); await f.type(f.rows().at(-1), 'amount', '50');
  assert.equal(f.money(f.elements.availableTotal), '₱950.00'); assert.equal(f.elements.availableCount.textContent, '3', 'unsaved receipts are not counted');
  assert.equal(f.elements.encodingUnsavedText.textContent, '2 unsaved receipts');
  await f.click(f.elements.saveDraft);
  assert.equal(f.money(f.elements.availableTotal), '₱2,000.00', '1,100 + 300 + 550 + the newly saved 50');
  assert.equal(f.elements.encodingUnsavedIndicator.hidden, true, 'the indicator clears after a successful Save');
  assert.equal(f.elements.availableCount.textContent, '4');
});

test('editing back to the saved value clears the indicator, and a blank new receipt does not raise it', async () => {
  const f = await fixture({ loaded });
  await f.type(f.rows()[0], 'amount', '101'); assert.equal(f.elements.encodingUnsavedIndicator.hidden, false);
  await f.type(f.rows()[0], 'amount', '100.00'); assert.equal(f.elements.encodingUnsavedIndicator.hidden, true, 'equivalent numeric formatting is not a change');
  await f.click(f.elements.floatingAdd); assert.equal(f.elements.encodingUnsavedIndicator.hidden, true);
});

test('the summary uses the existing integer-centavo helpers, not floating-point sums', async () => {
  const ui = await read('../ui/receiptUi.js');
  assert.match(ui, /const total = availableReceiptTotalCents\(storeSourceReceipts\.map\(receipt => \(\{ status: receipt\.status, cents: toCents\(receipt\.amount\) \}\)\)\);/);
  assert.match(ui, /elements\.availableTotal\.textContent = format\(total\);/);
  assert.doesNotMatch(ui, /reduce\([^)]*\+ Number\(/);
});

// ---- protected behaviour ---------------------------------------------------------------------------------------------------------------------------------
test('pins and presentation state are never persisted, and the save, delete, restore and export code paths are unchanged', async () => {
  const ui = await read('../ui/receiptUi.js'); const helpers = await read('../ui/encodingPresentation.js');
  assert.doesNotMatch(helpers, /localStorage|sessionStorage|supabase|fetch\(/i);
  assert.doesNotMatch(ui, /sessionStorage\.setItem\([^)]*[Pp]in/);
  for (const token of ['persistReceiptsBeforeDirectoryPrompts', 'receiptService.consumeReceipts', 'receiptService.updateReceiptStatus', 'createReceiptDeleteHandler', 'postSaveDirectoryDecision']) assert.ok(ui.includes(token), `${token} still present`);
  const service = await read('../services/receiptService.js');
  assert.ok(service.includes(".update({ status: 'consumed' }).in('id', uniqueIds).eq('status', 'available')"));
  const engine = await read('../services/optimizationService.js');
  assert.match(engine, /export const MAXIMUM_EXCESS_CENTS = 5000;/);
});

// ---- CP10-C1R: unsaved indicator, feedback severity, REVIEW-03, Consumed deletion -----------------------------------------------------------
const showConsumed = async f => { f.elements.receiptStatusFilter.value = 'consumed'; await f.elements.receiptStatusFilter.emit('change'); };

test('the unsaved indicator counts edited and new receipts with content, uses plain text, and follows delete and save', async () => {
  const f = await fixture({ loaded });
  const indicator = f.elements.encodingUnsavedIndicator; const text = f.elements.encodingUnsavedText;
  assert.equal(indicator.hidden, true, 'nothing unsaved at load');
  await f.type(f.rows()[0], 'store', 'Renamed'); assert.equal(indicator.hidden, false); assert.equal(text.textContent, '1 unsaved receipt');
  await f.click(f.elements.floatingAdd); assert.equal(text.textContent, '1 unsaved receipt', 'a blank new receipt is not a change');
  await f.type(f.rows().at(-1), 'amount', '75'); assert.equal(text.textContent, '2 unsaved receipts');
  await f.click(f.rows().at(-1).part('.delete-receipt')); assert.equal(text.textContent, '1 unsaved receipt', 'discarding a draft updates the count');
  await f.click(f.rows()[0].part('.delete-receipt')); assert.equal(indicator.hidden, true, 'deleting the edited saved receipt clears it');
  assert.equal(text.textContent, '');
});

test('the unsaved indicator is cleared by a successful Save and never changes the saved total', async () => {
  const f = await fixture({ loaded });
  await f.type(f.rows()[1], 'amount', '350'); assert.equal(f.elements.encodingUnsavedText.textContent, '1 unsaved receipt');
  assert.equal(f.money(f.elements.availableTotal), '₱950.00');
  await f.click(f.elements.saveDraft);
  assert.equal(f.elements.encodingUnsavedIndicator.hidden, true); assert.equal(f.money(f.elements.availableTotal), '₱1,000.00');
});

test('the unsaved indicator is announced through a polite status region and is text, not colour alone', () => {
  assert.match(encoding, /<span class="unsaved-status" role="status"><span class="unsaved-indicator" id="encodingUnsavedIndicator" hidden><span class="unsaved-dot" aria-hidden="true">●<\/span> <span id="encodingUnsavedText"><\/span><\/span><\/span>/);
  assert.match(css, /\.unsaved-indicator \{[^}]*border: var\(--border-width\) solid var\(--warning-border\)[^}]*background: var\(--warning-soft\)/);
  assert.doesNotMatch(css.slice(css.indexOf('.unsaved-status'), css.indexOf('.photo-note')), /#[0-9a-fA-F]{3,8}\b|!important/, 'tokens only');
});

test('feedback severity is explicit: success, warning, error and info come from the call site, never from the wording', async () => {
  const f = await fixture({ loaded });
  const feedback = f.elements.encodingFeedback;
  await f.type(f.rows()[0], 'amount', '12,34.50'); await f.click(f.elements.saveDraft);
  assert.equal(feedback.dataset.severity, 'error');
  await f.type(f.rows()[0], 'amount', '120'); await f.click(f.elements.saveDraft);
  assert.equal(feedback.dataset.severity, 'success'); assert.match(feedback.textContent, /^Receipt changes saved/);
  const ui = await read('../ui/receiptUi.js');
  assert.match(ui, /const setFeedback = \(target, text = '', severity = ''\) => \{[\s\S]*?dataset\.severity = severity; else delete target\.dataset\.severity;/);
  assert.doesNotMatch(ui, /includes\('(Could not|saved|error)/i, 'no substring classification of messages');
  for (const severity of ['success', 'warning', 'error', 'info']) assert.ok(ui.includes(`'${severity}')`), `call sites pass '${severity}'`);
});

test('every severity has a distinct accessible style: an icon with a text alternative, plus border and tint, in Light and Dark via tokens', () => {
  for (const [severity, icon, alt] of [['success', '✓', 'Success: '], ['warning', '⚠', 'Warning: '], ['error', '✕', 'Error: '], ['info', 'ℹ', 'Note: ']]) assert.ok(css.includes(`#encodingActions .workflow-feedback[data-severity="${severity}"]:not(:empty)::before { content: "${icon}" / "${alt}";`), severity);
  assert.match(css, /\[data-severity="error"\]:not\(:empty\) \{[^}]*border-left-color: var\(--danger\)[^}]*background: var\(--danger-soft\)/);
  assert.match(css, /\[data-severity="success"\]:not\(:empty\) \{[^}]*border-left-color: var\(--success\)[^}]*background: var\(--success-soft\)/);
  assert.match(css, /\[data-severity="warning"\]:not\(:empty\) \{[^}]*border-left-color: var\(--warning\)[^}]*background: var\(--warning-soft\)/);
});

test('REVIEW-03: an invalid Available receipt hidden by the Consumed view keeps the view, keeps the input, explains why and focuses View receipts', async () => {
  const f = await fixture({ loaded });
  const [row] = f.rows(); await f.type(row, 'amount', '12,34.50');
  await showConsumed(f);
  assert.equal(row.hidden, true);
  await f.click(f.elements.saveDraft);
  assert.equal(f.calls.update.length, 0, 'nothing saved');
  assert.equal(f.elements.receiptStatusFilter.value, 'consumed', 'the filter is never changed silently');
  assert.equal(row.hidden, true); assert.equal(f.field(row, 'amount').value, '12,34.50', 'the invalid input is kept');
  assert.match(f.elements.encodingFeedback.textContent, /hidden by the View receipts filter \(your filter was not changed\); choose Available or All to see it\./);
  assert.equal(f.elements.encodingFeedback.dataset.severity, 'error');
  assert.equal(f.focusLog.at(-1), f.elements.receiptStatusFilter, 'focus goes to the control that explains why, not to a hidden field');
});

test('an invalid receipt that is visible still gets its Amount field focused', async () => {
  const f = await fixture({ loaded });
  const [row] = f.rows(); await f.type(row, 'amount', '12,34.50'); await f.click(f.elements.saveDraft);
  assert.equal(f.focusLog.at(-1), f.field(row, 'amount'));
});

test('Delete permanently is offered on Consumed receipts only; Available receipts keep Delete receipt and Mark Available stays on Consumed', async () => {
  const f = await fixture({ loaded });
  const [available] = f.rows(); const consumed = f.rows().at(-1);
  assert.equal(available.part('.delete-consumed').hidden, true); assert.equal(available.part('.delete-receipt').hidden, false);
  assert.equal(consumed.part('.delete-consumed').hidden, false); assert.equal(consumed.part('.delete-receipt').hidden, true);
  assert.equal(consumed.part('.restore-receipt').hidden, false, 'Mark Available is unchanged');
  assert.equal(available.part('.restore-receipt').hidden, true);
});

test('permanently deleting a Consumed receipt: destructive confirmation, one database call, row removed after success, derived state refreshed', async () => {
  const f = await fixture({ loaded });
  await showConsumed(f);
  const consumed = f.rows().at(-1); assert.equal(consumed.hidden, false);
  await f.click(consumed.part('.delete-consumed'));
  const [confirmation] = f.calls.confirmations;
  assert.equal(confirmation.title, 'Permanently delete this Consumed receipt?'); assert.equal(confirmation.confirmLabel, 'Delete permanently'); assert.equal(confirmation.danger, true);
  assert.match(confirmation.message, /permanently deletes the saved receipt\. It cannot be undone\./);
  assert.deepEqual(f.calls.deleteConsumed, ['d']); assert.deepEqual(f.calls.delete, [], 'the Available delete path is not used');
  assert.equal(f.rows().includes(consumed), false, 'the row is gone');
  assert.equal(f.rows().length, 3);
  assert.equal(f.elements.encodingFeedback.dataset.severity, 'success'); assert.equal(f.elements.encodingFeedback.textContent, 'Consumed receipt deleted permanently.');
  assert.equal(f.money(f.elements.availableTotal), '₱950.00', 'Available totals are unaffected'); assert.equal(f.elements.availableCount.textContent, '3');
  assert.equal(f.elements.receiptStatusFilter.value, 'consumed', 'the view is kept');
});

test('cancelling the Consumed deletion changes nothing and makes no database call', async () => {
  const f = await fixture({ loaded, confirm: async () => false });
  await showConsumed(f);
  const consumed = f.rows().at(-1); await f.click(consumed.part('.delete-consumed'));
  assert.deepEqual(f.calls.deleteConsumed, []); assert.equal(f.rows().includes(consumed), true); assert.equal(f.elements.encodingFeedback.textContent, '');
});

test('a failed or unconfirmed Consumed deletion keeps the row, says so as an error and allows a retry', async () => {
  let attempt = 0;
  const f = await fixture({ loaded, deleteConsumed: async () => { if (++attempt === 1) throw new Error('The receipt is no longer Consumed (or no longer exists), so it was not deleted.'); } });
  await showConsumed(f);
  const consumed = f.rows().at(-1);
  await f.click(consumed.part('.delete-consumed'));
  assert.equal(f.rows().includes(consumed), true, 'the row stays after a failure'); assert.equal(f.rows().length, 4);
  assert.equal(f.elements.encodingFeedback.dataset.severity, 'error');
  assert.match(f.elements.encodingFeedback.textContent, /^Could not delete this Consumed receipt: The receipt is no longer Consumed .* not deleted\. It was not removed from your list\.$/);
  assert.equal(consumed.part('.delete-consumed').disabled, false, 'the control is usable again');
  await f.click(consumed.part('.delete-consumed'));
  assert.equal(f.rows().includes(consumed), false, 'the retry succeeds'); assert.equal(f.calls.deleteConsumed.length, 2);
});

test('deleting a Consumed receipt never touches the Company Directory, Monthly Filing or the Available delete path', async () => {
  const ui = await read('../ui/receiptUi.js'); const start = ui.indexOf('export function createConsumedDeleteHandler'); const handler = ui.slice(start, ui.indexOf('export const floatingAddVisibleForStatus'));
  assert.doesNotMatch(handler, /sharedStore|directory|monthly|contribute|deleteReceipt\b/i);
  assert.match(ui, /row\.querySelector\('\.delete-consumed'\)\.hidden = !consumed;/);
});

test('receipts are separate cards: a gap, own border and radius, no connecting dividers, blue and amber accents distinguishable', () => {
  assert.match(css, /\.encoding-list \{ display: grid; gap: 10px; padding: var\(--space-3\); \}/);
  assert.match(css, /\.encoding-list \.receipt-card \{[^}]*border: var\(--border-width\) solid var\(--border-strong\); border-radius: var\(--radius-md\)/);
  assert.doesNotMatch(css, /\.encoding-list \.receipt-card \{[^}]*border-bottom/);
  assert.match(css, /\.encoding-list \.receipt-card\[open\] \{ border-color: var\(--primary\); box-shadow: inset 4px 0 0 var\(--primary\); \}/);
  assert.match(css, /\.encoding-list \.receipt-card\.is-outside-range, \.encoding-list \.receipt-card\.is-outside-range\[open\] \{ border-color: var\(--warning\); box-shadow: inset 4px 0 0 var\(--warning\); \}/, 'amber wins over blue while outside the range');
  assert.match(css, /\[hidden\] \{ display: none !important; \}/, 'filtered receipts leave no empty grid cell');
  assert.match(receiptTemplate, /^\s*<details class="receipt-card">/, 'native details/summary kept');
});

test('the action bar is a distinct slate-blue command bar (tokens, border, elevation) with one Save, on desktop and phones', () => {
  assert.match(css, /--toolbar-bg: #dbe5f3;/); assert.match(css, /--toolbar-bg: #213652;/, 'Dark token');
  const desktop = css.slice(css.indexOf('@media (min-width: 641px) and (min-height: 480px) {'), css.indexOf('.photo-note {'));
  assert.match(desktop, /#encodingActions \{ position: sticky; top: var\(--space-2\); z-index: 12;[^}]*border: var\(--border-width\) solid var\(--toolbar-border\)[^}]*background: var\(--toolbar-bg\); box-shadow: 0 4px 14px/);
  const phone = css.slice(css.indexOf('@media (max-width: 640px) {\n  .receipts-bar'));
  assert.match(phone, /\.encoding-workspace > #encodingActions \{[^}]*border-top: 2px solid var\(--toolbar-border\); background: var\(--toolbar-bg\);/);
  assert.match(phone, /#encodingActions \.action-bar-spacer, #encodingActions \.action-bar-label \{ display: none; \}/, 'the label is not shown on phones, so the bar gains no height');
  assert.match(staticHtml, /<span class="action-bar-label" aria-hidden="true">RECEIPT ACTIONS<\/span>/);
  assert.equal(count(staticHtml, /id="saveDraft"/g), 1, 'still a single Save changes control');
  assert.match(css, /@media \(min-width: 641px\) and \(min-height: 480px\)/, 'sticky only on tall viewports');
  assert.match(phone, /\.encoding-workspace > #encodingActions, \.encoding-workspace\.is-editing > #encodingActions:not\(:focus-within\) \{ position: static;/, 'short viewports and zoom keep the static override');
});

test('the scrollable suggestion list is not a Tab stop, so Tab goes Store to Address; on phones the unsaved indicator gets its own line above the buttons', () => {
  assert.match(receiptTemplate, /<ul class="store-suggestions" role="listbox" tabindex="-1" hidden><\/ul>/, 'a scrollable list would otherwise be keyboard-focusable in Chromium and interrupt the Tab order');
  assert.doesNotMatch(receiptTemplate, /tabindex="[1-9]/);
  const phone = css.slice(css.indexOf('@media (max-width: 640px) {\n  .receipts-bar'));
  assert.match(phone, /#encodingActions \.unsaved-status \{ display: block; flex: 1 1 100%; order: -1; \}/);
  assert.match(phone, /#encodingActions \.unsaved-status:has\(> \.unsaved-indicator\[hidden\]\) \{ margin-bottom: calc\(var\(--space-2\) \* -1\); \}/, 'no empty gap while nothing is unsaved');
});

test('REVIEW-05: a partial save keeps the successful write, refreshes the saved total, count and unsaved indicator, and a later Save finishes the rest', async () => {
  let failB = true;
  const f = await fixture({ loaded, failUpdate: id => id === 'b' && failB });
  await f.type(f.rows()[0], 'amount', '150'); await f.type(f.rows()[1], 'amount', '400');
  assert.equal(f.elements.encodingUnsavedText.textContent, '2 unsaved receipts'); assert.equal(f.money(f.elements.availableTotal), '₱950.00');
  await f.click(f.elements.saveDraft);
  assert.deepEqual(f.calls.update.map(([id]) => id), ['a'], 'receipt 1 was written once; receipt 2 failed');
  assert.equal(f.calls.create.length, 0, 'no duplicates');
  assert.equal(f.money(f.elements.availableTotal), '₱1,000.00', '150 + 300 + 550: only confirmed saved values');
  assert.equal(f.elements.availableCount.textContent, '3');
  assert.equal(f.elements.encodingUnsavedText.textContent, '1 unsaved receipt');
  assert.equal(f.field(f.rows()[1], 'amount').value, '400', 'the failed receipt keeps its entered value');
  assert.equal(f.elements.encodingFeedback.dataset.severity, 'error'); assert.match(f.elements.encodingFeedback.textContent, /^Could not save receipt changes: network unavailable$/);
  failB = false;
  await f.click(f.elements.saveDraft);
  assert.equal(f.calls.update.filter(([id]) => id === 'a').length, 2, 'no automatic retry earlier; the manual Save re-sends unchanged rows as before (idempotent update)');
  assert.equal(f.calls.update.filter(([id]) => id === 'b').length, 1); assert.equal(f.calls.create.length, 0);
  assert.equal(f.money(f.elements.availableTotal), '₱1,100.00'); assert.equal(f.elements.encodingUnsavedIndicator.hidden, true);
  assert.equal(f.elements.encodingFeedback.dataset.severity, 'success');
});

test('REVIEW-05: when the first write fails nothing is reported as saved and the total and indicator are unchanged', async () => {
  const f = await fixture({ loaded, failUpdate: () => true });
  await f.type(f.rows()[0], 'amount', '150');
  await f.click(f.elements.saveDraft);
  assert.equal(f.calls.update.length, 0);
  assert.equal(f.money(f.elements.availableTotal), '₱950.00'); assert.equal(f.elements.encodingUnsavedText.textContent, '1 unsaved receipt');
  assert.equal(f.elements.encodingFeedback.dataset.severity, 'error'); assert.doesNotMatch(f.elements.encodingFeedback.textContent, /saved./);
});
