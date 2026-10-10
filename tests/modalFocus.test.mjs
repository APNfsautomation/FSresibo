import assert from 'node:assert/strict';
import test from 'node:test';
import { createModalFocus, isTabbable, tabbableWithin } from '../ui/modalFocus.js';

// Minimal DOM stand-ins: enough tree structure for focus order, containment and inert bookkeeping.
const makeDocument = () => {
  const listeners = new Map();
  const doc = {
    activeElement: null,
    body: { children: [] },
    addEventListener: (name, listener) => listeners.set(name, listener),
    emitKeydown(event) { const defaultPrevented = { value: false }; listeners.get('keydown')({ preventDefault() { defaultPrevented.value = true; }, ...event }); return defaultPrevented.value; }
  };
  return doc;
};
const makeElement = (doc, { tagName = 'BUTTON', ...props } = {}) => {
  const attributes = new Map(Object.entries(props.attributes ?? {}));
  const element = {
    tagName, hidden: false, disabled: false, isConnected: true, children: [], parentElement: null, ...props,
    getAttribute: name => attributes.has(name) ? attributes.get(name) : null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: name => attributes.delete(name),
    hasAttribute: name => attributes.has(name),
    focus() { doc.activeElement = this; },
    contains(candidate) { return candidate === this || this.children.some(child => child.contains?.(candidate)); },
    querySelectorAll() { return flatten(this).filter(node => node !== this && ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'SUMMARY'].includes(node.tagName)); }
  };
  return element;
};
const flatten = node => [node, ...node.children.flatMap(flatten)];
const adopt = (parent, ...children) => { children.forEach(child => { child.parentElement = parent; parent.children.push(child); }); return parent; };
const visible = element => !element.hidden;

const buildPage = () => {
  const doc = makeDocument();
  const pageButton = makeElement(doc);
  const app = adopt(makeElement(doc, { tagName: 'MAIN' }), pageButton);
  const script = makeElement(doc, { tagName: 'SCRIPT' });
  const first = makeElement(doc); const middle = makeElement(doc, { tagName: 'INPUT' }); const last = makeElement(doc);
  const modal = adopt(makeElement(doc, { tagName: 'SECTION' }), first, middle, last);
  doc.body.children.push(app, modal, script);
  app.parentElement = modal.parentElement = script.parentElement = doc.body;
  return { doc, app, pageButton, script, modal, first, middle, last, manager: createModalFocus({ documentRef: doc, isVisible: visible }) };
};

test('tabbable detection skips disabled, hidden, hidden-input and negative-tabindex controls', () => {
  const doc = makeDocument();
  assert.equal(isTabbable(makeElement(doc), visible), true);
  assert.equal(isTabbable(makeElement(doc, { disabled: true }), visible), false);
  assert.equal(isTabbable(makeElement(doc, { hidden: true }), visible), false);
  assert.equal(isTabbable(makeElement(doc, { tagName: 'INPUT', type: 'hidden' }), visible), false);
  assert.equal(isTabbable(makeElement(doc, { attributes: { tabindex: '-1' } }), visible), false);
  const container = adopt(makeElement(doc, { tagName: 'SECTION' }), makeElement(doc), makeElement(doc, { disabled: true }), makeElement(doc, { hidden: true }));
  assert.equal(tabbableWithin(container, visible).length, 1);
});

test('Tab and Shift+Tab wrap inside the open dialog and never leave it', () => {
  const { doc, modal, first, middle, last, manager } = buildPage();
  manager.open(modal, { initialFocus: first });
  assert.equal(doc.activeElement, first);

  doc.activeElement = last;
  assert.equal(doc.emitKeydown({ key: 'Tab', shiftKey: false }), true);
  assert.equal(doc.activeElement, first, 'Tab on the last control wraps to the first');

  doc.activeElement = first;
  assert.equal(doc.emitKeydown({ key: 'Tab', shiftKey: true }), true);
  assert.equal(doc.activeElement, last, 'Shift+Tab on the first control wraps to the last');

  doc.activeElement = middle;
  assert.equal(doc.emitKeydown({ key: 'Tab', shiftKey: false }), false, 'Tab inside the dialog keeps native behavior');
  assert.equal(doc.activeElement, middle);
});

test('focus that has escaped the dialog is pulled back to its first or last control', () => {
  const { doc, modal, first, last, pageButton, manager } = buildPage();
  manager.open(modal);
  doc.activeElement = pageButton;
  doc.emitKeydown({ key: 'Tab', shiftKey: false });
  assert.equal(doc.activeElement, first);
  doc.activeElement = pageButton;
  doc.emitKeydown({ key: 'Tab', shiftKey: true });
  assert.equal(doc.activeElement, last);
});

test('Tab handling is inactive when no dialog is open or when modifier keys are used', () => {
  const { doc, modal, last, manager } = buildPage();
  doc.activeElement = last;
  assert.equal(doc.emitKeydown({ key: 'Tab' }), false);
  manager.open(modal);
  assert.equal(doc.emitKeydown({ key: 'Tab', ctrlKey: true }), false);
  assert.equal(doc.emitKeydown({ key: 'Enter' }), false);
  assert.equal(manager.isOpen(), true);
});

test('a dialog with nothing to tab to keeps focus on the dialog itself', () => {
  const doc = makeDocument();
  const modal = makeElement(doc, { tagName: 'SECTION' });
  doc.body.children.push(modal); modal.parentElement = doc.body;
  const manager = createModalFocus({ documentRef: doc, isVisible: visible });
  manager.open(modal);
  assert.equal(doc.emitKeydown({ key: 'Tab' }), true);
  assert.equal(doc.activeElement, modal);
});

test('the page behind an open dialog is inert, scripts are left alone, and closing restores only what was changed', () => {
  const { app, script, modal, manager } = buildPage();
  manager.open(modal);
  assert.equal(app.hasAttribute('inert'), true);
  assert.equal(modal.hasAttribute('inert'), false);
  assert.equal(script.hasAttribute('inert'), false);
  manager.close(modal);
  assert.equal(app.hasAttribute('inert'), false);
  assert.equal(manager.isOpen(), false);
});

test('stacked dialogs: the lower dialog is inert while another is open and usable again afterward', () => {
  const { doc, app, modal, manager } = buildPage();
  const second = adopt(makeElement(doc, { tagName: 'SECTION' }), makeElement(doc));
  doc.body.children.push(second); second.parentElement = doc.body;
  manager.open(modal);
  manager.open(second);
  assert.equal(modal.hasAttribute('inert'), true);
  assert.equal(second.hasAttribute('inert'), false);
  manager.close(second);
  assert.equal(modal.hasAttribute('inert'), false);
  assert.equal(app.hasAttribute('inert'), true, 'the page stays inert while the first dialog is still open');
  manager.close(modal);
  assert.equal(app.hasAttribute('inert'), false);
});

test('closing restores focus to the opening control, or to the fallback when it is gone or disabled', () => {
  const { doc, modal, pageButton, manager } = buildPage();
  const fallback = makeElement(doc);
  manager.open(modal, { trigger: pageButton, fallback });
  manager.close(modal);
  assert.equal(doc.activeElement, pageButton);

  doc.activeElement = null;
  manager.open(modal, { trigger: pageButton, fallback });
  pageButton.disabled = true;
  manager.close(modal);
  assert.equal(doc.activeElement, fallback, 'a disabled trigger falls back');

  pageButton.disabled = false; doc.activeElement = null;
  manager.open(modal, { trigger: pageButton, fallback });
  pageButton.isConnected = false;
  manager.close(modal);
  assert.equal(doc.activeElement, fallback, 'a removed trigger falls back');

  pageButton.isConnected = true; doc.activeElement = null;
  manager.open(modal, { trigger: pageButton });
  manager.close(modal, { restoreFocus: false });
  assert.equal(doc.activeElement, null, 'restoration can be skipped');
  manager.close(modal); // closing twice is harmless
});
