import assert from 'node:assert/strict';
import test from 'node:test';
import { createNavigationController, isAuthenticationCallbackLocation, receiptRoutes, routeFromHash, routeRegistry } from '../ui/navigationController.js';

const eventTarget = () => {
  const listeners = new Map();
  return { addEventListener: (name, callback) => listeners.set(name, callback), emit: (name, event = {}) => listeners.get(name)?.(event) };
};

const element = () => ({ hidden: false, attributes: new Map(), focused: false, ...eventTarget(), setAttribute(name, value) { this.attributes.set(name, value); }, getAttribute(name) { return this.attributes.get(name); }, focus() { this.focused = true; } });

test('empty and unknown application routes normalize safely to Receipt Encoding', () => {
  assert.deepEqual(routeFromHash(''), { route: receiptRoutes.encoding, normalized: true });
  assert.deepEqual(routeFromHash('#not-a-route'), { route: receiptRoutes.encoding, normalized: true });
  assert.deepEqual(routeFromHash('#monthly-filing'), { route: receiptRoutes.encoding, normalized: true });
  assert.equal(routeRegistry['monthly-filing'].available, false);
  assert.equal(routeRegistry['quick-optimizer'].available, false);
  assert.equal(routeRegistry['store-directory'].available, false);
});

test('receipt Encoding and Optimization routes resolve independently', () => {
  assert.deepEqual(routeFromHash('#receipts/encoding'), { route: receiptRoutes.encoding, normalized: false });
  assert.deepEqual(routeFromHash('#receipts/optimization'), { route: receiptRoutes.optimization, normalized: false });
});

test('Supabase recovery and session fragments are never treated as application routes', () => {
  assert.equal(isAuthenticationCallbackLocation({ href: 'https://example.test/#access_token=token&refresh_token=refresh&type=recovery' }), true);
  assert.equal(isAuthenticationCallbackLocation({ href: 'https://example.test/#error=access_denied&error_description=expired' }), true);
  assert.equal(isAuthenticationCallbackLocation({ href: 'https://example.test/?auth=recovery' }), true);
  assert.equal(isAuthenticationCallbackLocation({ href: 'https://example.test/#receipts/encoding' }), false);
});

test('mobile drawer tracks ARIA state, closes on Escape, and restores trigger focus', () => {
  const document = { title: 'FSResibo', ...eventTarget() };
  const location = { href: 'https://example.test/#receipts/encoding', hash: '#receipts/encoding' };
  const window = { location, ...eventTarget(), matchMedia: () => ({ matches: true }), history: { replaceState: (_state, _title, url) => { location.href = String(url); location.hash = new URL(String(url)).hash; } } };
  const elements = { menuButton: element(), drawer: element(), drawerBackdrop: element(), receiptsNav: element(), encodingTab: element(), optimizationTab: element() };
  const controller = createNavigationController({ window, document, elements, onRoute: () => {} });
  controller.start();
  assert.equal(elements.drawer.hidden, true);
  assert.equal(elements.menuButton.getAttribute('aria-expanded'), 'false');
  controller.setDrawer(true);
  assert.equal(elements.drawer.hidden, false);
  assert.equal(elements.drawer.getAttribute('aria-hidden'), 'false');
  document.emit('keydown', { key: 'Escape' });
  assert.equal(elements.drawer.hidden, true);
  assert.equal(elements.menuButton.focused, true);
});

test('an explicit URL beats a legacy workspace fallback and hash history changes switch workspaces', () => {
  const document = { title: 'FSResibo', ...eventTarget() };
  const location = { href: 'https://example.test/#receipts/encoding', hash: '#receipts/encoding' };
  const window = { location, ...eventTarget(), matchMedia: () => ({ matches: false }), history: { replaceState: (_state, _title, url) => { location.href = String(url); location.hash = new URL(String(url)).hash; } } };
  const elements = { menuButton: element(), drawer: element(), drawerBackdrop: element(), receiptsNav: element(), encodingTab: element(), optimizationTab: element() };
  const workspaces = [];
  const controller = createNavigationController({ window, document, elements, onRoute: workspace => workspaces.push(workspace) });
  controller.start({ fallbackRoute: receiptRoutes.optimization });
  assert.equal(controller.activeRoute, receiptRoutes.encoding);
  location.hash = '#receipts/optimization';
  window.emit('hashchange');
  assert.equal(controller.activeRoute, receiptRoutes.optimization);
  assert.deepEqual(workspaces, ['encoding', 'optimization']);
});
