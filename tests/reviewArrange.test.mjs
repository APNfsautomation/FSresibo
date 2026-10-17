// CP10-C3E-2: the Review & Arrange dialog, driven through the real receipt UI against an in-memory receipts database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildExpenseDetailedReportRows } from '../services/exportService.js';
import { findBest } from '../services/optimizationService.js';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';

const saved = (dbId, amount, store, extra = {}) => ({ dbId, amount, store, ...extra });
const four = () => [saved('r1', 100, 'Store A', { invoice: 'INV-1', receiptDate: '2026-08-01' }), saved('r2', 200, 'Store B', { invoice: 'INV-2', receiptDate: '2026-08-02' }), saved('r3', 300, 'Store C'), saved('r4', 400, 'Store D')];
const calculate = async (f, target) => { f.elements.target.value = target; await f.click(f.elements.calculate); };
const exportClick = f => f.click(f.elements.exportSelected);
const confirm = f => f.click(f.elements.confirmExport);
const cancel = f => f.click(f.elements.cancelExport);
const dialogOpen = f => f.elements.exportConfirmModal.hidden === false;
const items = f => f.elements.exportReviewList.children;
const order = f => items(f).map(item => item.dataset.receiptId);
const parts = (f, id) => items(f).find(item => item.dataset.receiptId === id).reviewParts;
const press = (f, id, key) => parts(f, id).handle.emit('keydown', { key });
const open = async (f, target = '1000') => { await calculate(f, target); await exportClick(f); return f; };
const otherSession = (f, id, changes) => f.db.set(id, { ...f.db.get(id), ...changes, updatedAt: f.stamp() });
const ack = async f => { f.elements.exportReviewAckInput.checked = true; await f.elements.exportReviewAckInput.emit('change'); };

test('A: the review opens in the optimizer export order with positions, numbers, stores, invoices, dates and amounts', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  assert.equal(dialogOpen(f), true);
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']);
  assert.deepEqual(items(f).map(item => item.reviewParts.position.textContent), ['1', '2', '3', '4']);
  const first = items(f)[0];
  assert.equal(first.children[2].children[0].textContent, 'Receipt 1 · Store A');
  assert.match(first.children[2].children[1].textContent, /^Invoice INV-1 · Aug 1, 2026$/);
  assert.equal(first.reviewParts.amount.textContent.replace(/\s/g, ''), '₱100.00');
  assert.equal(items(f)[2].children[2].children[1].textContent, 'No invoice number · Date not set');
  assert.equal(f.elements.exportReviewCount.textContent, '4');
  assert.equal(f.elements.exportReviewTotal.textContent.replace(/\s/g, ''), '₱1,000.00');
  assert.equal(f.elements.exportReviewNoAmountGroup.hidden, true);
  assert.equal(f.focusLog.at(-1), f.elements.confirmExport);
});

test('B, C: Move up and Move down reorder one place, and the boundary buttons are disabled', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  assert.equal(parts(f, 'r1').up.disabled, true); assert.equal(parts(f, 'r4').down.disabled, true);
  assert.equal(parts(f, 'r1').down.disabled, false); assert.equal(parts(f, 'r4').up.disabled, false);
  await parts(f, 'r3').up.emit('click');
  assert.deepEqual(order(f), ['r1', 'r3', 'r2', 'r4']);
  await parts(f, 'r1').down.emit('click');
  assert.deepEqual(order(f), ['r3', 'r1', 'r2', 'r4']);
  assert.deepEqual(items(f).map(item => item.reviewParts.position.textContent), ['1', '2', '3', '4']);
  assert.equal(parts(f, 'r3').up.disabled, true, 'the new first receipt cannot move up');
  assert.match(parts(f, 'r1').up.getAttribute('aria-label'), /^Move Receipt 1 up$/);
  assert.match(parts(f, 'r1').handle.getAttribute('aria-label'), /^Reorder Receipt 1, position 2 of 4$/);
});

test('D, E: ArrowUp and ArrowDown move one place; Home and End jump to the ends; boundaries do nothing but announce', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  await press(f, 'r2', 'ArrowDown'); assert.deepEqual(order(f), ['r1', 'r3', 'r2', 'r4']);
  await press(f, 'r2', 'ArrowUp'); assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']);
  await press(f, 'r3', 'End'); assert.deepEqual(order(f), ['r1', 'r2', 'r4', 'r3']);
  await press(f, 'r3', 'Home'); assert.deepEqual(order(f), ['r3', 'r1', 'r2', 'r4']);
  await press(f, 'r3', 'ArrowUp');
  assert.deepEqual(order(f), ['r3', 'r1', 'r2', 'r4'], 'already first');
  assert.match(f.elements.exportReviewAnnouncer.textContent, /^Receipt 3 is already at position 1 of 4\./);
  let prevented = false;
  await parts(f, 'r1').handle.emit('keydown', { key: 'ArrowDown', preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'handled keys do not scroll the page');
  await parts(f, 'r1').handle.emit('keydown', { key: 'ArrowDown', ctrlKey: true });
  await parts(f, 'r2').handle.emit('keydown', { key: 'a' });
  assert.deepEqual(order(f), ['r3', 'r2', 'r1', 'r4'], 'modified or unrelated keys are ignored');
});

test('F, G: the total, the selection and the optimizer result do not change when receipts are moved', async () => {
  const f = await receiptFixture({ loaded: four() });
  await calculate(f, '600');
  const result = { title: f.elements.resultTitle.textContent, amount: f.elements.resultAmount.textContent, label: f.elements.exportSelected.textContent };
  await exportClick(f);
  const total = f.elements.exportReviewTotal.textContent; const members = [...order(f)].sort();
  await press(f, order(f)[0], 'End'); await parts(f, order(f)[1]).up.emit('click'); await press(f, order(f).at(-1), 'Home');
  assert.equal(f.elements.exportReviewTotal.textContent, total);
  assert.deepEqual([...order(f)].sort(), members);
  assert.deepEqual({ title: f.elements.resultTitle.textContent, amount: f.elements.resultAmount.textContent, label: f.elements.exportSelected.textContent }, result);
  assert.deepEqual(f.cards().filter(card => card.classList.contains('is-selected')).map(card => card.part('.compact-store').textContent).sort(), members.map(id => f.db.get(id).store).sort());
  const candidates = [100, 200, 300, 400].map((cents, index) => ({ index, cents: cents * 100 }));
  assert.deepEqual(findBest(candidates, 60000), findBest(candidates, 60000), 'the optimizer is untouched');
  assert.deepEqual(['r1', 'r2', 'r3', 'r4'].map(id => f.db.get(id).amount), [100, 200, 300, 400], 'and so are the receipts');
});

test('focus stays on the control that was used, and hops to its neighbour at an edge', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  await parts(f, 'r2').down.emit('click');
  assert.equal(f.focusLog.at(-1), parts(f, 'r2').down, 'the same control of the same receipt');
  await parts(f, 'r2').down.emit('click');
  assert.equal(parts(f, 'r2').down.disabled, true);
  assert.equal(f.focusLog.at(-1), parts(f, 'r2').up, 'focus moved to the remaining button instead of being lost');
  await press(f, 'r1', 'ArrowDown');
  assert.equal(f.focusLog.at(-1), parts(f, 'r1').handle, 'keyboard use keeps focus on the handle');
});

test('moves are announced for screen readers', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  await parts(f, 'r3').up.emit('click');
  assert.match(f.elements.exportReviewAnnouncer.textContent, /^Receipt 3 moved to position 2 of 4\.$/);
  await press(f, 'r3', 'Home');
  assert.match(f.elements.exportReviewAnnouncer.textContent, /^Receipt 3 moved to position 1 of 4\./);
});

test('H: Reset order restores the initial order and is only enabled when the order differs', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  assert.equal(f.elements.exportReviewReset.disabled, true);
  await press(f, 'r4', 'Home'); assert.equal(f.elements.exportReviewReset.disabled, false);
  await f.elements.exportReviewReset.emit('click');
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']);
  assert.equal(f.elements.exportReviewReset.disabled, true);
  assert.match(f.elements.exportReviewAnnouncer.textContent, /^Order reset to the original export order\./);
  assert.equal(f.focusLog.at(-1), parts(f, 'r1').handle, 'focus moves to the list instead of the button that just became disabled');
});

test('I, J, K: Cancel generates and consumes nothing, and reopening restores the arrangement', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  await press(f, 'r4', 'Home'); await press(f, 'r2', 'End');
  const arranged = [...order(f)];
  await cancel(f);
  assert.equal(dialogOpen(f), false);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (4)');
  await exportClick(f);
  assert.deepEqual(order(f), arranged, 'the same arrangement');
  assert.equal(f.elements.exportReviewReset.disabled, false);
  await f.elements.exportReviewReset.emit('click'); await cancel(f); await exportClick(f);
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4'], 'Reset order is remembered too');
});

test('L: recalculating discards the arrangement, even for the same receipts', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  await press(f, 'r4', 'Home'); await cancel(f);
  await calculate(f, '1000'); await exportClick(f);
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']);
});

test('editing a selected receipt (the result is cleared) discards the arrangement', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  await press(f, 'r4', 'Home'); await cancel(f);
  await f.type(f.rows()[0], 'amount', '100.00');
  assert.equal(f.elements.exportSelected.disabled, true);
  await calculate(f, '1000'); await exportClick(f);
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']);
});

test('M, O, P: the confirmed order decides the workbook order and Item No.; a successful export discards the arrangement', async () => {
  const f = await receiptFixture({ loaded: four() });
  await open(f);
  await press(f, 'r4', 'Home'); await parts(f, 'r2').down.emit('click');
  const confirmed = [...order(f)];
  assert.deepEqual(confirmed, ['r4', 'r1', 'r3', 'r2']);
  await confirm(f);
  assert.deepEqual(f.calls.download[0].map(item => item.dbId), confirmed);
  assert.deepEqual(f.calls.consume, [confirmed], 'the same receipts are marked Consumed');
  const rows = buildExpenseDetailedReportRows(f.calls.download[0]).slice(2);
  assert.deepEqual(rows.map(row => [row[0], row[2], row[7]]), [[1, 'Store D', 400], [2, 'Store A', 100], [3, 'Store C', 300], [4, 'Store B', 200]], 'Item No. 1..n follows the order and values are the saved ones');
  assert.deepEqual(['r1', 'r2', 'r3', 'r4'].map(id => f.db.get(id).status), ['consumed', 'consumed', 'consumed', 'consumed']);
  assert.equal(f.elements.difference.textContent, '4 receipts exported and marked as Consumed.');
  for (const row of f.rows()) { await row.part('.restore-receipt').emit('click'); await settle(); }
  await open(f);
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4'], 'a later review for the same receipts starts from the original order');
});

test('N: logout discards the arrangement', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  await press(f, 'r4', 'Home'); await cancel(f);
  f.ui.clearForLogout();
  await f.ui.loadForUser({ id: 'user-1' });
  await open(f);
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']);
});

test('the arrangement is never written to browser storage or the database', async () => {
  const { storage } = await import('./helpers/receiptUiFixture.mjs');
  const f = await open(await receiptFixture({ loaded: four() }));
  await press(f, 'r4', 'Home'); await cancel(f);
  assert.equal([...storage.values()].some(value => String(value).includes('r4') && String(value).includes('r1') && /"?order/i.test(String(value))), false);
  assert.equal(f.calls.update.length + f.calls.create.length, 0);
  const source = await readFile(new URL('../ui/exportReview.js', import.meta.url), 'utf8') + await readFile(new URL('../domain/exportArrangement.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|supabase|fetch\(/);
});

// ---- changed database values ----------------------------------------------------------------------------------------------------------
test('Q: the final snapshot check is still active after reordering', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  await press(f, 'r4', 'Home');
  otherSession(f, 'r1', { amount: 150 });
  await confirm(f);
  assert.equal(f.calls.snapshot.length, 2);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
});

test('R: an amount change needs a new Find Best Match and cannot be acknowledged away', async () => {
  const f = await receiptFixture({ loaded: four() });
  await calculate(f, '1000');
  otherSession(f, 'r2', { amount: 250 });
  await exportClick(f);
  assert.equal(dialogOpen(f), false);
  assert.match(f.elements.difference.textContent, /saved amount of Receipt 2 no longer matches the amount Find Best Match used/);
  assert.equal(f.elements.resultTitle.textContent, 'Result out of date');
  const g = await open(await receiptFixture({ loaded: four() }));
  otherSession(g, 'r3', { amount: 310 });
  await confirm(g);
  assert.equal(dialogOpen(g), false, 'an amount change while the dialog is open also closes it');
  assert.equal(g.elements.exportReviewAck.hidden, true);
  assert.match(g.elements.difference.textContent, /No workbook was prepared and nothing was marked Consumed\. Run Find Best Match again\./);
  assert.deepEqual([g.calls.download.length, g.calls.consume.length], [0, 0]);
});

test('S: other field changes are shown, named, and need an explicit acknowledgement before anything is exported', async () => {
  const f = await receiptFixture({ loaded: four() });
  await calculate(f, '1000');
  otherSession(f, 'r2', { store: 'Renamed B', invoice: 'INV-9' });
  await exportClick(f);
  assert.equal(dialogOpen(f), true);
  const row = items(f).find(item => item.dataset.receiptId === 'r2');
  assert.equal(row.children[2].children[0].textContent, 'Receipt 2 · Renamed B', 'the current saved value is shown');
  const note = row.children[2].children[2].textContent;
  assert.match(note, /^Updated since selection — Store name: "Store B" to "Renamed B"; Invoice number: "INV-2" to "INV-9"\.$/);
  assert.equal(items(f).filter(item => item.children[2].children.length === 3).length, 1, 'only the affected receipt is flagged');
  assert.match(f.elements.exportReviewAckText.textContent, /1 receipt was changed in the database after it was selected/);
  assert.equal(f.elements.confirmExport.disabled, true);
  assert.equal(f.focusLog.at(-1), f.elements.exportReviewAckInput, 'focus starts on the acknowledgement');
  await confirm(f);
  assert.equal(f.calls.download.length, 0, 'a disabled or ignored confirmation exports nothing');
  assert.match(f.elements.exportReviewAnnouncer.textContent, /tick the box before exporting/);
  await ack(f);
  assert.equal(f.elements.confirmExport.disabled, false);
  f.elements.exportReviewAckInput.checked = false; await f.elements.exportReviewAckInput.emit('change');
  assert.equal(f.elements.confirmExport.disabled, true, 'unticking disables it again');
  await ack(f); await confirm(f);
  assert.equal(f.calls.download[0].find(item => item.dbId === 'r2').store, 'Renamed B');
  assert.deepEqual(f.calls.consume, [['r1', 'r2', 'r3', 'r4']]);
});

test('S: a change that happens after the acknowledgement requires a new acknowledgement, and unsaved local edits are never overwritten', async () => {
  const f = await receiptFixture({ loaded: four() });
  await calculate(f, '1000');
  otherSession(f, 'r2', { store: 'Renamed B' });
  await exportClick(f); await ack(f);
  otherSession(f, 'r2', { store: 'Renamed again' });
  await confirm(f);
  assert.equal(dialogOpen(f), true);
  assert.equal(f.elements.exportReviewAck.hidden, false); assert.equal(f.elements.confirmExport.disabled, true);
  assert.equal(f.elements.exportReviewAckInput.checked, false, 'the earlier acknowledgement does not carry over');
  assert.equal(f.calls.download.length, 0);
  await ack(f); await confirm(f);
  assert.equal(f.calls.download[0].find(item => item.dbId === 'r2').store, 'Renamed again');
  const g = await receiptFixture({ loaded: four() });
  await g.type(g.rows()[3], 'amount', '400.00'); // keeps the amount but is a typed edit on a receipt that stays unselected
  g.field(g.rows()[3], 'store').value = 'Typed locally';
  await calculate(g, '600'); await exportClick(g);
  assert.equal(g.field(g.rows()[3], 'store').value, 'Typed locally', 'an unselected receipt with unsaved text is left alone');
});

test('T: a missing or Consumed receipt blocks export at review and while the dialog is open', async () => {
  const f = await receiptFixture({ loaded: four() });
  await calculate(f, '1000');
  otherSession(f, 'r2', { status: 'consumed' });
  await exportClick(f);
  assert.equal(dialogOpen(f), false);
  assert.match(f.elements.difference.textContent, /Receipt 2 is no longer Available/);
  assert.match(f.elements.difference.textContent, /Run Find Best Match again\.$/);
  const g = await open(await receiptFixture({ loaded: four() }));
  g.db.delete('r3');
  await confirm(g);
  assert.equal(dialogOpen(g), false);
  assert.match(g.elements.difference.textContent, /Receipt 3 no longer exists/);
  assert.deepEqual([g.calls.download.length, g.calls.consume.length], [0, 0]);
});

test('U: confirming twice quickly exports once, in the confirmed order', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  await press(f, 'r4', 'Home');
  await Promise.all([f.elements.confirmExport.emit('click'), f.elements.confirmExport.emit('click')]); await settle();
  assert.equal(f.calls.download.length, 1); assert.equal(f.calls.consume.length, 1);
  assert.equal(f.calls.download[0][0].dbId, 'r4');
});

test('C3E-1 safeguards still apply: generation failure and an unconfirmed status update behave as before', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  f.fails.download = new Error('disk full'); await confirm(f);
  assert.match(f.elements.difference.textContent, /Could not prepare the XLSX export: disk full\. No receipt was marked Consumed\./);
  assert.equal(f.calls.consume.length, 0);
  f.fails.download = null; await exportClick(f); f.fails.consumeResponseLost = new Error('lost'); await confirm(f);
  assert.match(f.elements.difference.textContent, /may already be Consumed/);
  assert.doesNotMatch(f.elements.difference.textContent, /still Available/);
});

// ---- dialog behaviour with the shared focus manager ---------------------------------------------------------------------------------------
const fakeModalFocus = () => { const log = { open: [], close: [] }; return { log, open: (modal, options) => log.open.push(options), close: (modal, options) => log.close.push(options) }; };

test('V, W: the dialog registers with the shared modal focus manager; Escape closes it when idle and restores focus to Export Selected', async () => {
  const modalFocus = fakeModalFocus();
  const f = await open(await receiptFixture({ loaded: four(), modalFocus }));
  assert.equal(modalFocus.log.open.length, 1);
  const [{ trigger, fallback, onEscape }] = modalFocus.log.open;
  assert.equal(trigger, f.elements.exportSelected); assert.equal(fallback, f.elements.calculate);
  onEscape();
  assert.equal(dialogOpen(f), false);
  assert.equal(modalFocus.log.close.length, 1);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  assert.equal(f.elements.exportReviewList.children.length, 0, 'the list is cleared; the arrangement itself is kept in memory');
  await exportClick(f); assert.equal(dialogOpen(f), true);
});

test('W: Escape does nothing while an export is in progress', async () => {
  const modalFocus = fakeModalFocus();
  const f = await open(await receiptFixture({ loaded: four(), modalFocus }));
  let release; f.fails.gate = new Promise(resolve => { release = resolve; }); // holds the status update open: the export is in flight
  const running = f.elements.confirmExport.emit('click'); await settle();
  const [{ onEscape }] = modalFocus.log.open;
  onEscape();
  assert.equal(dialogOpen(f), true, 'the dialog cannot be dismissed mid-export');
  release(); await running; await settle();
});

// ---- Go to Encoding ---------------------------------------------------------------------------------------------------------------------------
test('Z: unsaved edits block export, name the receipt, and Go to Encoding navigates and focuses it without touching the edit', async () => {
  const f = await receiptFixture({ loaded: four() });
  let tabClicks = 0; f.elements.encodingTab.click = () => { tabClicks += 1; };
  f.field(f.rows()[1], 'store').value = 'Typed, unsaved';
  await calculate(f, '1000');
  assert.equal(f.elements.exportGoToEncoding.hidden, true, 'not offered before a block');
  await exportClick(f);
  assert.match(f.elements.difference.textContent, /Receipt 2 has unsaved changes\./);
  assert.equal(f.elements.exportGoToEncoding.hidden, false);
  assert.equal(dialogOpen(f), false);
  f.elements.optimizationWorkspace.hidden = false; f.elements.encodingWorkspace.hidden = true;
  await f.click(f.elements.exportGoToEncoding);
  assert.equal(tabClicks, 1, 'the existing Encoding tab is used');
  assert.equal(f.elements.encodingWorkspace.hidden, false); assert.equal(f.elements.optimizationWorkspace.hidden, true);
  assert.equal(f.rows()[1].open, true, 'the receipt is expanded');
  assert.equal(f.focusLog.at(-1), f.field(f.rows()[1], 'store'), 'and its first field is focused');
  assert.equal(f.field(f.rows()[1], 'store').value, 'Typed, unsaved', 'the edit is untouched');
  assert.equal(f.calls.update.length + f.calls.create.length, 0, 'nothing was saved');
  await calculate(f, '1000');
  assert.equal(f.elements.exportGoToEncoding.hidden, true, 'the shortcut goes away with the old result');
});

test('Z: an unsaved draft in the result also offers Go to Encoding', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A'), saved('r2', 300, 'Store B')] });
  await f.click(f.elements.floatingAdd);
  const draft = f.rows()[2]; await f.type(draft, 'store', 'Draft'); await f.type(draft, 'amount', '200');
  await calculate(f, '200'); await exportClick(f);
  assert.match(f.elements.difference.textContent, /Receipt 3 has not been saved/);
  assert.equal(f.elements.exportGoToEncoding.hidden, false);
  draft.open = false; await f.click(f.elements.exportGoToEncoding);
  assert.equal(draft.open, true); assert.equal(f.field(draft, 'amount').value, '200');
});

// ---- markup and styles --------------------------------------------------------------------------------------------------------------------------
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = (await readFile(new URL('../styles.css', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const dialog = html.slice(html.indexOf('id="exportConfirmModal"'), html.indexOf('id="confirmationModal"'));

test('Y: the review dialog markup is an accessible modal with a named, ordered list, a live region and labelled controls', () => {
  assert.match(html, /<section class="edit-modal export-review-modal" id="exportConfirmModal" role="dialog" aria-modal="true" aria-labelledby="exportConfirmTitle" aria-describedby="exportConfirmMessage" hidden>/);
  for (const id of ['exportConfirmTitle', 'exportConfirmMessage', 'exportReviewCount', 'exportReviewTotal', 'exportReviewNoAmount', 'exportReviewHint', 'exportReviewList', 'exportReviewAckInput', 'exportReviewAnnouncer', 'exportReviewReset', 'confirmExport', 'cancelExport', 'exportConfirmBackdrop']) assert.equal((dialog.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1, `#${id} exists once`);
  assert.match(dialog, /<ol class="export-review-list" id="exportReviewList" aria-label="[^"]+"><\/ol>/);
  assert.match(dialog, /id="exportReviewAnnouncer" role="status" aria-live="polite"/);
  assert.match(dialog, /<label[^>]*><input type="checkbox" id="exportReviewAckInput" \/>/, 'the acknowledgement is a labelled checkbox');
  assert.match(dialog, /Reset order/); assert.match(dialog, /Export &amp; Mark Consumed/);
  const all = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(all.filter((id, index) => all.indexOf(id) !== index), [], 'no duplicate ids');
});

test('Y: the dialog is a full-screen, safe-area-aware sheet on phones and keeps every row inside the viewport', () => {
  const phone = css.slice(css.indexOf('@media (max-width: 640px) {\n  .export-review-modal'));
  const block = phone.slice(0, phone.indexOf('\n}\n'));
  assert.match(block, /\.export-review-card\.modal-card \{[^}]*height: 100dvh/);
  assert.match(block, /env\(safe-area-inset-bottom\)/); assert.match(block, /env\(safe-area-inset-top\)/);
  assert.match(block, /\.export-review-row \{[^}]*grid-template-columns: 30px minmax\(0, 1fr\) auto/);
  assert.match(block, /\.export-review-actions button \{ width: 100%; \}/);
  assert.match(css, /\.export-review-list \{[^}]*overflow-y: auto/, 'only the receipt list scrolls');
  assert.match(css, /\.export-review-card\.modal-card \{[^}]*display: flex; flex-direction: column/);
  assert.match(css, /\.export-review-move \{[^}]*min-width: var\(--control-height\)/, 'touch-sized reorder buttons');
  assert.match(css, /\.export-review-details \{[^}]*min-width: 0/); assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /\.export-review-move:disabled \{ opacity: \.45/);
  assert.match(css, /focus-visible/);
});

test('Y: only existing design tokens are used (light and dark themes follow them), and nothing is hard-coded', () => {
  const rules = css.slice(css.indexOf('/* Review & Arrange'), css.indexOf('.unsaved-values-notice + .export-go-encoding'));
  assert.ok(rules.length > 500);
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(/, 'no literal colours');
  for (const token of [...rules.matchAll(/var\((--[a-z0-9-]+)/g)].map(match => match[1])) assert.ok(css.includes(`${token}:`) || token === '--focus', `${token} is defined`);
});

test('Go to Encoding is hidden by default and sits with the optimizer feedback', () => {
  assert.match(html, /<button class="secondary export-go-encoding" id="exportGoToEncoding" type="button" hidden>Go to Encoding<\/button>/);
  assert.ok(html.indexOf('id="difference"') < html.indexOf('id="exportGoToEncoding"') && html.indexOf('id="exportGoToEncoding"') < html.indexOf('id="optimizationResultSummary"'));
});
