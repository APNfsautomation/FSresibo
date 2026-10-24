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
  assert.equal(progress(f), 'Saved 1 of 3 · 2 still unsaved (1 new receipt may already be in your account; the next Save checks first)', 'a failed create is reported as unconfirmed, not as certainly absent');
  assert.deepEqual(kinds(f), ['', 'New, unsaved', 'New, unsaved']); assert.equal(counter(f), '2 unsaved receipts');
  assert.match(feedback(f), /^Could not save receipt changes: /); assert.doesNotMatch(feedback(f), /saved\./);
  assert.equal(f.db.size, 1); assert.deepEqual(prompts, [], 'no Company Directory prompt after a failed batch');
  f.fails.saveAfter = null;
  await save(f);
  assert.equal(f.db.size, 3, 'each receipt exists exactly once'); assert.equal(f.calls.create.length, 4, 'Alpha once, Beta (failed + retried) twice, Gamma once');
  assert.equal(progress(f), 'Saved 2 receipts (a check of your account just now found no matching copy of Receipt 2, so it was saved again)');
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

// ---- Review round 1 ------------------------------------------------------------------------------------------------------------------------
// Holds only the FIRST write that arrives, so a second session can save while the first one's request is still pending.
const holdFirstWrite = f => { let release; f.fails.saveGateOnce = new Promise(resolve => { release = resolve; }); return release; };
const dbIdOf = row => row.dataset.receiptDbId;

// Records every confirmation dialog and answers each one from a script (a function of the dialog's options).
const dialogs = answer => { const seen = []; return { seen, confirm: async options => { seen.push(options); return answer(options); } }; };
const isLink = options => /^Link Receipt/.test(options.confirmLabel);
const isSaveNew = options => options.confirmLabel === 'Save as a new receipt';
const isDirectory = options => options.title === 'Add store to Company Directory?';
const lostThenReady = async (f, row) => { f.fails.createResponseLost = new Error('connection reset'); await save(f); f.fails.createResponseLost = null; return row; };

test('R1: a create whose answer is lost after the insert committed is not inserted again: the user is asked and links it to the committed receipt', async () => {
  const { seen, confirm } = dialogs(options => isLink(options) || false);
  const f = await receiptFixture({ loaded: [], confirm });
  const row = await newReceipt(f, 'Lost Mart', '10', { address: '1 Main Street' });
  f.fails.createResponseLost = new Error('connection reset');
  await save(f);
  assert.equal(f.db.size, 1, 'the insert was committed although the save reported an error'); assert.equal(f.calls.create.length, 1);
  assert.match(progress(f), /^Saved 0 of 1 · 1 still unsaved \(1 new receipt may already be in your account; the next Save checks first\)$/, 'the screen does not claim the receipt is certainly absent');
  assert.match(feedback(f), /The outcome of a failed new receipt could not be confirmed/); assert.deepEqual(kinds(f), ['New, unsaved']); assert.equal(dbIdOf(row), undefined);
  f.fails.createResponseLost = null;
  await save(f);
  assert.equal(seen[0].title, 'Is this the same receipt?'); assert.match(seen[0].message, /may be the earlier attempt, or it may be a separate identical receipt/);
  assert.equal(f.calls.create.length, 1, 'no second INSERT'); assert.equal(f.db.size, 1);
  assert.equal(dbIdOf(row), 'new-1', 'only after the user chose "link" does the row point at that receipt');
  assert.deepEqual(kinds(f), ['']); assert.equal(counter(f), '');
  assert.equal(progress(f), '1 receipt linked to the matching saved receipt'); assert.match(f.elements.saveProgressLive.textContent, /Receipt 1 was linked to the matching receipt already in your account, as you chose, so it was not saved twice\./);
  assert.equal(seen.filter(isDirectory).length, 1, 'the Company Directory decision for that store is still offered'); assert.match(seen.find(isDirectory).message, /Lost Mart/);
  await save(f); assert.equal(f.calls.create.length, 1); assert.equal(feedback(f), 'No changes to save.');
});

test('R1: a definite failure before the commit stays retriable: one check shows no copy, the receipt is saved again, and the screen says exactly what the check established', async () => {
  const { seen, confirm } = dialogs(() => true);
  const f = await receiptFixture({ loaded: [], confirm });
  const row = await newReceipt(f, 'Rejected Mart', '10');
  f.fails.save = new Error('rejected before commit');
  await save(f); assert.equal(f.db.size, 0);
  f.fails.save = null; const loadsBefore = f.calls.load.length;
  await save(f);
  assert.equal(f.calls.load.length, loadsBefore + 1, 'exactly one read');
  assert.deepEqual(seen, [], 'no match, no question');
  assert.equal(f.calls.create.length, 2); assert.equal(f.db.size, 1); assert.equal(dbIdOf(row), 'new-1');
  assert.deepEqual(kinds(f), ['']); assert.equal(feedback(f), 'Receipt changes saved.');
  assert.equal(progress(f), 'Saved 1 receipt (a check of your account just now found no matching copy of Receipt 1, so it was saved again)', 'it states what the read found, not that nothing was ever committed');
  await newReceipt(f, 'Second', '5'); const loads = f.calls.load.length; await save(f);
  assert.equal(f.calls.load.length, loads, 'with no unconfirmed create there is no extra read');
});

test('R1: text edited after the user linked an unconfirmed create is kept: the linked receipt is updated, not inserted again', async () => {
  const f = await receiptFixture({ loaded: [], confirm: async options => isLink(options) });
  const row = await newReceipt(f, 'Lost Mart', '10');
  await lostThenReady(f, row);
  await f.type(row, 'store', 'Lost Mart (edited)');
  await save(f);
  assert.equal(f.calls.create.length, 1); assert.deepEqual(f.calls.update.map(([id, values]) => [id, values.store]), [['new-1', 'Lost Mart (edited)']]);
  assert.equal(f.db.size, 1); assert.deepEqual(kinds(f), ['']);
});

test('R1: if the database check cannot be made, nothing is written', async () => {
  const f = await receiptFixture({ loaded: [] });
  await newReceipt(f, 'Twin Mart', '10');
  f.fails.createResponseLost = new Error('timeout'); await save(f); f.fails.createResponseLost = null;
  f.fails.load = new Error('offline'); const writes = f.calls.create.length + f.calls.update.length;
  await save(f);
  assert.match(feedback(f), /^Could not check whether an earlier attempt already saved a new receipt: offline\. Nothing was saved; try again\.$/);
  assert.equal(f.calls.create.length + f.calls.update.length, writes);
});

test('R1: several identical receipts are never linked: only "save as a new receipt" or "leave unsaved" is offered', async () => {
  const { seen, confirm } = dialogs(() => false);
  const f = await receiptFixture({ loaded: [], confirm });
  const row = await newReceipt(f, 'Twin Mart', '10');
  await lostThenReady(f, row);
  f.db.set('other', { ...f.db.get('new-1'), dbId: 'other', updatedAt: f.stamp() }); // a second identical receipt appeared meanwhile
  await save(f);
  assert.equal(seen.length, 1, 'no "link" question when the match is not unique'); assert.equal(seen[0].title, 'Save as a new receipt?'); assert.match(seen[0].message, /2 receipts in your account look identical to it/);
  assert.match(feedback(f), /^Nothing was saved\. Receipt 1 is still unsaved/);
  assert.equal(f.calls.create.length, 1); assert.equal(f.calls.update.length, 0); assert.deepEqual(kinds(f), ['New, unsaved']); assert.equal(dbIdOf(row), undefined);
  const yes = dialogs(() => true); const g = await receiptFixture({ loaded: [], confirm: yes.confirm });
  const grow = await newReceipt(g, 'Twin Mart', '10'); await lostThenReady(g, grow);
  g.db.set('other', { ...g.db.get('new-1'), dbId: 'other', updatedAt: g.stamp() }); await save(g);
  assert.equal(g.db.size, 3, 'saved as a new receipt, because the user said so'); assert.equal(dbIdOf(grow), 'new-2');
});

test('R1: an identical receipt that is already on screen is never a candidate', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 10, 'Same Mart')], confirm: async options => isLink(options) });
  const row = await newReceipt(f, 'Same Mart', '10'); // a genuinely new receipt that looks like the saved one
  await lostThenReady(f, row);
  assert.equal(f.db.size, 2);
  await save(f);
  assert.equal(dbIdOf(row), 'new-1', 'it linked to its own earlier write, never to the receipt that was already there'); assert.equal(f.calls.create.length, 1); assert.equal(f.db.size, 2);
});

test('R1 follow-up (a): a failed create followed by an independent identical receipt from another session is never silently adopted or overwritten', async () => {
  const other = { dbId: 'from-b', amount: 10, store: 'Shared Mart', receiptDate: '', address: '', tin: '', vat: '', invoice: '', status: 'available' };
  // The user declines both questions: nothing is written, the entry stays on screen, the other session's receipt is untouched, and the question returns at the next Save.
  const declineAll = dialogs(() => false); const f = await receiptFixture({ loaded: [], confirm: declineAll.confirm });
  const row = await newReceipt(f, 'Shared Mart', '10');
  f.fails.save = new Error('rejected before commit'); await save(f); f.fails.save = null;
  f.db.set('from-b', { ...other, updatedAt: f.stamp() });
  const untouchedAt = f.db.get('from-b').updatedAt;
  await save(f);
  assert.deepEqual(declineAll.seen.map(options => options.title), ['Is this the same receipt?', 'Save as a new receipt?']);
  assert.match(declineAll.seen[0].message, /may be a separate identical receipt/); assert.match(feedback(f), /^Nothing was saved\./);
  assert.equal(f.calls.create.length, 1, 'no insert'); assert.equal(f.calls.update.length, 0, 'the other receipt is not updated'); assert.equal(f.db.size, 1);
  assert.equal(dbIdOf(row), undefined); assert.deepEqual(kinds(f), ['New, unsaved']); assert.equal(f.db.get('from-b').updatedAt, untouchedAt);
  await save(f); assert.equal(declineAll.seen.length, 4, 'the receipt is still unconfirmed, so it is asked about again');
  // "Do not link", then "Save as a new receipt": the user's separate receipt is created and the other receipt is left exactly as it was.
  const separate = dialogs(options => isSaveNew(options)); const g = await receiptFixture({ loaded: [], confirm: separate.confirm });
  const grow = await newReceipt(g, 'Shared Mart', '10'); g.fails.save = new Error('rejected before commit'); await save(g); g.fails.save = null;
  g.db.set('from-b', { ...other, updatedAt: g.stamp() }); const before = { ...g.db.get('from-b') };
  await save(g);
  assert.equal(g.db.size, 2); assert.deepEqual(g.db.get('from-b'), before); assert.equal(dbIdOf(grow), 'new-1', 'a new receipt of its own'); assert.notEqual(dbIdOf(grow), 'from-b'); assert.equal(g.calls.update.length, 0);
  // Only when the user explicitly chooses "link" is the other receipt bound to the row.
  const link = dialogs(options => isLink(options)); const h = await receiptFixture({ loaded: [], confirm: link.confirm });
  const hrow = await newReceipt(h, 'Shared Mart', '10'); h.fails.save = new Error('rejected before commit'); await save(h); h.fails.save = null;
  h.db.set('from-b', { ...other, updatedAt: h.stamp() }); await save(h);
  assert.equal(dbIdOf(hrow), 'from-b'); assert.equal(h.calls.create.length, 1); assert.equal(h.db.size, 1);
});

test('R1 follow-up (b): a committed create that another session has since marked Consumed is never linked, never shown as Available, and never updated', async () => {
  const { seen, confirm } = dialogs(options => isSaveNew(options));
  const f = await receiptFixture({ loaded: [], confirm });
  const row = await newReceipt(f, 'Used Mart', '10');
  await lostThenReady(f, row);
  f.db.set('new-1', { ...f.db.get('new-1'), status: 'consumed', updatedAt: f.stamp() }); // exported and consumed elsewhere before the retry
  const consumedAt = f.db.get('new-1').updatedAt;
  await f.type(row, 'store', 'Used Mart'); // no change in values
  await save(f);
  assert.deepEqual(seen.map(options => options.title), ['Save as a new receipt?'], 'no "link" question is offered for a Consumed match');
  assert.match(seen[0].message, /An identical receipt in your account is Consumed\. It cannot be linked or edited from here\./);
  assert.equal(f.calls.update.length, 0, 'the Consumed receipt is never updated'); assert.equal(f.db.get('new-1').status, 'consumed'); assert.equal(f.db.get('new-1').updatedAt, consumedAt);
  assert.equal(dbIdOf(row), 'new-2', 'the user chose to save a new receipt; it is a different, Available receipt'); assert.equal(f.db.get('new-2').status, 'available');
  assert.equal(row.dataset.receiptStatus, 'available'); assert.equal(f.db.size, 2);
  // Declining leaves the entry unsaved and the Consumed receipt alone.
  const keep = dialogs(() => false); const g = await receiptFixture({ loaded: [], confirm: keep.confirm });
  const grow = await newReceipt(g, 'Used Mart', '10'); await lostThenReady(g, grow);
  g.db.set('new-1', { ...g.db.get('new-1'), status: 'consumed', updatedAt: g.stamp() }); await save(g);
  assert.equal(dbIdOf(grow), undefined); assert.equal(g.calls.update.length, 0); assert.equal(g.calls.create.length, 1); assert.deepEqual(kinds(g), ['New, unsaved']);
});

test('R2: sign out during a save, sign in as someone else: the new session starts clean, can save while the old request is pending, and the old answer changes nothing', async () => {
  const f = await receiptFixture({ loaded: many(5) });
  await f.type(f.rows()[0], 'amount', '111');
  const releaseA = holdFirstWrite(f); const pendingA = (await startSave(f)).done;
  assert.equal(progress(f), 'Saving 0 of 1'); assert.equal(f.elements.saveDraft.disabled, true);
  f.ui.clearForLogout();
  assert.equal(progressVisible(f), false); assert.equal(progress(f), ''); assert.equal(f.elements.saveProgressLive.textContent, '');
  assert.equal(f.elements.saveDraft.disabled, false); assert.equal(f.elements.saveDraft.getAttribute('aria-busy'), null);
  await f.ui.loadForUser({ id: 'user-2' });
  assert.equal(progressVisible(f), false, 'the next account does not see the previous account\'s progress');
  await f.type(f.rows()[3], 'amount', '333');
  const releaseB = holdFirstWrite(f); const pendingB = (await startSave(f)).done; // B's own write is held while A's is still pending
  assert.equal(progress(f), 'Saving 0 of 1'); assert.equal(f.elements.saveDraft.disabled, true);
  releaseA(); await pendingA; await settle();
  assert.equal(progress(f), 'Saving 0 of 1', 'A finishing late did not change B\'s progress');
  assert.equal(f.elements.saveDraft.disabled, true, 'nor B\'s Save button: a stale finish never clears a newer save\'s state'); assert.equal(f.elements.saveDraft.getAttribute('aria-busy'), 'true');
  releaseB(); await pendingB; await settle();
  assert.equal(progress(f), 'Saved 1 receipt'); assert.equal(f.elements.saveDraft.disabled, false); assert.equal(feedback(f), 'Receipt changes saved.');
  assert.deepEqual(f.calls.update.map(([id]) => id), ['r001', 'r004'], 'A\'s write was already in flight; B wrote only its own receipt');
  assert.equal(String(f.field(f.rows()[0], 'amount').value), '1','nothing from A appears in B\'s list'); assert.deepEqual(kinds(f), ['', '', '', '', '']);
  assert.equal(f.elements.availableCount.textContent, '5');
});

test('R2: an account that never finishes its save does not stop the next account from saving', async () => {
  const f = await receiptFixture({ loaded: many(3) });
  await f.type(f.rows()[0], 'amount', '50'); holdFirstWrite(f); await startSave(f); // never released
  f.ui.clearForLogout(); await f.ui.loadForUser({ id: 'user-2' });
  await f.type(f.rows()[1], 'amount', '60'); await save(f);
  assert.equal(progress(f), 'Saved 1 receipt'); assert.equal(f.elements.saveDraft.disabled, false);
});

test('R3: a receipt removed while its own write is in flight is not applied to the list or the cache, and the result says it was saved anyway', async () => {
  const prompts = [];
  const f = await receiptFixture({ loaded: [], confirm: async options => { prompts.push(options.message); return false; } });
  const doomed = await newReceipt(f, 'Doomed Mart', '20', { address: '2 Gone Street' }); await newReceipt(f, 'Keep Mart', '30');
  const release = holdFirstWrite(f); const pending = (await startSave(f)).done; // the first write (Doomed Mart) is the one awaited
  f.list.children = f.list.children.filter(row => row !== doomed); // the user removes that card while its write is running
  release(); await pending; await settle();
  assert.equal(f.calls.create.length, 2); assert.equal(f.db.size, 2, 'the write that was already running did commit; nothing claims otherwise');
  assert.deepEqual(f.rows().map(row => row.part('.receipt-store').value), ['Keep Mart'], 'the removed card is not put back');
  assert.equal(dbIdOf(doomed), undefined, 'the removed row was not updated'); assert.equal(f.elements.availableCount.textContent, '1', 'the cache only holds receipts that are on the list');
  assert.match(feedback(f), /^Receipt changes saved\. A receipt you removed from the list was already being saved and was saved anyway; refresh the page to see it\.$/);
  assert.equal(progress(f), 'Saved 1 receipt'); assert.deepEqual(prompts.filter(message => /Doomed/.test(message)), [], 'no Company Directory prompt for the removed receipt');
  assert.deepEqual(kinds(f), ['']);
});
