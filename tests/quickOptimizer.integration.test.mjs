import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createApplicationWorkspaces } from '../ui/applicationWorkspaces.js';
import { createNavigationController, receiptRoutes } from '../ui/navigationController.js';
import { createQuickOptimizerUi } from '../ui/quickOptimizerUi.js';
import { availableReceiptTotalCents, availableOptimizerReceipts } from '../ui/receiptUi.js';

const eventTarget = () => {
  const listeners = new Map();
  return { addEventListener: (name, callback) => listeners.set(name, callback), emit: (name, event = {}) => listeners.get(name)?.(event) };
};
const element = () => ({ hidden: false, attributes: {}, focused: false, ...eventTarget(), setAttribute(name, value) { this.attributes[name] = value; }, focus() { this.focused = true; } });
function setup(hash = '#quick-optimizer', mobile = false) {
  const location = { href: `https://example.test/${hash}`, hash };
  const window = { location, ...eventTarget(), matchMedia: () => ({ matches: mobile }), history: { replaceState(_state, _title, url) { location.href = String(url); location.hash = url.hash; } } };
  const document = { title: 'FSResibo', ...eventTarget() };
  const elements = Object.fromEntries(['menuButton', 'drawer', 'drawerBackdrop', 'receiptsNav', 'monthlyNav', 'quickNav', 'encodingTab', 'optimizationTab'].map(name => [name, element()]));
  const visible = {};
  const receiptWorkspaces = [];
  const quick = createQuickOptimizerUi({ nextFrame: async () => {} });
  const composition = createApplicationWorkspaces({
    receiptUi: { setModuleVisible: value => { visible.receipts = value; }, setWorkspace: value => receiptWorkspaces.push(value) },
    monthlyFilingUi: { setVisible: value => { visible.monthly = value; } },
    quickOptimizerUi: { ...quick, setModuleVisible: value => { visible.quick = value; } }
  });
  const controller = createNavigationController({ window, document, elements, onRoute: composition.renderRoute });
  const route = hash => { location.hash = hash; location.href = `https://example.test/${hash}`; window.emit('hashchange'); };
  return { controller, composition, quick, visible, receiptWorkspaces, elements, route, window, document };
}

test('Quick direct link shows only Quick and marks only its desktop navigation current', () => {
  const app = setup(); app.controller.start({ fallbackRoute: receiptRoutes.optimization });
  assert.equal(app.controller.activeRoute, 'quick-optimizer');
  assert.deepEqual(app.visible, { receipts: false, monthly: false, quick: true });
  assert.equal(app.elements.quickNav.attributes['aria-current'], 'page');
  assert.equal(app.elements.receiptsNav.attributes['aria-current'], 'false');
  assert.equal(app.elements.monthlyNav.attributes['aria-current'], 'false');
  assert.equal(app.elements.drawer.hidden, false);
});

test('hash history and receipt tabs restore visibility without replacing temporary state', async () => {
  const app = setup(); app.composition.setUser('user-a'); app.controller.start();
  app.quick.setTarget('1000'); app.quick.appendBulk('500\n500\n1040'); await app.quick.calculate();
  app.quick.selectResult(1); const before = app.quick.getState();
  app.route('#receipts/encoding'); assert.deepEqual(app.visible, { receipts: true, monthly: false, quick: false });
  app.elements.optimizationTab.emit('click'); assert.equal(app.window.location.hash, receiptRoutes.optimization);
  app.route('#receipts/optimization'); assert.equal(app.receiptWorkspaces.at(-1), 'optimization');
  app.route('#monthly-filing'); assert.deepEqual(app.visible, { receipts: false, monthly: true, quick: false });
  assert.equal(app.elements.optimizationTab.attributes['aria-selected'], 'true');
  app.route('#quick-optimizer'); assert.deepEqual(app.quick.getState(), before);
  // Hashchange is the event emitted by Back/Forward; replay both directions.
  app.route('#monthly-filing'); app.route('#quick-optimizer');
  assert.deepEqual(app.quick.getState(), before);
  app.route('#unknown'); assert.equal(app.controller.activeRoute, receiptRoutes.encoding);
  assert.equal(app.elements.receiptsNav.attributes['aria-current'], 'page');
  assert.equal(app.elements.quickNav.attributes['aria-current'], 'false');
  app.route('#store-directory'); assert.equal(app.controller.activeRoute, receiptRoutes.encoding);
});

test('mobile Quick navigation closes drawer, restores focus, and Escape/backdrop still work', () => {
  const app = setup('#receipts/encoding', true); app.controller.start();
  app.elements.menuButton.emit('click'); assert.equal(app.elements.drawer.hidden, false);
  app.elements.quickNav.emit('click'); assert.equal(app.window.location.hash, 'quick-optimizer');
  assert.equal(app.elements.drawer.hidden, true); assert.equal(app.elements.menuButton.focused, true);
  app.route('#quick-optimizer'); assert.equal(app.elements.quickNav.attributes['aria-current'], 'page');
  app.controller.setDrawer(true); app.document.emit('keydown', { key: 'Escape' }); assert.equal(app.elements.drawer.hidden, true);
  app.controller.setDrawer(true); app.elements.drawerBackdrop.emit('click'); assert.equal(app.elements.drawer.hidden, true);
});

test('authentication callbacks win over direct links and never get normalized away', () => {
  for (const hash of ['#access_token=token&refresh_token=refresh&type=recovery', '#error=access_denied']) {
    const app = setup(hash); assert.equal(app.controller.start(), false);
    assert.equal(app.window.location.hash, hash); assert.deepEqual(app.visible, {});
  }
  const app = setup(); app.window.location.href = 'https://example.test/?auth=recovery#quick-optimizer';
  assert.equal(app.controller.start(), false); assert.deepEqual(app.visible, {});
});

test('same account retains calculator; account switch, logout and repeated null cleanup clear it', async () => {
  const app = setup(); app.composition.setUser('user-a');
  app.quick.setTarget('1000'); app.quick.appendBulk('1000'); await app.quick.calculate();
  const before = app.quick.getState(); app.composition.setUser('user-a'); assert.deepEqual(app.quick.getState(), before);
  app.composition.setUser('user-b'); assert.deepEqual(app.quick.getState(), createQuickOptimizerUi().getState());
  app.quick.setTarget('10'); app.composition.clearForLogout();
  assert.deepEqual(app.quick.getState(), createQuickOptimizerUi().getState());
  assert.deepEqual(app.visible, { receipts: false, monthly: false, quick: false });
  app.quick.setTarget('20'); app.composition.clearForLogout(); assert.equal(app.quick.getState().target, '');
});

test('Quick mutations and routing cannot alter long-term receipts or Monthly Filing records', async () => {
  const app = setup();
  const receipts = [{ index: 0, cents: 50000, status: 'available' }, { index: 1, cents: 90000, status: 'consumed' }];
  const monthly = [{ dbId: 'monthly-id', amount: '700', status: 'active' }];
  const snapshot = structuredClone({ receipts, monthly });
  app.controller.start(); app.quick.setTarget('1000'); app.quick.appendBulk('1000\n2000'); await app.quick.calculate();
  app.route('#monthly-filing'); app.route('#receipts/optimization'); app.quick.clear();
  assert.deepEqual({ receipts, monthly }, snapshot);
  assert.equal(availableReceiptTotalCents(receipts), 50000);
  assert.deepEqual(availableOptimizerReceipts(receipts), [receipts[0]]);
});

test('app composes one calculator and uses cleanup paths; HTML exposes the contracted navigation and root', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal([...app.matchAll(/createQuickOptimizerUi\(\{/g)].length, 1);
  assert.match(app, /root: document.querySelector\('#quickOptimizerWorkspace'\)/);
  assert.match(app, /onRoute: applicationWorkspaces.renderRoute/);
  assert.match(app, /applicationWorkspaces.setUser\(user.id\)/);
  assert.match(app, /event === 'SIGNED_OUT'[\s\S]*?applicationWorkspaces.clearForLogout\(\)/);
  assert.match(app, /else \{\s*activeUserId = undefined;[\s\S]*?applicationWorkspaces.clearForLogout\(\)/);
  assert.match(html, /id="quickOptimizerNavigationItem"[^>]*>Quick Optimizer<\/button>/);
  assert.match(html, /id="quickOptimizerWorkspace" hidden/);
});

test('actual app bootstrap uses one calculator and clears it on auth events and logout', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const nodes = new Map();
  const document = { title: 'FSResibo', querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  } };
  const window = { location: { href: 'https://example.test/#quick-optimizer' }, history: { replaceState() {} }, setTimeout };
  const noop = () => {};
  let instances = 0, subscription;
  const routeCallbacks = [];
  const auth = { show: noop, hide: noop, setMessage: noop, showRecovery: noop, showRecoveryUnavailable: noop };
  const receipt = { setModuleVisible: noop, setWorkspace: noop, clearForLogout: noop, start: noop,
    loadForUser: async () => {}, importLegacyDraft: async () => {}, consumeLegacyWorkspace: () => 'encoding' };
  const monthly = { setVisible: noop, clearForLogout: noop, start: noop, loadForUser: async () => {} };
  const dependencies = {
    document, window, isSupabaseConfigured: () => true, supabaseConfig: {}, appMetadata: { name: 'FSResibo', version: '3.6.0-beta.1' },
    authRedirectUrl: () => 'https://example.test/', getCurrentSession: async () => ({ user: { id: 'a', email: 'a@example.test' } }),
    hasPasswordRecoveryIntent: () => false, login: noop, logout: async () => {},
    onAuthStateChange: async callback => { subscription = callback; }, recoveryCallbackError: () => null,
    register: noop, requestPasswordReset: noop, updatePassword: noop, scanPrintedDetails: noop,
    downloadExpenseDetailedReport: noop, downloadSelectedReceipts: noop, findBest: noop, optimizationStrategies: {}, toCents: noop,
    receiptService: {}, monthlyFilingService: {}, sharedStoreService: {}, renderApplicationIdentity: noop, renderApplicationName: noop,
    createAuthPanel: () => auth, createConfirmationDialog: () => ({ confirm: noop }), createModalFocus: () => ({ open: noop, close: noop }),
    createNavigationController: ({ onRoute }) => ({ start() { routeCallbacks.push(onRoute); onRoute('quick-optimizer', { module: 'quick-optimizer' }); } }),
    receiptRoutes, createReceiptUi: () => receipt, createMonthlyFilingUi: () => monthly,
    createQuickOptimizerUi: () => { instances++; return createQuickOptimizerUi({ nextFrame: async () => {} }); },
    createApplicationWorkspaces, createThemeController: () => ({ restore: noop })
  };
  // Execute the real composition/bootstrap with imported services replaced by inert
  // test doubles. This never authenticates or reads a hosted database.
  const body = source.replace(/^import .*;\r?$/gm, '') + '\nreturn { handleAuthState, quickOptimizerUi };';
  const app = new Function(...Object.keys(dependencies), body)(...Object.values(dependencies));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(instances, 1); assert.equal(typeof subscription, 'function');
  assert.equal(routeCallbacks.length, 1);
  app.quickOptimizerUi.setTarget('1000'); app.quickOptimizerUi.appendBulk('1000'); await app.quickOptimizerUi.calculate();
  const before = app.quickOptimizerUi.getState();
  await app.handleAuthState('TOKEN_REFRESHED', { user: { id: 'a' } });
  assert.deepEqual(app.quickOptimizerUi.getState(), before);
  await app.handleAuthState('SIGNED_IN', { user: { id: 'b' } });
  assert.equal(instances, 1); assert.equal(app.quickOptimizerUi.getState().target, '');
  app.quickOptimizerUi.setTarget('100'); await app.handleAuthState('SIGNED_OUT', null);
  assert.equal(app.quickOptimizerUi.getState().target, '');
  app.quickOptimizerUi.setTarget('200'); await app.handleAuthState('INITIAL_SESSION', null);
  assert.equal(app.quickOptimizerUi.getState().target, '');
  app.quickOptimizerUi.setTarget('300'); await nodes.get('#logout').emit('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.quickOptimizerUi.getState().target, '');
  app.quickOptimizerUi.setTarget('400'); await app.handleAuthState('PASSWORD_RECOVERY', { user: { id: 'b' } });
  assert.equal(app.quickOptimizerUi.getState().target, '');
});
