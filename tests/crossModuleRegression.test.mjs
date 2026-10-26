// CP10-C3E-5 (Issue #26): cross-module regression coverage for gaps found while mapping the integration matrix (docs/07_Regression_Coverage_Matrix.md).
// Tests only. They drive the real composition (app.js bootstrap) and the real receipt / Monthly Filing UI controllers against in-memory test doubles.
// Nothing here talks to Supabase, so it is automated fake-backend evidence and never a substitute for the Product Owner's hosted UAT.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { createApplicationWorkspaces } from '../ui/applicationWorkspaces.js';
import { receiptRoutes } from '../ui/navigationController.js';
import { createQuickOptimizerUi } from '../ui/quickOptimizerUi.js';
import { optimizationStrategies } from '../services/optimizationService.js';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';
import { monthlyFixture, savedMonthly } from './helpers/monthlyFilingUiFixture.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const tick = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));

// ---- 1. Authentication / session isolation: the real app.js bootstrap, every module observed -------------------------------------------------------
const eventTarget = () => {
  const listeners = new Map();
  return { addEventListener: (name, callback) => listeners.set(name, callback), emit: (name, event = {}) => listeners.get(name)?.(event) };
};
const element = () => ({ hidden: false, attributes: {}, focused: false, ...eventTarget(), setAttribute(name, value) { this.attributes[name] = value; }, focus() { this.focused = true; } });

// Runs the real app.js with every import replaced by a recording double. Receipts and Monthly Filing are spies so the ORDER and the TARGET of each lifecycle call
// are visible; Quick Optimizer and the module-visibility composition are the real ones.
async function bootApp({ sessionUser = { id: 'a', email: 'a@example.test' }, gates = {} } = {}) {
  const source = await read('../app.js');
  const log = [];
  const nodes = new Map();
  const document = { title: 'FSResibo', querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); } };
  const window = { location: { href: 'https://example.test/#receipts/encoding' }, history: { replaceState() {} }, setTimeout };
  const record = name => (...args) => { log.push(name + (args.length ? `:${args.map(arg => arg?.id ?? arg).join(',')}` : '')); };
  let subscription; let logoutCalls = 0;
  const receipt = {
    setModuleVisible: () => {}, setWorkspace: () => {}, start: record('receipt.start'), clearForLogout: record('receipt.clear'),
    loadForUser: async user => { log.push(`receipt.load:${user.id}`); if (gates.failFor === user.id) throw new Error('load failed'); if (gates.receiptLoad) await gates.receiptLoad; if (gates.receiptByUser?.[user.id]) await gates.receiptByUser[user.id]; },
    importLegacyDraft: async user => { log.push(`receipt.importLegacy:${user.id}`); }, consumeLegacyWorkspace: () => 'encoding'
  };
  const monthly = { setVisible: () => {}, start: record('monthly.start'), clearForLogout: record('monthly.clear'), loadForUser: async user => { log.push(`monthly.load:${user.id}`); if (gates.monthlyByUser?.[user.id]) await gates.monthlyByUser[user.id]; } };
  const auth = { show: (message, options) => log.push(`auth.show:${message ?? ''}:${options?.clearPasswords ? 'clearPasswords' : ''}`), hide: record('auth.hide'), setMessage: () => {}, showRecovery: record('auth.showRecovery'), showRecoveryUnavailable: record('auth.showRecoveryUnavailable') };
  const dependencies = {
    document, window, isSupabaseConfigured: () => true, supabaseConfig: {}, appMetadata: { name: 'FSResibo', version: '3.6.0' },
    authRedirectUrl: () => 'https://example.test/', getCurrentSession: async () => { if (gates.session) await gates.session; return sessionUser ? { user: sessionUser } : null; },
    hasPasswordRecoveryIntent: () => false, login: () => {}, logout: async () => { logoutCalls += 1; },
    onAuthStateChange: async callback => { subscription = callback; }, recoveryCallbackError: () => null,
    register: () => {}, requestPasswordReset: () => {}, updatePassword: () => {}, scanPrintedDetails: () => {},
    downloadExpenseDetailedReport: () => {}, downloadSelectedReceipts: () => {}, findBest: () => {}, optimizationStrategies: {}, toCents: () => {},
    receiptService: {}, monthlyFilingService: {}, sharedStoreService: {}, renderApplicationIdentity: () => {}, renderApplicationName: () => {},
    createAuthPanel: () => auth, createConfirmationDialog: () => ({ confirm: () => {}, close: record('dialog.close') }), createModalFocus: () => ({ open: () => {}, close: () => {} }),
    createNavigationController: () => ({ start: () => { log.push('navigation.start'); }, setDrawer: () => {} }),
    receiptRoutes, createReceiptUi: () => receipt, createMonthlyFilingUi: () => monthly,
    createQuickOptimizerUi: () => createQuickOptimizerUi({ nextFrame: async () => {} }),
    createApplicationWorkspaces: args => {
      const real = createApplicationWorkspaces(args);
      return { ...real, setUser: id => { log.push(`workspaces.setUser:${id}`); real.setUser(id); }, clearForLogout: () => { log.push('workspaces.clear'); real.clearForLogout(); } };
    },
    createThemeController: () => ({ restore: () => {} })
  };
  const body = source.replace(/^import .*;\r?$/gm, '') + '\nreturn { handleAuthState, quickOptimizerUi };';
  const app = new Function(...Object.keys(dependencies), body)(...Object.values(dependencies));
  await tick();
  return { ...app, log, nodes, emit: (event, session) => subscription(event, session), handle: app.handleAuthState, logoutCalls: () => logoutCalls };
}
const since = (app, mark) => app.log.slice(mark);

test('AUTH-1: the first session activates receipts, then Monthly Filing, for that account only, and a token refresh reloads nothing', async () => {
  const app = await bootApp();
  const activation = app.log.filter(entry => /^(workspaces\.setUser|auth\.hide|receipt\.load|monthly\.load|receipt\.importLegacy|navigation\.start)/.test(entry));
  assert.deepEqual(activation, ['workspaces.setUser:a', 'auth.hide', 'receipt.load:a', 'monthly.load:a', 'receipt.importLegacy:a', 'navigation.start']);
  const mark = app.log.length;
  await app.handle('TOKEN_REFRESHED', { user: { id: 'a' } }); await app.handle('SIGNED_IN', { user: { id: 'a' } });
  assert.deepEqual(since(app, mark), [], 'the same account never reloads or clears anything');
});

test('AUTH-2: a different account signing in without a sign-out event reloads both modules for the new account and resets the Quick calculator', async () => {
  const app = await bootApp();
  app.quickOptimizerUi.setTarget('1000'); app.quickOptimizerUi.appendBulk('500\n500'); await app.quickOptimizerUi.calculate();
  assert.equal(app.quickOptimizerUi.getState().target, '1000');
  const mark = app.log.length;
  await app.handle('SIGNED_IN', { user: { id: 'b', email: 'b@example.test' } });
  assert.deepEqual(since(app, mark).filter(entry => /load|setUser/.test(entry)), ['workspaces.setUser:b', 'receipt.load:b', 'monthly.load:b']);
  assert.equal(app.quickOptimizerUi.getState().target, '', 'the previous account\'s temporary amounts are gone');
  assert.equal(app.nodes.get('#userEmail').textContent, 'b@example.test');
});

test('AUTH-3: a second sign-in event for the account that is still activating does not start a second load', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const app = await bootApp({ sessionUser: null, gates: { receiptLoad: gate } });
  const first = app.handle('SIGNED_IN', { user: { id: 'c' } }); await tick();
  const repeats = [app.handle('SIGNED_IN', { user: { id: 'c' } }), app.handle('TOKEN_REFRESHED', { user: { id: 'c' } })]; await tick();
  release(); await Promise.all([first, ...repeats]);
  assert.equal(app.log.filter(entry => entry === 'receipt.load:c').length, 1);
  assert.equal(app.log.filter(entry => entry === 'monthly.load:c').length, 1);
});

test('AUTH-4: sign-out, a missing session and a signed-out start each clear receipts, Monthly Filing and Quick, and the sign-in screen clears password fields on an explicit sign-out', async () => {
  const signedOutStart = await bootApp({ sessionUser: null });
  assert.ok(signedOutStart.log.includes('workspaces.clear') && signedOutStart.log.some(entry => entry.startsWith('auth.show')), 'a signed-out start shows sign-in with nothing loaded');
  assert.equal(signedOutStart.log.some(entry => /load:/.test(entry)), false);
  const app = await bootApp();
  app.quickOptimizerUi.setTarget('777');
  let mark = app.log.length; await app.handle('SIGNED_OUT', null);
  assert.deepEqual(since(app, mark), ['dialog.close:false', 'receipt.clear', 'monthly.clear', 'workspaces.clear', 'auth.show::clearPasswords'], 'any open prompt of the ended account is dismissed first');
  assert.equal(app.quickOptimizerUi.getState().target, '');
  await app.handle('SIGNED_IN', { user: { id: 'a' } }); // the same account may sign in again after signing out and is loaded afresh
  assert.equal(app.log.filter(entry => entry === 'receipt.load:a').length, 2); assert.equal(app.log.filter(entry => entry === 'monthly.load:a').length, 2);
  app.quickOptimizerUi.setTarget('888'); mark = app.log.length; await app.handle('INITIAL_SESSION', null);
  assert.deepEqual(since(app, mark), ['dialog.close:false', 'receipt.clear', 'monthly.clear', 'workspaces.clear', 'auth.show::']);
  assert.equal(app.quickOptimizerUi.getState().target, '');
});

test('AUTH-5: after a recovery event, sign-in events are ignored until sign-out, and sign-out clears every module', async () => {
  const app = await bootApp();
  await app.handle('PASSWORD_RECOVERY', { user: { id: 'a' } });
  assert.ok(app.log.includes('auth.showRecovery'));
  const mark = app.log.length;
  await app.handle('SIGNED_IN', { user: { id: 'z' } });
  assert.equal(since(app, mark).some(entry => /load:|auth.hide/.test(entry)), false, 'a recovery session never opens the application for any account');
  await app.handle('SIGNED_OUT', null);
  assert.deepEqual(since(app, mark).filter(entry => /clear/.test(entry)), ['receipt.clear', 'monthly.clear', 'workspaces.clear', 'auth.show::clearPasswords']);
  await app.handle('SIGNED_IN', { user: { id: 'a' } });
  assert.ok(app.log.slice(mark).includes('receipt.load:a'), 'the next ordinary sign-in works again');
});

test('AUTH-6: Quick Optimizer use triggers no receipt, Monthly Filing or directory activity and no sign-out', async () => {
  const app = await bootApp();
  const mark = app.log.length;
  app.quickOptimizerUi.setTarget('1000'); app.quickOptimizerUi.appendBulk('400\n600\n1040'); await app.quickOptimizerUi.calculate(); app.quickOptimizerUi.clear();
  assert.deepEqual(since(app, mark), []); assert.equal(app.logoutCalls(), 0);
});

// ---- AUTH-10: overlapping activation in the real app.js bootstrap (Issue #27) -------------------------------------------------------------------------------
const deferred = () => { let open; const promise = new Promise(resolve => { open = resolve; }); return { promise, open }; };
const activations = app => app.log.filter(entry => /^(receipt\.load|monthly\.load|receipt\.importLegacy|navigation\.start|auth\.hide)/.test(entry));

test('AUTH-10 (app.js): an older account\'s activation that resumes after the next account\'s finished loads nothing more, shows nothing, and does not take over', async () => {
  const hold = deferred(); const app = await bootApp({ sessionUser: null, gates: { receiptByUser: { a: hold.promise } } });
  const first = app.handle('SIGNED_IN', { user: { id: 'a', email: 'a@example.test' } }); await tick();
  await app.handle('SIGNED_IN', { user: { id: 'b', email: 'b@example.test' } });
  assert.equal(app.nodes.get('#userEmail').textContent, 'b@example.test');
  hold.open(); await first; await tick();
  assert.deepEqual(activations(app), ['auth.hide', 'receipt.load:a', 'auth.hide', 'receipt.load:b', 'monthly.load:b', 'receipt.importLegacy:b', 'navigation.start'], 'a\'s activation stopped right after its receipt load');
  assert.equal(app.nodes.get('#userEmail').textContent, 'b@example.test');
  const mark = app.log.length; await app.handle('TOKEN_REFRESHED', { user: { id: 'b' } });
  assert.deepEqual(since(app, mark), [], 'b is the active account: a refresh reloads nothing (a did not overwrite it)');
});

test('AUTH-10 (app.js): an activation that resumes after a sign-out never reopens the application or loads any module', async () => {
  const hold = deferred(); const app = await bootApp({ sessionUser: null, gates: { receiptByUser: { a: hold.promise } } });
  const first = app.handle('SIGNED_IN', { user: { id: 'a', email: 'a@example.test' } }); await tick();
  await app.handle('SIGNED_OUT', null); const mark = app.log.length;
  hold.open(); await first; await tick();
  assert.deepEqual(since(app, mark), [], 'nothing runs after the sign-out');
  assert.equal(app.log.some(entry => entry === 'monthly.load:a' || entry === 'navigation.start'), false);
  await app.handle('SIGNED_IN', { user: { id: 'a' } }); assert.ok(app.log.slice(mark).includes('receipt.load:a'), 'a fresh sign-in of the same account is a new activation');
});

test('AUTH-10 (app.js): an older account\'s activation held at the Monthly Filing load does not import, navigate or take over after the switch', async () => {
  const hold = deferred(); const app = await bootApp({ sessionUser: null, gates: { monthlyByUser: { a: hold.promise } } });
  const first = app.handle('SIGNED_IN', { user: { id: 'a' } }); await tick();
  await app.handle('SIGNED_IN', { user: { id: 'b' } }); hold.open(); await first; await tick();
  assert.deepEqual(activations(app), ['auth.hide', 'receipt.load:a', 'monthly.load:a', 'auth.hide', 'receipt.load:b', 'monthly.load:b', 'receipt.importLegacy:b', 'navigation.start']);
  const mark = app.log.length; await app.handle('TOKEN_REFRESHED', { user: { id: 'b' } }); assert.deepEqual(since(app, mark), []);
});

test('AUTH-10 (app.js): a recovery event during an activation also ends it', async () => {
  const hold = deferred(); const app = await bootApp({ sessionUser: null, gates: { receiptByUser: { a: hold.promise } } });
  const first = app.handle('SIGNED_IN', { user: { id: 'a' } }); await tick(); await app.handle('PASSWORD_RECOVERY', { user: { id: 'a' } }); const mark = app.log.length;
  hold.open(); await first; await tick();
  assert.equal(since(app, mark).some(entry => /monthly\.load|importLegacy|navigation\.start/.test(entry)), false);
});

test('AUTH-10 (app.js): a direct account switch ends the previous account\'s Monthly Filing session at once, before the new account\'s loads are awaited', async () => {
  const hold = deferred(); const app = await bootApp({ gates: { receiptByUser: { b: hold.promise } } });
  const mark = app.log.length; const switching = app.handle('SIGNED_IN', { user: { id: 'b' } }); await tick();
  assert.deepEqual(since(app, mark).filter(entry => /dialog\.close|monthly\.|receipt\.load|setUser/.test(entry)), ['dialog.close:false', 'monthly.clear', 'workspaces.setUser:b', 'receipt.load:b'], 'while b\'s receipts load, a\'s Monthly Filing screen is already gone');
  hold.open(); await switching;
});

// ---- Round 1 review of PR #31 (app.js): latest event wins, late startup answers, recovery ---------------------------------------------------------------------
test('R1 (A to B to A): a held B activation cannot take over after A signed in again; the later A event is not ignored as a duplicate of the earlier A', async () => {
  const hold = deferred(); const app = await bootApp({ gates: { receiptByUser: { b: hold.promise } } }); // A is fully active
  const mark = app.log.length;
  const b = app.handle('SIGNED_IN', { user: { id: 'b', email: 'b@example.test' } }); await tick();
  await app.handle('SIGNED_IN', { user: { id: 'a', email: 'a@example.test' } });
  assert.equal(since(app, mark).filter(entry => entry === 'receipt.load:a').length, 1, 'A is activated afresh');
  assert.equal(app.nodes.get('#userEmail').textContent, 'a@example.test');
  hold.open(); await b; await tick();
  assert.equal(app.nodes.get('#userEmail').textContent, 'a@example.test', 'B did not take the screen over');
  assert.equal(since(app, mark).includes('monthly.load:b'), false, 'B\'s activation stopped after its receipt load');
  const after = app.log.length; await app.handle('TOKEN_REFRESHED', { user: { id: 'a' } }); await app.handle('SIGNED_IN', { user: { id: 'a' } });
  assert.deepEqual(since(app, after), [], 'A is the active account again: redundant events for A are still de-duplicated');
});

test('R1 (B to A to B): the newest of three overlapping sign-ins is the one that ends up active', async () => {
  const holdB = deferred(), holdA = deferred(); const app = await bootApp({ sessionUser: null, gates: { receiptByUser: { a: holdA.promise, b: holdB.promise } } });
  const first = app.handle('SIGNED_IN', { user: { id: 'b', email: 'b@example.test' } }); await tick();
  const second = app.handle('SIGNED_IN', { user: { id: 'a', email: 'a@example.test' } }); await tick();
  const third = app.handle('SIGNED_IN', { user: { id: 'b', email: 'b@example.test' } }); await tick();
  holdA.open(); await second; holdB.open(); await Promise.all([first, third]); await tick();
  assert.equal(app.log.filter(entry => entry === 'monthly.load:b').length, 1, 'only the newest activation went on to load Monthly Filing');
  assert.equal(app.log.filter(entry => entry === 'monthly.load:a').length, 0);
  assert.equal(app.log.filter(entry => entry === 'navigation.start').length, 1); assert.equal(app.nodes.get('#userEmail').textContent, 'b@example.test');
  const mark = app.log.length; await app.handle('TOKEN_REFRESHED', { user: { id: 'b' } }); assert.deepEqual(since(app, mark), []);
});

test('R1: a failed activation leaves no account marked active, so the account that was active before it can sign in again and load', async () => {
  const app = await bootApp({ gates: { failFor: 'b' } }); // a is fully active
  await assert.rejects(() => app.handle('SIGNED_IN', { user: { id: 'b' } }), /load failed/);
  const mark = app.log.length; await app.handle('SIGNED_IN', { user: { id: 'a' } });
  assert.ok(since(app, mark).includes('receipt.load:a'), 'a is loaded again: it is not mistaken for the still-active account of before b');
});

test('R2: a late initial getCurrentSession() answer never reactivates a user after SIGNED_OUT, after another account signed in, or after a recovery event', async () => {
  for (const [label, event, expectEmail] of [['sign-out', ['SIGNED_OUT', null], undefined], ['recovery', ['PASSWORD_RECOVERY', { user: { id: 'a' } }], undefined], ['another account signed in', ['SIGNED_IN', { user: { id: 'b', email: 'b@example.test' } }], 'b@example.test']]) {
    const hold = deferred(); const app = await bootApp({ gates: { session: hold.promise } }); // the startup session lookup is still pending
    await app.handle(...event); const mark = app.log.length;
    hold.open(); await tick(20);
    const rest = since(app, mark);
    assert.equal(rest.some(entry => /^(receipt\.load:a|monthly\.load:a|receipt\.importLegacy:a|navigation\.start)/.test(entry)), false, `${label}: a was not reopened (${rest.join(',')})`);
    if (expectEmail) assert.equal(app.nodes.get('#userEmail').textContent, expectEmail, `${label}: the newer account stays on screen`);
  }
});

test('R2: a late "no session" answer does not show the sign-in screen over an account that signed in meanwhile', async () => {
  const hold = deferred(); const app = await bootApp({ sessionUser: null, gates: { session: hold.promise } });
  await app.handle('SIGNED_IN', { user: { id: 'b', email: 'b@example.test' } }); const mark = app.log.length;
  hold.open(); await tick(20);
  assert.equal(since(app, mark).some(entry => entry.startsWith('auth.show')), false); assert.equal(since(app, mark).includes('workspaces.clear'), false);
});

test('R2: without any later event the startup session answer still activates the user', async () => {
  const hold = deferred(); const app = await bootApp({ gates: { session: hold.promise } });
  assert.equal(app.log.some(entry => entry === 'receipt.load:a'), false); hold.open(); await tick(20);
  assert.ok(app.log.includes('receipt.load:a') && app.log.includes('monthly.load:a') && app.log.includes('navigation.start'));
});

test('R4: password recovery ends both controllers\' sessions and dismisses open prompts, and recovery-mode sign-in events stay ignored until the sign-out', async () => {
  const app = await bootApp(); const mark = app.log.length;
  await app.handle('PASSWORD_RECOVERY', { user: { id: 'a' } });
  assert.deepEqual(since(app, mark).filter(entry => /clear|dialog\.close|showRecovery/.test(entry)), ['dialog.close:false', 'receipt.clear', 'monthly.clear', 'workspaces.clear', 'auth.showRecovery'], 'receipts, Monthly Filing and Quick are all cleared on entry to recovery');
  const afterRecovery = app.log.length; await app.handle('SIGNED_IN', { user: { id: 'z' } }); await app.handle('TOKEN_REFRESHED', { user: { id: 'a' } });
  assert.deepEqual(since(app, afterRecovery), [], 'recovery-mode events are ignored');
  await app.handle('SIGNED_OUT', null); assert.ok(app.log.slice(afterRecovery).includes('auth.show::clearPasswords'));
});

test('AUTH-10 (app.js): any open confirmation dialog is dismissed when the account ends or changes, but not on a same-account token refresh', async () => {
  const app = await bootApp(); let mark = app.log.length;
  await app.handle('TOKEN_REFRESHED', { user: { id: 'a' } }); assert.equal(since(app, mark).includes('dialog.close:false'), false);
  mark = app.log.length; await app.handle('SIGNED_IN', { user: { id: 'b' } }); assert.ok(since(app, mark).includes('dialog.close:false'), 'switching account closes a prompt that belonged to the previous one');
  mark = app.log.length; await app.handle('SIGNED_OUT', null); assert.ok(since(app, mark).includes('dialog.close:false'), 'sign-out closes any prompt');
  mark = app.log.length; await app.handle('INITIAL_SESSION', null); assert.ok(since(app, mark).includes('dialog.close:false'));
});

// ---- 1b. Monthly Filing requests that belong to a signed-out account (Issue #27, fixed): they never touch, block or speak into the next account's screen ----
// The broader gated-promise matrix (late export, directory prompts, delete, return, clear, A-B-A) is in monthlySessionIsolation.test.mjs.
const owner = card => card.querySelector('.monthly-store').value;

test('AUTH-7: a Monthly Filing save still running when account A signs out never changes account B\'s screen', async () => {
  const f = monthlyFixture();
  await f.ui.loadForUser({ id: 'A' }); await f.click(f.elements.add);
  await f.edit(f.cards()[0], 'store', 'A-SECRET'); await f.edit(f.cards()[0], 'amount', '123');
  let release; f.gates.create = new Promise(resolve => { release = resolve; });
  const saving = f.click(f.elements.save); await tick();
  f.ui.clearForLogout(); f.gates.create = null;
  f.table.set('b1', savedMonthly('b1', { store: 'B-store' }));
  await f.ui.loadForUser({ id: 'B' });
  release(); await saving; await tick(20);
  assert.deepEqual(f.cards().map(owner), ['B-store'], 'account A\'s receipt must not appear on B\'s screen');
});

test('AUTH-8: account B can save while account A\'s earlier save is still unanswered', async () => {
  const f = monthlyFixture();
  await f.ui.loadForUser({ id: 'A' }); await f.click(f.elements.add);
  await f.edit(f.cards()[0], 'store', 'A-pending');
  f.gates.create = new Promise(() => {}); // an answer that never arrives
  void f.click(f.elements.save); await tick();
  f.ui.clearForLogout(); f.gates.create = null;
  f.table.set('b1', savedMonthly('b1', { store: 'B-store' }));
  await f.ui.loadForUser({ id: 'B' });
  assert.equal(f.elements.save.disabled, false, 'B\'s Save must not stay disabled behind A\'s request');
});

test('AUTH-9: a slow Monthly Filing load for account A that resolves after account B\'s load does not replace B\'s receipts', async () => {
  const f = monthlyFixture({ records: [savedMonthly('a1', { store: 'A-ONE' })] });
  let release; f.gates.load = new Promise(resolve => { release = resolve; });
  const slow = f.ui.loadForUser({ id: 'A' }); await tick();
  f.gates.load = null; f.table.clear(); f.table.set('b1', savedMonthly('b1', { store: 'B-store' }));
  await f.ui.loadForUser({ id: 'B' });
  release(); await slow; await tick(20);
  assert.deepEqual(f.cards().map(owner), ['B-store']);
});

// ---- 2. Receipt Encoding: Consumed receipts are read-only --------------------------------------------------------------------------------------
test('ENC-1: every field of a Consumed receipt is read-only, Mark Available makes it editable again, and Save never writes it', async () => {
  const f = await receiptFixture({ loaded: [
    { dbId: 'a', amount: 100, store: 'Available store', receiptDate: '2026-08-01' },
    { dbId: 'u', amount: 70, store: 'Used store', receiptDate: '2026-08-02', status: 'consumed' }
  ] });
  f.elements.receiptStatusFilter.value = 'all'; await f.elements.receiptStatusFilter.emit('change'); await settle();
  const fields = row => row.querySelectorAll('input, select');
  const used = f.rows().find(row => row.dataset.receiptDbId === 'u'); const open = f.rows().find(row => row.dataset.receiptDbId === 'a');
  assert.ok(fields(used).length >= 7 && fields(used).every(field => field.disabled), 'a Consumed receipt cannot be edited');
  assert.ok(fields(open).every(field => !field.disabled), 'an Available receipt stays editable');
  await f.click(f.elements.saveDraft);
  assert.equal(f.calls.update.length + f.calls.create.length, 0, 'Save with nothing edited writes nothing, Consumed included');
  await f.click(used.part('.restore-receipt')); await settle();
  assert.ok(fields(used).every(field => !field.disabled), 'a restored receipt is editable');
});

// ---- 3. Receipt Optimization: accounting boundary and lifecycle through the real receipt UI --------------------------------------------------------
const bestMatch = async (f, target, strategy) => { f.elements.optimizationStrategy.value = strategy; await f.elements.optimizationStrategy.emit('change'); f.elements.target.value = target; await f.click(f.elements.calculate); };
const resultText = f => f.elements.resultAmount.textContent.replace(/\s/g, '');
const available = (dbId, amount, store) => ({ dbId, amount, store, receiptDate: '2026-08-01' });

test('OPT-1: through Receipt Optimization, PHP 50.00 of excess is accepted, PHP 50.01 is not, and a Consumed receipt is never in the pool', async () => {
  const consumedExact = { ...available('x', 1000, 'Consumed exact'), status: 'consumed' };
  const inside = await receiptFixture({ loaded: [available('r1', 500, 'A'), available('r2', 550, 'B'), consumedExact] });
  await bestMatch(inside, '1000', optimizationStrategies.closest);
  assert.equal(resultText(inside), '₱1,050.00', 'T + 50.00 is eligible and beats the under-target fallback; the Consumed 1,000.00 receipt is not used');
  assert.equal(inside.elements.exportSelected.textContent, 'Export Selected (2)');
  const outside = await receiptFixture({ loaded: [available('r1', 500, 'A'), available('r2', 550.01, 'B'), consumedExact] });
  await bestMatch(outside, '1000', optimizationStrategies.closest);
  assert.equal(resultText(outside), '₱550.01', 'T + 50.01 is excluded, so the best under-target receipt is offered instead');
  await bestMatch(outside, '1000', optimizationStrategies.withoutExceeding);
  assert.equal(resultText(outside), '₱550.01', 'Do Not Exceed never offers a total above the target');
  for (const f of [inside, outside]) assert.deepEqual([f.calls.create.length, f.calls.update.length, f.calls.consume.length, f.calls.download.length], [0, 0, 0, 0], 'calculating writes and exports nothing');
});

test('OPT-2: after a Best Match export the exported receipts are Consumed, leave the pool, and the next calculation uses only what remains', async () => {
  const f = await receiptFixture({ loaded: [available('r1', 500, 'A'), available('r2', 500, 'B'), available('r3', 300, 'C'), available('r4', 200, 'D')], viaServiceMapping: true });
  await bestMatch(f, '1000', optimizationStrategies.closest);
  assert.equal(resultText(f), '₱1,000.00');
  await f.click(f.elements.exportSelected); await f.click(f.elements.confirmExport);
  assert.equal(f.calls.download.length, 1, 'one download');
  const exported = f.calls.download[0].map(item => item.dbId);
  assert.deepEqual(f.calls.consume, [exported], 'exactly the exported receipts are marked Consumed, once');
  for (const id of ['r1', 'r2', 'r3', 'r4']) assert.equal(f.db.get(id).status, exported.includes(id) ? 'consumed' : 'available');
  await bestMatch(f, '1000', optimizationStrategies.closest);
  assert.equal(resultText(f), '₱500.00', 'only the two remaining Available receipts (300.00 + 200.00) can be offered; the Consumed 1,000.00 is gone from the pool');
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)');
});

// ---- 4. Security / persistence: static posture of every migration (NOT hosted two-account evidence) ------------------------------------------------
const allMigrations = async () => {
  const names = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
  return (await Promise.all(names.map(name => read(`../supabase/migrations/${name}`)))).join('\n');
};

test('SEC-1: every table created by the migrations enables row level security, grants nothing to anon, and every policy is owner-scoped or an active-profile read', async () => {
  const names = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
  assert.deepEqual(names.map(name => name.slice(0, 3)), ['001', '002', '003', '004'], 'a new migration needs this posture check reviewed');
  const sql = (await Promise.all(names.map(name => read(`../supabase/migrations/${name}`)))).join('\n');
  const tables = [...sql.matchAll(/create table (?:if not exists )?(public\.\w+)/gi)].map(match => match[1]);
  assert.deepEqual(tables.sort(), ['public.monthly_filing_receipts', 'public.receipts', 'public.shared_store_directory']);
  for (const table of tables) assert.match(sql, new RegExp(`alter table ${table.replace('.', '\\.')} enable row level security`, 'i'), `${table} enables row level security`);
  assert.doesNotMatch(sql, /grant [^;]*\bto\b[^;]*\b(anon|public)\b/i, 'no migration grants table or function access to anon or public');
  const policies = [...sql.matchAll(/create policy "[^"]+"\s+on (public\.\w+) for (\w+) to (\w+)([\s\S]*?);/gi)];
  assert.ok(policies.length >= 10, 'policies are present');
  for (const [, table, , role, rest] of policies) {
    assert.equal(role, 'authenticated', `${table} policies apply to authenticated users only`);
    const sharedRead = /shared_store_directory/.test(table);
    assert.ok(/auth\.uid\(\)\)\s*=\s*(user_id|created_by)/i.test(rest) || (sharedRead && /active is true/i.test(rest)), `${table} policy is owner-scoped or an active shared-profile read`);
  }
});

test('SEC-2: no migration defines a privileged (security definer) function, so every RPC runs as the signed-in caller', async () => {
  assert.doesNotMatch(await allMigrations(), /security definer/i);
});

// ---- 5. Coverage matrix integrity: every executable test ID the documentation cites exists --------------------------------------------------------
test('DOC-1: every test cited in docs/07_Regression_Coverage_Matrix.md exists under that file name, and every cited file is a real test file', async () => {
  const matrix = await read('../docs/07_Regression_Coverage_Matrix.md');
  const files = new Set((await readdir(new URL('.', import.meta.url))).filter(name => name.endsWith('.test.mjs') || name.endsWith('.mjs')));
  const citations = [...matrix.matchAll(/`([\w.]+\.test\.mjs)`(?: › "([^"]+)")?/g)];
  assert.ok(citations.length >= 40, 'the matrix cites its evidence');
  for (const [, file, title] of citations) {
    assert.ok(files.has(file), `${file} exists`);
    if (title) assert.ok((await read(`./${file}`)).includes(title), `${file} contains a test titled "${title}"`);
  }
});

test('DOC-2: the documentation states the shipped version, and the roadmap no longer calls merged Milestone 3.6 unmerged', async () => {
  const { appMetadata } = await import('../config/appMetadata.js');
  for (const name of ['04_AI_CONTEXT.md', '07_Regression_Coverage_Matrix.md', '08_Integration_UAT_Checklist.md']) assert.ok((await read(`../docs/${name}`)).includes(appMetadata.version), `${name} cites ${appMetadata.version}`);
  for (const name of ['00_Project_Charter.md', '01_Architecture.md', '02_Roadmap.md', '04_AI_CONTEXT.md', '05_DECISIONS.md', '06_M3.6_Browser_Acceptance.md']) {
    assert.doesNotMatch(await read(`../docs/${name}`), /Milestone 3\.6 is not yet accepted or merged|It is not accepted or merged|not accepted, merged, or declared rolled out|It is not accepted, merged, or declared rolled out/, `${name} has no stale 'not merged' claim`);
  }
});
