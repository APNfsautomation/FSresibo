import assert from 'node:assert/strict';
import test from 'node:test';
import { installTablistKeyboard, nextTabIndex, syncRovingTabIndex } from '../ui/tablistKeyboard.js';
import { createNavigationController, receiptRoutes } from '../ui/navigationController.js';

const tab = () => {
  const listeners = new Map();
  return { tabIndex: 0, focusCount: 0, attributes: new Map(), addEventListener: (name, listener) => listeners.set(name, listener),
    emit(name, event = {}) { const prevented = { value: false }; listeners.get(name)?.({ preventDefault() { prevented.value = true; }, ...event }); return prevented.value; },
    focus() { this.focusCount += 1; }, setAttribute(name, value) { this.attributes.set(name, value); }, getAttribute(name) { return this.attributes.get(name) ?? null; } };
};

test('arrow keys wrap, Home and End jump, other keys are ignored', () => {
  assert.equal(nextTabIndex('ArrowRight', 0, 2), 1);
  assert.equal(nextTabIndex('ArrowRight', 1, 2), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 2), 1);
  assert.equal(nextTabIndex('ArrowLeft', 1, 2), 0);
  assert.equal(nextTabIndex('Home', 1, 3), 0);
  assert.equal(nextTabIndex('End', 0, 3), 2);
  assert.equal(nextTabIndex('Enter', 0, 3), -1);
  assert.equal(nextTabIndex('ArrowRight', -1, 3), -1);
  assert.equal(nextTabIndex('ArrowRight', 0, 0), -1);
});

test('roving tabindex keeps only the selected tab in the Tab order', () => {
  const tabs = [tab(), tab(), tab()];
  syncRovingTabIndex(tabs, 1);
  assert.deepEqual(tabs.map(item => item.tabIndex), [-1, 0, -1]);
  syncRovingTabIndex(tabs, 2);
  assert.deepEqual(tabs.map(item => item.tabIndex), [-1, -1, 0]);
});

test('keyboard activation performs the tab action and moves focus; modifier keys and unrelated keys are left alone', () => {
  const tabs = [tab(), tab()];
  const activated = [];
  installTablistKeyboard({ tabs, activate: index => activated.push(index) });
  assert.equal(tabs[0].emit('keydown', { key: 'ArrowRight' }), true);
  assert.deepEqual(activated, [1]);
  assert.equal(tabs[1].focusCount, 1);
  tabs[1].emit('keydown', { key: 'Home' });
  assert.deepEqual(activated, [1, 0]);
  assert.equal(tabs[0].focusCount, 1);
  tabs[0].emit('keydown', { key: 'Home' });                       // already on the first tab: no activation, focus stays
  assert.deepEqual(activated, [1, 0]);
  assert.equal(tabs[0].emit('keydown', { key: 'ArrowRight', ctrlKey: true }), false);
  assert.equal(tabs[0].emit('keydown', { key: 'a' }), false);
  assert.deepEqual(activated, [1, 0]);
});

test('a refused activation (for example while a save is pending) does not move focus', () => {
  const tabs = [tab(), tab()];
  installTablistKeyboard({ tabs, activate: () => false });
  tabs[0].emit('keydown', { key: 'ArrowRight' });
  assert.equal(tabs[1].focusCount, 0);
});

const element = () => ({ hidden: false, ...tab() });
const makeController = () => {
  const listeners = new Map();
  const events = { addEventListener: (name, listener) => listeners.set(name, listener), emit: (name, event = {}) => listeners.get(name)?.(event) };
  const document = { title: 'FSResibo', ...events };
  const location = { href: 'https://example.test/#receipts/encoding', hash: '#receipts/encoding' };
  const windowEvents = new Map();
  const window = { location, addEventListener: (name, listener) => windowEvents.set(name, listener), emit: name => windowEvents.get(name)?.(), matchMedia: () => ({ matches: false }), history: { replaceState: (_state, _title, url) => { location.href = String(url); location.hash = new URL(String(url)).hash; } } };
  const elements = { menuButton: element(), drawer: element(), drawerBackdrop: element(), receiptsNav: element(), monthlyNav: element(), quickNav: element(), encodingTab: element(), optimizationTab: element() };
  const routes = [];
  const controller = createNavigationController({ window, document, elements, onRoute: workspace => routes.push(workspace) });
  controller.start();
  return { controller, elements, window, location, routes };
};

test('Receipt Encoding / Optimization tabs: arrows, Home and End change the route and selected tab, and click still works', () => {
  const { elements, window, location, routes } = makeController();
  assert.deepEqual([elements.encodingTab.tabIndex, elements.optimizationTab.tabIndex], [0, -1]);
  elements.encodingTab.emit('keydown', { key: 'ArrowRight' });
  assert.equal(location.hash, receiptRoutes.optimization);
  window.emit('hashchange');
  assert.equal(elements.optimizationTab.getAttribute('aria-selected'), 'true');
  assert.equal(elements.encodingTab.getAttribute('aria-selected'), 'false');
  assert.deepEqual([elements.encodingTab.tabIndex, elements.optimizationTab.tabIndex], [-1, 0]);
  assert.equal(elements.optimizationTab.focusCount, 1, 'focus follows the activated tab');
  elements.optimizationTab.emit('keydown', { key: 'Home' });
  window.emit('hashchange');
  assert.equal(location.hash, receiptRoutes.encoding);
  assert.deepEqual([elements.encodingTab.tabIndex, elements.optimizationTab.tabIndex], [0, -1]);
  elements.encodingTab.emit('keydown', { key: 'End' });
  window.emit('hashchange');
  assert.equal(location.hash, receiptRoutes.optimization);
  elements.optimizationTab.emit('click');
  assert.equal(location.hash, receiptRoutes.optimization, 'click on the current tab is unchanged');
  elements.encodingTab.emit('click');
  window.emit('hashchange');
  assert.equal(location.hash, receiptRoutes.encoding);
  assert.deepEqual(routes.filter(Boolean).slice(-1), ['encoding']);
});
