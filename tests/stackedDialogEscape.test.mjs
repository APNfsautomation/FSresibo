import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfirmationDialog } from '../ui/confirmationDialog.js';
import { createModalFocus } from '../ui/modalFocus.js';

// Document stand-in with ordered listeners, capture-first dispatch and stopImmediatePropagation, like a browser.
const makeDocument = () => {
  const listeners = [];
  const doc = {
    activeElement: null, body: { children: [] },
    addEventListener: (name, listener, capture = false) => listeners.push({ name, listener, capture }),
    press(key, extra = {}) {
      let stopped = false;
      const event = { key, shiftKey: false, preventDefault() { event.defaultPrevented = true; }, stopImmediatePropagation() { stopped = true; }, ...extra };
      for (const { name, listener } of [...listeners.filter(item => item.capture), ...listeners.filter(item => !item.capture)]) {
        if (name === 'keydown' && !stopped) listener(event);
      }
      return event;
    }
  };
  return doc;
};
const makeElement = (doc, tagName = 'BUTTON') => {
  const attributes = new Map();
  const element = { tagName, hidden: false, disabled: false, isConnected: true, children: [], parentElement: null,
    getAttribute: name => attributes.get(name) ?? null, setAttribute: (name, value) => attributes.set(name, String(value)), removeAttribute: name => attributes.delete(name), hasAttribute: name => attributes.has(name),
    focus() { doc.activeElement = this; }, classList: { toggle() {} }, textContent: '',
    contains(candidate) { return candidate === this || this.children.some(child => child.contains(candidate)); },
    querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]).filter(node => node.tagName === 'BUTTON'); },
    addEventListener() {} };
  return element;
};
const dialogShell = (doc, buttons = 2) => {
  const shell = makeElement(doc, 'SECTION');
  shell.children = Array.from({ length: buttons }, () => { const button = makeElement(doc); button.parentElement = shell; return button; });
  shell.parentElement = doc.body; doc.body.children.push(shell);
  return shell;
};

// Mirrors how receiptUi registers the Edit Receipt and export dialogs with the shared manager.
const makeFixture = () => {
  const doc = makeDocument();
  const page = makeElement(doc, 'MAIN'); const opener = makeElement(doc); opener.parentElement = page; page.children = [opener]; page.parentElement = doc.body; doc.body.children.push(page);
  const lower = dialogShell(doc); const confirmation = dialogShell(doc);
  const modalFocus = createModalFocus({ documentRef: doc, isVisible: element => !element.hidden });
  // A competing document listener of the kind the application used to have; it must never see an Escape the manager handled.
  let competingEscapeCalls = 0;
  doc.addEventListener('keydown', event => { if (event.key === 'Escape') competingEscapeCalls += 1; });
  const lowerOpener = lower.children[0];
  const openLower = () => { lower.hidden = false; modalFocus.open(lower, { trigger: opener, onEscape: closeLower }); lower.children[0].focus(); };
  const closeLower = () => { lower.hidden = true; modalFocus.close(lower); };
  lower.hidden = true; confirmation.hidden = true;
  const [confirmButton, cancelButton] = confirmation.children;
  const dialog = createConfirmationDialog({ modal: confirmation, backdrop: makeElement(doc), title: makeElement(doc), message: makeElement(doc), confirmButton, cancelButton, documentRef: doc, modalFocus });
  return { doc, page, opener, lower, lowerOpener, confirmation, confirmButton, cancelButton, modalFocus, dialog, openLower, closeLower, competing: () => competingEscapeCalls };
};
const settle = () => new Promise(resolve => queueMicrotask(resolve));

test('Escape on a confirmation above Edit Receipt closes only the confirmation', async () => {
  const f = makeFixture();
  f.openLower();
  const pending = f.dialog.confirm({ title: 'Delete?', danger: true, trigger: f.lowerOpener });
  await settle();
  assert.equal(f.confirmation.hidden, false);
  const event = f.doc.press('Escape');
  assert.equal(await pending, false);
  assert.equal(f.confirmation.hidden, true, 'the top dialog closed');
  assert.equal(f.lower.hidden, false, 'the underlying dialog stays open');
  assert.equal(f.modalFocus.isOpen(), true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.competing(), 0, 'the same Escape event never reaches another listener');
});

test('after the top dialog closes, focus is back in the underlying dialog, which is active while the page stays inert', async () => {
  const f = makeFixture();
  f.openLower();
  const pending = f.dialog.confirm({ title: 'Delete?', trigger: f.lowerOpener });
  await settle();
  assert.equal(f.lower.hasAttribute('inert'), true, 'the lower dialog is inert while the confirmation is on top');
  assert.equal(f.page.hasAttribute('inert'), true);
  f.doc.press('Escape');
  await pending;
  assert.equal(f.doc.activeElement, f.lowerOpener, 'focus returns to the control inside the underlying dialog');
  assert.equal(f.lower.hasAttribute('inert'), false, 'the underlying dialog is usable again');
  assert.equal(f.page.hasAttribute('inert'), true, 'the page stays inert while any dialog remains');
  // focus containment now applies to the underlying dialog
  f.doc.activeElement = f.lower.children[1];
  f.doc.press('Tab');
  assert.equal(f.doc.activeElement, f.lower.children[0]);
});

test('a second Escape closes the remaining dialog and releases the page', async () => {
  const f = makeFixture();
  f.openLower();
  const pending = f.dialog.confirm({ title: 'Delete?', trigger: f.lowerOpener });
  await settle();
  f.doc.press('Escape');
  await pending;
  f.doc.press('Escape');
  assert.equal(f.lower.hidden, true);
  assert.equal(f.modalFocus.isOpen(), false);
  assert.equal(f.page.hasAttribute('inert'), false);
  assert.equal(f.doc.activeElement, f.opener, 'focus returns to the control that opened the first dialog');
  assert.equal(f.competing(), 0);
});

test('confirmation above the export confirmation behaves the same way', async () => {
  const f = makeFixture();
  f.openLower();                                              // stands in for the export confirmation
  const pending = f.dialog.confirm({ title: 'Mark Available?', trigger: f.lowerOpener });
  await settle();
  f.doc.press('Escape');
  assert.equal(await pending, false);
  assert.equal(f.lower.hidden, false);
  assert.equal(f.doc.activeElement, f.lowerOpener);
  f.doc.press('Escape');
  assert.equal(f.lower.hidden, true);
});

test('single-dialog Escape is unchanged, and Escape with no dialog does nothing', async () => {
  const f = makeFixture();
  const event = f.doc.press('Escape');
  assert.equal(event.defaultPrevented, undefined, 'nothing open: the event is left alone');
  assert.equal(f.competing(), 1, 'other listeners still see an Escape when no dialog is open');
  f.opener.focus();
  const pending = f.dialog.confirm({ title: 'Clear?', trigger: f.opener });
  await settle();
  f.doc.press('Escape');
  assert.equal(await pending, false);
  assert.equal(f.confirmation.hidden, true);
  assert.equal(f.doc.activeElement, f.opener);
  assert.equal(f.page.hasAttribute('inert'), false);
});

test('Cancel and Confirm still resolve and release exactly one dialog when stacked', async () => {
  const f = makeFixture();
  f.openLower();
  let pending = f.dialog.confirm({ title: 'Delete?', trigger: f.lowerOpener });
  await settle();
  // the stand-in buttons carry no listeners, so drive the dialog's own close through its public API
  f.dialog.close(false);
  assert.equal(await pending, false);
  assert.equal(f.lower.hidden, false);
  pending = f.dialog.confirm({ title: 'Delete again?', trigger: f.lowerOpener });
  await settle();
  f.dialog.close(true);
  assert.equal(await pending, true);
  assert.equal(f.lower.hidden, false, 'confirming the top dialog never closes the dialog beneath it');
  assert.equal(f.modalFocus.isOpen(), true);
});

test('Tab containment stays with the top dialog while stacked', async () => {
  const f = makeFixture();
  f.openLower();
  f.dialog.confirm({ title: 'Delete?', trigger: f.lowerOpener });
  await settle();
  f.doc.activeElement = f.cancelButton;                       // last control of the confirmation
  f.doc.press('Tab');
  assert.equal(f.doc.activeElement, f.confirmButton, 'wraps inside the confirmation, not into the dialog beneath');
  f.doc.activeElement = f.lower.children[0];
  f.doc.press('Tab');
  assert.ok(f.confirmation.contains(f.doc.activeElement), 'focus that strays into the inert lower dialog is pulled back to the top dialog');
});
