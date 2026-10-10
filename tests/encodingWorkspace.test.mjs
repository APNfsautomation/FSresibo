import nodeAssert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createReceiptUi } from '../ui/receiptUi.js';
import { optimizationStrategies } from '../services/optimizationService.js';
import { isTextEntry, trackTextEntry } from '../ui/textEntryFocus.js';

// match/doesNotMatch report the pattern, not the whole stylesheet, when they fail.
const assert = { ...nodeAssert, match: (text, pattern, message) => nodeAssert.ok(pattern.test(text), message ?? `expected a match for ${pattern}`), doesNotMatch: (text, pattern, message) => nodeAssert.ok(!pattern.test(text), message ?? `expected no match for ${pattern}`) };
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const html = await read('../index.html');
const staticHtml = html.replace(/<template[\s\S]*?<\/template>/g, '');
const template = html.match(/<template id="receiptTemplate">([\s\S]*?)<\/template>/)[1];
const css = (await read('../styles.css')).replace(/\r\n/g, '\n');
const count = (text, pattern) => (text.match(pattern) ?? []).length;
const encoding = staticHtml.slice(staticHtml.indexOf('id="encodingWorkspace"'), staticHtml.indexOf('id="optimizationWorkspace"'));

// ---- markup: bar, action controls, template ---------------------------------------------------------------------------------
test('Receipt workspace controls keep their IDs inside one compact bar', () => {
  const bar = staticHtml.slice(staticHtml.indexOf('id="receiptsBar"'), staticHtml.indexOf('id="encodingWorkspace"'));
  for (const id of ['receiptWorkspaceSwitcher', 'encodingTab', 'optimizationTab', 'receiptStatusControl', 'receiptStatusFilter']) assert.equal(count(bar, new RegExp(`id="${id}"`, 'g')), 1, `#${id} is in the bar`);
  assert.match(bar, /role="tablist"/);
  assert.match(bar, /<option value="available">Available<\/option><option value="consumed">Consumed<\/option><option value="all">All<\/option>/, 'status filter options unchanged');
  for (const id of ['availableTotal', 'encodingAmountCompartment']) assert.equal(count(encoding, new RegExp(`id="${id}"`, 'g')), 1);
  const all = [...staticHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(all.filter((id, index) => all.indexOf(id) !== index), [], 'no duplicate IDs');
});

test('Clear form, Add receipt and Save changes sit in one action bar above the list, once each, with the status line beside them', () => {
  const bar = encoding.slice(encoding.indexOf('id="encodingActions"'), encoding.indexOf('class="panel encoding-panel"'));
  assert.ok(bar.length > 0 && encoding.indexOf('id="encodingActions"') < encoding.indexOf('id="receiptList"'), 'the bar precedes the receipt list');
  const order = ['id="clearAll"', 'class="action-bar-spacer"', 'id="floatingAddReceipt"', 'id="saveDraft"', 'id="encodingFeedback"'].map(token => bar.indexOf(token));
  assert.ok(order.every(position => position > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'Clear, spacer, Add, Save, then the status line');
  for (const id of ['clearAll', 'floatingAddReceipt', 'saveDraft', 'encodingFeedback']) assert.equal(count(staticHtml, new RegExp(`id="${id}"`, 'g')), 1, `#${id} is not duplicated`);
  assert.match(bar, /<button class="primary action-save" id="saveDraft" type="button">Save changes<\/button>/);
  assert.match(bar, /<button class="ghost danger" id="clearAll" type="button">Clear form<\/button>/);
  assert.match(bar, /id="floatingAddReceipt" type="button"><span aria-hidden="true">\+<\/span> Add receipt<\/button>/, 'the visible label is the accessible name');
  assert.match(bar, /id="encodingFeedback" role="status" aria-live="polite"/);
});

test('the receipt template keeps every field, action and the keyboard-reachable scan control', () => {
  for (const cls of ['receipt-amount', 'receipt-receiptDate', 'receipt-vat', 'receipt-invoice', 'receipt-store', 'receipt-address', 'receipt-tin', 'receipt-photo', 'contribute-store', 'delete-receipt', 'restore-receipt', 'ocr-status', 'store-suggestions', 'summary-id', 'summary-store', 'summary-amount', 'receipt-status-badge', 'summary-toggle']) {
    assert.equal(count(template, new RegExp(`class="([^"]* )?${cls}( [^"]*)?"`, 'g')), 1, `.${cls} appears once in the template`);
  }
  assert.match(template, /<input class="receipt-photo" type="file" accept="image\/\*" capture="environment" \/>/);
  assert.doesNotMatch(template, /receipt-photo[^>]*(tabindex="-1"|hidden)/, 'the file input stays focusable');
  assert.match(template, /role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false"/, 'store autocomplete roles unchanged');
  assert.ok(template.indexOf('receipt-amount') < template.indexOf('receipt-store'), 'Amount comes first in the DOM (and in Tab order)');
});

// ---- CSS: layout rules ------------------------------------------------------------------------------------------------------
test('rows are one compact line and the editor is two columns on wide windows, stacked below 1100px', () => {
  assert.match(css, /\.receipt-summary \{[^}]*min-height: 48px/);
  assert.match(css, /\.receipt-summary \{[^}]*grid-template-areas: "id store amount badge toggle"/);
  assert.match(css, /\.encoding-list \.receipt-content \{[^}]*grid-template-columns: minmax\(0, 5fr\) minmax\(0, 7fr\)/);
  assert.match(css, /@media \(max-width: 1100px\) \{\n  \.encoding-list \.receipt-content \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.encoding-list \.receipt-amount \{[^}]*font-size: 1\.125rem[^}]*font-weight: var\(--weight-bold\)/, 'Amount is prominent and at least 16px');
  assert.match(css, /\.summary-store \{[^}]*text-overflow: ellipsis/, 'long names truncate in the row (the full name is the title and the editor value)');
});

test('control heights agree: 40px (44px on coarse pointers) in the editor, 44px on phones', () => {
  assert.match(css, /\.encoding-list \.receipt-fields input, \.encoding-list \.receipt-fields select \{ height: var\(--control-height\); min-height: var\(--control-height\); \}/);
  assert.match(css, /@media \(pointer: coarse\) \{ :root \{ --control-height: 44px; \} \}/);
  const phone = css.slice(css.indexOf('@media (max-width: 640px) {\n  .receipts-bar'), css.indexOf('@media (prefers-reduced-motion'));
  assert.match(phone, /\.encoding-list \.receipt-fields input, \.encoding-list \.receipt-fields select \{ height: 44px; min-height: 44px; \}/);
  assert.match(phone, /\.encoding-list \.scan-button \{ min-height: 44px; \}/);
  assert.doesNotMatch(css, /\.receipt-fields input, \.receipt-fields select \{ min-height: 42px; \}[\s\S]*\.encoding-list \.receipt-fields input[^{]*\{[^}]*42px/, 'no 42px control height in the Encoding editor');
});

test('the store suggestion list is not clipped by the compact receipt card and stays above following rows', () => {
  assert.match(css, /\.encoding-list \.receipt-card \{[^}]*overflow: visible/);
  assert.match(css, /\.store-suggestions \{[^}]*position: absolute; z-index: 15;/);
  assert.doesNotMatch(css, /\.encoding-panel \{[^}]*overflow: hidden/);
  assert.match(css, /\.encoding-list \.receipt-card \{[^}]*scroll-margin-bottom: 96px/, 'a focused row scrolls clear of the phone action bar');
});

test('the action bar is in-flow above the list on desktop and sticky (never fixed) only on phones, with safe-area padding and a keyboard-safe step-aside', () => {
  assert.doesNotMatch(css.slice(0, css.indexOf('@media (max-width: 640px) {\n  .receipts-bar')), /#encodingActions \{[^}]*position: (fixed|sticky)/, 'desktop bar is in normal flow');
  assert.equal(count(css, /\.floating-add \{[^}]*position: fixed/g), 0, 'Add receipt is no longer a fixed pill');
  const phone = css.slice(css.indexOf('@media (max-width: 640px) {\n  .receipts-bar'), css.indexOf('@media (prefers-reduced-motion'));
  assert.match(phone, /\.encoding-workspace > #encodingActions \{ order: 6; position: sticky; bottom: 0;[^}]*env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(phone, /#encodingActions[^{]*\{[^}]*position: fixed/);
  assert.match(phone, /\.encoding-workspace\.is-editing > #encodingActions:not\(:focus-within\) \{ opacity: 0; pointer-events: none; transform: translateY\(100%\); \}/);
  assert.doesNotMatch(phone, /is-editing[^{]*\{[^}]*(display: none|visibility: hidden)/, 'stepping aside never removes it from the Tab order');
  assert.match(phone, /#encodingActions button \{[^}]*min-height: 44px/);
  const drawerZ = Number(css.match(/\.application-navigation \{ position: fixed; z-index: (\d+)/)[1]);
  assert.ok(12 < drawerZ, 'the bar sits below the navigation drawer');
});

test('Monthly Filing keeps its own card layout: its rules are untouched and the compact editor rules are scoped to the Encoding list', () => {
  for (const monthly of ['.monthly-card .receipt-content { display: block; }', '.monthly-card { padding: 0; }', '.monthly-filing-tabs .workspace-tab { flex: 0 1 auto; }', '.monthly-suggestions { position: static; margin-top: var(--space-1); }']) assert.ok(css.includes(monthly), `${monthly} is intact`);
  const compact = css.slice(css.indexOf('/* Compact editor'), css.indexOf('.store-name-field { position: relative; }'));
  for (const selector of compact.match(/^[^\n{]+(?= \{)/gm).filter(text => !text.startsWith('/*') && !text.startsWith('@'))) assert.match(selector, /\.encoding-list/, `${selector} is scoped to the Encoding list`);
});

test('the status filter keeps its filtering semantics: only presentation changed', async () => {
  const ui = await read('../ui/receiptUi.js');
  assert.match(ui, /const matchesStatus = toolbarState\.status === 'all' \|\| receiptStatus\(row\) === toolbarState\.status;/);
  assert.match(ui, /row\.hidden = !matchesStatus \|\| !matchesCompartment;/, 'rows are hidden, never removed or renumbered');
  assert.match(ui, /export const floatingAddVisibleForStatus = status => status !== 'consumed';/);
});

// ---- the text-entry helper --------------------------------------------------------------------------------------------------
test('only text-entry controls count as editing: selects, buttons and file inputs keep the bar visible', async () => {
  const node = (tag, type = 'text') => ({ tag, type, matches: selector => (tag === 'textarea' || (tag === 'input' && !['checkbox', 'radio', 'button', 'file'].includes(type))) && selector.includes('input') });
  assert.equal(isTextEntry(node('input')), true);
  assert.equal(isTextEntry(node('input', 'date')), true);
  assert.equal(isTextEntry(node('textarea')), true);
  for (const other of [node('input', 'file'), node('input', 'checkbox'), node('select'), node('button')]) assert.equal(isTextEntry(other), false);
  assert.equal(isTextEntry(null), false);
  const classes = new Set(); const listeners = {}; const document = { activeElement: null };
  const root = { classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) }, addEventListener: (name, listener) => { listeners[name] = listener; }, contains: () => true, ownerDocument: document };
  trackTextEntry(root);
  document.activeElement = node('input'); listeners.focusin();
  assert.equal(classes.has('is-editing'), true);
  document.activeElement = node('select'); listeners.focusin();
  assert.equal(classes.has('is-editing'), false);
  document.activeElement = node('input'); listeners.focusin(); document.activeElement = null; listeners.focusout();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(classes.has('is-editing'), false);
  assert.doesNotThrow(() => trackTextEntry(null));
});

// ---- behaviour: the real receipt UI against a DOM fixture ----------------------------------------------------------------------
const storage = new Map();
globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
globalThis.Option = class { constructor(label, value) { this.label = label; this.value = value; } };

function fixture({ reducedMotion = false } = {}) {
  const focusLog = []; const scrollLog = [];
  const state = { activeElement: null };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
  globalThis.matchMedia = query => ({ matches: query.includes('prefers-reduced-motion') ? reducedMotion : false });
  globalThis.requestAnimationFrame = callback => { callback(); return 0; };
  const node = (extra = {}) => {
    const self = {
      hidden: false, value: '', disabled: false, textContent: '', title: '', dataset: {}, children: [], files: [], open: false, listeners: {}, attrs: {},
      classList: { classes: new Set(), add(name) { this.classes.add(name); }, remove(name) { this.classes.delete(name); }, toggle(name, on) { on ? this.classes.add(name) : this.classes.delete(name); }, contains(name) { return this.classes.has(name); } },
      addEventListener(name, listener) { (self.listeners[name] ??= []).push(listener); },
      emit(name, event = {}) { (self.listeners[name] ?? []).forEach(listener => listener({ currentTarget: self, target: self, preventDefault() {}, ...event })); },
      setAttribute(name, value) { self.attrs[name] = String(value); }, getAttribute: name => self.attrs[name] ?? null, removeAttribute(name) { delete self.attrs[name]; },
      append(...nodes) { self.children.push(...nodes); }, replaceChildren(...nodes) { self.children = nodes; },
      focus(options) { focusLog.push({ node: self, options: options ?? null }); state.activeElement = self; },
      scrollIntoView(options) { scrollLog.push({ node: self, options }); }, closest: () => null, contains: () => false, querySelectorAll: () => [], querySelector: () => null,
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
  globalThis.document = { createDocumentFragment: () => ({ append() {} }), createElement: () => node({ className: '' }), addEventListener() {}, get activeElement() { return state.activeElement; } };
  const list = node({ append(row) { list.children.push(row); }, replaceChildren(...rows) { list.children = rows; } });
  const overrides = {
    list, template: { content: { firstElementChild: { cloneNode: () => makeRow() } } }, optimizationTemplate: { content: { firstElementChild: { cloneNode: () => makeRow() } } },
    receiptStatusFilter: node({ value: 'available' }), optimizationSort: node({ value: 'default' }), optimizationStrategy: node({ value: optimizationStrategies.closest }), encodingAmountCompartment: node({ value: 'all' })
  };
  const elements = new Proxy(overrides, { get: (target, key) => key in target ? target[key] : (target[key] = node()) });
  const ui = createReceiptUi({ elements, findBest: () => null, optimizationStrategies, toCents: value => Math.round(Number(value || 0) * 100), scanPrintedDetails: async () => ({}), downloadSelectedReceipts() {}, receiptService: {} });
  ui.start();
  const add = () => elements.floatingAdd.emit('click');
  const rows = () => list.children;
  const label = row => row.part('.summary-id').textContent;
  const fill = (row, field, value) => { const input = row.part(`.receipt-${field}`); input.value = value; input.emit('input'); };
  return { elements, ui, add, rows, label, fill, focusLog, scrollLog, state };
}

test('Add Receipt creates a receipt, expands it, scrolls it into view and focuses Amount first (not Store)', () => {
  const { add, rows, label, focusLog, scrollLog } = fixture();
  assert.equal(rows().length, 0);
  add();
  assert.equal(rows().length, 1);
  const [row] = rows();
  assert.equal(label(row), 'Receipt 1');
  assert.equal(row.open, true, 'the intended receipt is expanded');
  assert.deepEqual(scrollLog.map(entry => [entry.node, entry.options]), [[row, { block: 'center', behavior: 'smooth' }]]);
  assert.deepEqual(focusLog.map(entry => entry.node), [row.part('.receipt-amount')], 'only Amount is focused');
  assert.deepEqual(focusLog[0].options, { preventScroll: true }, 'focus does not fight the scroll');
  assert.equal(focusLog.some(entry => entry.node === row.part('.receipt-store')), false);
});

test('Add Receipt respects reduced motion', () => {
  const { add, scrollLog } = fixture({ reducedMotion: true });
  add();
  assert.equal(scrollLog[0].options.behavior, 'auto');
});

test('Add Receipt reuses a blank unsaved receipt instead of stacking blanks, and creates a new one once it is used', () => {
  const { add, rows, label, fill, focusLog } = fixture();
  add(); add(); add();
  assert.equal(rows().length, 1, 'repeated Add reuses the blank receipt');
  assert.equal(focusLog.length, 3);
  assert.ok(focusLog.every(entry => entry.node === rows()[0].part('.receipt-amount')));
  fill(rows()[0], 'amount', '120');
  add();
  assert.equal(rows().length, 2);
  assert.equal(label(rows()[1]), 'Receipt 2', 'identifiers keep counting up');
  assert.equal(focusLog.at(-1).node, rows()[1].part('.receipt-amount'));
});

test('a blank receipt that is visible is preferred over a blank one that is hidden', () => {
  const { add, rows, fill, focusLog } = fixture();
  add(); fill(rows()[0], 'amount', '120'); add();
  fill(rows()[0], 'amount', '');                     // both rows are blank now
  rows()[0].hidden = true;
  const before = focusLog.length;
  add();
  assert.equal(rows().length, 2, 'no extra blank receipt');
  assert.equal(focusLog[before].node, rows()[1].part('.receipt-amount'), 'the visible blank receipt is used');
});

test('when the amount range hides the new receipt, nothing is focused, nothing is duplicated and the user is told why', () => {
  const { elements, add, rows, focusLog, scrollLog } = fixture();
  elements.encodingAmountCompartment.value = '500-599'; elements.encodingAmountCompartment.emit('change');
  add();
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].hidden, true, 'a blank receipt (₱0) is outside the 500–599 range');
  assert.equal(focusLog.length, 0, 'no focus, so no keyboard opens for something the user cannot see');
  assert.equal(scrollLog.length, 0);
  assert.match(elements.encodingFeedback.textContent, /hidden by the current amount range or view/);
  add();
  assert.equal(rows().length, 1, 'the hidden blank receipt is reused, not duplicated');
  elements.encodingAmountCompartment.value = 'all'; elements.encodingAmountCompartment.emit('change');
  add();
  assert.equal(focusLog.length, 1, 'once visible, Add focuses Amount');
  assert.equal(elements.encodingFeedback.textContent, '', 'the warning is cleared');
});

test('receipt identifiers never change when other receipts are hidden by filters', () => {
  const { elements, add, rows, label, fill } = fixture();
  for (const amount of ['120', '550', '1200', '1500']) { add(); fill(rows().at(-1), 'amount', amount); }
  assert.deepEqual(rows().map(label), ['Receipt 1', 'Receipt 2', 'Receipt 3', 'Receipt 4']);
  elements.encodingAmountCompartment.value = '1000-plus'; elements.encodingAmountCompartment.emit('change');
  assert.deepEqual(rows().map(row => row.hidden), [true, true, false, false]);
  assert.deepEqual(rows().filter(row => !row.hidden).map(label), ['Receipt 3', 'Receipt 4'], 'visible rows keep their own numbers (no renumbering to 1, 2)');
  elements.receiptStatusFilter.value = 'consumed'; elements.receiptStatusFilter.emit('change');
  assert.ok(rows().every(row => row.hidden), 'consumed view hides available receipts');
  assert.deepEqual(rows().map(label), ['Receipt 1', 'Receipt 2', 'Receipt 3', 'Receipt 4']);
});

test('unsaved input survives filtering, expanding and collapsing (rows are hidden, never rebuilt)', () => {
  const { elements, add, rows, fill } = fixture();
  add(); fill(rows()[0], 'amount', '550'); fill(rows()[0], 'invoice', 'OR-77'); fill(rows()[0], 'store', 'A Store With A Very Long Name Indeed');
  const row = rows()[0];
  elements.encodingAmountCompartment.value = '1000-plus'; elements.encodingAmountCompartment.emit('change');
  row.open = false; row.emit('toggle'); row.open = true; row.emit('toggle');
  elements.encodingAmountCompartment.value = 'all'; elements.encodingAmountCompartment.emit('change');
  assert.equal(rows()[0], row, 'the same row element');
  assert.deepEqual(['amount', 'invoice', 'store'].map(field => row.part(`.receipt-${field}`).value), ['550', 'OR-77', 'A Store With A Very Long Name Indeed']);
});

test('the one-line summary shows identity, store, amount and keeps the full store name inspectable', () => {
  const { add, rows, label, fill } = fixture();
  add();
  const row = rows()[0];
  fill(row, 'amount', '2300'); fill(row, 'store', 'Sample Hardware & Industrial Supply Trading Corporation of the Philippines');
  assert.equal(label(row), 'Receipt 1');
  assert.equal(row.part('.summary-store').textContent, 'Sample Hardware & Industrial Supply Trading Corporation of the Philippines');
  assert.equal(row.part('.summary-store').title, 'Sample Hardware & Industrial Supply Trading Corporation of the Philippines');
  assert.match(row.part('.summary-amount').textContent, /2,300\.00/);
  assert.match(row.part('summary').getAttribute('aria-label'), /^Receipt 1, Sample Hardware .*2,300\.00 pesos, /);
  fill(row, 'store', '');
  assert.equal(row.part('.summary-store').textContent, 'Store not set');
  assert.equal(row.part('.summary-store').title, 'Store not set');
});

test('starting the receipt UI tracks text entry on the Encoding workspace so the phone action bar can step aside', () => {
  const { elements } = fixture();
  assert.ok(elements.encodingWorkspace.listeners.focusin?.length, 'focusin is tracked');
  assert.ok(elements.encodingWorkspace.listeners.focusout?.length, 'focusout is tracked');
});

// ---- protection: lifecycle, save and optimization stay as they were -------------------------------------------------------------
test('Save, Clear and lifecycle code paths are untouched by the layout work', async () => {
  const ui = await read('../ui/receiptUi.js');
  assert.ok(ui.includes("elements.saveDraft.addEventListener('click'"), 'Save Changes still has its handler');
  assert.match(ui, /elements\.clearAll\.addEventListener\('click', async event => \{[\s\S]*?title: 'Clear receipts from this form\?'/, 'Clear form still asks first');
  for (const message of ['Could not save receipt changes: ', 'Receipt changes saved.', 'Receipt marked as Available.', 'Store added to the Company Store Directory.']) assert.ok(ui.includes(message), `${message} is unchanged`);
  assert.ok(ui.includes("title: 'Mark receipt Available?'") && ui.includes("title: 'Delete saved receipt?'"), 'destructive and restore confirmations unchanged');
  const service = await read('../services/receiptService.js');
  assert.ok(service.includes(".update({ status: 'consumed' }).in('id', uniqueIds).eq('status', 'available')"));
});

// ---- CSS isolation: Monthly Filing reuses class="encoding-actions" and must keep its pre-CP8 layout ------------------------
const ruleSelectors = text => [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{/g)].map(match => match[1].trim());

test('Monthly Filing still uses the shared action class and gets its pre-CP8 layout', () => {
  for (const id of ['monthlyFilingActiveActions', 'monthlyFilingArchivedActions']) assert.match(staticHtml, new RegExp(`class="encoding-actions"[^>]*id="${id}"|id="${id}"`), `#${id} exists`);
  assert.ok(/class="encoding-actions" id="monthlyFilingActiveActions"/.test(staticHtml));
  assert.ok(css.includes('.encoding-actions { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-top: 18px; }'), 'CP7 base layout restored');
  const narrow = css.slice(css.indexOf('@media (max-width: 780px) {'), css.indexOf('@media (max-width: 1100px)') > css.indexOf('@media (max-width: 780px) {') ? css.indexOf('@media (max-width: 1100px)') : undefined);
  assert.ok(narrow.includes('.encoding-actions { flex-direction: column; align-items: stretch; }') && narrow.includes('.action-save { width: 100%; }'), 'CP7 narrow-screen stacking restored');
  assert.ok(css.includes('.action-save { min-width: 180px; }'), 'CP7 shared minimum width restored');
});

test('every CP8 action-bar rule is scoped to #encodingActions, so Monthly Filing buttons inherit nothing from it', () => {
  const selectors = ruleSelectors(css).flatMap(selector => selector.split(',').map(part => part.trim()));
  const touching = selectors.filter(selector => /encoding-actions|action-bar-spacer|action-save/.test(selector));
  const allowedShared = new Set(['.encoding-actions', '.action-save']);
  for (const selector of touching) assert.ok(allowedShared.has(selector) || /^(#encodingActions|\.encoding-workspace(\.is-editing)? > #encodingActions)/.test(selector), `${selector} is scoped to the Encoding bar`);
  assert.equal(touching.filter(selector => selector === '.encoding-actions').length, 2, 'only the two CP7 shared rules remain unscoped (base + narrow)');
  assert.ok(!selectors.some(selector => /^\.encoding-actions\s+(button|\.workflow-feedback|\.action-bar-spacer)/.test(selector)), 'no descendant rule on the shared class');
});

test('the Encoding bar keeps its approved desktop row and phone sticky bar despite the restored shared rules', () => {
  const bar = css.match(/#encodingActions \{([^}]*)\}/)[1];
  for (const declaration of ['flex-direction: row', 'flex-wrap: wrap', 'align-items: center', 'justify-content: flex-start']) assert.ok(bar.includes(declaration), `${declaration} overrides the shared column/space-between rules`);
  assert.ok(css.includes('#encodingActions .action-save { min-width: 160px; width: auto; }'), 'Save is not stretched by the shared narrow rule');
});
