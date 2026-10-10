import nodeAssert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMonthlyFilingUi, createMonthlyFilingViewState, monthlyFilingAmountText, monthlyFilingDirtyLabel, monthlyFilingSignature, monthlyFilingSummaryName } from '../ui/monthlyFilingUi.js';

// match/doesNotMatch report the pattern, not the whole stylesheet, when they fail.
const assert = { ...nodeAssert, match: (text, pattern, message) => nodeAssert.ok(pattern.test(text), message ?? `expected a match for ${pattern}`), doesNotMatch: (text, pattern, message) => nodeAssert.ok(!pattern.test(text), message ?? `expected no match for ${pattern}`) };
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const html = await read('../index.html');
const staticHtml = html.replace(/<template[\s\S]*?<\/template>/g, '');
const template = html.match(/<template id="monthlyFilingReceiptTemplate">([\s\S]*?)<\/template>/)[1];
const css = (await read('../styles.css')).replace(/\r\n/g, '\n');
const count = (text, pattern) => (text.match(pattern) ?? []).length;
const monthly = staticHtml.slice(staticHtml.indexOf('id="monthlyFilingWorkspace"'), staticHtml.indexOf('id="quickOptimizerWorkspace"'));
const phoneBlock = css.slice(css.indexOf('@media (max-width: 640px) {\n  .receipts-bar'), css.indexOf('@media (prefers-reduced-motion'));
const monthlySection = css.slice(css.indexOf('/* ---- 8c. Monthly Filing'), css.indexOf('/* ---- 8d. Quick Optimizer'));

// ---- A. header: tabs and actions are separate rows ---------------------------------------------------------------------------
test('Monthly Filing has two rows: heading with tabs, then a separate action bar, with every ID and the tablist kept', () => {
  const header = monthly.slice(monthly.indexOf('class="workspace-heading monthly-header"'), monthly.indexOf('id="monthlyActionsBar"'));
  const bar = monthly.slice(monthly.indexOf('id="monthlyActionsBar"'), monthly.indexOf('id="monthlyFilingExportHelper"'));
  for (const id of ['monthlyFilingActiveTab', 'monthlyFilingArchivedTab']) assert.equal(count(header, new RegExp(`id="${id}"`, 'g')), 1, `${id} is in the header row`);
  assert.match(header, /<h1>Monthly Filing<\/h1>/);
  assert.match(header, /role="tablist" aria-label="Monthly Filing receipt status"/);
  assert.doesNotMatch(bar, /role="tab"|workspace-tab/, 'no tab sits in the action row');
  assert.doesNotMatch(header, /<button class="(primary|secondary|ghost)/, 'no action button sits in the tab row');
  for (const id of ['monthlyFilingActiveActions', 'monthlyFilingArchivedActions', 'monthlyFilingAdd', 'monthlyFilingSave', 'monthlyFilingExportActive', 'monthlyFilingClearArchived', 'monthlyFilingFeedback', 'monthlyUnsavedNote']) assert.equal(count(bar, new RegExp(`id="${id}"`, 'g')), 1, `${id} is in the action bar`);
  const all = [...staticHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(all.filter((id, index) => all.indexOf(id) !== index), [], 'no duplicate IDs');
  assert.ok(monthly.indexOf('monthly-header') < monthly.indexOf('id="monthlyActionsBar"') && monthly.indexOf('id="monthlyActionsBar"') < monthly.indexOf('id="monthlyFilingList"'));
});

test('Active actions are Add, Save, Export; Archived actions are the Archived cleanup; Clear all stays in More actions', () => {
  const active = monthly.slice(monthly.indexOf('id="monthlyFilingActiveActions"'), monthly.indexOf('id="monthlyFilingArchivedActions"'));
  const order = ['id="monthlyFilingAdd"', 'id="monthlyUnsavedNote"', 'class="action-bar-spacer"', 'id="monthlyFilingSave"', 'id="monthlyFilingExportActive"'].map(token => active.indexOf(token));
  assert.ok(order.every(position => position > 0)); assert.deepEqual([...order].sort((a, b) => a - b), order, 'Add, unsaved note, spacer, Save, Export');
  assert.match(active, /<button class="primary monthly-export" id="monthlyFilingExportActive" type="button">Export &amp; archive active<\/button>/);
  assert.match(active, /<button class="secondary monthly-save" id="monthlyFilingSave" type="button">Save changes<\/button>/);
  const archived = monthly.slice(monthly.indexOf('id="monthlyFilingArchivedActions"'), monthly.indexOf('id="monthlyFilingFeedback"'));
  assert.match(archived, /id="monthlyFilingArchivedActions" hidden/);
  assert.match(archived, /<button class="delete-receipt" id="monthlyFilingClearArchived"[^>]*>Clear archived receipts<\/button>/);
  assert.doesNotMatch(archived, /monthlyFilingSave|monthlyFilingExportActive|monthlyFilingAdd/);
  assert.match(monthly, /<details class="monthly-more-actions"><summary>More actions<\/summary><button class="delete-receipt" id="monthlyFilingClear"/);
  assert.match(monthly, /id="monthlyUnsavedNote" role="status" hidden/);
});

test('the header and the action bar are separated by at least 16px and the bar is its own bordered region', () => {
  assert.match(css, /\.monthly-filing-workspace \.monthly-header \{[^}]*margin-bottom: var\(--space-4\)/);
  assert.match(css, /\.monthly-actions-bar \{[^}]*padding: var\(--space-2\) var\(--space-3\)[^}]*border: var\(--border-width\) solid var\(--border\)[^}]*border-radius: var\(--radius-md\)[^}]*background: var\(--surface\)/);
  assert.match(css, /\.monthly-actions \{ display: flex; flex-wrap: wrap; align-items: center; gap: var\(--space-2\); \}/, 'actions wrap naturally and never overlap');
});

// ---- B. receipt containers ----------------------------------------------------------------------------------------------------
test('every receipt is a subtle bordered card: 1px border, 8px radius, 10px apart, no shadow, no nested panel', () => {
  assert.match(css, /\.monthly-card \{[^}]*border: var\(--border-width\) solid var\(--border-strong\)[^}]*border-radius: var\(--radius-sm\)[^}]*background: var\(--surface\)[^}]*box-shadow: none/);
  assert.match(css, /\.monthly-filing-list \{ display: grid; gap: 10px; \}/);
  assert.match(css, /\.monthly-filing-panel \{ min-height: 0; \}/, 'the list is not wrapped in a second decorated panel');
  assert.doesNotMatch(monthly, /class="panel monthly-filing-panel"/);
  assert.match(css, /\.monthly-card\[data-status="archived"\] \{[^}]*background: var\(--surface-2\)/, 'Archived cards look different');
  assert.match(css, /\.monthly-card\.is-unsaved \{ box-shadow: inset 4px 0 0 var\(--warning\); \}/);
});

test('the compact desktop row keeps every field in a 12-column grid with 16px text and consistent control height', () => {
  assert.match(css, /\.monthly-card \.receipt-fields \{ grid-template-columns: repeat\(12, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.monthly-card \.receipt-fields \.store-name-field \{ grid-column: span 4; \}/);
  assert.match(css, /\.monthly-card \.receipt-fields input, \.monthly-card \.receipt-fields select \{ height: var\(--control-height\); min-height: var\(--control-height\); \}/);
  assert.doesNotMatch(monthlySection, /font-size: (\.[0-9]+|1[0-5]px|0\.[0-9]+)(rem)?[^;]*;[^}]*\}\s*\n\.monthly-card \.receipt-fields input/, 'inputs are not shrunk');
  const fields = ['monthly-store', 'monthly-address', 'monthly-tin', 'monthly-vat', 'monthly-amount', 'monthly-receiptDate', 'monthly-invoice'];
  fields.forEach(field => assert.equal(count(template, new RegExp(`class="${field}"`, 'g')), 1, `.${field} appears once in the template`));
  const domOrder = fields.map(field => template.indexOf(`class="${field}"`));
  assert.deepEqual([...domOrder].sort((a, b) => a - b), domOrder, 'Tab order follows Store, Address, TIN, VAT, Amount, Date, Invoice');
  assert.match(template, /class="delete-receipt monthly-delete"/); assert.match(template, /class="secondary monthly-return-active" type="button" hidden/);
  assert.match(template, /class="store-suggestions monthly-suggestions" hidden/);
  assert.match(css, /\.monthly-suggestions \{ position: static;/, 'the suggestion list is in flow, so no card can clip it');
  assert.match(css, /\.monthly-card \{[^}]*overflow: visible/);
});

test('on phones each receipt is a native-feeling disclosure: a summary button, hidden content when collapsed, 44px fields', () => {
  assert.match(template, /<button class="monthly-summary" type="button" aria-expanded="true">/);
  for (const part of ['monthly-summary-id', 'monthly-summary-store', 'monthly-summary-amount', 'monthly-summary-date', 'monthly-summary-flags', 'monthly-summary-chevron']) assert.equal(count(template, new RegExp(`class="${part}"`, 'g')), 1);
  assert.ok(css.includes('.monthly-summary { display: none; }'), 'no disclosure button on wide screens, where the form is always shown');
  assert.match(phoneBlock, /\.monthly-card\.is-collapsed \.receipt-content \{ display: none; \}/);
  assert.equal(count(css, /\.is-collapsed \.receipt-content \{ display: none; \}/g), 1, 'collapsing only exists inside the phone breakpoint');
  assert.match(phoneBlock, /\.monthly-summary \{ display: grid;[^}]*min-height: 52px/);
  assert.match(phoneBlock, /\.monthly-card \.receipt-fields input, \.monthly-card \.receipt-fields select \{ height: 44px; min-height: 44px; \}/);
  assert.match(phoneBlock, /\.monthly-card \.receipt-form-footer button \{[^}]*min-height: 44px/);
});

test('the phone action bar is the same element, sticky only on phones, safe-area aware, and steps aside while typing', () => {
  assert.doesNotMatch(css.slice(0, css.indexOf('@media (max-width: 640px) {\n  .receipts-bar')), /\.monthly-actions-bar \{[^}]*position: (sticky|fixed)/, 'desktop bar is in flow');
  assert.match(phoneBlock, /\.monthly-filing-workspace > \.monthly-actions-bar \{ order: 6; position: sticky; bottom: 0;[^}]*env\(safe-area-inset-bottom\)/);
  assert.match(phoneBlock, /\.monthly-filing-workspace\.is-editing > \.monthly-actions-bar:not\(:focus-within\) \{ opacity: 0; pointer-events: none; transform: translateY\(100%\); \}/);
  assert.doesNotMatch(phoneBlock, /monthly-actions-bar[^{]*\{[^}]*(display: none|visibility: hidden|position: fixed)/);
  assert.match(phoneBlock, /\.monthly-actions button \{[^}]*min-height: 44px/);
  assert.match(phoneBlock, /\.monthly-actions \.monthly-export \{ flex: 1 1 100%; order: -1; \}/);
  const drawerZ = Number(css.match(/\.application-navigation \{ position: fixed; z-index: (\d+)/)[1]);
  assert.ok(12 < drawerZ);
  for (const duplicate of ['id="monthlyFilingSave"', 'id="monthlyFilingExportActive"']) assert.equal(count(html, new RegExp(duplicate, 'g')), 1, `${duplicate} is not duplicated`);
});

test('Monthly Filing styling is isolated: Monthly selectors only, no !important, no leakage into other workspaces', () => {
  const stripped = monthlySection.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(stripped, /!important/);
  const selectors = [...stripped.matchAll(/([^{}@]+)\{/g)].map(match => match[1].trim()).filter(selector => !selector.startsWith('media')).flatMap(selector => selector.split(',').map(part => part.trim()));
  for (const selector of selectors) assert.match(selector, /monthly/, `${selector} is Monthly-specific`);
  const phoneMonthly = phoneBlock.slice(phoneBlock.indexOf('/* Monthly Filing on phones'), phoneBlock.indexOf('.panel, .result-panel'));
  for (const selector of [...phoneMonthly.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{/g)].map(match => match[1].trim()).flatMap(selector => selector.split(',').map(part => part.trim()))) assert.match(selector, /monthly/, `${selector} (phone) is Monthly-specific`);
  assert.equal(count(staticHtml, /class="encoding-actions"/g) + count(html, /class="monthly-card encoding-actions/g), 0, 'nothing reuses the old shared action class any more');
});

// ---- C. presentation state: identity, expansion, unsaved ---------------------------------------------------------------------
const base = { dbId: '', sharedStoreId: '', store: '', address: '', tin: '', vat: '', amount: '', receiptDate: '', invoice: '', status: 'active', persistedStoreFingerprint: '' };
const saved = (id, extra = {}) => ({ ...base, dbId: id, store: `Store ${id}`, amount: '100', ...extra });

test('record identity follows the receipt, not its array position, and survives edits, saves and deletions', () => {
  const view = createMonthlyFilingViewState();
  const draft = { ...base, store: 'New' };
  const key = view.keyOf(draft);
  assert.match(key, /^draft:/);
  const edited = { ...draft, store: 'New cafe' };
  view.replace(draft, edited);
  assert.equal(view.keyOf(edited), key, 'an edited copy of a draft keeps its key');
  view.setExpanded(edited, true); const number = view.labelOf(edited);
  const persisted = saved('db-1', { store: 'New cafe' });
  view.replace(edited, persisted);
  assert.equal(view.keyOf(persisted), 'db:db-1');
  assert.equal(view.isExpanded(persisted), true, 'expansion moves from the draft key to the database key');
  assert.equal(view.labelOf(persisted), number, 'the receipt keeps its number when it is saved');
  const other = saved('db-2'); const otherNumber = view.labelOf(other);
  view.forget(persisted);
  assert.equal(view.isExpanded(other), false);
  assert.equal(view.labelOf(other), otherNumber, 'deleting another receipt never renumbers this one');
  assert.ok(view.labelOf(saved('db-3')) > otherNumber, 'numbers are not reused');
  const second = { ...base }; view.setExpanded(second, true);
  assert.equal(view.isExpanded({ ...base }), false, 'a different draft never inherits another receipt\'s state');
});

test('unsaved state reflects real edits: new, edited, clean, reverted, Archived and blank placeholders', () => {
  const view = createMonthlyFilingViewState();
  const record = saved('db-1', { invoice: 'A' }); view.markPersisted(record);
  assert.equal(view.dirtyState(record), 'clean');
  assert.equal(view.dirtyState({ ...record, invoice: 'B' }), 'edited');
  assert.equal(view.dirtyState({ ...record, invoice: 'A' }), 'clean', 'reverting an edit clears the marker');
  assert.equal(view.dirtyState({ ...record, amount: 100 }), 'clean', 'number vs string form of the same value is not an edit');
  assert.equal(view.dirtyState({ ...base }), 'clean', 'a blank placeholder is not "unsaved"');
  assert.equal(view.dirtyState({ ...base, store: 'x' }), 'new');
  assert.equal(view.dirtyState({ ...record, status: 'archived', invoice: 'B' }), 'clean', 'Archived receipts are read-only, never dirty');
  view.markPersisted({ ...record, invoice: 'B' });
  assert.equal(view.dirtyState({ ...record, invoice: 'B' }), 'clean', 'after a save the saved values are the baseline');
  const fresh = saved('db-9'); view.markPersistedIfNew(fresh); view.markPersistedIfNew({ ...fresh, store: 'changed' });
  assert.equal(view.dirtyState({ ...fresh, store: 'changed' }), 'edited', 'markPersistedIfNew never overwrites an existing baseline');
});

test('summary text helpers: amounts, labels and accessible names (state is not colour alone)', () => {
  assert.equal(monthlyFilingAmountText('4120.5'), '₱4,120.50'); assert.equal(monthlyFilingAmountText(''), '₱0.00'); assert.equal(monthlyFilingAmountText('abc'), '₱0.00');
  assert.equal(monthlyFilingDirtyLabel('new'), 'New, unsaved'); assert.equal(monthlyFilingDirtyLabel('edited'), 'Unsaved changes'); assert.equal(monthlyFilingDirtyLabel('clean'), '');
  assert.equal(monthlyFilingSummaryName({ number: 3, store: 'Shell', amountText: '₱2,000.00', date: '2026-10-04', archived: false, dirty: 'edited' }), 'Monthly receipt 3, Shell, ₱2,000.00, 2026-10-04, unsaved changes');
  assert.equal(monthlyFilingSummaryName({ number: 5, store: 'Store not set', amountText: '₱0.00', date: '', archived: true, dirty: 'clean' }), 'Monthly receipt 5, Store not set, ₱0.00, no date, archived');
  assert.equal(monthlyFilingSignature(saved('x')), monthlyFilingSignature({ ...saved('x'), unrelated: 1 }));
});

// ---- D. the real Monthly Filing UI against a DOM fixture --------------------------------------------------------------------------
function fixture({ records = [], confirm = async () => true, reduced = false } = {}) {
  const focusLog = []; const scrollLog = []; const state = { activeElement: null };
  globalThis.matchMedia = query => ({ matches: query.includes('prefers-reduced-motion') ? reduced : false });
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
      focus(options) { focusLog.push({ node: self, options: options ?? null }); state.activeElement = self; },
      scrollIntoView(options) { scrollLog.push({ node: self, options }); },
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
  const elements = { workspace: node(), list, template: { content: { firstElementChild: { cloneNode: () => makeRow() } } }, activeTab: node(), archivedTab: node(), activeActions: node(), archivedActions: node(), exportHelper: node(), add: node(), save: node(), exportActive: node(), clearArchived: node(), clearAll: node(), feedback: node(), unsavedNote: node() };
  const calls = { create: [], update: [], remove: [], archive: [], ret: [], workbook: [], confirms: [], order: [] };
  let sequence = 0; const failures = { update: new Set(), create: false, workbook: false, archive: false };
  const service = {
    loadMonthlyFilingReceipts: async () => records.map(record => ({ ...record })),
    createMonthlyFilingReceipt: async receipt => { calls.order.push('create'); if (failures.create) throw new Error('create failed'); calls.create.push(receipt); return { ...receipt, dbId: `new-${++sequence}`, status: 'active' }; },
    updateMonthlyFilingReceipt: async (id, receipt) => { calls.order.push('update'); if (failures.update.has(id)) throw new Error(`update ${id} failed`); calls.update.push([id, receipt]); return { ...receipt, dbId: id, status: 'active' }; },
    deleteMonthlyFilingReceipt: async id => { calls.remove.push(id); },
    archiveMonthlyFilingReceipts: async ids => { calls.order.push('archive'); if (failures.archive) throw new Error('archive failed'); calls.archive.push(ids); return ids.map(id => ({ ...records.find(record => record.dbId === id), dbId: id, status: 'archived' })); },
    returnMonthlyFilingReceiptToActive: async id => { calls.ret.push(id); return { ...records.find(record => record.dbId === id), dbId: id, status: 'active' }; },
    associateMonthlyFilingSharedStore: async id => ({ ...records.find(record => record.dbId === id), dbId: id })
  };
  const ui = createMonthlyFilingUi({
    elements, monthlyFilingService: service, sharedStoreService: { listActiveSharedStores: async () => [] },
    downloadExpenseDetailedReport: snapshot => { calls.order.push('workbook'); if (failures.workbook) throw new Error('workbook failed'); calls.workbook.push(snapshot.map(record => record.dbId)); },
    confirmAction: async options => { calls.confirms.push(options.title); return confirm(options); }
  });
  ui.start();
  const cards = () => list.kids.filter(kid => kid.matches('.monthly-card'));
  const field = (card, key) => card.querySelector(`.monthly-${key}`);
  const edit = (card, key, value) => { const input = field(card, key); input.value = value; return input.emit('input'); };
  const flag = card => card.querySelector('.monthly-unsaved');
  const summary = card => card.querySelector('.monthly-summary');
  const label = card => card.querySelector('.monthly-receipt-id').textContent;
  const click = async target => { await target.emit('click', { currentTarget: target }); await new Promise(resolve => setTimeout(resolve, 5)); };
  return { ui, elements, calls, failures, cards, field, edit, flag, summary, label, click, focusLog, scrollLog, state };
}
const user = { id: 'user-1' };
const activeRecords = () => [saved('a1', { store: 'Alpha', invoice: 'I-1' }), saved('a2', { store: 'Beta', invoice: 'I-2' }), { ...saved('z1', { store: 'Archived store' }), status: 'archived' }];

test('loading shows stable numbered cards, counts, and no unsaved markers', async () => {
  const f = fixture({ records: activeRecords() }); await f.ui.loadForUser(user);
  assert.equal(f.cards().length, 2);
  assert.deepEqual(f.cards().map(f.label), ['Receipt 1', 'Receipt 2']);
  assert.deepEqual([f.elements.activeTab.textContent, f.elements.archivedTab.textContent], ['Active (2)', 'Archived (1)']);
  assert.ok(f.cards().every(card => f.flag(card).hidden && !card.classList.contains('is-unsaved')));
  assert.equal(f.elements.unsavedNote.hidden, true);
  assert.equal(f.summary(f.cards()[0]).getAttribute('aria-label'), 'Monthly receipt 1, Alpha, ₱100.00, no date');
  assert.ok(f.cards().every(card => card.classList.contains('is-collapsed')) && f.cards().every(card => f.summary(card).getAttribute('aria-expanded') === 'false'), 'saved receipts start collapsed');
  assert.match(f.summary(f.cards()[0]).getAttribute('aria-controls'), /^monthly-card-content-\d+$/);
  const ids = f.cards().map(card => card.querySelector('.receipt-content').id); assert.equal(new Set(ids).size, ids.length, 'content IDs are unique');
});

test('editing a saved Active receipt shows Unsaved changes; reverting the edit clears it; the note counts receipts', async () => {
  const f = fixture({ records: activeRecords() }); await f.ui.loadForUser(user);
  await f.edit(f.cards()[0], 'invoice', 'CHANGED');
  assert.equal(f.flag(f.cards()[0]).textContent, 'Unsaved changes'); assert.equal(f.flag(f.cards()[0]).hidden, false);
  assert.ok(f.cards()[0].classList.contains('is-unsaved'));
  assert.equal(f.elements.unsavedNote.textContent, '1 unsaved receipt');
  assert.match(f.summary(f.cards()[0]).getAttribute('aria-label'), /unsaved changes$/);
  await f.edit(f.cards()[1], 'amount', '999');
  assert.equal(f.elements.unsavedNote.textContent, '2 unsaved receipts');
  await f.edit(f.cards()[0], 'invoice', 'I-1');
  assert.equal(f.flag(f.cards()[0]).hidden, true);
  assert.equal(f.elements.unsavedNote.textContent, '1 unsaved receipt');
});

test('Add receipt creates one blank receipt, expands it, scrolls it into view and focuses Store; repeated clicks reuse it', async () => {
  const f = fixture({ records: activeRecords() }); await f.ui.loadForUser(user);
  f.focusLog.length = 0; await f.click(f.elements.add);
  assert.equal(f.cards().length, 3);
  const card = f.cards()[2];
  assert.equal(card.classList.contains('is-collapsed'), false, 'the new receipt is expanded');
  assert.equal(f.summary(card).getAttribute('aria-expanded'), 'true');
  assert.deepEqual(f.scrollLog.at(-1), { node: card, options: { block: 'center', behavior: 'smooth' } });
  assert.equal(f.focusLog.at(-1).node, f.field(card, 'store'));
  assert.equal(f.flag(card).hidden, true, 'an empty placeholder is not "unsaved"');
  await f.click(f.elements.add); await f.click(f.elements.add);
  assert.equal(f.cards().length, 3, 'no duplicate blank receipts');
  assert.equal(f.focusLog.at(-1).node, f.field(f.cards()[2], 'store'));
  await f.edit(f.cards()[2], 'store', 'Gamma');
  assert.equal(f.flag(f.cards()[2]).textContent, 'New, unsaved');
  assert.equal(f.label(f.cards()[2]), 'Receipt 4', 'a new receipt continues the numbering (the archived one is Receipt 3)');
  await f.click(f.elements.add);
  assert.equal(f.cards().length, 4, 'once the blank receipt is used, Add creates another');
});

test('Add receipt respects reduced motion', async () => {
  const f = fixture({ records: [], reduced: true }); await f.ui.loadForUser(user);
  await f.click(f.elements.add);
  assert.equal(f.scrollLog.at(-1).options.behavior, 'auto');
});

test('Save clears the unsaved markers and keeps each receipt expanded and numbered; a new receipt becomes a saved one', async () => {
  const f = fixture({ records: activeRecords() }); await f.ui.loadForUser(user);
  await f.click(f.summary(f.cards()[0]));
  assert.equal(f.cards()[0].classList.contains('is-collapsed'), false);
  await f.edit(f.cards()[0], 'invoice', 'SAVE-ME'); await f.click(f.elements.add); await f.edit(f.cards()[2], 'store', 'Gamma'); await f.edit(f.cards()[2], 'amount', '55');
  assert.equal(f.elements.unsavedNote.textContent, '2 unsaved receipts');
  await f.click(f.elements.save);
  assert.deepEqual(f.calls.update.map(([id, receipt]) => [id, receipt.invoice]).filter(([id]) => id === 'a1'), [['a1', 'SAVE-ME']]);
  assert.equal(f.calls.create.length, 1);
  assert.ok(f.cards().every(card => f.flag(card).hidden), 'markers cleared');
  assert.equal(f.elements.unsavedNote.hidden, true);
  assert.deepEqual(f.cards().map(card => card.classList.contains('is-collapsed')), [false, true, false], 'expansion follows the receipts across the re-render');
  assert.deepEqual(f.cards().map(f.label), ['Receipt 1', 'Receipt 2', 'Receipt 4']);
  assert.equal(f.elements.feedback.textContent, 'Monthly Filing changes saved.');
});

test('a failed Save keeps the dirty markers, the typed values and the expansion', async () => {
  const f = fixture({ records: activeRecords() }); await f.ui.loadForUser(user);
  await f.click(f.summary(f.cards()[0])); await f.edit(f.cards()[0], 'invoice', 'KEEP-ME');
  f.failures.update.add('a1');
  await f.click(f.elements.save);
  assert.match(f.elements.feedback.textContent, /Could not save Monthly Filing changes: update a1 failed/);
  assert.equal(f.flag(f.cards()[0]).textContent, 'Unsaved changes');
  assert.equal(f.field(f.cards()[0], 'invoice').value, 'KEEP-ME');
  assert.equal(f.cards()[0].classList.contains('is-collapsed'), false);
  assert.equal(f.elements.unsavedNote.textContent, '1 unsaved receipt');
});

test('a partially successful batch Save marks only the saved receipts clean', async () => {
  const f = fixture({ records: activeRecords() }); await f.ui.loadForUser(user);
  await f.edit(f.cards()[0], 'invoice', 'FIRST'); await f.edit(f.cards()[1], 'invoice', 'SECOND');
  f.failures.update.add('a2');
  await f.click(f.elements.save);
  assert.equal(f.flag(f.cards()[0]).hidden, true, 'the receipt that was saved is clean');
  assert.equal(f.flag(f.cards()[1]).textContent, 'Unsaved changes', 'the receipt that failed is still unsaved');
  assert.equal(f.elements.unsavedNote.textContent, '1 unsaved receipt');
  assert.match(f.elements.feedback.textContent, /update a2 failed/);
});

test('expansion and unsaved edits survive switching to Archived and back', async () => {
  const f = fixture({ records: activeRecords() }); await f.ui.loadForUser(user);
  await f.click(f.summary(f.cards()[1])); await f.edit(f.cards()[1], 'amount', '777');
  await f.click(f.elements.archivedTab);
  assert.equal(f.cards().length, 1); assert.equal(f.cards()[0].dataset.status, 'archived');
  assert.equal(f.label(f.cards()[0]), 'Receipt 3');
  assert.ok(f.cards()[0].querySelector('.monthly-return-active').hidden === false && f.cards()[0].querySelector('.monthly-delete').hidden === true);
  assert.ok(f.flag(f.cards()[0]).hidden, 'Archived receipts are never marked unsaved');
  await f.click(f.elements.activeTab);
  assert.deepEqual(f.cards().map(card => card.classList.contains('is-collapsed')), [true, false]);
  assert.equal(f.field(f.cards()[1], 'amount').value, '777');
  assert.equal(f.flag(f.cards()[1]).textContent, 'Unsaved changes');
});

test('deleting a receipt keeps the others\' numbers and expansion, and moves focus to the receipt now in that position', async () => {
  const f = fixture({ records: [saved('a1', { store: 'A' }), saved('a2', { store: 'B' }), saved('a3', { store: 'C' })] }); await f.ui.loadForUser(user);
  await f.click(f.summary(f.cards()[2]));
  f.focusLog.length = 0;
  await f.click(f.cards()[1].querySelector('.monthly-delete'));
  assert.deepEqual(f.calls.remove, ['a2']); assert.ok(f.calls.confirms.includes('Delete Monthly Filing receipt?'));
  assert.deepEqual(f.cards().map(f.label), ['Receipt 1', 'Receipt 3'], 'Receipt 3 is not renumbered to 2');
  assert.deepEqual(f.cards().map(card => card.classList.contains('is-collapsed')), [true, false], 'the expanded receipt stayed expanded; the deleted one left no state behind');
  assert.ok([f.field(f.cards()[1], 'store'), f.summary(f.cards()[1])].includes(f.focusLog.at(-1).node), 'focus lands on a control of the receipt that took its place');
});

test('declining the delete confirmation changes nothing; unsaved receipts are removed without a prompt', async () => {
  const f = fixture({ records: activeRecords(), confirm: async () => false }); await f.ui.loadForUser(user);
  await f.click(f.cards()[0].querySelector('.monthly-delete'));
  assert.equal(f.calls.remove.length, 0); assert.equal(f.cards().length, 2);
  await f.click(f.elements.add); await f.edit(f.cards()[2], 'store', 'Draft');
  const before = f.calls.confirms.length;
  await f.click(f.cards()[2].querySelector('.monthly-delete'));
  assert.equal(f.cards().length, 2); assert.equal(f.calls.confirms.length, before, 'no confirmation for a never-saved receipt');
  assert.deepEqual(f.cards().map(f.label), ['Receipt 1', 'Receipt 2']);
  assert.equal(f.elements.feedback.textContent, 'Unsaved Monthly Filing receipt removed.');
});

test('Return to Active asks first, switches tabs, expands the receipt and focuses a visible Store field', async () => {
  const f = fixture({ records: activeRecords() }); await f.ui.loadForUser(user);
  await f.click(f.elements.archivedTab);
  f.focusLog.length = 0;
  await f.click(f.cards()[0].querySelector('.monthly-return-active'));
  assert.deepEqual(f.calls.ret, ['z1']); assert.ok(f.calls.confirms.includes('Return receipt to Active?'));
  assert.equal(f.elements.activeTab.attrs['aria-selected'], 'true');
  const returned = f.cards().find(card => f.label(card) === 'Receipt 3');
  assert.ok(returned, 'the same receipt (Receipt 3) is now in the Active list');
  assert.equal(returned.classList.contains('is-collapsed'), false, 'expanded before focusing');
  assert.equal(f.focusLog.at(-1).node, f.field(returned, 'store'));
  assert.equal(f.field(returned, 'store').disabled, false, 'editable again');
});

test('declining Return to Active leaves the receipt Archived and read-only', async () => {
  const f = fixture({ records: activeRecords(), confirm: async () => false }); await f.ui.loadForUser(user);
  await f.click(f.elements.archivedTab); await f.click(f.cards()[0].querySelector('.monthly-return-active'));
  assert.equal(f.calls.ret.length, 0); assert.equal(f.cards()[0].dataset.status, 'archived'); assert.equal(f.field(f.cards()[0], 'store').disabled, true);
});

test('Export saves first, then generates the workbook from the exact saved snapshot, then archives exactly those IDs', async () => {
  const f = fixture({ records: activeRecords() }); await f.ui.loadForUser(user);
  await f.edit(f.cards()[0], 'invoice', 'PRE-EXPORT');
  await f.click(f.elements.exportActive);
  assert.ok(f.calls.order.indexOf('update') < f.calls.order.indexOf('workbook') && f.calls.order.indexOf('workbook') < f.calls.order.indexOf('archive'), 'save, workbook, archive');
  assert.deepEqual(f.calls.workbook, [['a1', 'a2']]); assert.deepEqual(f.calls.archive, [['a1', 'a2']]);
  assert.deepEqual(f.calls.update.find(([id]) => id === 'a1')[1].invoice, 'PRE-EXPORT');
  assert.equal(f.elements.activeTab.textContent, 'Active (0)'); assert.equal(f.elements.archivedTab.textContent, 'Archived (3)');
  assert.match(f.elements.feedback.textContent, /Exported and archived 2 Monthly Filing receipts\./);
  assert.ok(f.calls.confirms.includes('Export Active Monthly Filing receipts?'));
});

test('Export stops when Save fails, when the workbook fails (nothing archived) and when the archive fails (blocks a second export)', async () => {
  const saveFail = fixture({ records: activeRecords() }); await saveFail.ui.loadForUser(user);
  await saveFail.edit(saveFail.cards()[0], 'invoice', 'X'); saveFail.failures.update.add('a1');
  await saveFail.click(saveFail.elements.exportActive);
  assert.equal(saveFail.calls.workbook.length, 0); assert.equal(saveFail.calls.archive.length, 0);
  assert.equal(saveFail.flag(saveFail.cards()[0]).textContent, 'Unsaved changes', 'the failed export save keeps the dirty marker');
  const workbookFail = fixture({ records: activeRecords() }); await workbookFail.ui.loadForUser(user);
  workbookFail.failures.workbook = true; await workbookFail.click(workbookFail.elements.exportActive);
  assert.equal(workbookFail.calls.archive.length, 0); assert.match(workbookFail.elements.feedback.textContent, /Could not prepare the XLSX export: workbook failed/);
  assert.equal(workbookFail.elements.activeTab.textContent, 'Active (2)');
  const archiveFail = fixture({ records: activeRecords() }); await archiveFail.ui.loadForUser(user);
  archiveFail.failures.archive = true; await archiveFail.click(archiveFail.elements.exportActive);
  assert.match(archiveFail.elements.feedback.textContent, /Workbook generated, but archive status could not be confirmed/);
  assert.equal(archiveFail.elements.exportActive.disabled, true, 'a second export is blocked until Monthly Filing is refreshed');
  assert.equal(archiveFail.elements.activeTab.textContent, 'Active (2)', 'nothing is shown as archived');
});

test('a second Export click while one is running does nothing, and cancelling the confirmation exports nothing', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ records: activeRecords(), confirm: async () => { await gate; return true; } }); await f.ui.loadForUser(user);
  const first = f.click(f.elements.exportActive); await f.click(f.elements.exportActive);
  assert.equal(f.calls.confirms.filter(title => title.startsWith('Export')).length, 1, 'duplicate action ignored');
  release(); await first;
  assert.equal(f.calls.archive.length, 1);
  const cancelled = fixture({ records: activeRecords(), confirm: async () => false }); await cancelled.ui.loadForUser(user);
  await cancelled.click(cancelled.elements.exportActive);
  assert.equal(cancelled.calls.workbook.length, 0); assert.equal(cancelled.calls.update.length, 0, 'cancelling does not even save');
});

test('Clear Archived and Clear All keep their destructive confirmations; Archived receipts stay read-only', async () => {
  const f = fixture({ records: activeRecords(), confirm: async () => false }); await f.ui.loadForUser(user);
  await f.click(f.elements.clearArchived); await f.click(f.elements.clearAll);
  assert.deepEqual(f.calls.confirms.slice(-2), ['Clear Archived receipts?', 'Clear ALL Monthly Filing receipts?']);
  assert.equal(f.cards().length, 2);
  await f.click(f.elements.archivedTab);
  assert.ok(f.cards().every(card => card.querySelector('.monthly-store').disabled), 'every Archived field is disabled');
});

test('logging out clears the presentation state: numbers, expansion and markers start fresh', async () => {
  const f = fixture({ records: activeRecords() }); await f.ui.loadForUser(user);
  await f.edit(f.cards()[0], 'invoice', 'X'); f.ui.clearForLogout();
  assert.equal(f.cards().length, 0); assert.equal(f.elements.unsavedNote.hidden, true);
  const second = fixture({ records: [saved('b1')] }); await second.ui.loadForUser(user);
  assert.equal(second.label(second.cards()[0]), 'Receipt 1');
});

// ---- E. what this checkpoint must not touch ----------------------------------------------------------------------------------------
test('Monthly services, export builder, migrations and the engine are untouched by the UI work', async () => {
  const ui = await read('../ui/monthlyFilingUi.js');
  assert.ok(ui.includes('runMonthlyFilingExport({ save: () => save({ successFeedback: false, fromExport: true }), snapshot: activeRecords, generateWorkbook: snapshot => downloadExpenseDetailedReport(snapshot, monthlyFilingExportFilename()), archive: ids => monthlyFilingService.archiveMonthlyFilingReceipts(ids) })'), 'export pipeline unchanged');
  assert.ok(ui.includes('export async function runMonthlyFilingExport({ save, snapshot, generateWorkbook, archive })'));
  assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB|supabase|\.rpc\(/i, 'no second persistence');
  const service = await read('../services/monthlyFilingService.js');
  assert.ok(service.includes("client.rpc('archive_monthly_filing_receipts', { p_ids: exactIds })"));
});
