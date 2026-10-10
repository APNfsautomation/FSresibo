import assert from 'node:assert/strict';
import test from 'node:test';
import { createMonthlyFilingUi } from '../ui/monthlyFilingUi.js';

globalThis.document = { createElement: () => ({ className: '', textContent: '', hidden: false, matches: () => false }) };

const control = () => {
  const listeners = new Map();
  return { hidden: false, disabled: false, textContent: '', tabIndex: 0, focusCount: 0, attributes: new Map(), children: [],
    addEventListener: (name, listener) => listeners.set(name, listener),
    emit(name, event = {}) { listeners.get(name)?.({ preventDefault() {}, currentTarget: this, ...event }); },
    setAttribute(name, value) { this.attributes.set(name, value); }, getAttribute(name) { return this.attributes.get(name) ?? null; },
    focus() { this.focusCount += 1; }, replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } };
};
const makeUi = () => {
  const elements = Object.fromEntries(['workspace', 'list', 'template', 'activeTab', 'archivedTab', 'activeActions', 'archivedActions', 'exportHelper', 'add', 'save', 'exportActive', 'clearArchived', 'clearAll', 'feedback'].map(name => [name, control()]));
  const ui = createMonthlyFilingUi({ elements, monthlyFilingService: {}, sharedStoreService: {}, downloadExpenseDetailedReport() {}, confirmAction: async () => false });
  ui.start();
  return { ui, elements };
};
const tabState = ({ activeTab, archivedTab }) => ({ active: activeTab.getAttribute('aria-selected'), archived: archivedTab.getAttribute('aria-selected'), tabindex: [activeTab.tabIndex, archivedTab.tabIndex] });

test('Monthly Filing Active/Archived tabs support Arrow, Home and End with a roving tabindex, preserving click behavior', () => {
  const { elements } = makeUi();
  assert.deepEqual(tabState(elements), { active: 'true', archived: 'false', tabindex: [0, -1] });

  elements.activeTab.emit('keydown', { key: 'ArrowRight' });
  assert.deepEqual(tabState(elements), { active: 'false', archived: 'true', tabindex: [-1, 0] });
  assert.equal(elements.archivedTab.focusCount > 0, true, 'focus lands on the newly selected tab');
  assert.equal(elements.archivedActions.hidden, false, 'the Archived view is shown');
  assert.equal(elements.activeActions.hidden, true);

  elements.archivedTab.emit('keydown', { key: 'ArrowLeft' });
  assert.deepEqual(tabState(elements), { active: 'true', archived: 'false', tabindex: [0, -1] });

  elements.activeTab.emit('keydown', { key: 'End' });
  assert.deepEqual(tabState(elements), { active: 'false', archived: 'true', tabindex: [-1, 0] });
  elements.archivedTab.emit('keydown', { key: 'Home' });
  assert.deepEqual(tabState(elements), { active: 'true', archived: 'false', tabindex: [0, -1] });

  elements.archivedTab.emit('click');
  assert.deepEqual(tabState(elements), { active: 'false', archived: 'true', tabindex: [-1, 0] });
  elements.activeTab.emit('click');
  assert.deepEqual(tabState(elements), { active: 'true', archived: 'false', tabindex: [0, -1] });
});

test('unrelated keys and modifier combinations do not switch Monthly Filing views', () => {
  const { elements } = makeUi();
  elements.activeTab.emit('keydown', { key: 'a' });
  elements.activeTab.emit('keydown', { key: 'ArrowRight', altKey: true });
  assert.deepEqual(tabState(elements), { active: 'true', archived: 'false', tabindex: [0, -1] });
});
