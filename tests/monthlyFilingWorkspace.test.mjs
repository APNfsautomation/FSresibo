import nodeAssert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { toDatabaseMonthlyFilingReceipt } from '../services/monthlyFilingService.js';
import { createMonthlyFilingUi, createMonthlyFilingViewState, directoryOutcomeFeedback, monthlyFilingAmountText, monthlyFilingArchivedLabel, monthlyFilingDirtyLabel, monthlyFilingExportNumbers, monthlyFilingSignature, monthlyFilingSnapshotTotalCents, monthlyFilingSummaryName, monthlyFilingTotalText, summarizeActiveMonthlyFiling } from '../ui/monthlyFilingUi.js';
import { buildExpenseDetailedReportRows } from '../services/exportService.js';
import { normalizeMoneyAmount } from '../domain/moneyAmount.js';

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
  view.setExpanded(edited, true);
  const persisted = saved('db-1', { store: 'New cafe' });
  view.replace(edited, persisted);
  assert.equal(view.keyOf(persisted), 'db:db-1');
  assert.equal(view.isExpanded(persisted), true, 'expansion moves from the draft key to the database key');
  const other = saved('db-2');
  view.forget(persisted);
  assert.equal(view.isExpanded(other), false);
  assert.equal(view.labelOf, undefined, 'display numbers are no longer session state: they come from export order');
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
  assert.equal(monthlyFilingAmountText('4120.5'), '₱4,120.50'); assert.equal(monthlyFilingAmountText('1,250.50'), '₱1,250.50'); assert.equal(monthlyFilingAmountText(1250.5), '₱1,250.50'); assert.equal(monthlyFilingAmountText(''), 'No amount'); assert.equal(monthlyFilingAmountText('  '), 'No amount');
  for (const bad of ['abc', '12,34.50', '1,250.999', '-5', '1e3']) assert.equal(monthlyFilingAmountText(bad), 'Invalid amount', `${bad} is never formatted as money`);
  assert.equal(monthlyFilingDirtyLabel('new'), 'New, unsaved'); assert.equal(monthlyFilingDirtyLabel('edited'), 'Unsaved changes'); assert.equal(monthlyFilingDirtyLabel('clean'), '');
  assert.equal(monthlyFilingSummaryName({ number: 3, store: 'Shell', amountText: '₱2,000.00', date: '2026-10-04', archived: false, dirty: 'edited' }), 'Monthly receipt 3, Shell, ₱2,000.00, 2026-10-04, unsaved changes');
  assert.equal(monthlyFilingSummaryName({ number: 5, store: 'Store not set', amountText: '₱0.00', date: '', archived: true, dirty: 'clean' }), 'Archived monthly receipt, Store not set, ₱0.00, no date, archived');
  assert.equal(monthlyFilingSummaryName({ number: undefined, store: 'Store not set', amountText: 'No amount', date: '', archived: false, dirty: 'new' }), 'New monthly receipt, Store not set, No amount, no date, new, unsaved');
  assert.equal(monthlyFilingSignature(saved('x')), monthlyFilingSignature({ ...saved('x'), unrelated: 1 }));
});

// ---- D. the real Monthly Filing UI against a DOM fixture --------------------------------------------------------------------------
function fixture({ records = [], confirm = async () => true, reduced = false, sharedStoreService = { listActiveSharedStores: async () => [] } } = {}) {
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
  const elements = { workspace: node(), list, template: { content: { firstElementChild: { cloneNode: () => makeRow() } } }, activeTab: node(), archivedTab: node(), activeActions: node(), archivedActions: node(), exportHelper: node(), add: node(), save: node(), exportActive: node(), clearArchived: node(), clearAll: node(), feedback: node(), unsavedNote: node(), activeTotal: node(), activeTotalMain: node(), activeTotalDetail: node() };
  const calls = { create: [], update: [], remove: [], archive: [], ret: [], workbook: [], snapshots: [], confirms: [], confirmOptions: [], order: [] };
  let sequence = 0; const failures = { update: new Set(), createAt: new Set(), create: false, workbook: false, archive: false }; let createAttempts = 0;
  const service = {
    loadMonthlyFilingReceipts: async () => records.map(record => ({ ...record })),
    createMonthlyFilingReceipt: async receipt => { calls.order.push('create'); createAttempts += 1; if (failures.create || failures.createAt.has(createAttempts)) throw new Error('create failed'); calls.create.push(receipt); return { ...receipt, amount: String(normalizeMoneyAmount(receipt.amount) ?? ''), dbId: `new-${++sequence}`, status: 'active' }; },
    updateMonthlyFilingReceipt: async (id, receipt) => { calls.order.push('update'); if (failures.update.has(id)) throw new Error(`update ${id} failed`); calls.update.push([id, receipt]); return { ...receipt, amount: String(normalizeMoneyAmount(receipt.amount) ?? ''), dbId: id, status: 'active' }; },
    deleteMonthlyFilingReceipt: async id => { calls.remove.push(id); },
    archiveMonthlyFilingReceipts: async ids => { calls.order.push('archive'); if (failures.archive) throw new Error('archive failed'); calls.archive.push(ids); return ids.map(id => ({ ...records.find(record => record.dbId === id), dbId: id, status: 'archived' })); },
    returnMonthlyFilingReceiptToActive: async id => { calls.ret.push(id); return { ...records.find(record => record.dbId === id), dbId: id, status: 'active' }; },
    associateMonthlyFilingSharedStore: async id => ({ ...records.find(record => record.dbId === id), dbId: id })
  };
  const ui = createMonthlyFilingUi({
    elements, monthlyFilingService: service, sharedStoreService,
    downloadExpenseDetailedReport: snapshot => { calls.order.push('workbook'); if (failures.workbook) throw new Error('workbook failed'); calls.workbook.push(snapshot.map(record => record.dbId)); calls.snapshots.push(snapshot.map(record => ({ ...record }))); },
    confirmAction: async options => { calls.confirms.push(options.title); calls.confirmOptions.push(options); return confirm(options); }
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
  assert.equal(f.label(f.cards()[2]), 'Receipt 3', 'a new receipt is next in export order; the Archived receipt has no Item No.');
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
  assert.deepEqual(f.cards().map(f.label), ['Receipt 1', 'Receipt 2', 'Receipt 3']);
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
  assert.equal(f.label(f.cards()[0]), 'Archived', 'Archived receipts carry no Item No.');
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
  assert.deepEqual(f.cards().map(f.label), ['Receipt 1', 'Receipt 2'], 'deleting renumbers the receipts below it (export order)');
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
  assert.match(f.elements.feedback.textContent, /^Exported and archived 2 Monthly Filing receipts \(Total: ₱200\.00\)\.$/);
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

// ---- partial Save of two new receipts: actions must use the current record, not a render-time snapshot ----------------------------
async function partialSaveFixture(extra = {}) {
  const f = fixture({ records: [], ...extra }); await f.ui.loadForUser(user);
  await f.click(f.elements.add); await f.edit(f.cards()[0], 'store', 'First cafe'); await f.edit(f.cards()[0], 'amount', '10');
  await f.click(f.elements.add); await f.edit(f.cards()[1], 'store', 'Second cafe'); await f.edit(f.cards()[1], 'amount', '20');
  f.failures.createAt.add(2);
  await f.click(f.elements.save);
  return f;
}

test('after a partial Save of two new receipts the first is persisted, the second stays unsaved with its values, and no card was rebuilt', async () => {
  const f = await partialSaveFixture();
  assert.equal(f.calls.create.length, 1); assert.match(f.elements.feedback.textContent, /Could not save Monthly Filing changes: create failed/);
  assert.equal(f.cards().length, 2);
  assert.equal(f.cards()[0].dataset.monthlyId, 'new-1', 'the first card carries its new database ID');
  assert.equal(f.cards()[0].dataset.recordKey, 'db:new-1', 'its record key matches its database identity (no stale draft key)');
  assert.equal(f.flag(f.cards()[0]).hidden, true);
  assert.equal(f.cards()[1].dataset.monthlyId, '');
  assert.match(f.cards()[1].dataset.recordKey, /^draft:/);
  assert.equal(f.flag(f.cards()[1]).textContent, 'New, unsaved');
  assert.deepEqual(['store', 'amount'].map(key => f.field(f.cards()[1], key).value), ['Second cafe', '20']);
  assert.deepEqual(f.cards().map(f.label), ['Receipt 1', 'Receipt 2']);
  assert.deepEqual(f.cards().map(card => card.classList.contains('is-collapsed')), [false, false], 'both stay expanded');
});

test('Delete on the receipt that was just persisted asks for confirmation and calls the database delete with its ID', async () => {
  const f = await partialSaveFixture();
  await f.click(f.cards()[0].querySelector('.monthly-delete'));
  assert.ok(f.calls.confirms.includes('Delete Monthly Filing receipt?'), 'the destructive confirmation is still required');
  assert.deepEqual(f.calls.remove, ['new-1'], 'the persisted receipt is deleted in the database, not only locally');
  assert.equal(f.cards().length, 1); assert.equal(f.label(f.cards()[0]), 'Receipt 1', 'the remaining receipt is renumbered to its export position');
  assert.deepEqual(['store', 'amount'].map(key => f.field(f.cards()[0], key).value), ['Second cafe', '20']);
  assert.equal(f.flag(f.cards()[0]).textContent, 'New, unsaved');
  assert.ok([f.field(f.cards()[0], 'store'), f.summary(f.cards()[0])].includes(f.focusLog.at(-1).node), 'focus lands on the receipt that took its place');
});

test('cancelling that Delete changes nothing', async () => {
  const f = await partialSaveFixture({ confirm: async () => false });
  await f.click(f.cards()[0].querySelector('.monthly-delete'));
  assert.deepEqual(f.calls.remove, []); assert.equal(f.cards().length, 2);
  assert.equal(f.cards()[0].dataset.monthlyId, 'new-1'); assert.equal(f.flag(f.cards()[1]).textContent, 'New, unsaved');
});

test('retrying Save updates the persisted receipt and creates only the one that failed (no duplicates)', async () => {
  const f = await partialSaveFixture();
  f.failures.createAt.clear();
  await f.click(f.elements.save);
  assert.deepEqual(f.calls.update.map(([id]) => id), ['new-1'], 'the first receipt is updated, not created again');
  assert.equal(f.calls.create.length, 2, 'exactly one more create, for the receipt that failed');
  assert.ok(f.cards().every(card => f.flag(card).hidden)); assert.equal(f.elements.unsavedNote.hidden, true);
  assert.deepEqual(f.cards().map(card => card.dataset.monthlyId), ['new-1', 'new-2']);
  assert.deepEqual(f.cards().map(f.label), ['Receipt 1', 'Receipt 2']);
  assert.equal(f.elements.feedback.textContent, 'Monthly Filing changes saved.');
});

test('Return to Active uses the current record too: a receipt returned from Archived still acts on its database ID after a later partial save', async () => {
  const f = fixture({ records: activeRecords() }); await f.ui.loadForUser(user);
  await f.click(f.elements.archivedTab); await f.click(f.cards()[0].querySelector('.monthly-return-active'));
  await f.click(f.elements.add); await f.edit(f.cards().at(-1), 'store', 'Fresh'); await f.edit(f.cards().at(-1), 'amount', '5');
  await f.edit(f.cards()[0], 'invoice', 'EDIT');
  f.failures.update.add('a2');
  await f.click(f.elements.save);
  const returned = f.cards().find(card => card.dataset.monthlyId === 'z1');
  await f.click(returned.querySelector('.monthly-delete'));
  assert.deepEqual(f.calls.remove, ['z1']);
});

// ---- amount validation (NF-01): malformed amounts are never saved, exported or archived ---------------------------------------------------
test('Monthly Save with a malformed amount persists nothing, names the receipt, and keeps the typed value and the unsaved marker', async () => {
  const f = fixture({ records: activeRecords() }); await f.ui.loadForUser(user);
  await f.edit(f.cards()[1], 'invoice', 'ALSO-EDITED'); await f.edit(f.cards()[0], 'amount', '12,34.50');
  await f.click(f.elements.save);
  assert.equal(f.calls.update.length + f.calls.create.length, 0, 'not even the valid receipt is sent');
  assert.match(f.elements.feedback.textContent, /^Could not save Monthly Filing changes: Monthly receipt 1 \(Alpha\): Invalid amount "12,34\.50"\. Thousands commas must group exactly three digits/);
  assert.match(f.elements.feedback.textContent, /Nothing was saved/);
  assert.equal(f.field(f.cards()[0], 'amount').value, '12,34.50');
  assert.equal(f.flag(f.cards()[0]).textContent, 'Unsaved changes'); assert.equal(f.flag(f.cards()[1]).textContent, 'Unsaved changes');
  assert.equal(f.cards()[0].classList.contains('is-collapsed'), false, 'the receipt is expanded so the field can be corrected');
  assert.equal(f.elements.save.disabled, false);
  await f.edit(f.cards()[0], 'amount', '12,340.50'); await f.click(f.elements.save);
  assert.deepEqual(f.calls.update.map(([id, receipt]) => [id, receipt.amount]), [['a1', '12,340.50'], ['a2', '100']], 'once corrected, both receipts save');
  assert.deepEqual(toDatabaseMonthlyFilingReceipt(f.calls.update[0][1], 'u').amount, 12340.5);
});

test('a malformed amount on a new Monthly receipt is not created; blank and zero amounts still save', async () => {
  const f = fixture({ records: [] }); await f.ui.loadForUser(user);
  await f.click(f.elements.add); await f.edit(f.cards()[0], 'store', 'Negative'); await f.edit(f.cards()[0], 'amount', '-5');
  await f.click(f.elements.save);
  assert.equal(f.calls.create.length, 0); assert.match(f.elements.feedback.textContent, /Invalid amount "-5"\. Amounts cannot be negative\./);
  await f.edit(f.cards()[0], 'amount', '');
  await f.click(f.elements.add); await f.edit(f.cards()[1], 'store', 'Zero'); await f.edit(f.cards()[1], 'amount', '0');
  await f.click(f.elements.save);
  assert.deepEqual(f.calls.create.map(receipt => receipt.amount), ['', '0'], 'blank (NULL) and zero are both still allowed');
  assert.deepEqual(f.calls.create.map(receipt => toDatabaseMonthlyFilingReceipt(receipt, 'u').amount), [null, 0]);
});

test('Export & archive is refused when an Active amount is malformed: no workbook, no archive, receipts stay Active', async () => {
  const f = fixture({ records: activeRecords() }); await f.ui.loadForUser(user);
  await f.edit(f.cards()[1], 'amount', '1,250.999');
  await f.click(f.elements.exportActive);
  assert.equal(f.calls.workbook.length, 0); assert.equal(f.calls.archive.length, 0); assert.equal(f.calls.update.length, 0);
  assert.match(f.elements.feedback.textContent, /Could not save Monthly Filing changes: Monthly receipt 2 \(Beta\): Invalid amount "1,250\.999"/);
  assert.doesNotMatch(f.elements.feedback.textContent, /Exported and archived/);
  assert.equal(f.elements.activeTab.textContent, 'Active (2)'); assert.equal(f.elements.archivedTab.textContent, 'Archived (1)');
  assert.equal(f.elements.exportActive.disabled, false, 'export is available again after correction (not uncertain-archive blocked)');
  await f.edit(f.cards()[1], 'amount', '1,250.99'); await f.click(f.elements.exportActive);
  assert.deepEqual(f.calls.archive, [['a1', 'a2']]); assert.equal(f.elements.activeTab.textContent, 'Active (0)');
});

test('the Monthly workbook is built from the saved (normalized) records, so amounts match what was stored', async () => {
  const f = fixture({ records: activeRecords() }); await f.ui.loadForUser(user);
  await f.edit(f.cards()[0], 'amount', '1,250.50');
  await f.click(f.elements.exportActive);
  const snapshotAmounts = f.calls.workbook.length;
  assert.equal(snapshotAmounts, 1);
  const stored = toDatabaseMonthlyFilingReceipt(f.calls.update.find(([id]) => id === 'a1')[1], 'u').amount;
  assert.equal(stored, 1250.5, 'the value persisted for the exported receipt is the normalized amount');
});

// ---- CP10-C2: export-order numbering, Active Total, D-09, directory feedback, invalid amounts, Archived labels --------------------------------
const totalLine = f => [f.elements.activeTotalMain.textContent, f.elements.activeTotalDetail.textContent];
const dollars = cents => `₱${(Math.floor(cents / 100)).toLocaleString('en-PH')}.${String(cents % 100).padStart(2, '0')}`;
const sheetCents = rows => rows.slice(2).reduce((sum, row) => sum + (typeof row[7] === 'number' ? Math.round(row[7] * 100) : 0), 0);

test('C2-01: Active receipts are numbered 1..N in export order; Archived receipts and blank placeholders take no number', async () => {
  const f = fixture({ records: [saved('a1', { store: 'Alpha' }), { ...saved('z0', { store: 'Old' }), status: 'archived' }, saved('a2', { store: 'Beta' }), saved('a3', { store: 'Gamma' })] }); await f.ui.loadForUser(user);
  assert.deepEqual(f.cards().map(f.label), ['Receipt 1', 'Receipt 2', 'Receipt 3'], 'the Archived receipt between them does not consume a number');
  await f.click(f.elements.add);
  assert.equal(f.label(f.cards().at(-1)), 'New receipt', 'a blank placeholder has no Item No.');
  assert.deepEqual([...monthlyFilingExportNumbers([saved('x'), { ...base }, saved('y')]).values()], [1, 2], 'the pure helper skips blanks');
  await f.edit(f.cards().at(-1), 'store', 'Delta');
  assert.equal(f.label(f.cards().at(-1)), 'Receipt 4', 'a meaningful draft takes its prospective export number');
});

test('C2-01: deleting renumbers the receipts below it while identity, expansion and focus stay with the receipt', async () => {
  const f = fixture({ records: [saved('a1', { store: 'Alpha' }), saved('a2', { store: 'Beta' }), saved('a3', { store: 'Gamma' })] }); await f.ui.loadForUser(user);
  const keyBefore = f.cards()[2].dataset.recordKey; await f.click(f.summary(f.cards()[2]));
  await f.click(f.cards()[0].querySelector('.monthly-delete'));
  assert.deepEqual(f.cards().map(f.label), ['Receipt 1', 'Receipt 2']);
  assert.deepEqual(f.cards().map(card => card.dataset.monthlyId), ['a2', 'a3']);
  assert.equal(f.cards()[1].dataset.recordKey, keyBefore, 'the display number changed, the receipt identity did not');
  assert.equal(f.cards()[1].classList.contains('is-collapsed'), false, 'expansion follows the receipt');
  assert.deepEqual(f.calls.remove, ['a1']);
});

test('C2-01: Save keeps the order and numbers; multiple export cycles restart at 1; Return to Active slots in by order', async () => {
  const f = fixture({ records: [saved('a1', { store: 'Alpha' }), saved('a2', { store: 'Beta' })] }); await f.ui.loadForUser(user);
  await f.click(f.elements.add); await f.edit(f.cards().at(-1), 'store', 'Gamma');
  const before = f.cards().map(f.label); await f.click(f.elements.save);
  assert.deepEqual(f.cards().map(f.label), before, 'saving never renumbers'); assert.deepEqual(before, ['Receipt 1', 'Receipt 2', 'Receipt 3']);
  await f.click(f.elements.exportActive);
  assert.equal(f.cards().length, 0, 'everything is Archived after the export');
  await f.click(f.elements.add); await f.edit(f.cards()[0], 'store', 'Next cycle');
  assert.equal(f.label(f.cards()[0]), 'Receipt 1', 'a new cycle restarts at 1');
});

test('C2-01: Return to Active gives the receipt its export position and renumbers the later ones', async () => {
  const f = fixture({ records: [{ ...saved('z1', { store: 'Back' }), status: 'archived' }, saved('a1', { store: 'Alpha' })] }); await f.ui.loadForUser(user);
  assert.deepEqual(f.cards().map(f.label), ['Receipt 1']);
  await f.click(f.elements.archivedTab); await f.click(f.cards()[0].querySelector('.monthly-return-active'));
  assert.deepEqual(f.cards().map(card => [card.dataset.monthlyId, f.label(card)]), [['z1', 'Receipt 1'], ['a1', 'Receipt 2']]);
});

test('C2-06: Archived receipts show "Archived · date" (or "Archived"), never a number that could be mistaken for an Item No.', async () => {
  const f = fixture({ records: [{ ...saved('z1'), status: 'archived', archivedAt: '2026-10-11T12:00:00.000Z' }, { ...saved('z2'), status: 'archived' }] }); await f.ui.loadForUser(user);
  await f.click(f.elements.archivedTab);
  assert.match(f.label(f.cards()[0]), /^Archived · .*Oct.*2026$/); assert.equal(f.label(f.cards()[1]), 'Archived');
  assert.ok(f.cards().every(card => !/Receipt \d/.test(f.label(card)) && !/Receipt \d/.test(f.summary(card).getAttribute('aria-label'))));
  assert.equal(monthlyFilingArchivedLabel('not a date'), 'Archived'); assert.equal(monthlyFilingArchivedLabel(''), 'Archived');
  assert.equal(f.cards()[0].querySelector('.monthly-delete').hidden, true); assert.equal(f.field(f.cards()[0], 'store').disabled, true); assert.equal(f.cards()[0].querySelector('.monthly-return-active').hidden, false);
});

test('C2-01/D-09: displayed numbers equal the workbook Item No., matched by database ID (several receipts share one store name), and the totals reconcile', async () => {
  const f = fixture({ records: [saved('a1', { store: 'Shared', amount: '500' }), saved('a2', { store: 'Shared', amount: '700.10' }), { ...saved('z1', { store: 'Shared' }), status: 'archived' }, saved('a3', { store: 'Other', amount: '300.20' })] }); await f.ui.loadForUser(user);
  await f.click(f.cards()[0].querySelector('.monthly-delete'));
  assert.deepEqual(f.cards().map(card => [card.dataset.monthlyId, f.label(card)]), [['a2', 'Receipt 1'], ['a3', 'Receipt 2']], 'deleting a1 renumbers the others dynamically');
  for (const [store, invoice, amount] of [['Shared', 'D-1', '1,000.05'], ['Shared', 'D-2', '10']]) { await f.click(f.elements.add); const card = f.cards().at(-1); await f.edit(card, 'store', store); await f.edit(card, 'invoice', invoice); await f.edit(card, 'amount', amount); }
  await f.edit(f.cards()[0], 'amount', '710.10');
  // Displayed numbers before export. Persisted receipts are keyed by database ID; unsaved drafts have no ID yet, so they are keyed by their unique invoice.
  const persisted = new Map(); const drafts = new Map();
  f.cards().forEach(card => { if (card.dataset.monthlyId) persisted.set(card.dataset.monthlyId, f.label(card)); else drafts.set(f.field(card, 'invoice').value, f.label(card)); });
  assert.deepEqual([...persisted], [['a2', 'Receipt 1'], ['a3', 'Receipt 2']]); assert.deepEqual([...drafts], [['D-1', 'Receipt 3'], ['D-2', 'Receipt 4']]);
  assert.equal(totalLine(f)[0], 'Active Total: ₱2,020.35');
  await f.click(f.elements.exportActive);
  const [snapshot] = f.calls.snapshots; const rows = buildExpenseDetailedReportRows(snapshot);
  // Drafts acquire their database ID during Save: recover it from the create call that persisted each draft (new-1, new-2 in call order).
  const createdId = new Map(f.calls.create.map((receipt, index) => [receipt.invoice, `new-${index + 1}`]));
  assert.deepEqual(snapshot.map(record => record.dbId), ['a2', 'a3', 'new-1', 'new-2'], 'the exact saved snapshot, in export order');
  assert.equal(new Set(snapshot.map(record => record.dbId)).size, 4, 'distinct database IDs'); assert.equal(snapshot.filter(record => record.store === 'Shared').length, 3, 'three different receipts share one store name');
  snapshot.forEach((record, index) => {
    const shown = persisted.get(record.dbId) ?? [...drafts].find(([invoice]) => createdId.get(invoice) === record.dbId)?.[1];
    assert.ok(shown, `${record.dbId} had a number on screen before the export`);
    assert.equal(`Receipt ${rows[index + 2][0]}`, shown, `${record.dbId}: Item No. equals the number shown before export`);
  });
  assert.equal(dollars(sheetCents(rows)), '₱2,020.35', 'workbook Amount column = displayed Active Total');
  assert.equal(monthlyFilingSnapshotTotalCents(snapshot), 202035);
  assert.match(f.elements.feedback.textContent, /^Exported and archived 4 Monthly Filing receipts \(Total: ₱2,020\.35\)\.$/, 'the reported total comes from the same exported snapshot');
});

test('D-09 / EXPORT-UX-02: a receipt without an amount adds nothing, is counted as "without amount", and the workbook leaves its Amount cell empty (not 0)', async () => {
  const f = fixture({ records: [saved('a1', { store: 'Alpha', amount: '100' }), saved('a2', { store: 'Beta', amount: '' })] }); await f.ui.loadForUser(user);
  assert.deepEqual(totalLine(f), ['Active Total: ₱100.00', '2 receipts · 1 without amount']);
  await f.click(f.elements.exportActive);
  const rows = buildExpenseDetailedReportRows(f.calls.snapshots[0]);
  assert.equal(rows[3][7], null, 'a missing amount is an empty cell; an explicit 0 would be numeric zero');
  assert.equal(sheetCents(rows), 10000); assert.match(f.elements.feedback.textContent, /\(Total: ₱100\.00\)/);
});

test('C2-02: the Active Total is exact, excludes Archived receipts and blank placeholders, and follows every edit', async () => {
  const f = fixture({ records: [saved('a1', { amount: '0.10' }), saved('a2', { amount: '0.20' }), { ...saved('z1', { amount: '999' }), status: 'archived' }] }); await f.ui.loadForUser(user);
  assert.deepEqual(totalLine(f), ['Active Total: ₱0.30', '2 receipts'], '0.10 + 0.20 is exactly 0.30; Archived 999 excluded');
  await f.click(f.elements.add); assert.deepEqual(totalLine(f), ['Active Total: ₱0.30', '2 receipts'], 'a blank placeholder is not counted');
  await f.edit(f.cards()[1], 'amount', '9,999,999,999.99'); await f.edit(f.cards()[0], 'amount', '0.01');
  assert.equal(totalLine(f)[0], 'Active Total: ₱10,000,000,000.00', 'integer centavos carry exactly');
  assert.equal(f.elements.activeTotal.hidden, false);
});

test('C2-02: unsaved edits show the working total, "includes unsaved changes" and the Saved Total; reverting returns to the plain total', async () => {
  const f = fixture({ records: [saved('a1', { amount: '500' }), saved('a2', { amount: '700' }), saved('a3', { amount: '300' })] }); await f.ui.loadForUser(user);
  assert.deepEqual(totalLine(f), ['Active Total: ₱1,500.00', '3 receipts']);
  await f.edit(f.cards()[1], 'amount', '800');
  assert.deepEqual(totalLine(f), ['Active Total: ₱1,600.00', '3 receipts · Includes unsaved changes · Saved Total: ₱1,500.00']);
  assert.equal(f.elements.unsavedNote.textContent, '1 unsaved receipt', 'the unsaved indicator is unchanged');
  await f.edit(f.cards()[1], 'amount', '700'); assert.deepEqual(totalLine(f), ['Active Total: ₱1,500.00', '3 receipts']);
  await f.edit(f.cards()[1], 'amount', '800'); await f.click(f.elements.save);
  assert.deepEqual(totalLine(f), ['Active Total: ₱1,600.00', '3 receipts'], 'after Save the saved total catches up');
  await f.click(f.cards()[2].querySelector('.monthly-delete')); assert.deepEqual(totalLine(f), ['Active Total: ₱1,300.00', '2 receipts'], 'Delete updates it');
});

test('C2-02: an invalid amount makes the total unavailable and names the receipt; no partial figure and never a zero', async () => {
  const f = fixture({ records: [saved('a1', { amount: '500' }), saved('a2', { amount: '700' })] }); await f.ui.loadForUser(user);
  await f.edit(f.cards()[1], 'amount', '12,34.50');
  assert.deepEqual(totalLine(f), ['Active Total unavailable', 'Receipt 2 has an invalid amount']); assert.equal(f.elements.activeTotal.classList.contains('is-unavailable'), true);
  await f.edit(f.cards()[0], 'amount', 'abc');
  assert.equal(totalLine(f)[1], 'Receipts 1, 2 have invalid amounts'); assert.doesNotMatch(totalLine(f).join(' '), /₱/);
  await f.edit(f.cards()[0], 'amount', '500'); await f.edit(f.cards()[1], 'amount', '700');
  assert.equal(totalLine(f)[0], 'Active Total: ₱1,200.00'); assert.equal(f.elements.activeTotal.classList.contains('is-unavailable'), false);
});

test('C2-02: after a partial Save the saved total includes only the confirmed write; after a first-write failure it is unchanged', async () => {
  const f = fixture({ records: [saved('a1', { amount: '100' }), saved('a2', { amount: '100' })] }); await f.ui.loadForUser(user);
  await f.edit(f.cards()[0], 'amount', '150'); await f.edit(f.cards()[1], 'amount', '250'); f.failures.update.add('a2');
  await f.click(f.elements.save);
  assert.deepEqual(totalLine(f), ['Active Total: ₱400.00', '2 receipts · Includes unsaved changes · Saved Total: ₱250.00'], 'a1 (150) is saved, a2 still 100 in the database');
  assert.equal(f.elements.unsavedNote.textContent, '1 unsaved receipt');
  const g = fixture({ records: [saved('a1', { amount: '100' })] }); await g.ui.loadForUser(user);
  await g.edit(g.cards()[0], 'amount', '150'); g.failures.update.add('a1'); await g.click(g.elements.save);
  assert.deepEqual(totalLine(g), ['Active Total: ₱150.00', '1 receipt · Includes unsaved changes · Saved Total: ₱100.00']);
});

test('C2-03: the export confirmation states the working total and that unsaved changes are saved first; an unavailable total shows no figure', async () => {
  const f = fixture({ records: [saved('a1', { amount: '500' }), saved('a2', { amount: '700' })] }); await f.ui.loadForUser(user);
  await f.edit(f.cards()[1], 'amount', '800'); await f.click(f.elements.exportActive);
  const [options] = f.calls.confirmOptions; assert.match(options.message, /Active Total: ₱1,300\.00\./); assert.match(options.message, /Unsaved changes are saved first\./);
  const g = fixture({ records: [saved('a1', { amount: '500' })] }); await g.ui.loadForUser(user);
  await g.edit(g.cards()[0], 'amount', '5,00,0'); await g.click(g.elements.exportActive);
  assert.doesNotMatch(g.calls.confirmOptions[0].message, /₱/, 'no misleading total'); assert.deepEqual(g.calls.workbook, [], 'validation still blocks the export');
  assert.match(g.elements.feedback.textContent, /^Could not save Monthly Filing changes: Monthly receipt 1/);
});

test('C2-03: export failures never claim success; archive uncertainty keeps its safeguard and may show the confirmed workbook total', async () => {
  const workbook = fixture({ records: [saved('a1', { amount: '100' })] }); await workbook.ui.loadForUser(user); workbook.failures.workbook = true;
  await workbook.click(workbook.elements.exportActive);
  assert.match(workbook.elements.feedback.textContent, /^Could not prepare the XLSX export: workbook failed$/); assert.deepEqual(workbook.calls.archive, []);
  assert.deepEqual(totalLine(workbook), ['Active Total: ₱100.00', '1 receipt'], 'receipts are still Active');
  const archive = fixture({ records: [saved('a1', { amount: '100' }), saved('a2', { amount: '50.25' })] }); await archive.ui.loadForUser(user); archive.failures.archive = true;
  await archive.click(archive.elements.exportActive);
  assert.match(archive.elements.feedback.textContent, /^Workbook generated, but archive status could not be confirmed\. Refresh Monthly Filing before exporting again\. \(archive failed\) Workbook total: ₱150\.25\.$/);
  assert.doesNotMatch(archive.elements.feedback.textContent, /Exported and archived/); assert.equal(archive.elements.exportActive.disabled, true, 'uncertain archive blocks another export');
});

test('C2-05: an invalid amount is never shown as money: summary text, flag, Amount field message, aria-invalid, and it clears when corrected', async () => {
  const f = fixture({ records: [saved('a1', { amount: '100' })] }); await f.ui.loadForUser(user);
  const card = f.cards()[0]; const input = f.field(card, 'amount'); const error = card.querySelector('.monthly-amount-error'); const summaryAmount = f.summary(card).querySelector('.monthly-summary-amount');
  assert.equal(input.getAttribute('aria-invalid'), null); assert.equal(error.hidden, true);
  await f.edit(card, 'amount', '12,34.50');
  assert.equal(input.value, '12,34.50', 'the typed text is preserved'); assert.equal(summaryAmount.textContent, 'Invalid amount'); assert.equal(summaryAmount.classList.contains('is-invalid'), true);
  assert.equal(input.getAttribute('aria-invalid'), 'true'); assert.equal(input.getAttribute('aria-describedby'), error.id); assert.ok(error.id);
  assert.equal(error.hidden, false); assert.match(error.textContent, /^Invalid amount\. Thousands commas must group exactly three digits/);
  assert.ok(f.summary(card).querySelector('.monthly-summary-flags').kids.some(flag => flag.textContent === 'Invalid amount'));
  assert.match(f.summary(card).getAttribute('aria-label'), /Invalid amount/); assert.equal(card.classList.contains('has-invalid-amount'), true);
  await f.edit(card, 'amount', ''); assert.equal(summaryAmount.textContent, 'No amount'); assert.equal(input.getAttribute('aria-invalid'), null);
  await f.edit(card, 'amount', '1,250.50'); assert.equal(summaryAmount.textContent, '₱1,250.50');
  assert.equal(input.getAttribute('aria-invalid'), null); assert.equal(input.getAttribute('aria-describedby'), null); assert.equal(error.hidden, true); assert.equal(card.classList.contains('has-invalid-amount'), false);
  assert.equal(summaryAmount.classList.contains('is-invalid'), false);
});

test('C2-05: Save still refuses an invalid amount before writing anything and names the receipt by its export number', async () => {
  const f = fixture({ records: [saved('a1', { store: 'Alpha', amount: '100' }), saved('a2', { store: 'Beta', amount: '100' })] }); await f.ui.loadForUser(user);
  await f.edit(f.cards()[1], 'amount', '1,250.999'); await f.click(f.elements.save);
  assert.equal(f.calls.update.length, 0); assert.match(f.elements.feedback.textContent, /Monthly receipt 2 \(Beta\): Invalid amount "1,250\.999"/);
});

// ---- C2-04 directory feedback ------------------------------------------------------------------------------------------------------------
test('C2-04: directoryOutcomeFeedback aggregates by type, puts failures first and keeps every distinct failure reason', () => {
  assert.equal(directoryOutcomeFeedback([]), '');
  assert.equal(directoryOutcomeFeedback([{ type: 'declined' }]), 'Monthly Filing saved. 1 store was kept only in Monthly Filing.');
  assert.equal(directoryOutcomeFeedback(Array.from({ length: 4 }, () => ({ type: 'declined' }))), 'Monthly Filing saved. 4 stores were kept only in Monthly Filing.');
  assert.equal(directoryOutcomeFeedback([{ type: 'declined' }, { type: 'contributed' }, { type: 'duplicate-reused' }, { type: 'duplicate-reused' }, { type: 'declined' }]),
    'Monthly Filing saved. 1 store was added to the Company Directory. 2 stores were already in the Company Directory. 2 stores were kept only in Monthly Filing.');
  const failures = directoryOutcomeFeedback([{ type: 'declined' }, { type: 'directory-failed', reason: 'denied.' }, { type: 'directory-failed', reason: 'timeout' }, { type: 'directory-failed', reason: 'denied' }, { type: 'directory-failed', reason: 'quota' }, { type: 'association-failed', reason: 'locked' }, { type: 'ambiguous' }, { type: 'ambiguous' }]);
  assert.match(failures, /^Monthly Filing saved\. 4 stores could not be added to the Company Directory: denied; timeout; quota\. The Company Directory association could not be recorded for 1 receipt: locked\. 2 stores match multiple Company profiles; add more identifying information before adding them to the directory\. 1 store was kept only in Monthly Filing\.$/, 'failures first; three distinct reasons, none dropped; duplicates collapsed');
  assert.equal(directoryOutcomeFeedback([{ type: 'ambiguous' }]), 'Monthly Filing saved. 1 store matches multiple Company profiles; add more identifying information before adding it to the directory.');
  assert.equal(directoryOutcomeFeedback([{ type: 'declined' }, { type: 'contributed' }], { saved: false }), '1 store was added to the Company Directory. 1 store was kept only in Monthly Filing.', 'no repeated "Monthly Filing saved." when appended to an export message');
});

const newStore = (id, store) => saved(id, { store, address: `${store} Street`, dbId: '' });
test('C2-04: several declined stores give ONE concise message; duplicate candidates are asked about once; nothing is added without a yes', async () => {
  const contributed = []; const f = fixture({ records: [], confirm: async options => options.title !== 'Add store to Company Directory?', sharedStoreService: { listActiveSharedStores: async () => [], contributeSharedStore: async candidate => { contributed.push(candidate); return { id: 's1' }; } } });
  await f.ui.loadForUser(user);
  for (const store of ['Alpha', 'Beta', 'Gamma', 'Alpha']) { await f.click(f.elements.add); const card = f.cards().at(-1); await f.edit(card, 'store', store); await f.edit(card, 'address', `${store} Street`); }
  await f.click(f.elements.save);
  assert.equal(f.calls.confirms.filter(title => title === 'Add store to Company Directory?').length, 3, 'the duplicate Alpha candidate is asked about once');
  assert.equal(f.elements.feedback.textContent, 'Monthly Filing saved. 3 stores were kept only in Monthly Filing.'); assert.deepEqual(contributed, []);
});

test('C2-04: mixed outcomes and contribution failures are reported by type, with the reason kept', async () => {
  let answers = 0; const f = fixture({ records: [], confirm: async () => ++answers === 1, sharedStoreService: { listActiveSharedStores: async () => [], contributeSharedStore: async () => ({ id: 's1', storeName: 'x' }) } });
  await f.ui.loadForUser(user);
  for (const store of ['Alpha', 'Beta']) { await f.click(f.elements.add); const card = f.cards().at(-1); await f.edit(card, 'store', store); await f.edit(card, 'address', `${store} Street`); }
  await f.click(f.elements.save);
  assert.equal(f.elements.feedback.textContent, 'Monthly Filing saved. 1 store was added to the Company Directory. 1 store was kept only in Monthly Filing.');
  const g = fixture({ records: [], sharedStoreService: { listActiveSharedStores: async () => [], contributeSharedStore: async () => { throw new Error('permission denied'); } } });
  await g.ui.loadForUser(user); await g.click(g.elements.add); await g.edit(g.cards()[0], 'store', 'Alpha'); await g.edit(g.cards()[0], 'address', 'A St'); await g.click(g.elements.save);
  assert.equal(g.elements.feedback.textContent, 'Monthly Filing saved. 1 store could not be added to the Company Directory: permission denied.');
});

test('C2-04: the export success message appends the directory summary without repeating "Monthly Filing saved."', async () => {
  const f = fixture({ records: [saved('a1', { amount: '100' })], confirm: async options => options.title !== 'Add store to Company Directory?' }); await f.ui.loadForUser(user);
  await f.click(f.elements.add); await f.edit(f.cards().at(-1), 'store', 'Delta'); await f.edit(f.cards().at(-1), 'address', 'D St'); await f.edit(f.cards().at(-1), 'amount', '50');
  await f.click(f.elements.exportActive);
  assert.equal(f.elements.feedback.textContent, 'Exported and archived 2 Monthly Filing receipts (Total: ₱150.00). 1 store was kept only in Monthly Filing.');
});

// ---- markup, styling and service contracts -------------------------------------------------------------------------------------------------
test('C2 markup: the Amount error sits beside the field, the total is a plain (non-live) text line, and Monthly styling stays token-only and Monthly-scoped', async () => {
  assert.match(template, /<label>Amount<input class="monthly-amount" inputmode="decimal" placeholder="0\.00" \/><span class="monthly-amount-error" hidden><\/span><\/label>/);
  assert.match(staticHtml, /<p class="monthly-active-total" id="monthlyActiveTotal" hidden><strong class="monthly-total-main" id="monthlyActiveTotalMain"><\/strong><span class="monthly-total-detail" id="monthlyActiveTotalDetail"><\/span><\/p>/);
  assert.doesNotMatch(staticHtml.match(/<p class="monthly-active-total"[^>]*>/)[0], /aria-live|role=/, 'not a live region: it changes on every keystroke');
  const css = await read('../styles.css'); const block = css.slice(css.indexOf('/* Active Total:'), css.indexOf('.monthly-actions-bar .workflow-feedback { min-height: 0;'));
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|!important/); assert.match(block, /\.monthly-active-total\.is-unavailable \.monthly-total-main::before \{ content: "⚠ "; \}/, 'unavailable is an icon and text, not colour alone');
  assert.match(block, /\.monthly-amount-error \{ color: var\(--danger\)/); assert.match(block, /\.monthly-card\.has-invalid-amount \.monthly-amount \{ border-color: var\(--danger\)/);
  assert.match(css, /\.monthly-active-total \{ order: -3; flex: 1 1 100%;/, 'on phones it takes its own line in the same action bar');
});

test('C2-01 load order: receipts load by created_at then id, so the numbers after a reload are deterministic', async () => {
  const source = await read('../services/monthlyFilingService.js');
  assert.match(source, /\.order\('created_at', \{ ascending: true \}\)\.order\('id', \{ ascending: true \}\)/);
});

test('C2 scope: the export builder and money parser are untouched and still the only sources of workbook and parsing rules', async () => {
  const ui = await read('../ui/monthlyFilingUi.js');
  assert.match(ui, /import \{ parseMoneyAmount \} from '\.\.\/domain\/moneyAmount\.js';/); assert.doesNotMatch(ui, /exportService|numericAmount/);
  assert.doesNotMatch(ui, /Number\(String\(value \?\? ''\)\.replaceAll/, 'the lenient amount formatter is gone');
});

// ---- CP10-C2R: floating Add receipt and the in-flow receipt header --------------------------------------------------------------------------
test('C2R: the receipt header is an in-flow line, not absolutely positioned, so Archived · date can never overlap a field label', async () => {
  const css = (await read('../styles.css')).replace(/\r\n/g, '\n');
  const rule = css.match(/\.monthly-card \.form-group-title \{[^}]*\}/g);
  assert.ok(rule && rule.length >= 1);
  for (const declaration of rule) assert.doesNotMatch(declaration, /position: absolute|max-width: 55%|top: 6px/, 'no fragile absolute offsets');
  assert.match(rule[0], /display: flex; flex-wrap: wrap;[^}]*margin: 0 0 var\(--space-1\)/, 'a wrapping header line with its own height');
  assert.match(css, /\.monthly-card\[data-status="archived"\] \.monthly-status \{ display: none; \}/, 'the Archived badge is not repeated next to "Archived · date"');
  assert.doesNotMatch(css, /\.monthly-card\[data-status="archived"\] \.monthly-status \{ display: inline-block/);
});

test('C2R: Add receipt floats bottom-right only on wide desktop (1280px+, tall viewports) using the same button; tablets, phones and short viewports keep it in the bar', async () => {
  const css = (await read('../styles.css')).replace(/\r\n/g, '\n');
  const block = css.slice(css.indexOf('/* Floating Add receipt'), css.indexOf('.monthly-unsaved-note {'));
  assert.match(block, /@media \(min-width: 1280px\) and \(min-height: 480px\) \{/, 'wide and tall windows only (short viewports/zoom keep the bar)');
  assert.equal(count(css, /\.monthly-add[^{]*\{[^}]*position: fixed/g), 1, 'exactly one floating rule, inside that query: tablets (641-1279px), phones and short viewports keep the static Add in the action bar');
  assert.match(block, /\.monthly-filing-workspace:has\(#monthlyFilingActiveActions:not\(\[hidden\]\)\) \.monthly-filing-list, [^{]*\.monthly-more-actions \{ margin-right: 176px; \}/, 'a reserved right gutter (button width + gap) on the list and the More actions row, only while the Active actions (and so the button) are shown');
  assert.match(block, /\.monthly-add \{ position: fixed; right: var\(--space-5\);[^}]*min-height: 48px/, 'the gutter must stay wider than the button (about 149px) plus its right inset');
  assert.match(block, /\.monthly-filing-workspace \.monthly-add \{ position: fixed; right: var\(--space-5\); bottom: var\(--space-5\);[^}]*border: 2px solid var\(--primary\)[^}]*background: var\(--surface\); color: var\(--primary\)/);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|!important/, 'theme tokens only (Light and Dark)');
  assert.match(block, /scroll-padding-bottom: 96px/, 'a focused receipt is never hidden behind the floating button');
  assert.equal(count(html, /id="monthlyFilingAdd"/g), 1, 'one Add control, no duplicate');
  assert.ok(html.indexOf('id="monthlyFilingAdd"') < html.indexOf('id="monthlyFilingSave"'), 'DOM and Tab order unchanged: Add first in the Active actions');
  const phone = css.slice(css.indexOf('@media (max-width: 640px) {\n  .receipts-bar'));
  assert.doesNotMatch(phone, /\.monthly-add[^{]*\{[^}]*position: fixed/, 'phones keep the sticky bottom bar');
  const active = html.slice(html.indexOf('id="monthlyFilingActiveActions"'), html.indexOf('id="monthlyFilingArchivedActions"'));
  assert.match(active, /id="monthlyFilingAdd"/, 'it sits in the Active actions, which are hidden on the Archived tab');
});

test('C2R: Add still reuses or creates the blank receipt, focuses Store and keeps other unsaved edits (handler unchanged)', async () => {
  const f = fixture({ records: [saved('a1', { store: 'Alpha' })] }); await f.ui.loadForUser(user);
  await f.edit(f.cards()[0], 'invoice', 'EDITED'); await f.click(f.elements.add); await f.click(f.elements.add);
  assert.equal(f.cards().length, 2, 'repeated Add reuses the one blank receipt'); assert.equal(f.field(f.cards()[0], 'invoice').value, 'EDITED');
  assert.equal(f.focusLog.at(-1).node, f.field(f.cards()[1], 'store')); assert.equal(f.label(f.cards()[1]), 'New receipt');
  await f.click(f.elements.archivedTab); assert.equal(f.elements.activeActions.hidden, true, 'the Active actions (and the floating Add) are hidden on Archived');
});
