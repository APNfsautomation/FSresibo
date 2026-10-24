// Issue #27, AUTH-10: overlapping account activation and Receipt Encoding load operations. The real receipt UI controller (and, in crossModuleRegression.test.mjs,
// the real app.js bootstrap) driven with independent deferred promises: a load or import that belongs to an earlier account must never render, announce or
// populate suggestions under the next account. Fake backend only; this is not a hosted Supabase test.
import assert from 'node:assert/strict';
import test from 'node:test';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';

const gate = () => { let open; const promise = new Promise(resolve => { open = resolve; }); return { promise, open }; };
const row = (dbId, store, amount = 100) => ({ dbId, store, amount, receiptDate: '2026-08-01' });
const stores = f => f.rows().map(item => f.field(item, 'store').value);
const setTable = (f, rows) => { f.db.clear(); rows.forEach(item => f.db.set(item.dbId, { amount: '', receiptDate: '', vat: '', invoice: '', store: '', address: '', tin: '', status: 'available', updatedAt: f.stamp(), ...item })); };
const visible = f => [stores(f).join(','), f.elements.encodingFeedback.textContent, f.elements.receiptCount.textContent].join(' | ');

test('AUTH-10a: an earlier account\'s slow load that resolves AFTER the next account\'s load never replaces its receipts', async () => {
  const f = await receiptFixture({ loaded: [row('seed', 'seed')] });
  setTable(f, [row('a1', 'A-secret-store'), row('a2', 'A-other')]);
  const slow = gate(); f.fails.loadGates.push(slow.promise); const aLoading = f.ui.loadForUser({ id: 'A' }); await settle();
  setTable(f, [row('b1', 'B-store')]); await f.ui.loadForUser({ id: 'B' });
  assert.deepEqual(stores(f), ['B-store']);
  slow.open(); await aLoading; await settle();
  assert.deepEqual(stores(f), ['B-store'], 'A\'s receipts do not appear under B'); assert.doesNotMatch(visible(f), /A-secret|A-other/);
  assert.equal(f.elements.receiptCount.textContent, '1 receipt');
});

test('AUTH-10b: an earlier account\'s load that resolves BEFORE the next account\'s load finishes does not render under the next account either', async () => {
  const f = await receiptFixture({ loaded: [row('seed', 'seed')] });
  setTable(f, [row('a1', 'A-secret-store')]); const aGate = gate(); f.fails.loadGates.push(aGate.promise); const aLoading = f.ui.loadForUser({ id: 'A' }); await settle();
  setTable(f, [row('b1', 'B-store')]); const bGate = gate(); f.fails.loadGates.push(bGate.promise); const bLoading = f.ui.loadForUser({ id: 'B' }); await settle();
  assert.doesNotMatch(visible(f), /A-secret/, 'while B is loading the screen holds no receipts of the account that was active before');
  aGate.open(); await aLoading; await settle();
  assert.doesNotMatch(visible(f), /A-secret/, 'A\'s answer arrives while B is still loading: nothing is rendered');
  bGate.open(); await bLoading; await settle();
  assert.deepEqual(stores(f), ['B-store']);
});

test('AUTH-10c: signing out while a load is running means the load never renders afterwards', async () => {
  const f = await receiptFixture({ loaded: [row('seed', 'seed')] });
  setTable(f, [row('a1', 'A-secret-store')]); const hold = gate(); f.fails.loadGates.push(hold.promise); const loading = f.ui.loadForUser({ id: 'A' }); await settle();
  f.ui.clearForLogout(); hold.open(); await loading; await settle();
  assert.deepEqual(stores(f), []); assert.doesNotMatch(visible(f), /A-secret/); assert.equal(f.elements.exportSelected.disabled, true);
});

test('AUTH-10d: a Company Directory list that fails late for an earlier account shows no warning under the next account', async () => {
  const queue = []; // each entry answers one directory request: { hold, fail }
  const f = await receiptFixture({ loaded: [], sharedStoreList: async () => { const next = queue.shift(); if (next?.hold) await next.hold.promise; if (next?.fail) throw new Error('directory down'); return []; } });
  const hold = gate(); queue.push({ hold, fail: true }); setTable(f, [row('a1', 'A-store')]);
  const aLoading = f.ui.loadForUser({ id: 'A' }); await settle();
  setTable(f, [row('b1', 'B-store')]); await f.ui.loadForUser({ id: 'B' });
  assert.equal(f.elements.encodingFeedback.textContent, '');
  hold.open(); await aLoading; await settle();
  assert.doesNotMatch(f.elements.encodingFeedback.textContent, /Company Store Directory is temporarily unavailable/, 'the stale failure is silent'); assert.deepEqual(stores(f), ['B-store']);
});

test('AUTH-10e: a legacy-draft import that finishes after the account changed is not rendered under the next account', async () => {
  const f = await receiptFixture({ loaded: [row('b-seed', 'B-seed')] });
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => key.includes('imported-for') ? null : JSON.stringify({ receipts: [{ store: 'Draft-of-A', amount: '12' }] }), setItem() {}, removeItem() {} };
  try {
    const hold = gate(); f.fails.importGate = hold.promise;
    const importing = f.ui.importLegacyDraft({ id: 'A' }); await settle();
    f.ui.clearForLogout(); await f.ui.loadForUser({ id: 'B' });
    hold.open(); await importing; await settle();
    assert.doesNotMatch(visible(f), /Draft-of-A|Import completed/); assert.deepEqual(stores(f), ['B-seed']);
  } finally { globalThis.localStorage = original; }
});

test('AUTH-10f: the same account signing in again is a new session: the older load of the same id is ignored', async () => {
  const f = await receiptFixture({ loaded: [row('seed', 'seed')] });
  setTable(f, [row('a1', 'A-v1')]); const hold = gate(); f.fails.loadGates.push(hold.promise); const first = f.ui.loadForUser({ id: 'A' }); await settle();
  setTable(f, [row('a1', 'A-v2')]); await f.ui.loadForUser({ id: 'A' });
  hold.open(); await first; await settle();
  assert.deepEqual(stores(f), ['A-v2']);
});
