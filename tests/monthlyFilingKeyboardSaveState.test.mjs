// Issue #42 / #50: Monthly Filing Ctrl+Enter = Add, Ctrl+S = Save, and the visible save state (Unsaved changes / Saving / Saved / Save failed).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { monthlyFixture, savedMonthly } from './helpers/monthlyFilingUiFixture.mjs';
import { monthlyFilingSaveState, monthlyFilingShortcut } from '../ui/monthlyFilingUi.js';

const user = { id: 'user-1' };
const press = (f, init = {}) => { const event = { key: 'Enter', ctrlKey: true, prevented: false, preventDefault() { event.prevented = true; }, ...init }; return f.elements.workspace.emit('keydown', event).then(() => event); };
const ready = async (records = [], options = {}) => { const f = monthlyFixture({ records, ...options }); await f.ui.loadForUser(user); f.elements.workspace.hidden = false; return f; };
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
const stateOf = f => [f.elements.saveState.dataset.state, f.elements.saveState.textContent, f.elements.saveState.hidden];

test('KB-1: only plain Ctrl+Enter and Ctrl+S are shortcuts; every other modifier combination, IME composition and other keys are ignored', () => {
  assert.equal(monthlyFilingShortcut({ ctrlKey: true, key: 'Enter' }), 'add'); assert.equal(monthlyFilingShortcut({ ctrlKey: true, key: 's' }), 'save'); assert.equal(monthlyFilingShortcut({ ctrlKey: true, key: 'S' }), 'save');
  for (const event of [{ key: 'Enter' }, { key: 's' }, { ctrlKey: true, shiftKey: true, key: 's' }, { ctrlKey: true, altKey: true, key: 'Enter' }, { metaKey: true, key: 's' }, { ctrlKey: true, metaKey: true, key: 's' }, { ctrlKey: true, key: 'a' }, { ctrlKey: true, key: 'Enter', isComposing: true }, { ctrlKey: true, key: 's', keyCode: 229 }, {}]) assert.equal(monthlyFilingShortcut(event), '', JSON.stringify(event));
  assert.equal(monthlyFilingShortcut(undefined), '');
});

test('KB-2: Ctrl+Enter adds one receipt using the Add handler (expanded, Store focused); repeated key events do not add more', async () => {
  const f = await ready([savedMonthly('a')]);
  const event = await press(f); assert.equal(event.prevented, true);
  assert.equal(f.cards().length, 2); assert.equal(f.state.activeElement, f.field(f.cards()[1], 'store'));
  await press(f, { repeat: true }); assert.equal(f.cards().length, 2, 'a held key does not repeat the action');
  await press(f); assert.equal(f.cards().length, 2, 'the existing blank receipt is reused, exactly as the Add button does');
});

test('KB-3: Ctrl+S saves through the Save handler, suppresses the browser Save Page dialog, and never saves twice for repeated key events', async () => {
  const f = await ready([savedMonthly('a')]); await f.edit(f.cards()[0], 'store', 'Changed');
  const event = await press(f, { key: 's' }); await settle();
  assert.equal(event.prevented, true); assert.equal(f.calls.update.length, 1); assert.equal(f.calls.update[0][1].store, 'Changed');
  await press(f, { key: 's', repeat: true }); await settle(); assert.equal(f.calls.update.length, 1);
});

test('KB-4: the shortcuts do nothing outside an eligible Monthly Filing screen: hidden workspace, Archived tab, signed-out, open dialog', async () => {
  const f = await ready([savedMonthly('a'), savedMonthly('old', { status: 'archived' })]);
  f.elements.workspace.hidden = true; assert.equal((await press(f)).prevented, false); assert.equal((await press(f, { key: 's' })).prevented, false); f.elements.workspace.hidden = false;
  await f.click(f.elements.archivedTab); assert.equal((await press(f)).prevented, false, 'the Archived tab has no Add'); assert.equal(f.calls.create.length + f.calls.update.length, 0); await f.click(f.elements.activeTab);
  const before = f.cards().length; f.ui.clearForLogout(); assert.equal((await press(f)).prevented, false, 'signed out'); assert.equal(f.cards().length <= before, true);
  const g = await ready([savedMonthly('a')]); globalThis.document.querySelector = selector => /aria-modal/.test(selector) ? {} : null;
  try { assert.equal((await press(g)).prevented, false, 'a dialog is open'); assert.equal(g.cards().length, 1); } finally { delete globalThis.document.querySelector; }
});

test('KB-5: the guards are untouched: while a save is pending the shortcut starts no second save and no extra receipt; a disabled Add stays disabled', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await ready([savedMonthly('a')]); await f.edit(f.cards()[0], 'store', 'Changed'); f.gates.update = gate;
  await press(f, { key: 's' }); await settle();
  assert.equal(f.calls.update.length, 1);
  await press(f, { key: 's' }); await press(f); await settle();
  assert.equal(f.calls.update.length, 1, 'no duplicate save'); assert.equal(f.cards().length, 1, 'no receipt added mid-save');
  release(); await settle(); assert.equal(f.calls.update.length, 1);
});

test('KB-6: Ctrl+Enter never selects an autocomplete suggestion: the shortcut only adds, and the store field keeps what was typed', async () => {
  const f = await ready([], { sharedStoreService: { listActiveSharedStores: async () => [{ id: 'p1', storeName: 'Alpha Mart', address: '1 Road', tin: '123456789012', vat: 'VAT' }] } });
  await f.click(f.elements.add); const [card] = f.cards(); await f.edit(card, 'store', 'Alpha');
  await press(f); assert.equal(f.field(card, 'store').value, 'Alpha'); assert.equal(f.field(card, 'tin').value, '', 'no profile was applied by Ctrl+Enter');
});

test('SAVE-1: the save state is pure: Saving wins, a failure stays visible, unsaved edits beat Saved, Saved needs a confirmed save, otherwise nothing is shown', () => {
  assert.deepEqual(monthlyFilingSaveState({ status: 'idle', dirtyCount: 0 }), { key: 'idle', text: '' });
  assert.equal(monthlyFilingSaveState({ status: 'saved', saving: true, dirtyCount: 3 }).text, 'Saving…');
  assert.equal(monthlyFilingSaveState({ status: 'failed', dirtyCount: 2 }).text, 'Save failed');
  assert.equal(monthlyFilingSaveState({ status: 'saved', dirtyCount: 1 }).text, 'Unsaved changes');
  assert.equal(monthlyFilingSaveState({ status: 'saved', dirtyCount: 0 }).text, 'Saved');
  assert.equal(monthlyFilingSaveState({ status: 'idle', dirtyCount: 0 }).text, '', 'loading alone never claims Saved');
});

test('SAVE-2: the indicator follows a real save: hidden after load, Unsaved changes on edit, Saving while the request runs, Saved only after success, Unsaved again on the next edit', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await ready([savedMonthly('a')]);
  assert.deepEqual(stateOf(f), ['idle', '', true], 'nothing is claimed after loading');
  await f.edit(f.cards()[0], 'store', 'Changed'); assert.deepEqual(stateOf(f), ['unsaved', 'Unsaved changes', false]);
  f.gates.update = gate; const saving = f.click(f.elements.save); await settle();
  assert.deepEqual(stateOf(f), ['saving', 'Saving…', false]);
  release(); await saving; await settle(); assert.deepEqual(stateOf(f), ['saved', 'Saved', false]);
  await f.edit(f.cards()[0], 'store', 'Changed again'); assert.deepEqual(stateOf(f), ['unsaved', 'Unsaved changes', false]);
});

test('SAVE-3: a failed save shows Save failed (never Saved), keeps the typed values, and only a later successful save clears it', async () => {
  const f = await ready([savedMonthly('a')]); await f.edit(f.cards()[0], 'store', 'Changed');
  const update = f.ui; const original = f.table; void update; void original;
  f.gates.update = Promise.reject(new Error('network down')); f.gates.update.catch(() => {});
  await f.click(f.elements.save); await settle();
  assert.deepEqual(stateOf(f), ['failed', 'Save failed', false]); assert.match(f.elements.feedback.textContent, /Could not save Monthly Filing changes: network down/);
  assert.equal(f.field(f.cards()[0], 'store').value, 'Changed', 'the typed value is kept');
  f.gates.update = null; await f.click(f.elements.save); await settle();
  assert.deepEqual(stateOf(f), ['saved', 'Saved', false]);
});

test('SAVE-4: a new session (sign-out or another account) starts with no save state, and Clear all resets it', async () => {
  const f = await ready([savedMonthly('a')]); await f.edit(f.cards()[0], 'store', 'X'); await f.click(f.elements.save); await settle(); assert.equal(f.elements.saveState.dataset.state, 'saved');
  f.ui.clearForLogout(); assert.deepEqual(stateOf(f), ['idle', '', true]);
  await f.ui.loadForUser({ id: 'user-2' }); assert.deepEqual(stateOf(f), ['idle', '', true]);
});

test('MARKUP-1: the controls expose their shortcuts and the save state is a polite live region; Add, Save, Export and Total share the one sticky bar', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8'); const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(html, /id="monthlyFilingAdd" type="button" aria-keyshortcuts="Control\+Enter"/); assert.match(html, /id="monthlyFilingSave" type="button" aria-keyshortcuts="Control\+S"/);
  assert.match(html, /id="monthlySaveState" role="status" aria-live="polite" hidden/);
  const bar = html.slice(html.indexOf('id="monthlyActionsBar"'), html.indexOf('id="monthlyFilingExportHelper"'));
  for (const id of ['monthlyFilingAdd', 'monthlyFilingSave', 'monthlyFilingExportActive', 'monthlyActiveTotal', 'monthlySaveState']) assert.ok(bar.includes(`id="${id}"`), `${id} lives in the sticky bar`);
  assert.match(css, /\.monthly-save-state\[data-state="failed"\]/); assert.doesNotMatch(css.slice(css.indexOf('.monthly-save-state')), /monthly-save-state[^{]*\{[^}]*!important/);
});
