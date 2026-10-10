import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createQuickOptimizerUi, invalidQuickAmountMessage, parseQuickAmount, quickCapacityMessage } from '../ui/quickOptimizerUi.js';
import { findBestMatches, optimizationStrategies } from '../services/optimizationService.js';

const calculator = options => createQuickOptimizerUi({ nextFrame: async () => {}, ...options });
const populated = () => {
  const ui = calculator(); ui.setTarget('1000'); ui.appendBulk('500\n500\n1040\n990'); return ui;
};

test('strict decimal parser accepts approved formats and exact integer centavos', () => {
  for (const [raw, cents] of [['500', 50000], ['500.5', 50050], ['500.50', 50050], ['1,500.00', 150000], ['₱1,500.00', 150000], [' PHP 1,500.00 ', 150000], ['0.01', 1], ['0.29', 29], ['90,071,992,547,409.91', Number.MAX_SAFE_INTEGER]]) {
    assert.equal(parseQuickAmount(raw), cents, raw);
  }
});

test('strict decimal parser rejects malformed, unsupported and unsafe amounts', () => {
  for (const raw of ['', ' ', '0', '0.00', '-1', '+1', '1.001', '1,50', '1,000,00', '1e3', 'NaN', 'Infinity', '$500', 'USD 500', '500 PHP', 'PHP500', '1.2.3', '.5', '5.', '5 00', '90,071,992,547,409.92']) assert.equal(parseQuickAmount(raw), null, raw);
});

test('default rows, stable labels, removal, addition and complete reset', () => {
  const ui = calculator();
  assert.deepEqual(ui.getState().rows, ['R1', 'R2', 'R3'].map(id => ({ id, raw: '' })));
  assert.equal(ui.getState().target, '');
  assert.equal(ui.getState().strategy, 'closest');
  ui.removeRow('R2'); assert.equal(ui.addRow(), 'R4');
  assert.deepEqual(ui.getState().rows.map(row => row.id), ['R1', 'R3', 'R4']);
  ui.setTarget('100'); ui.setStrategy('fewest'); ui.appendBulk('10\n20\n30\n40'); ui.clear();
  assert.deepEqual(ui.getState(), calculator().getState());
  assert.equal(ui.addRow(), 'R4');
});

test('bulk fills blanks in display order, appends, retains duplicates and ignores blank lines', () => {
  const ui = calculator(); ui.setAmount('R2', '50');
  assert.equal(ui.appendBulk('\n500\r\n1,500.00\n\n500\n'), true);
  assert.deepEqual(ui.getState().rows, [{ id: 'R1', raw: '500' }, { id: 'R2', raw: '50' }, { id: 'R3', raw: '1,500.00' }, { id: 'R4', raw: '500' }]);
  assert.equal(ui.appendBulk(' \n'), true);
  assert.equal(ui.getState().nextLabel, 5);
});

test('invalid bulk and capacity overflow are atomic with approved feedback', () => {
  const ui = calculator(); ui.setAmount('R2', '100');
  const before = ui.getState();
  assert.equal(ui.appendBulk('500\nnope\n200'), false);
  assert.deepEqual(ui.getState().rows, before.rows);
  assert.equal(ui.getState().nextLabel, before.nextLabel);
  assert.equal(ui.getState().message, invalidQuickAmountMessage);
  assert.equal(ui.appendBulk(Array(32).fill('1').join('\n')), false);
  assert.deepEqual(ui.getState().rows, before.rows);
  assert.equal(ui.getState().message, quickCapacityMessage);
  assert.equal(ui.appendBulk(Array(31).fill('1').join('\n')), true);
  assert.equal(ui.getState().rows.length, 32);
  assert.equal(ui.addRow(), false);
});

test('aggregate overflow and unsafe target allowance are rejected before calculation', async () => {
  const ui = calculator(); ui.setTarget('100'); ui.setAmount('R1', '90071992547409.91');
  const before = ui.getState();
  assert.equal(ui.appendBulk('0.01'), false);
  assert.deepEqual(ui.getState().rows, before.rows);
  ui.setAmount('R2', '0.01'); assert.equal(await ui.calculate(), false);
  assert.equal(ui.getState().message, invalidQuickAmountMessage);
  ui.clear(); ui.setTarget('90071992547409.91'); ui.setAmount('R1', '1');
  assert.equal(await ui.calculate(), false);
});

test('all 32 entered rows calculate with distinct identities and receipt 33 is rejected', async () => {
  const ui = calculator(); ui.setTarget('1');
  assert.equal(ui.appendBulk(Array(32).fill('1').join('\n')), true);
  assert.equal(await ui.calculate(), true);
  assert.deepEqual(ui.getState().results.map(result => result.receipts.map(row => row.id)), [['R1'], ['R2'], ['R3']]);
  const before = ui.getState();
  assert.equal(ui.appendBulk('1'), false);
  assert.equal(ui.getState().message, quickCapacityMessage);
  assert.deepEqual(ui.getState().rows, before.rows);
  assert.deepEqual(ui.getState().results, before.results);
});

test('calculation ignores blank rows and maps engine positions to stable identities after deletion', async () => {
  const ui = calculator(); ui.removeRow('R2'); ui.setTarget('1000');
  ui.setAmount('R1', '500'); ui.setAmount('R3', '500'); const id = ui.addRow(); ui.setAmount(id, '1040'); ui.addRow();
  await ui.calculate();
  const results = ui.getState().results;
  assert.deepEqual(results[0].receipts.map(row => row.id), ['R1', 'R3']);
  assert.deepEqual(results[1].receipts.map(row => row.id), ['R4']);
  assert.equal(results[0].total, 100000); assert.equal(results[1].difference, 4000);
  assert.equal(ui.getState().selectedResult, 0);
  assert.equal(ui.selectResult(1), true); assert.equal(ui.getState().selectedResult, 1);
  assert.equal(ui.selectResult(99), false);
});

test('UI preserves exact engine order for every strategy and never fabricates alternatives', async () => {
  for (const strategy of Object.values(optimizationStrategies)) {
    const ui = populated(); ui.setStrategy(strategy); await ui.calculate();
    const receipts = ui.getState().rows.map(row => ({ id: row.id, cents: parseQuickAmount(row.raw) }));
    assert.deepEqual(ui.getState().results, findBestMatches(receipts, 100000, strategy, 3).map(result => ({ total: result.total, difference: result.total - 100000, receipts: result.items.map(index => receipts[index]) })));
  }
  const ui = calculator(); ui.setTarget('1000'); ui.setAmount('R1', '1000'); await ui.calculate();
  assert.equal(ui.getState().results.length, 1);
  ui.setAmount('R1', '1050.01'); await ui.calculate();
  assert.equal(ui.getState().results.length, 0); assert.equal(ui.getState().selectedResult, null);
  assert.equal(ui.getState().message, 'No qualifying combination found.');
});

test('all input mutations invalidate recommendations without calculating', async () => {
  for (const mutate of [ui => ui.setTarget('2000'), ui => ui.setStrategy('fewest'), ui => ui.setAmount('R1', '1'), ui => ui.addRow(), ui => ui.removeRow('R1'), ui => ui.appendBulk('1')]) {
    const ui = populated(); await ui.calculate(); assert.ok(ui.getState().results.length);
    mutate(ui); assert.deepEqual(ui.getState().results, []); assert.equal(ui.getState().selectedResult, null);
    assert.match(ui.getState().message, /Run Find Best Match/);
  }
});

test('invalid target, populated receipt and empty input use generic feedback', async () => {
  for (const [target, amount] of [['', '500'], ['0', '500'], ['1000', ''], ['1000', '0'], ['1000', 'abc']]) {
    const ui = calculator(); ui.setTarget(target); ui.setAmount('R1', amount);
    assert.equal(await ui.calculate(), false); assert.equal(ui.getState().message, invalidQuickAmountMessage);
    assert.deepEqual(ui.getState().results, []);
  }
});

test('busy state yields before calculation and prevents duplicate work', async () => {
  let resume;
  const ui = calculator({ nextFrame: () => new Promise(resolve => { resume = resolve; }) });
  ui.setTarget('500'); ui.setAmount('R1', '500');
  const pending = ui.calculate();
  assert.equal(ui.getState().busy, true); assert.equal(ui.getState().message, 'Calculating…');
  assert.deepEqual(ui.getState().results, []); assert.equal(await ui.calculate(), false);
  resume(); await pending; assert.equal(ui.getState().busy, false); assert.equal(ui.getState().results.length, 1);
});

test('editing or logout during frame yield cancels stale calculations', async () => {
  for (const mutate of [ui => ui.setAmount('R1', '600'), ui => ui.clearForLogout()]) {
    let resume;
    const ui = calculator({ nextFrame: () => new Promise(resolve => { resume = resolve; }) });
    ui.setTarget('500'); ui.setAmount('R1', '500'); const pending = ui.calculate(); mutate(ui); resume();
    assert.equal(await pending, false); assert.deepEqual(ui.getState().results, []); assert.equal(ui.getState().busy, false);
  }
});

test('same-instance hiding preserves state; logout and fresh instance reset; snapshots cannot mutate model', async () => {
  const ui = populated(); await ui.calculate(); const before = ui.getState();
  ui.setModuleVisible(false); ui.setModuleVisible(true); assert.deepEqual(ui.getState(), before);
  const snapshot = ui.getState(); snapshot.rows[0].raw = 'bad'; assert.equal(ui.getState().rows[0].raw, '500');
  ui.clearForLogout(); assert.deepEqual(ui.getState(), calculator().getState());
});

// Minimal event-capable DOM fixture: execute real view creation and click/input handlers.
class Node {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.value = ''; this.textContent = '';
    this.classes = new Set(); this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  focus() { this.focused = true; }
  querySelector(selector) {
    const descendants = this.children.flatMap(child => [child, ...child.descendants()]);
    return descendants.find(child => selector.startsWith('#') ? child.id === selector.slice(1) : child.tag === selector) || null;
  }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
}
const dom = () => {
  const controls = Object.fromEntries(['target', 'strategy', 'helper', 'rows', 'bulk', 'append', 'add', 'clear', 'calculate', 'feedback', 'results', 'breakdown'].map(key => [key, new Node()]));
  const document = { createElement: tag => new Node(tag) };
  const root = { ownerDocument: document, hidden: true, querySelector: selector => controls[selector.match(/"(.+)"/)[1]] };
  return { controls, root, ui: calculator({ root }) };
};

test('DOM events render labels, accessible alternatives, signed differences, highlights and breakdown', async () => {
  const { ui, controls, root } = dom();
  assert.deepEqual(controls.rows.children.map(row => row.children[0].textContent), ['R1', 'R2', 'R3']);
  const input = controls.rows.children[0].querySelector('input'); input.value = '500'; input.listeners.input();
  controls.bulk.value = '500\n1040\n990'; controls.append.listeners.click();
  controls.target.value = '1000'; controls.target.listeners.input();
  await controls.calculate.listeners.click();
  assert.equal(controls.calculate.disabled, false); assert.equal(controls.results.attributes['aria-busy'], 'false');
  assert.equal(controls.results.children.length, 3);
  assert.deepEqual(controls.results.children.map(card => card.children[0].textContent), ['Best Match', 'Alternative 1', 'Alternative 2']);
  assert.ok(controls.results.children.every(card => card.tag === 'button' && card.type === 'button'));
  assert.equal(controls.results.children[0].attributes['aria-pressed'], 'true');
  assert.match(controls.results.children[1].children[3].textContent, /\+.*40\.00/);
  assert.match(controls.results.children[2].children[3].textContent, /−.*10\.00/);
  assert.ok(controls.rows.children[0].classes.has('is-selected'));
  controls.results.children[1].listeners.click();
  assert.equal(ui.getState().selectedResult, 1); assert.equal(controls.results.children[1].focused, true);
  assert.equal(controls.results.children[1].attributes['aria-pressed'], 'true');
  assert.deepEqual(controls.rows.children.filter(row => row.classes.has('is-selected')).map(row => row.dataset.receiptId), ['R3']);
  assert.match(controls.breakdown.children[0].textContent, /R3.*1,040\.00/);
  ui.setModuleVisible(true); assert.equal(root.hidden, false); const before = ui.getState();
  ui.setModuleVisible(false); ui.setModuleVisible(true); assert.deepEqual(ui.getState(), before);
  controls.strategy.value = 'without-exceeding'; controls.strategy.listeners.change();
  assert.equal(controls.helper.textContent, 'No amount above target is permitted.');
  assert.equal(controls.results.children.length, 0); assert.ok(controls.rows.children.every(row => !row.classes.has('is-selected')));
  controls.clear.listeners.click(); assert.equal(controls.target.value, ''); assert.equal(controls.strategy.value, 'closest');
  assert.equal(controls.bulk.value, ''); assert.equal(controls.feedback.textContent, '');
});

test('DOM row add/remove controls preserve identities and move focus predictably', () => {
  const { controls, ui } = dom();
  controls.rows.children[1].children[2].listeners.click();
  assert.equal(controls.rows.children[1].querySelector('input').focused, true);
  controls.add.listeners.click();
  assert.deepEqual(ui.getState().rows.map(row => row.id), ['R1', 'R3', 'R4']);
  assert.equal(controls.rows.children[2].querySelector('input').focused, true);
  assert.equal(controls.rows.children[2].children[2].attributes['aria-label'], 'Remove R4');
});

test('calculator operates when browser storage and network access would throw', async () => {
  const keys = ['localStorage', 'sessionStorage', 'fetch'];
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  try {
    keys.forEach(key => Object.defineProperty(globalThis, key, { configurable: true, get() { throw new Error(`${key} accessed`); } }));
    const ui = populated(); await ui.calculate(); ui.selectResult(1); ui.clearForLogout();
    assert.deepEqual(ui.getState(), calculator().getState());
  } finally {
    keys.forEach((key, index) => descriptors[index] ? Object.defineProperty(globalThis, key, descriptors[index]) : delete globalThis[key]);
  }
  const source = await readFile(new URL('../ui/quickOptimizerUi.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.deepEqual(imports, ['../services/optimizationService.js']);
});
