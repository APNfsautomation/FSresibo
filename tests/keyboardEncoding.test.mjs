// CP10-C3E-3K: Ctrl+Enter (Add receipt) and Ctrl+S (Save changes) in Receipt Encoding, driven through the real receipt UI against an in-memory database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';

const saved = (dbId, amount, store, extra = {}) => ({ dbId, amount, store, ...extra });
const key = (f, init, target = f.elements.encodingWorkspace) => { const event = { prevented: false, preventDefault() { event.prevented = true; }, ...init }; target.emit('keydown', event); return event; };
const ctrlEnter = (f, extra = {}) => key(f, { key: 'Enter', ctrlKey: true, ...extra });
const ctrlS = (f, extra = {}) => key(f, { key: 's', ctrlKey: true, ...extra });
const lastRow = f => f.rows().at(-1);
const storeField = row => row.part('.receipt-store');

test('01-03: Ctrl+Enter adds the next receipt, expands it, scrolls it into view and focuses its Store Name', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')] });
  const before = f.rows().length;
  const event = ctrlEnter(f);
  assert.equal(f.rows().length, before + 1); const row = lastRow(f);
  assert.equal(row.open, true, 'expanded');
  assert.equal(f.focusLog.at(-1), storeField(row), 'focus is on Store Name, ready for typing');
  assert.equal(event.prevented, true);
  assert.equal(row.dataset.filterPinned, '1', 'pinned like the Add receipt button does, so it stays visible while edited');
  assert.equal(f.calls.create.length + f.calls.update.length, 0, 'nothing was saved');
});

test('04: the receipt that was being edited keeps every value (and is not saved, cleared or changed)', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')] });
  await f.click(f.elements.floatingAdd); const first = lastRow(f);
  await f.type(first, 'store', 'Cafe Uno'); await f.type(first, 'amount', '1,250.50'); await f.type(first, 'invoice', 'INV-9');
  ctrlEnter(f);
  assert.equal(f.rows().length, 3); assert.notEqual(lastRow(f), first);
  assert.deepEqual(['store', 'amount', 'invoice'].map(name => f.field(first, name).value), ['Cafe Uno', '1,250.50', 'INV-9']);
  assert.equal(f.calls.create.length, 0, 'no automatic save');
  assert.equal(f.rows()[0].dataset.receiptStatus, 'available'); assert.equal(f.field(f.rows()[0], 'store').value, 'Store A', 'other receipts are untouched');
});

test('05, 06: a blank unsaved receipt is reused, and rapid repeated presses never pile up empty receipts', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')] });
  await f.click(f.elements.floatingAdd); const blank = lastRow(f); const count = f.rows().length;
  ctrlEnter(f);
  assert.equal(f.rows().length, count, 'the existing blank receipt is reused'); assert.equal(f.focusLog.at(-1), storeField(blank));
  for (let i = 0; i < 6; i += 1) ctrlEnter(f);
  assert.equal(f.rows().length, count, 'six more presses still leave exactly one blank receipt');
  await f.type(blank, 'store', 'Typed'); ctrlEnter(f); assert.equal(f.rows().length, count + 1, 'once it has content the next press adds a new one');
  for (let i = 0; i < 5; i += 1) ctrlEnter(f); assert.equal(f.rows().length, count + 1);
});

test('a blank receipt that has a staged photo is reused and its photo is left alone', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')] });
  await f.click(f.elements.floatingAdd); const row = lastRow(f);
  const photo = { name: 'receipt.jpg' }; row.part('.receipt-photo').files = [photo]; const count = f.rows().length;
  ctrlEnter(f);
  assert.equal(f.rows().length, count); assert.deepEqual(row.part('.receipt-photo').files, [photo], 'the staged photo data is not touched');
});

test('09: Enter alone never adds a receipt, and other keys and modifier combinations do nothing', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')] }); const count = f.rows().length;
  for (const init of [{ key: 'Enter' }, { key: 'Enter', shiftKey: true }, { key: 'Enter', altKey: true }, { key: 'Enter', metaKey: true }, { key: 'Enter', ctrlKey: true, shiftKey: true }, { key: 'Enter', ctrlKey: true, altKey: true }, { key: 's' }, { key: 's', metaKey: true }, { key: 's', ctrlKey: true, shiftKey: true }, { key: 'a', ctrlKey: true }, { key: 'Tab' }, { key: 'Tab', shiftKey: true }, { key: 'Escape' }, { key: 'ArrowDown' }, { key: 'ArrowUp', ctrlKey: true }]) {
    const event = key(f, init);
    assert.equal(event.prevented, false, `${JSON.stringify(init)} is left alone`);
  }
  assert.equal(f.rows().length, count); assert.deepEqual([f.calls.create.length, f.calls.update.length], [0, 0]);
});

test('07, 08: Ctrl+S runs the existing Save changes workflow and stops the browser Save Page dialog', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')] });
  await f.click(f.elements.floatingAdd); const row = lastRow(f); await f.type(row, 'store', 'New Cafe'); await f.type(row, 'amount', '250');
  const event = ctrlS(f); await settle();
  assert.equal(event.prevented, true, 'the browser default is prevented');
  assert.equal(f.calls.create.length, 1); assert.equal(f.calls.create[0].store, 'New Cafe');
  assert.equal(f.elements.encodingFeedback.textContent, 'Receipt changes saved.');
  assert.equal(row.dataset.receiptDbId.startsWith('new-'), true);
  assert.equal(ctrlS(f, { key: 'S' }).prevented, true, 'also with Caps Lock');
});

test('Ctrl+S is exactly the Save changes button: same calls, same feedback, same save-pending protection', async () => {
  const run = async how => {
    const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')] });
    await f.click(f.elements.floatingAdd); await f.type(lastRow(f), 'store', 'Same'); await f.type(lastRow(f), 'amount', '5');
    if (how === 'key') { ctrlS(f); await settle(); } else await f.click(f.elements.saveDraft);
    return { create: f.calls.create, feedback: f.elements.encodingFeedback.textContent, update: f.calls.update.length };
  };
  assert.deepEqual(await run('key'), await run('click'));
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')] });
  await f.click(f.elements.floatingAdd); await f.type(lastRow(f), 'store', 'Once');
  ctrlS(f); ctrlS(f); ctrlS(f); await settle();
  assert.equal(f.calls.create.length, 1, 'repeated presses cannot start overlapping saves');
});

test('19: when saving fails, every unsaved value is preserved (invalid amount, and a service error)', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')] });
  await f.click(f.elements.floatingAdd); const row = lastRow(f); await f.type(row, 'store', 'Cafe'); await f.type(row, 'amount', '12,34.50');
  ctrlS(f); await settle();
  assert.equal(f.calls.create.length, 0); assert.match(f.elements.encodingFeedback.textContent, /Could not save receipt changes\. Receipt \d+: Invalid amount "12,34\.50"/);
  assert.deepEqual([f.field(row, 'store').value, f.field(row, 'amount').value], ['Cafe', '12,34.50']);
  await f.type(row, 'amount', '120'); f.fails.save = new Error('network down');
  ctrlS(f); await settle();
  assert.match(f.elements.encodingFeedback.textContent, /Could not save receipt changes: network down/);
  assert.deepEqual([f.field(row, 'store').value, f.field(row, 'amount').value], ['Cafe', '120'], 'the receipt is still there with its values');
  assert.equal(row.dataset.receiptDbId, undefined, 'and is not marked as saved');
  assert.equal(f.elements.saveDraft.disabled, false, 'Save is usable again');
  f.fails.save = null; ctrlS(f); await settle(); assert.equal(f.elements.encodingFeedback.textContent, 'Receipt changes saved.');
});

test('20: the Add receipt and Save changes buttons keep working', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')] }); const count = f.rows().length;
  await f.click(f.elements.floatingAdd); assert.equal(f.rows().length, count + 1);
  await f.type(lastRow(f), 'store', 'Button Cafe'); await f.type(lastRow(f), 'amount', '10'); await f.click(f.elements.saveDraft);
  assert.equal(f.calls.create.length, 1); assert.equal(f.elements.encodingFeedback.textContent, 'Receipt changes saved.');
});

test('10, 11: Store autocomplete: plain Enter still accepts the highlighted suggestion; Ctrl+Enter never does', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Mercury Drug'), saved('r2', 200, 'Mercato Market')] });
  await f.click(f.elements.floatingAdd); const row = lastRow(f); const input = storeField(row);
  await f.type(row, 'store', 'Mer');
  input.emit('keydown', { key: 'ArrowDown', preventDefault() {} });
  const withCtrl = { key: 'Enter', ctrlKey: true, prevented: false, preventDefault() { withCtrl.prevented = true; } };
  input.emit('keydown', withCtrl);
  assert.equal(input.value, 'Mer', 'Ctrl+Enter did not take the highlighted suggestion'); assert.equal(withCtrl.prevented, false, 'the autocomplete leaves the event to the shortcut');
  const count = f.rows().length; ctrlEnter(f);
  assert.equal(f.rows().length, count + 1, 'and the shortcut added the next receipt'); assert.equal(input.value, 'Mer', 'the half-typed store is preserved as typed');
  const plain = { key: 'Enter', prevented: false, preventDefault() { plain.prevented = true; } };
  input.emit('keydown', plain);
  assert.notEqual(input.value, 'Mer', 'plain Enter accepts the suggestion'); assert.match(input.value, /^Merc/); assert.equal(plain.prevented, true);
  assert.equal(f.rows().length, count + 1, 'accepting a suggestion with Enter never adds a receipt');
});

test('inactive: signed out, another workspace shown, a dialog open, or the workspace hidden', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')] }); const count = f.rows().length;
  f.elements.encodingWorkspace.hidden = true;
  assert.equal(ctrlEnter(f).prevented, false); assert.equal(ctrlS(f).prevented, false); assert.equal(f.rows().length, count, 'the Encoding workspace is hidden (Optimization etc. is showing)');
  f.elements.encodingWorkspace.hidden = false;
  const open = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')], modalFocus: { open() {}, close() {}, isOpen: () => true } });
  assert.equal(ctrlEnter(open).prevented, false); assert.equal(ctrlS(open).prevented, false); assert.equal(open.rows().length, 1, 'a dialog is open (modal focus manager)');
  const out = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')] });
  out.ui.clearForLogout();
  assert.equal(ctrlEnter(out).prevented, false, 'signed out: the browser keeps its own Ctrl shortcuts'); assert.equal(ctrlS(out).prevented, false); assert.equal(out.rows().length, 0);
  for (const name of ['optimizationWorkspace', 'monthlyFilingWorkspace', 'quickOptimizerWorkspace', 'exportConfirmModal', 'editModal', 'confirmationModal']) assert.equal(f.elements[name].listeners?.keydown, undefined, `${name} has no shortcut listener`);
  assert.deepEqual(Object.keys(f.elements.encodingWorkspace.listeners).includes('keydown'), true, 'the one listener is on the Encoding workspace');
});

test('18: repeated keydown events (key held down) and IME composition are ignored', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')] });
  await f.click(f.elements.floatingAdd); await f.type(lastRow(f), 'store', 'Typed'); await f.type(lastRow(f), 'amount', '5');
  const count = f.rows().length;
  assert.equal(ctrlEnter(f, { repeat: true }).prevented, true, 'a held key is swallowed');
  assert.equal(f.rows().length, count, 'but does not repeat the action');
  assert.equal(ctrlS(f, { repeat: true }).prevented, true, 'and a held Ctrl+S does not open the browser Save dialog either'); await settle();
  assert.equal(f.calls.create.length, 0);
  for (const init of [{ isComposing: true }, { keyCode: 229 }]) { assert.equal(ctrlEnter(f, init).prevented, false); assert.equal(ctrlS(f, init).prevented, false); }
  assert.equal(f.rows().length, count); assert.equal(f.calls.create.length, 0);
});

test('Ctrl+Enter does not save, clear, change status, optimize or open any dialog', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A'), saved('r2', 200, 'Store B', { status: 'consumed' })] });
  f.elements.target.value = '300';
  ctrlEnter(f);
  assert.deepEqual([f.calls.create.length, f.calls.update.length, f.calls.consume.length, f.calls.snapshot.length], [0, 0, 0, 0]);
  assert.deepEqual(f.rows().slice(0, 2).map(row => row.dataset.receiptStatus), ['available', 'consumed']);
  assert.equal(f.elements.exportConfirmModal.hidden, true); assert.equal(f.elements.exportSelected.disabled, true, 'no optimization ran');
  assert.equal(f.elements.editModal.hidden, true);
});

test('focus: with many receipts, a scrolled list and a rapid sequence, the newest receipt always owns the focus', async () => {
  const loaded = Array.from({ length: 40 }, (_, i) => saved(`r${i + 1}`, 10 + i, `Store ${i + 1}`));
  const f = await receiptFixture({ loaded });
  ctrlEnter(f); const first = lastRow(f);
  assert.equal(f.rows().length, 41); assert.equal(f.focusLog.at(-1), storeField(first));
  await f.type(first, 'store', 'Filled'); ctrlEnter(f);
  assert.equal(f.rows().length, 42); assert.equal(f.focusLog.at(-1), storeField(lastRow(f)));
  assert.equal(f.rows().slice(0, 40).every((row, i) => f.field(row, 'store').value === undefined || row.dataset.receiptDbId === `r${i + 1}`), true, 'the 40 saved receipts are untouched and in place');
  assert.equal(f.rows()[40].part('.receipt-store').value, 'Filled');
});

test('hidden by a filter: the existing warning is shown, the filter is not changed, and no focus is stolen', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A', { status: 'consumed' })] });
  f.elements.receiptStatusFilter.value = 'consumed'; await f.elements.receiptStatusFilter.emit('change');
  const before = f.focusLog.length;
  ctrlEnter(f);
  assert.match(f.elements.encodingFeedback.textContent, /The new receipt is hidden by the current view\. Choose Available or All in View receipts to see it\./);
  assert.equal(f.elements.receiptStatusFilter.value, 'consumed', 'the filter is untouched');
  assert.equal(f.focusLog.length, before, 'nothing is focused in a hidden receipt');
});

test('12: Tab and Shift+Tab are never intercepted', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A')] });
  for (const shiftKey of [false, true]) { const event = key(f, { key: 'Tab', shiftKey }); assert.equal(event.prevented, false); }
  const input = storeField(f.rows()[0]); const tab = { key: 'Tab', prevented: false, preventDefault() { tab.prevented = true; } }; input.emit('keydown', tab); assert.equal(tab.prevented, false);
});

// ---- markup, styles ------------------------------------------------------------------------------------------------------------------------------------
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = (await readFile(new URL('../styles.css', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('13-17: the shortcut scope is the Encoding workspace element: no other workspace and no dialog is inside it', () => {
  const start = html.indexOf('id="encodingWorkspace"'); const end = html.indexOf('id="optimizationWorkspace"');
  const encoding = html.slice(start, end);
  for (const id of ['optimizationWorkspace', 'monthlyFilingWorkspace', 'quickOptimizerWorkspace', 'exportConfirmModal', 'editReceiptModal', 'confirmationModal', 'authView']) assert.equal(encoding.includes(`id="${id}"`), false, `${id} is outside the Encoding workspace`);
  assert.ok(encoding.includes('id="floatingAddReceipt"') && encoding.includes('id="saveDraft"'));
  for (const id of ['monthlyFilingWorkspace', 'quickOptimizerWorkspace']) assert.ok(html.indexOf(`id="${id}"`) > end, `${id} follows the Encoding workspace and is not inside it`);
  assert.ok(html.indexOf('id="exportConfirmModal"') > html.indexOf('</main>'), 'dialogs sit outside the main content');
});

test('discoverability: both buttons advertise their shortcut (aria-keyshortcuts + a decorative hint) and keep their visible labels', () => {
  assert.match(html, /id="floatingAddReceipt" type="button" aria-keyshortcuts="Control\+Enter">/); assert.match(html, /id="saveDraft" type="button" aria-keyshortcuts="Control\+S">/);
  assert.equal((html.match(/<kbd class="shortcut-hint" aria-hidden="true">/g) ?? []).length, 2, 'two hints, both hidden from assistive technology');
  assert.match(html, /Add receipt <kbd class="shortcut-hint" aria-hidden="true">Ctrl\+Enter<\/kbd>/); assert.match(html, /Save changes <kbd class="shortcut-hint" aria-hidden="true">Ctrl\+S<\/kbd>/);
});

test('the hints are subtle, token-based, never wrap, and disappear on touch screens and phones (no Ctrl key, no overflow)', () => {
  const rule = css.match(/\n\.shortcut-hint \{([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /white-space: nowrap/); assert.match(rule, /opacity: \.7/); assert.match(rule, /border: var\(--border-width\) solid currentColor/);
  assert.doesNotMatch(rule, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/, 'inherits the button colour: readable in light and dark');
  assert.match(css, /@media \(pointer: coarse\), \(max-width: 640px\) \{ \.shortcut-hint \{ display: none; \} \}/);
});
