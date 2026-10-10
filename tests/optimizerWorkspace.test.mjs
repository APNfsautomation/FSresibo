import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createQuickOptimizerUi, quickCapacityMessage } from '../ui/quickOptimizerUi.js';
import { collapseKeptReceiptsOnShortWindows, tallWindowQuery } from '../ui/optimizationPresentation.js';
import { optimizationStrategies } from '../services/optimizationService.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const html = await read('../index.html');
const staticHtml = html.replace(/<template[\s\S]*?<\/template>/g, '');
const css = (await read('../styles.css')).replace(/\r\n/g, '\n');
const count = (text, pattern) => (text.match(pattern) ?? []).length;
const section = (start, end) => staticHtml.slice(staticHtml.indexOf(start), staticHtml.indexOf(end, staticHtml.indexOf(start)));
const optimization = section('id="optimizationWorkspace"', 'id="monthlyFilingWorkspace"');
const quick = section('id="quickOptimizerWorkspace"', '</main>');

// ---- Receipt Optimization: markup contract ------------------------------------------------------------------------
test('Receipt Optimization keeps every ID that app.js and receiptUi.js read, each exactly once', () => {
  const ids = ['targetAmount', 'optimizationStrategy', 'optimizationStrategyHelper', 'calculate', 'exportSelected', 'resultTitle', 'resultAmount', 'difference',
    'optimizationResultSummary', 'summaryTarget', 'summaryMatched', 'summaryDifference', 'summaryReceiptCount', 'summaryStrategy', 'keptReceipts', 'adminContent',
    'optimizationReceiptList', 'optimizationSearch', 'clearOptimizationSearch', 'optimizationResultCount', 'optimizationFilterStatus', 'clearOptimizationFilters',
    'optimizationSort', 'optimizationMoreFilters', 'optimizationStoreFilter', 'optimizationStartDate', 'optimizationEndDate', 'optimizationMinAmount', 'optimizationMaxAmount',
    'optimizationRangeValidation', 'optimizationHiddenSelected'];
  for (const id of ids) assert.equal(count(staticHtml, new RegExp(`\\bid="${id}"`, 'g')), 1, `#${id} appears exactly once`);
  const all = [...staticHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(all.filter((id, index) => all.indexOf(id) !== index), [], 'no duplicate IDs in the document');
});

test('the command bar holds the target, strategy, explanation, primary action and export in reading order', () => {
  const bar = optimization.slice(optimization.indexOf('class="target-card"'), optimization.indexOf('class="panel result-panel"'));
  const order = ['id="targetAmount"', 'id="optimizationStrategy"', 'id="optimizationStrategyHelper"', 'id="calculate"', 'id="exportSelected"'].map(token => bar.indexOf(token));
  assert.ok(order.every(position => position > 0), 'every command control is inside the command bar');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'DOM (Tab) order matches the visual order');
  assert.match(bar, /<button class="primary" id="calculate" type="button">Find best match<\/button>/);
  assert.match(bar, /id="exportSelected"[^>]*disabled/, 'export stays disabled until a recommendation exists');
});

test('the recommendation keeps its summary, breakdown and calculation details, with the breakdown in a native disclosure', () => {
  assert.match(optimization, /<details class="kept-details" open><summary>Receipts to pull<\/summary><div id="keptReceipts" class="kept-receipts"><\/div><\/details>/);
  assert.match(optimization, /<details class="admin"><summary>Calculation details<\/summary><div id="adminContent"/);
  for (const dt of ['Target', 'Matched', 'Difference', 'Receipts', 'Strategy']) assert.match(optimization, new RegExp(`<dt>${dt}</dt>`));
  assert.match(optimization, /<aside class="panel result-panel" aria-live="polite">/);
});

test('the receipt browser keeps search, sort, status, filters and warnings, in Tab order', () => {
  const order = ['id="optimizationSearch"', 'id="clearOptimizationSearch"', 'id="optimizationSort"', 'id="clearOptimizationFilters"', 'id="optimizationMoreFilters"', 'id="optimizationRangeValidation"', 'id="optimizationHiddenSelected"', 'id="optimizationReceiptList"'].map(token => optimization.indexOf(token));
  assert.ok(order.every(position => position > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(optimization, /id="optimizationRangeValidation"[^>]*role="alert"/);
  assert.match(optimization, /<label class="optimization-search-label" for="optimizationSearch">Search receipts<\/label>/, 'the search field keeps its label');
});

// ---- Receipt Optimization: layout and presentation rules --------------------------------------------------------------
const rule = selector => { const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`)); return match ? match[1] : null; };

test('the receipt browser scrolls with the page: no fixed-height or inner scroll container remains', () => {
  for (const selector of ['.optimization-receipt-list', '.optimization-receipts-panel']) {
    const declarations = rule(selector);
    assert.ok(declarations, `${selector} is styled`);
    assert.doesNotMatch(declarations, /overflow(-y)?\s*:\s*(auto|scroll)/, `${selector} is not a scroller`);
    assert.doesNotMatch(declarations, /(^|[\s;])(height|max-height)\s*:/, `${selector} has no fixed height`);
  }
});

test('the command bar is sticky only on wide windows at least 820px tall', () => {
  const stickyRules = [...css.matchAll(/\.target-card \{[^}]*position: sticky[^}]*\}/g)];
  assert.equal(stickyRules.length, 1);
  assert.ok(css.includes('@media (min-width: 981px) and (min-height: 820px) {\n  .target-card { position: sticky;'), 'sticky is gated by width and height');
  assert.ok(css.includes('scroll-padding-top'), 'keyboard focus is scrolled clear of the sticky bar');
  assert.doesNotMatch(rule('.target-card'), /position/, 'the base command bar is not sticky');
});

test('selected and consumed receipts are shown by more than colour', () => {
  assert.match(css, /\.optimization-receipt-card\.is-selected \{[^}]*inset 5px 0 0 var\(--success\)/);
  assert.match(optimization + html, /<span class="selected-badge" hidden>Selected<\/span>/);
  assert.match(html, /<span class="compact-status" hidden>Consumed<\/span>/);
});

test('short windows collapse "Receipts to pull" once, as presentation only, and users can always expand it', () => {
  const details = { open: true };
  const kept = { closest: selector => selector === 'details' ? details : null };
  assert.equal(collapseKeptReceiptsOnShortWindows(kept, query => ({ matches: query !== tallWindowQuery })), true);
  assert.equal(details.open, false);
  details.open = true;
  assert.equal(collapseKeptReceiptsOnShortWindows(kept, query => ({ matches: query === tallWindowQuery })), false, 'tall windows keep it open');
  assert.equal(details.open, true);
  assert.equal(collapseKeptReceiptsOnShortWindows(null, () => ({ matches: false })), false);
  assert.equal(collapseKeptReceiptsOnShortWindows({ closest: () => null }, () => ({ matches: false })), false);
  assert.equal(collapseKeptReceiptsOnShortWindows(kept, undefined), false, 'no matchMedia: leave it alone');
  assert.equal(tallWindowQuery, '(min-height: 880px)');
});

test('the presentation helper is applied once at start and never touches results or selection', async () => {
  const ui = await read('../ui/receiptUi.js');
  assert.equal(count(ui, /collapseKeptReceiptsOnShortWindows\(/g), 1, 'called once, from start()');
  const helper = await read('../ui/optimizationPresentation.js');
  assert.doesNotMatch(helper, /selectedReceiptIndexes|keptReceipts\.(replaceChildren|textContent|innerHTML)|findBest|exportSelected/);
});

// ---- Receipt Optimization: handlers stay connected ----------------------------------------------------------------------
test('the redesigned markup stays wired to the existing calculation, export, filter, edit and restore handlers', async () => {
  const ui = await read('../ui/receiptUi.js');
  for (const wiring of ["elements.calculate.addEventListener('click'", "elements.exportSelected.addEventListener('click', openExportConfirmation)", "elements.optimizationSearch.addEventListener('input'", "elements.optimizationSort].forEach(field => field",
    "elements.clearOptimizationFilters.addEventListener('click'", "'.compact-edit').addEventListener('click', event => openEditModal(entry.index, event.currentTarget)", "'.compact-restore').addEventListener('click', event => restoreReceipt(entry.index, event.currentTarget)"]) {
    assert.ok(ui.includes(wiring), `${wiring} is still wired`);
  }
  const app = await read('../app.js');
  for (const id of ['#targetAmount', '#optimizationStrategy', '#calculate', '#exportSelected', '#resultTitle', '#keptReceipts', '#adminContent', '#optimizationReceiptList', '#optimizationSearch']) assert.ok(app.includes(`'${id}'`), `${id} is still read by app.js`);
});

test('the export lifecycle code is untouched by the layout work', async () => {
  const ui = await read('../ui/receiptUi.js');
  for (const token of ['openExportConfirmation', 'closeExportConfirmation', 'exportPending', 'selectedReceiptIndexes', 'downloadSelectedReceipts']) assert.ok(ui.includes(token), `${token} still present`);
  const service = await read('../services/receiptService.js');
  assert.ok(service.includes(".update({ status: 'consumed' }).in('id', uniqueIds).eq('status', 'available')"), 'the consumed update still only touches Available receipts');
});

// ---- Quick Optimizer: markup contract -------------------------------------------------------------------------------------
test('Quick Optimizer keeps every data-quick hook exactly once and adds no second Calculate control', () => {
  for (const hook of ['target', 'strategy', 'helper', 'rows', 'bulk', 'append', 'add', 'clear', 'calculate', 'feedback', 'results', 'breakdown']) {
    assert.equal(count(quick, new RegExp(`data-quick="${hook}"`, 'g')), 1, `data-quick="${hook}" appears exactly once`);
  }
  assert.equal(count(quick, /data-quick="calculate"/g), 1, 'one Calculate control serves desktop and phone layouts');
  assert.equal(count(quick, /Find Best Match<\/button>/g), 1);
  for (const id of ['quickTarget', 'quickStrategy', 'quickStrategyHelper', 'quickBulk', 'quickOptimizerTitle']) assert.equal(count(quick, new RegExp(`id="${id}"`, 'g')), 1);
});

test('the primary action sits with the target and strategy, before the amount list and above the fold', () => {
  const order = ['class="panel quick-setup quick-controls"', 'data-quick="target"', 'data-quick="strategy"', 'data-quick="calculate"', 'class="panel quick-results-panel"', 'data-quick="results"', 'class="panel quick-entry quick-controls"', 'data-quick="rows"', 'data-quick="add"', 'data-quick="append"'].map(token => quick.indexOf(token));
  assert.ok(order.every(position => position > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'setup, then results, then amount entry');
  assert.match(quick, /<details class="quick-bulk"><summary>Bulk paste<\/summary>[\s\S]*data-quick="bulk"[\s\S]*data-quick="append"[\s\S]*<\/details>/, 'Bulk Paste and Append stay available inside a disclosure');
});

test('Edit amounts exists once, starts hidden and targets a focusable heading of the amount list', () => {
  assert.match(quick, /<button type="button" class="ghost quick-edit-amounts" data-quick="edit-amounts" hidden>Edit amounts<\/button>/);
  assert.match(quick, /<h2 id="quickEntryHeading" data-quick="entry-heading" tabindex="-1">Receipt amounts<\/h2>/);
});

// ---- Quick Optimizer: phone Calculate rules -----------------------------------------------------------------------------------
test('the Calculate button floats only on phones, respects safe areas and yields to text entry without leaving the Tab order', () => {
  assert.equal(count(css, /\.quick-calculate \{[^}]*position: fixed/g), 1);
  const phoneBlock = css.slice(css.indexOf('@media (max-width: 640px) {\n  .receipts-bar'), css.indexOf('@media (prefers-reduced-motion'));
  assert.match(phoneBlock, /\.quick-calculate \{[^}]*position: fixed[^}]*env\(safe-area-inset-bottom\)/, 'fixed positioning lives inside the phone breakpoint and uses the safe-area inset');
  assert.match(phoneBlock, /\.quick-optimizer-workspace \{ padding-bottom: calc\(84px \+ env\(safe-area-inset-bottom\)\)/, 'page padding keeps the last content reachable above the button');
  assert.match(phoneBlock, /\.quick-optimizer-workspace\.is-editing \.quick-calculate:not\(:focus\) \{[^}]*opacity: 0[^}]*pointer-events: none[^}]*transform/, 'it steps aside while editing but returns when focused by keyboard');
  assert.doesNotMatch(phoneBlock, /\.is-editing \.quick-calculate[^{]*\{[^}]*(display: none|visibility: hidden)/, 'never display:none or visibility:hidden (that would skip it in Tab order)');
  assert.match(css, /\.quick-amount-row \{[^}]*scroll-margin-bottom: 96px/, 'focused rows scroll clear of the floating button');
  assert.match(css, /\.quick-edit-amounts \{ display: none;/, 'Edit amounts is only shown in stacked layouts');
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \* \{ transition: none !important; \} html \{ scroll-behavior: auto; \} \}/);
});

test('the desktop Quick Optimizer composition is two balanced columns with sticky results', () => {
  assert.match(css, /\.quick-optimizer-grid \{[^}]*grid-template-areas: "setup results" "entry results"/);
  assert.match(css, /@media \(min-width: 981px\) and \(min-height: 640px\) \{ \.quick-results-panel \{ position: sticky;[^}]*max-height: calc\(100vh - var\(--space-5\)\); overflow-y: auto; \} \}/);
  assert.match(css, /@media \(max-width: 980px\) \{[\s\S]*?\.quick-optimizer-grid \{ grid-template-columns: 1fr; grid-template-areas: "setup" "results" "entry"; \}/);
});

// ---- Quick Optimizer: behaviour with a DOM fixture ------------------------------------------------------------------------------
class Node {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.focusCalls = [];
    this.classes = new Set(); this.classList = { toggle: (name, on) => { on ? this.classes.add(name) : this.classes.delete(name); } };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
  emit(name, event = {}) { (this.listeners[name] ?? []).forEach(listener => listener(event)); }
  focus(options) { this.focusCalls.push(options ?? null); this.ownerDocument.activeElement = this; }
  matches(selector) { return /^input|^textarea/.test(selector) && (this.tag === 'input' || this.tag === 'textarea') && this.type !== 'checkbox'; }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelector(selector) { return this.descendants().find(child => selector.startsWith('#') ? child.id === selector.slice(1) : child.tag === selector) ?? null; }
}
function fixture({ stacked = true, reducedMotion = false, panelTop = 900, innerHeight = 800 } = {}) {
  const document = { activeElement: null, createElement: tag => { const node = new Node(tag); node.ownerDocument = document; return node; }, defaultView: { innerHeight, matchMedia: query => ({ matches: query.includes('max-width: 980px') ? stacked : query.includes('prefers-reduced-motion') ? reducedMotion : false }) } };
  const make = (tag = 'div') => { const node = new Node(tag); node.ownerDocument = document; return node; };
  const names = ['target', 'strategy', 'helper', 'rows', 'bulk', 'append', 'add', 'clear', 'calculate', 'feedback', 'results', 'breakdown', 'edit-amounts', 'entry-heading'];
  const controls = Object.fromEntries(names.map(name => [name, make()]));
  controls['edit-amounts'].hidden = true;
  const scrolls = [];
  const resultsPanel = Object.assign(make(), { getBoundingClientRect: () => ({ top: panelTop }), scrollIntoView: options => scrolls.push(['results', options]) });
  const entryPanel = Object.assign(make(), { scrollIntoView: options => scrolls.push(['entry', options]) });
  controls.results.closest = selector => selector === '.quick-results-panel' ? resultsPanel : null;
  controls.rows.closest = selector => selector === '.quick-entry' ? entryPanel : null;
  const root = make(); root.ownerDocument = document; root.contains = node => node?.ownerDocument === document;
  root.querySelector = selector => controls[selector.match(/"(.+)"/)[1]] ?? null;
  const ui = createQuickOptimizerUi({ root, nextFrame: async () => {} });
  return { ui, controls, root, document, scrolls };
}
const rowInput = (controls, index) => controls.rows.children[index].children[1];
const fill = (controls, target, amounts) => { controls.target.value = target; controls.target.emit('input'); amounts.forEach((value, index) => { while (!controls.rows.children[index]) controls.add.emit('click'); rowInput(controls, index).value = value; rowInput(controls, index).emit('input'); }); };

test('text entry marks the workspace as editing, buttons and selects do not, and blur clears it', async () => {
  const { controls, root, document } = fixture();
  const input = rowInput(controls, 0);
  document.activeElement = input; root.emit('focusin');
  assert.equal(root.classes.has('is-editing'), true);
  document.activeElement = controls.calculate; root.emit('focusin');
  assert.equal(root.classes.has('is-editing'), false, 'focusing the Calculate button restores it');
  document.activeElement = input; root.emit('focusin'); document.activeElement = null; root.emit('focusout');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(root.classes.has('is-editing'), false, 'blur restores it');
  document.activeElement = Object.assign(new Node('select'), { ownerDocument: document }); root.emit('focusin');
  assert.equal(root.classes.has('is-editing'), false, 'a select does not hide the button');
});

for (const [rows, target] of [[3, '1500'], [15, '5000'], [32, '7500']]) {
  test(`${rows} amount rows: three ranked recommendations, stable labels and highlighted selected rows`, async () => {
    const { ui, controls } = fixture();
    const amounts = Array.from({ length: rows }, (_, index) => String(100 + ((index * 37) % 900) + (index % 4) * 0.25));
    fill(controls, target, amounts);
    assert.equal(ui.getState().rows.length, rows);
    await controls.calculate.listeners.click[0]();
    const state = ui.getState();
    assert.equal(state.results.length, 3, 'up to three ranked recommendations');
    assert.deepEqual(controls.results.children.map(card => card.children[0].textContent), ['Best Match', 'Alternative 1', 'Alternative 2']);
    assert.deepEqual(state.rows.map(row => row.id), Array.from({ length: rows }, (_, index) => `R${index + 1}`), 'labels stay R1..Rn');
    const selectedIds = new Set(state.results[state.selectedResult].receipts.map(receipt => receipt.id));
    assert.deepEqual(controls.rows.children.filter(row => row.classes.has('is-selected')).map(row => row.dataset.receiptId).sort(), [...selectedIds].sort());
    assert.equal(controls['edit-amounts'].hidden, false, 'Edit amounts appears once results exist');
  });
}

test('the 33rd amount is rejected atomically and Add Amount is disabled at capacity', () => {
  const { ui, controls } = fixture();
  fill(controls, '100', Array.from({ length: 32 }, (_, index) => String(index + 1)));
  assert.equal(ui.getState().rows.length, 32);
  assert.equal(controls.add.disabled, true);
  controls.bulk.value = '10'; controls.append.emit('click');
  assert.equal(ui.getState().rows.length, 32);
  assert.equal(ui.getState().message, quickCapacityMessage);
});

test('bulk paste fills blanks then appends, and Clear Calculator resets everything including Edit amounts', async () => {
  const { ui, controls } = fixture();
  controls.bulk.value = '500\n700\n1000\n250'; controls.append.emit('click');
  assert.deepEqual(ui.getState().rows.map(row => `${row.id}=${row.raw}`), ['R1=500', 'R2=700', 'R3=1000', 'R4=250']);
  controls.target.value = '1500'; controls.target.emit('input');
  await controls.calculate.listeners.click[0]();
  assert.equal(controls['edit-amounts'].hidden, false);
  controls.clear.emit('click');
  assert.equal(controls['edit-amounts'].hidden, true);
  assert.deepEqual(ui.getState().rows.map(row => row.raw), ['', '', '']);
});

test('after a successful calculation the results are brought into view only in the stacked layout and only when below the fold', async () => {
  const stackedBelow = fixture({ stacked: true, panelTop: 1500 });
  fill(stackedBelow.controls, '1500', ['500', '700', '1000']);
  await stackedBelow.controls.calculate.listeners.click[0]();
  assert.deepEqual(stackedBelow.scrolls, [['results', { behavior: 'smooth', block: 'start' }]]);
  const above = fixture({ stacked: true, panelTop: 120 });
  fill(above.controls, '1500', ['500', '700', '1000']); await above.controls.calculate.listeners.click[0]();
  assert.deepEqual(above.scrolls, [], 'results already in view: no movement');
  const desktop = fixture({ stacked: false, panelTop: 1500 });
  fill(desktop.controls, '1500', ['500', '700', '1000']); await desktop.controls.calculate.listeners.click[0]();
  assert.deepEqual(desktop.scrolls, [], 'side-by-side layout needs no scrolling');
  const reduced = fixture({ stacked: true, panelTop: 1500, reducedMotion: true });
  fill(reduced.controls, '1500', ['500', '700', '1000']); await reduced.controls.calculate.listeners.click[0]();
  assert.equal(reduced.scrolls[0][1].behavior, 'auto', 'reduced motion: no animated scrolling');
  const failure = fixture({ stacked: true, panelTop: 1500 });
  fill(failure.controls, '1500', []); await failure.controls.calculate.listeners.click[0]();
  assert.deepEqual(failure.scrolls, [], 'a failed calculation never scrolls');
});

test('calculating does not steal focus: only a focused Calculate button keeps it after the busy state', async () => {
  const idle = fixture();
  fill(idle.controls, '1500', ['500', '700', '1000']);
  idle.document.activeElement = rowInput(idle.controls, 0);
  await idle.controls.calculate.listeners.click[0]();
  assert.equal(idle.controls.calculate.focusCalls.length, 0);
  assert.equal(idle.document.activeElement, rowInput(idle.controls, 0));
  const keyboard = fixture();
  fill(keyboard.controls, '1500', ['500', '700', '1000']);
  keyboard.document.activeElement = keyboard.controls.calculate;
  await keyboard.controls.calculate.listeners.click[0]();
  assert.deepEqual(keyboard.controls.calculate.focusCalls, [{ preventScroll: true }], 'focus is restored to the button that was disabled while calculating');
  assert.equal(keyboard.controls.results.children.length, 3);
});

test('Edit amounts returns to the temporary list, focuses its heading and changes no data', async () => {
  const { ui, controls, scrolls, document } = fixture();
  fill(controls, '1500', ['500', '700', '1000']);
  await controls.calculate.listeners.click[0]();
  const before = ui.getState();
  controls['edit-amounts'].emit('click');
  assert.deepEqual(scrolls.at(-1), ['entry', { behavior: 'smooth', block: 'start' }]);
  assert.equal(document.activeElement, controls['entry-heading']);
  assert.deepEqual(controls['entry-heading'].focusCalls, [{ preventScroll: true }]);
  assert.deepEqual(ui.getState(), before, 'results, rows and target are untouched');
});

test('correcting one amount keeps the other amounts, clears stale results and recalculates', async () => {
  const { ui, controls } = fixture();
  fill(controls, '1500', ['500', '700', '1000']);
  await controls.calculate.listeners.click[0]();
  const others = ui.getState().rows.map(row => row.raw);
  rowInput(controls, 1).value = '800'; rowInput(controls, 1).emit('input');
  assert.equal(ui.getState().results.length, 0, 'stale recommendations are cleared');
  assert.equal(controls['edit-amounts'].hidden, true);
  assert.deepEqual(ui.getState().rows.map(row => row.raw), [others[0], '800', others[2]]);
  assert.equal(ui.getState().target, '1500');
  await controls.calculate.listeners.click[0]();
  assert.equal(ui.getState().results.length, 3);
  assert.equal(ui.getState().results[0].total, 150000, '₱500 + ₱1,000 reaches the target exactly');
});

test('Quick Optimizer state stays in memory: no storage, network or database access, and logout clears it', async () => {
  const source = await read('../ui/quickOptimizerUi.js');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(|supabase|XMLHttpRequest/i);
  const { ui, controls } = fixture();
  fill(controls, '1500', ['500', '700', '1000']);
  await controls.calculate.listeners.click[0]();
  ui.clearForLogout();
  assert.deepEqual(ui.getState().rows.map(row => row.raw), ['', '', '']);
  assert.equal(ui.getState().target, '');
  assert.equal(controls['edit-amounts'].hidden, true);
});

// ---- Financial rules are outside this checkpoint ---------------------------------------------------------------------------------
test('the optimization engine and strategy names are the ones the workspaces expose', async () => {
  assert.deepEqual(Object.values(optimizationStrategies).sort(), ['closest', 'fewest', 'without-exceeding']);
  for (const value of Object.values(optimizationStrategies)) {
    assert.ok(optimization.includes(`<option value="${value}">`) && quick.includes(`<option value="${value}">`), `${value} is offered in both workspaces`);
  }
});
