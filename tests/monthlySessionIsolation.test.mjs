// Issue #27: Monthly Filing session isolation. Deterministic gated-promise scenarios against the REAL Monthly Filing controller and an in-memory service double.
// A request that belongs to an earlier session (an earlier account, or the same account signed in again) must change nothing on the next session's screen, say
// nothing, prompt nothing, send nothing further, and never hold the next session's guards. Nothing here talks to Supabase: a request already sent before the
// switch cannot be recalled, so these tests assert what the PAGE does afterwards, and the server-side effect of such a request stays owner-scoped by RLS.
import assert from 'node:assert/strict';
import test from 'node:test';
import { monthlyFixture, savedMonthly } from './helpers/monthlyFilingUiFixture.mjs';

const tick = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));
const gate = () => { let open, fail; const promise = new Promise((resolve, reject) => { open = resolve; fail = reject; }); return { promise, open, fail }; };
const A = { id: 'A' }, B = { id: 'B' };
const stores = f => f.cards().map(card => f.field(card, 'store').value);
const screen = f => [f.elements.feedback.textContent, f.elements.unsavedNote.textContent, f.elements.activeTab.textContent, f.elements.archivedTab.textContent, f.elements.activeTotalMain.textContent, ...stores(f)].join(' | ');
const quiet = f => assert.doesNotMatch(f.elements.feedback.textContent, /saved|Exported|archived|deleted|returned|cleared|Could not/i, f.elements.feedback.textContent);
const buttons = f => ({ add: f.elements.add.disabled, save: f.elements.save.disabled, exportActive: f.elements.exportActive.disabled, clearArchived: f.elements.clearArchived.disabled, clearAll: f.elements.clearAll.disabled });
// Two ways an account can be replaced: an explicit sign-out first, or a direct switch (a new sign-in event for another account, as app.js can see).
const switchModes = { 'sign-out then sign-in': f => f.ui.clearForLogout(), 'direct switch': () => {} };
async function asB(f, mode, records = [savedMonthly('b1', { store: 'B-store' })]) {
  switchModes[mode](f); f.table.clear(); records.forEach(record => f.table.set(record.dbId, { ...record })); f.gates.create = f.gates.update = f.gates.load = f.gates.archive = null;
  await f.ui.loadForUser(B);
}
const modes = Object.keys(switchModes);

for (const mode of modes) {
  test(`save: A's create still running when ${mode} to B changes nothing on B's screen, and B's controls are free (${mode})`, async () => {
    const f = monthlyFixture(); await f.ui.loadForUser(A); await f.click(f.elements.add);
    await f.edit(f.cards()[0], 'store', 'A-SECRET'); await f.edit(f.cards()[0], 'amount', '123');
    const created = gate(); f.gates.create = created.promise; const saving = f.click(f.elements.save); await tick();
    assert.equal(f.calls.create.length, 1);
    await asB(f, mode);
    const before = screen(f); const buttonsBefore = buttons(f);
    created.open(); await saving; await tick(20);
    assert.equal(screen(f), before, 'B\'s screen is exactly as it was'); assert.deepEqual(buttons(f), buttonsBefore); assert.doesNotMatch(screen(f), /A-SECRET/); quiet(f);
    assert.equal(buttons(f).save, false, 'B can save'); assert.equal(buttons(f).add, false);
  });
}

test('save: B operates normally while A\'s request never finishes, and every write B makes carries B\'s id', async () => {
  const f = monthlyFixture(); await f.ui.loadForUser(A); await f.click(f.elements.add);
  await f.edit(f.cards()[0], 'store', 'A-forever'); f.gates.create = new Promise(() => {}); void f.click(f.elements.save); await tick();
  await asB(f, 'direct switch', [savedMonthly('b1', { store: 'B-one' }), savedMonthly('b2', { store: 'B-two' })]);
  assert.equal(buttons(f).save, false); await f.edit(f.cards()[0], 'invoice', 'B-INV'); await f.click(f.elements.save);
  assert.match(f.elements.feedback.textContent, /Monthly Filing changes saved\./); assert.equal(f.table.get('b1').invoice, 'B-INV');
  assert.deepEqual(f.calls.writes.filter(write => write.userId === 'B').map(write => write.op), ['update', 'update']); assert.equal(f.calls.writes.filter(write => write.userId === 'A').length, 1, 'A\'s one request was sent before the switch');
  await f.click(f.elements.exportActive); // B can export too, with no lock inherited from A
  assert.equal(f.calls.workbook.length, 1); assert.deepEqual(f.calls.workbook[0].map(record => record.dbId), ['b1', 'b2']); assert.equal(f.table.get('b1').status, 'archived');
});

test('save: an A save with several receipts stops sending writes once the session has ended', async () => {
  const f = monthlyFixture(); await f.ui.loadForUser(A);
  for (const name of ['A-one', 'A-two', 'A-three']) { await f.click(f.elements.add); await f.edit(f.cards().at(-1), 'store', name); await f.edit(f.cards().at(-1), 'amount', '10'); }
  const first = gate(); f.gates.create = first.promise; const saving = f.click(f.elements.save); await tick();
  assert.equal(f.calls.create.length, 1); await asB(f, 'sign-out then sign-in');
  first.open(); await saving; await tick(20);
  assert.equal(f.calls.create.length, 1, 'no second or third write was dispatched for the ended session'); assert.equal([...f.table.keys()].some(id => id.startsWith('new-') && f.table.get(id).store !== 'A-one'), false);
});

test('save: an A update of a saved receipt that resolves after the switch is not applied to B', async () => {
  const f = monthlyFixture({ records: [savedMonthly('a1', { store: 'A-one' })] }); await f.ui.loadForUser(A);
  await f.edit(f.cards()[0], 'invoice', 'A-EDIT'); const updating = gate(); f.gates.update = updating.promise; const saving = f.click(f.elements.save); await tick();
  await asB(f, 'direct switch', [savedMonthly('b1', { store: 'B-store' })]);
  updating.open(); await saving; await tick(20);
  assert.deepEqual(stores(f), ['B-store']); assert.equal(f.field(f.cards()[0], 'invoice').value, ''); quiet(f);
});

test('save: a late rejection of A\'s request shows no error on B and leaves B\'s buttons alone', async () => {
  const f = monthlyFixture(); await f.ui.loadForUser(A); await f.click(f.elements.add); await f.edit(f.cards()[0], 'store', 'A-store');
  const failing = gate(); f.gates.create = failing.promise; const saving = f.click(f.elements.save); await tick();
  await asB(f, 'sign-out then sign-in'); const before = buttons(f);
  failing.fail(new Error('A network failure')); await saving; await tick(20);
  assert.doesNotMatch(screen(f), /A network failure|Could not save/); assert.deepEqual(buttons(f), before);
});

// ---- loads ------------------------------------------------------------------------------------------------------------------------------------------
test('load: out-of-order loads, a late rejection, and the same account signing in again as a new session', async () => {
  const f = monthlyFixture({ records: [savedMonthly('a1', { store: 'A-v1' })] });
  const slow = gate(); f.gates.load = slow.promise; const first = f.ui.loadForUser(A); await tick();
  f.table.set('a1', { ...f.table.get('a1'), store: 'A-v2' }); f.gates.load = null;
  await f.ui.loadForUser(A); // the same account again: a NEW session whose answer is current
  assert.deepEqual(stores(f), ['A-v2']);
  slow.open(); await first; await tick(20);
  assert.deepEqual(stores(f), ['A-v2'], 'the older session\'s answer (A-v1) is ignored even though the account id is the same');
  const failing = gate(); f.gates.load = failing.promise; const third = f.ui.loadForUser(A); await tick(); f.gates.load = null; await f.ui.loadForUser(B);
  failing.fail(new Error('slow load failed')); await third; await tick(20);
  assert.doesNotMatch(f.elements.feedback.textContent, /Could not load/);
});

test('load: starting a load wipes the previous account\'s receipts, totals and messages at once, before the new data arrives', async () => {
  const f = monthlyFixture({ records: [savedMonthly('a1', { store: 'A-secret' })] }); await f.ui.loadForUser(A);
  f.table.clear(); f.table.set('b1', savedMonthly('b1', { store: 'B-store' }));
  const pending = gate(); f.gates.load = pending.promise; const loading = f.ui.loadForUser(B); await tick();
  assert.doesNotMatch(screen(f), /A-secret/); assert.equal(f.elements.feedback.textContent, 'Loading Monthly Filing…'); assert.equal(f.cards().length, 0); assert.equal(f.elements.activeTab.textContent, 'Active (0)');
  pending.open(); await loading; assert.deepEqual(stores(f), ['B-store']); assert.equal(f.elements.feedback.textContent, '');
});

// ---- export, at every stage ---------------------------------------------------------------------------------------------------------------------------
for (const mode of modes) {
  test(`export: ${mode} while A's confirmation is open: confirming afterwards saves, generates and archives nothing (${mode})`, async () => {
    const answer = gate(); let asked = 0;
    const f = monthlyFixture({ records: [savedMonthly('a1', { store: 'A-one' })], confirm: async () => { asked++; return answer.promise; } }); await f.ui.loadForUser(A);
    const exporting = f.click(f.elements.exportActive); await tick(); assert.equal(asked, 1);
    await asB(f, mode); const before = screen(f);
    answer.open(true); await exporting; await tick(20);
    assert.equal(f.calls.update.length + f.calls.create.length, 0); assert.equal(f.calls.workbook.length, 0, 'no XLSX download'); assert.equal(f.calls.archive.length, 0, 'no archive call');
    assert.equal(screen(f), before); assert.equal(f.table.get('b1').status, 'active'); assert.equal(buttons(f).exportActive, false);
  });
}

test('export: the account changes while A\'s save-before-export is in flight: no workbook, no archive, nothing said, B\'s export free', async () => {
  const f = monthlyFixture({ records: [savedMonthly('a1', { store: 'A-one' })] }); await f.ui.loadForUser(A); await f.edit(f.cards()[0], 'invoice', 'A-EDIT');
  const saving = gate(); f.gates.update = saving.promise; const exporting = f.click(f.elements.exportActive); await tick(); assert.equal(f.calls.update.length, 1);
  await asB(f, 'direct switch'); const before = screen(f);
  saving.open(); await exporting; await tick(20);
  assert.equal(f.calls.workbook.length, 0); assert.equal(f.calls.archive.length, 0); assert.equal(screen(f), before);
  await f.click(f.elements.exportActive); assert.deepEqual(f.calls.workbook.map(rows => rows.map(record => record.dbId)), [['b1']], 'B exports its own receipt normally'); assert.deepEqual(f.calls.archive, [['b1']]);
});

test('export: the account changes while A\'s archive request is in flight: the workbook already generated is the only effect, B sees nothing and is not locked', async () => {
  const f = monthlyFixture({ records: [savedMonthly('a1', { store: 'A-one' })] }); await f.ui.loadForUser(A);
  const archiving = gate(); f.gates.archive = archiving.promise; const exporting = f.click(f.elements.exportActive); await tick();
  assert.equal(f.calls.workbook.length, 1, 'generated before the switch: this cannot be recalled'); assert.equal(f.calls.archive.length, 1, 'requested before the switch: this cannot be recalled');
  await asB(f, 'sign-out then sign-in'); const before = screen(f);
  archiving.open(); await exporting; await tick(20);
  assert.equal(screen(f), before, 'no "Exported and archived" message and no record change for B'); assert.equal(f.calls.workbook.length, 1); assert.equal(f.calls.archive.length, 1);
  assert.equal(buttons(f).exportActive, false, 'B\'s export is not blocked by A\'s unfinished export');
  await f.click(f.elements.exportActive); assert.equal(f.calls.workbook.length, 2); assert.deepEqual(f.calls.archive.at(-1), ['b1']); assert.equal(f.table.get('b1').status, 'archived');
});

test('export: A\'s archive failing after the switch neither shows an error nor locks B\'s exports as "archive uncertain"', async () => {
  const f = monthlyFixture({ records: [savedMonthly('a1', { store: 'A-one' })] }); await f.ui.loadForUser(A);
  const archiving = gate(); f.gates.archive = archiving.promise; const exporting = f.click(f.elements.exportActive); await tick();
  await asB(f, 'direct switch'); const before = screen(f);
  archiving.fail(new Error('archive failed for A')); await exporting; await tick(20);
  assert.equal(screen(f), before); assert.doesNotMatch(screen(f), /archive status could not be confirmed|archive failed/);
  assert.equal(buttons(f).exportActive, false); await f.click(f.elements.exportActive); assert.equal(f.table.get('b1').status, 'archived', 'B exports and archives normally');
});

// ---- Company Directory ----------------------------------------------------------------------------------------------------------------------------------
function directoryFixture(extra = {}) {
  const contribute = []; const lists = { count: 0 };
  const sharedStoreService = {
    listActiveSharedStores: async () => { lists.count++; return []; },
    contributeSharedStore: async (candidate, userId) => { contribute.push({ candidate, userId }); if (extra.contributeGate) await extra.contributeGate; return { id: 'shared-1', storeName: candidate.storeName }; }
  };
  return { sharedStoreService, contribute, lists };
}
const newStore = async f => { await f.click(f.elements.add); await f.edit(f.cards()[0], 'store', 'Fresh Store'); await f.edit(f.cards()[0], 'address', '1 Main Street'); await f.edit(f.cards()[0], 'amount', '50'); };

test('directory: A\'s save finishing after the switch shows no Company Directory prompt for A\'s store and contributes nothing', async () => {
  const directory = directoryFixture(); const prompts = [];
  const f = monthlyFixture({ sharedStoreService: directory.sharedStoreService, confirm: async options => { prompts.push(options.title); return true; } }); await f.ui.loadForUser(A); await newStore(f);
  const created = gate(); f.gates.create = created.promise; const saving = f.click(f.elements.save); await tick();
  await asB(f, 'direct switch'); created.open(); await saving; await tick(20);
  assert.deepEqual(prompts, [], 'no prompt naming A\'s store appears for B'); assert.equal(directory.contribute.length, 0);
});

test('directory: a prompt open when the account changes cannot contribute afterwards, and its late answer changes nothing', async () => {
  const directory = directoryFixture(); const answer = gate(); let prompts = 0;
  const f = monthlyFixture({ sharedStoreService: directory.sharedStoreService, confirm: async options => { if (options.title !== 'Add store to Company Directory?') return true; prompts++; return answer.promise; } }); await f.ui.loadForUser(A); await newStore(f);
  const saving = f.click(f.elements.save); await tick(); assert.equal(prompts, 1);
  await asB(f, 'sign-out then sign-in'); const before = screen(f);
  answer.open(true); await saving; await tick(20);
  assert.equal(directory.contribute.length, 0, 'the contribution was never sent'); assert.equal(f.calls.associate.length, 0); assert.equal(screen(f), before);
});

test('directory: a contribution already in flight at the switch applies nothing to B (it was sent for A, and stays A\'s)', async () => {
  const hold = gate(); const directory = directoryFixture({ contributeGate: hold.promise });
  const f = monthlyFixture({ sharedStoreService: directory.sharedStoreService }); await f.ui.loadForUser(A); await newStore(f);
  const saving = f.click(f.elements.save); await tick(); assert.deepEqual(directory.contribute.map(entry => entry.userId), ['A']);
  await asB(f, 'direct switch'); const listsBefore = directory.lists.count, before = screen(f);
  hold.open(); await saving; await tick(20);
  assert.equal(directory.lists.count, listsBefore, 'no follow-up directory reload was started'); assert.equal(f.calls.associate.length, 0); assert.equal(screen(f), before);
});

// ---- the other asynchronous actions --------------------------------------------------------------------------------------------------------------------
const archivedRecords = () => [savedMonthly('a1', { store: 'A-active' }), { ...savedMonthly('z1', { store: 'A-archived' }), status: 'archived' }];
const bScreen = f => ({ stores: stores(f), feedback: f.elements.feedback.textContent, buttons: buttons(f) });

test('delete: a confirmation that outlives the session deletes nothing, and a delete in flight is not applied to B', async () => {
  let f = monthlyFixture({ records: [savedMonthly('a1', { store: 'A-one' })], confirm: async () => { await tick(30); return true; } }); await f.ui.loadForUser(A);
  const deleting = f.click(f.cards()[0].querySelector('.monthly-delete')); await tick(5);
  await asB(f, 'direct switch'); await deleting; await tick(60);
  assert.deepEqual(f.calls.remove, [], 'the stale confirmation never reached the service');
  f = monthlyFixture({ records: [savedMonthly('a1', { store: 'A-one' })] }); await f.ui.loadForUser(A);
  const hold = gate(); f.gates.remove = hold.promise; const inFlight = f.click(f.cards()[0].querySelector('.monthly-delete')); await tick();
  await asB(f, 'sign-out then sign-in'); const before = bScreen(f); hold.open(); await inFlight; await tick(20);
  assert.deepEqual(bScreen(f), before); assert.deepEqual(stores(f), ['B-store']);
});

test('return to Active: a stale confirmation or answer neither returns a receipt nor changes B\'s screen', async () => {
  const f = monthlyFixture({ records: archivedRecords() }); await f.ui.loadForUser(A); await f.click(f.elements.archivedTab);
  const hold = gate(); f.gates.returnToActive = hold.promise; const returning = f.click(f.cards()[0].querySelector('.monthly-return-active')); await tick();
  assert.equal(f.calls.returned.length, 1);
  await asB(f, 'direct switch'); const before = bScreen(f); hold.open(); await returning; await tick(20);
  assert.deepEqual(bScreen(f), before); assert.equal(f.elements.activeTab.getAttribute('aria-selected'), 'true', 'B stays on its own Active view');
});

test('Clear Archived and Clear All: nothing is sent after the session ends, and answers that arrive late change nothing', async () => {
  for (const [label, button, calls, gateName] of [['Clear Archived', 'clearArchived', 'clearArchived', 'clearArchived'], ['Clear All', 'clearAll', 'clearAll', 'clearAll']]) {
    let release; const confirmation = new Promise(resolve => { release = resolve; });
    let f = monthlyFixture({ records: archivedRecords(), confirm: async () => confirmation }); await f.ui.loadForUser(A); if (button === 'clearArchived') await f.click(f.elements.archivedTab);
    const clearing = f.click(f.elements[button]); await tick(); await asB(f, 'direct switch'); release(true); await clearing; await tick(20);
    assert.equal(f.calls[calls].length, 0, `${label}: the stale confirmation sent nothing`); assert.deepEqual(stores(f), ['B-store']);
    f = monthlyFixture({ records: archivedRecords() }); await f.ui.loadForUser(A); if (button === 'clearArchived') await f.click(f.elements.archivedTab);
    const hold = gate(); f.gates[gateName] = hold.promise; const inFlight = f.click(f.elements[button]); await tick(); assert.equal(f.calls[calls].length, 1);
    await asB(f, 'sign-out then sign-in'); const before = bScreen(f); hold.open(); await inFlight; await tick(20);
    assert.deepEqual(bScreen(f), before, `${label}: a late answer changes nothing on B`);
  }
});

// ---- rapid switching, guards, focus -------------------------------------------------------------------------------------------------------------------------
test('rapid A to B to A: the first A request is stale for the second A session, which can save independently', async () => {
  const f = monthlyFixture({ records: [savedMonthly('a1', { store: 'A-one' })] }); await f.ui.loadForUser(A); await f.edit(f.cards()[0], 'invoice', 'FIRST');
  const first = gate(); f.gates.update = first.promise; const saving = f.click(f.elements.save); await tick();
  await asB(f, 'direct switch'); f.table.clear(); f.table.set('a1', savedMonthly('a1', { store: 'A-one' })); f.gates.update = null; await f.ui.loadForUser(A);
  const before = screen(f); assert.equal(buttons(f).save, false);
  first.open(); await saving; await tick(20);
  assert.equal(screen(f), before, 'the old session\'s answer is ignored although the account id matches'); assert.equal(f.field(f.cards()[0], 'invoice').value, '', 'its invoice edit is not applied');
  await f.edit(f.cards()[0], 'invoice', 'SECOND'); await f.click(f.elements.save); assert.equal(f.table.get('a1').invoice, 'SECOND'); assert.match(f.elements.feedback.textContent, /saved/);
});

test('guards: a stale operation\'s finally block cannot release or disturb the next session\'s own guards', async () => {
  const f = monthlyFixture({ records: [savedMonthly('a1', { store: 'A-one' })] }); await f.ui.loadForUser(A); await f.edit(f.cards()[0], 'invoice', 'A-EDIT');
  const aSave = gate(); f.gates.update = aSave.promise; const aSaving = f.click(f.elements.save); await tick();
  await asB(f, 'direct switch', [savedMonthly('b1', { store: 'B-one' })]); await f.edit(f.cards()[0], 'invoice', 'B-EDIT');
  const bSave = gate(); f.gates.update = bSave.promise; const bSaving = f.click(f.elements.save); await tick();
  const writes = f.calls.update.length; assert.equal(f.elements.save.disabled, true, 'B\'s own save is pending, so its Save is disabled');
  aSave.open(); await aSaving; await tick(20);
  assert.equal(f.elements.save.disabled, true, 'A\'s finally block did not free B\'s busy flag');
  await f.click(f.elements.save); assert.equal(f.calls.update.length, writes, 'a second Save while B\'s save is pending sends nothing: A\'s finally block did not release B\'s mutation guard either');
  bSave.open(); await bSaving; await tick(20);
  assert.equal(f.elements.save.disabled, false); assert.equal(f.table.get('b1').invoice, 'B-EDIT');
});

test('focus: a focus change scheduled by the ended session never moves focus in the next account\'s screen', async () => {
  const f = monthlyFixture(); const queued = []; const original = globalThis.requestAnimationFrame; globalThis.requestAnimationFrame = callback => { queued.push(callback); return 0; };
  try {
    await f.ui.loadForUser(A); await f.click(f.elements.add); assert.ok(queued.length > 0, 'the Add click scheduled a focus move');
    await asB(f, 'direct switch'); const focusesBefore = f.focusLog.length;
    queued.splice(0).forEach(callback => callback());
    assert.equal(f.focusLog.length, focusesBefore, 'the stale focus move did nothing');
  } finally { globalThis.requestAnimationFrame = original; }
});

test('same-session behavior is unchanged: save, then directory decision, then export and archive still complete in order', async () => {
  const directory = directoryFixture(); const order = [];
  const f = monthlyFixture({ sharedStoreService: directory.sharedStoreService, confirm: async options => { order.push(options.title); return true; } }); await f.ui.loadForUser(A); await newStore(f);
  await f.click(f.elements.exportActive);
  assert.deepEqual(order, ['Export Active Monthly Filing receipts?', 'Add store to Company Directory?'], 'export confirmation, then the directory prompt while saving');
  assert.deepEqual(directory.contribute.map(entry => entry.userId), ['A']); assert.equal(f.calls.workbook.length, 1); assert.equal(f.calls.archive.length, 1);
  assert.match(f.elements.feedback.textContent, /Exported and archived 1 Monthly Filing receipt/);
});
