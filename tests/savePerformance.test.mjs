// Issue #24 (CP10-C3E-4U01-B): Save writes only what changed, shows real progress, and keeps edits and accounts straight while it runs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';

const saved = (dbId, amount, store, extra = {}) => ({ dbId, amount, store, receiptDate: '2026-08-01', ...extra });
const rid = n => `r${String(n).padStart(3, '0')}`;
const many = count => Array.from({ length: count }, (_, i) => saved(rid(i + 1), i + 1, `Store ${String(i + 1).padStart(3, '0')}`));
const progress = f => f.elements.saveProgressText.textContent;
const progressVisible = f => !f.elements.saveProgress.hidden;
const feedback = f => f.elements.encodingFeedback.textContent;
const counter = f => f.elements.encodingUnsavedText.textContent;
const kinds = f => f.rows().map(row => row.part('.receipt-unsaved-flag').hidden ? '' : row.part('.receipt-unsaved-flag').textContent);
const save = f => f.click(f.elements.saveDraft);
// Holds every write until released, so a test can look at (and act during) a save that is in flight.
const holdWrites = f => { let release; f.fails.saveGate = new Promise(resolve => { release = resolve; }); return () => { f.fails.saveGate = null; release(); }; };
// Returns a wrapper: returning the bare promise from an async function would wait for the whole save, which is held on purpose.
const startSave = async f => { const pending = f.elements.saveDraft.emit('click'); await settle(); return { done: pending }; };
const newReceipt = async (f, store, amount = '10', extra = {}) => { await f.click(f.elements.floatingAdd); const row = f.rows().at(-1); await f.type(row, 'store', store); await f.type(row, 'amount', amount); for (const [key, value] of Object.entries(extra)) await f.type(row, key, value); return row; };

// ---- A. dirty-only persistence ---------------------------------------------------------------------------------------------------------------
test('B01: 400 clean saved receipts, only #399 edited: exactly one update for its id, nothing else is written, progress is out of 1', async () => {
  const f = await receiptFixture({ loaded: many(400) });
  assert.equal(f.rows().length, 400);
  await f.type(f.rows()[398], 'amount', '9999');
  assert.equal(counter(f), '1 unsaved receipt');
  const release = holdWrites(f); const pending = (await startSave(f)).done;
  assert.equal(progress(f), 'Saving 0 of 1'); assert.equal(progressVisible(f), true); assert.equal(f.elements.saveProgress.dataset.busy, '1', 'the spinner shows while writes are in progress');
  assert.equal(f.elements.saveDraft.disabled, true); assert.equal(f.elements.saveDraft.getAttribute('aria-busy'), 'true');
  release(); await pending; await settle();
  assert.deepEqual(f.calls.update.map(([id, values]) => [id, values.amount]), [[rid(399), '9999']]);
  assert.equal(f.calls.create.length, 0);
  assert.equal(progress(f), 'Saved 1 receipt'); assert.equal(f.elements.saveProgress.dataset.busy, '', 'and stops when the save is over'); assert.equal(f.elements.saveDraft.getAttribute('aria-busy'), null); assert.equal(f.elements.saveDraft.disabled, false);
  assert.equal(Number(f.db.get(rid(399)).amount), 9999, 'the persisted value is in the database (what a reload would load)');
  assert.deepEqual(kinds(f).filter(Boolean), []); assert.equal(counter(f), ''); assert.equal(f.elements.encodingUnsavedIndicator.hidden, true);
  assert.equal(feedback(f), 'Receipt changes saved.');
});

test('B02: 400 clean saved receipts with nothing edited: no writes, "No changes to save.", no progress, and no prompts', async () => {
  const prompts = [];
  const f = await receiptFixture({ loaded: many(400).map(item => ({ ...item, address: '1 Main St', tin: '123' })), confirm: async options => { prompts.push(options.title); return false; } });
  await save(f);
  assert.deepEqual([f.calls.update.length, f.calls.create.length], [0, 0]);
  assert.equal(feedback(f), 'No changes to save.'); assert.equal(f.elements.encodingFeedback.dataset.severity, 'info');
  assert.equal(progressVisible(f), false); assert.deepEqual(prompts, [], 'B11: clicking Save on unchanged receipts raises no Company Directory prompt');
});

test('B03: 75 saved with 1 edit, and 100 saved with 1 edit, each write exactly one update', async () => {
  for (const size of [75, 100]) {
    const f = await receiptFixture({ loaded: many(size) });
    await f.type(f.rows()[size - 2], 'store', 'Edited store');
    await save(f);
    assert.deepEqual(f.calls.update.map(([id]) => id), [rid(size - 1)], `${size} saved`); assert.equal(f.calls.create.length, 0);
  }
});

test('B04: 75 receipts with 5 new, 3 edited saved and the rest unchanged: exactly 5 creates and 3 updates, progress out of 8', async () => {
  const f = await receiptFixture({ loaded: many(70) });
  for (const index of [3, 30, 60]) await f.type(f.rows()[index], 'amount', String(1000 + index));
  for (let i = 1; i <= 5; i += 1) await newReceipt(f, `Brand new ${i}`, String(500 + i));
  assert.equal(f.rows().length, 75); assert.equal(counter(f), '8 unsaved receipts');
  const release = holdWrites(f); const pending = (await startSave(f)).done;
  assert.equal(progress(f), 'Saving 0 of 8');
  release(); await pending; await settle();
  assert.deepEqual([f.calls.update.length, f.calls.create.length], [3, 5]);
  assert.deepEqual(f.calls.update.map(([id]) => id), [rid(4), rid(31), rid(61)]);
  assert.equal(progress(f), 'Saved 8 receipts'); assert.equal(counter(f), ''); assert.equal(f.db.size, 75);
});

test('B05: 400 new valid receipts are all created once each, with progress out of 400', async () => {
  const f = await receiptFixture({ loaded: [] });
  for (let i = 1; i <= 400; i += 1) await newReceipt(f, `New ${String(i).padStart(3, '0')}`, String(i));
  assert.equal(counter(f), '400 unsaved receipts');
  const release = holdWrites(f); const pending = (await startSave(f)).done;
  assert.equal(progress(f), 'Saving 0 of 400');
  release(); await pending; await settle();
  assert.equal(f.calls.create.length, 400); assert.equal(f.calls.update.length, 0);
  assert.equal(new Set(f.calls.create.map(values => values.store)).size, 400, 'no receipt was created twice');
  assert.equal(f.db.size, 400); assert.equal(progress(f), 'Saved 400 receipts'); assert.equal(counter(f), '');
  await save(f); assert.equal(f.calls.create.length, 400, 'a second Save creates nothing'); assert.equal(feedback(f), 'No changes to save.');
});

test('B06: the same dirty rules as the unsaved flags and the export preflight: whitespace and blank/zero differences are written, equal exact centavos are not', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('b', '', 'Blank'), saved('c', 0, 'Zero'), saved('d', 250.5, 'Dee')] });
  await f.type(f.rows()[0], 'store', 'Alpha '); // trailing whitespace only: the workbook would differ
  await f.type(f.rows()[1], 'amount', '0');      // blank -> numeric zero
  await f.type(f.rows()[2], 'amount', '');       // numeric zero -> blank
  await f.type(f.rows()[3], 'amount', '250.50'); // the same exact centavos as the saved 250.5
  assert.deepEqual(kinds(f), ['Unsaved changes', 'Unsaved changes', 'Unsaved changes', ''], 'the flags and the plan agree');
  await save(f);
  assert.deepEqual(f.calls.update.map(([id]) => id), ['a', 'b', 'c']);
  assert.equal(f.calls.update[0][1].store, 'Alpha ', 'the exact text, whitespace included, is what is written');
  assert.deepEqual(kinds(f), ['', '', '', '']); assert.equal(counter(f), '');
});

test('B07: a late invalid amount blocks every write and focuses that receipt', async () => {
  const f = await receiptFixture({ loaded: many(400) });
  await f.type(f.rows()[10], 'amount', '5000'); await f.type(f.rows()[390], 'amount', '12,3');
  await save(f);
  assert.deepEqual([f.calls.update.length, f.calls.create.length], [0, 0]);
  assert.match(feedback(f), /^Could not save receipt changes\. /); assert.match(feedback(f), /Nothing was saved/);
  assert.equal(f.focusLog.at(-1), f.rows()[390].part('.receipt-amount'));
  assert.equal(f.elements.saveDraft.disabled, false);
});

// ---- B. progress, failures and retry ---------------------------------------------------------------------------------------------------------
test('B08: a failure after K of N writes shows K of N, keeps only the confirmed rows clean, and a retry neither duplicates nor loses a Company Directory decision', async () => {
  const prompts = [];
  const f = await receiptFixture({ loaded: [], confirm: async options => { prompts.push(options.message); return false; } });
  await newReceipt(f, 'Alpha Mart', '10', { address: '1 Main Street' }); await newReceipt(f, 'Beta Mart', '20'); await newReceipt(f, 'Gamma Mart', '30');
  f.fails.saveAfter = 1; // the first write succeeds, the second fails
  await save(f);
  assert.equal(progress(f), 'Saved 1 of 3 · 2 still unsaved');
  assert.deepEqual(kinds(f), ['', 'New, unsaved', 'New, unsaved']); assert.equal(counter(f), '2 unsaved receipts');
  assert.match(feedback(f), /^Could not save receipt changes: /); assert.doesNotMatch(feedback(f), /saved\./);
  assert.equal(f.db.size, 1); assert.deepEqual(prompts, [], 'no Company Directory prompt after a failed batch');
  f.fails.saveAfter = null;
  await save(f);
  assert.equal(f.db.size, 3, 'each receipt exists exactly once'); assert.equal(f.calls.create.length, 4, 'Alpha once, Beta (failed + retried) twice, Gamma once');
  assert.equal(progress(f), 'Saved 2 receipts');
  assert.equal(prompts.length, 1, 'the store of the receipt saved before the failure still gets its directory prompt on the retry'); assert.match(prompts[0], /Alpha Mart/);
  assert.deepEqual(kinds(f), ['', '', '']);
});

test('B09: a second click, repeated Ctrl+S or a re-entrant Save while one is pending never duplicates a write; the busy state clears on success and on failure', async () => {
  const f = await receiptFixture({ loaded: many(5) });
  await f.type(f.rows()[0], 'amount', '111'); await f.type(f.rows()[1], 'amount', '222');
  const release = holdWrites(f); const first = (await startSave(f)).done;
  assert.equal(f.elements.saveDraft.getAttribute('aria-busy'), 'true');
  await f.elements.saveDraft.emit('click'); await f.elements.saveDraft.emit('click');
  release(); await first; await settle();
  assert.deepEqual(f.calls.update.map(([id]) => id), ['r001', 'r002'], 'each receipt written once');
  assert.equal(f.elements.saveDraft.getAttribute('aria-busy'), null);
  await f.type(f.rows()[0], 'amount', '333'); f.fails.save = new Error('offline');
  await save(f);
  assert.equal(f.elements.saveDraft.getAttribute('aria-busy'), null, 'busy state removed after a failure'); assert.equal(f.elements.saveDraft.disabled, false);
  assert.equal(progress(f), 'Saved 0 of 1 · 1 still unsaved');
});

// ---- C. edits and sessions while a save runs -------------------------------------------------------------------------------------------------
test('B10: a value typed into a receipt while it is being saved is never marked saved, and a later Save writes it', async () => {
  const f = await receiptFixture({ loaded: many(4) });
  await f.type(f.rows()[0], 'amount', '101'); await f.type(f.rows()[1], 'amount', '202');
  const release = holdWrites(f); const pending = (await startSave(f)).done;
  await f.type(f.rows()[1], 'amount', '999'); // edited again mid-save (the save holds a snapshot of 202)
  await f.type(f.rows()[3], 'store', 'Typed mid save'); // a clean receipt becomes dirty mid-save
  release(); await pending; await settle();
  assert.deepEqual(f.calls.update.map(([id, values]) => [id, values.amount]), [['r001', '101'], ['r002', '202']], 'the snapshot taken at Save is what was written');
  assert.equal(f.field(f.rows()[1], 'amount').value, '999', 'the newer text is still in the field');
  assert.deepEqual(kinds(f), ['', 'Unsaved changes', '', 'Unsaved changes'], 'newer edits are re-flagged, never silently clean');
  assert.equal(counter(f), '2 unsaved receipts');
  await save(f);
  assert.deepEqual(f.calls.update.slice(2).map(([id, values]) => [id, id === 'r004' ? values.store : values.amount]), [['r002', '999'], ['r004', 'Typed mid save']]);
  assert.deepEqual(kinds(f), ['', '', '', '']);
});

test('B10: signing out during a save stops it, writes nothing further and applies nothing to the next session', async () => {
  const f = await receiptFixture({ loaded: many(3) });
  for (let i = 0; i < 3; i += 1) await f.type(f.rows()[i], 'amount', String(500 + i));
  const release = holdWrites(f); const pending = (await startSave(f)).done;
  f.ui.clearForLogout(); // the account signs out while the first write is in flight
  release(); await pending; await settle();
  assert.equal(f.calls.update.length, 1, 'only the write already in flight; the rest were never sent');
  assert.notEqual(feedback(f), 'Receipt changes saved.'); assert.equal(f.rows().length, 0, 'the signed-out list stays empty: nothing was applied to the screen');
  assert.equal(f.elements.saveDraft.disabled, false);
});

test('B10: a receipt removed from the list while a save runs is not written', async () => {
  const f = await receiptFixture({ loaded: [], confirm: async () => true });
  await newReceipt(f, 'Keep one', '10'); const doomed = await newReceipt(f, 'Remove me', '20'); await newReceipt(f, 'Keep two', '30');
  const release = holdWrites(f); const pending = (await startSave(f)).done;
  f.list.children = f.list.children.filter(row => row !== doomed); // the user clears that card
  release(); await pending; await settle();
  assert.deepEqual(f.calls.create.map(values => values.store), ['Keep one', 'Keep two'], 'the receipt removed before its turn was skipped, the others were saved');
});

// ---- D. what stays the same ------------------------------------------------------------------------------------------------------------------
test('B11/B12: Consumed receipts and blank placeholders are never written, and the Company Directory prompt still follows a real change', async () => {
  const prompts = [];
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('u', 50, 'Used', { status: 'consumed' })], confirm: async options => { prompts.push(options.title); return false; } });
  await f.click(f.elements.floatingAdd); // a blank placeholder
  await f.type(f.rows()[0], 'address', '9 New Road'); // a real change that makes the store contributable
  await save(f);
  assert.deepEqual(f.calls.update.map(([id]) => id), ['a']); assert.equal(f.calls.create.length, 0);
  assert.deepEqual(prompts, ['Add store to Company Directory?']);
  assert.equal(f.db.get('u').status, 'consumed');
});
