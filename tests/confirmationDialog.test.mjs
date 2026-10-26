import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createConfirmationDialog } from '../ui/confirmationDialog.js';

const eventTarget = () => {
  const listeners = new Map();
  return {
    addEventListener: (name, listener) => listeners.set(name, listener),
    emit: (name, event = {}) => listeners.get(name)?.({ preventDefault() {}, ...event })
  };
};
const button = () => ({ textContent: '', disabled: false, focusCount: 0, attributes: new Map(), focus() { this.focusCount += 1; }, setAttribute(name, value) { this.attributes.set(name, value); }, removeAttribute(name) { this.attributes.delete(name); }, ...eventTarget() });
const createFixture = () => {
  const trigger = { focusCount: 0, focus() { this.focusCount += 1; } };
  const documentRef = { activeElement: trigger, ...eventTarget() };
  const modal = { hidden: true, danger: false, classList: { toggle: (_name, value) => { modal.danger = value; } } };
  const backdrop = eventTarget();
  const confirmButton = button();
  const cancelButton = button();
  const title = { textContent: '' };
  const message = { textContent: '' };
  return { trigger, documentRef, modal, backdrop, confirmButton, cancelButton, title, message };
};

test('in-app confirmation resolves a confirmed action only once and restores focus', async () => {
  const fixture = createFixture();
  const dialog = createConfirmationDialog({ ...fixture });
  const pending = dialog.confirm({ title: 'Delete saved receipt?', message: 'This cannot be undone.', confirmLabel: 'Delete receipt', danger: true });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(fixture.modal.hidden, false);
  assert.equal(fixture.title.textContent, 'Delete saved receipt?');
  assert.equal(fixture.confirmButton.textContent, 'Delete receipt');
  assert.equal(fixture.modal.danger, true);
  assert.equal(fixture.cancelButton.focusCount, 1, 'destructive confirmations start on the safe action');
  assert.equal(fixture.confirmButton.focusCount, 0);
  fixture.confirmButton.emit('click');
  fixture.confirmButton.emit('click');
  assert.equal(await pending, true);
  assert.equal(fixture.modal.hidden, true);
  assert.equal(fixture.trigger.focusCount, 1);
});

test('in-app confirmation cancels from its button, backdrop, or Escape without native dialogs', async () => {
  const nativeApis = { alert: globalThis.alert, confirm: globalThis.confirm, prompt: globalThis.prompt };
  globalThis.alert = globalThis.confirm = globalThis.prompt = () => { throw new Error('Native browser dialog should not be called'); };
  try {
    const fixture = createFixture();
    const dialog = createConfirmationDialog({ ...fixture });
    const cancelled = dialog.confirm({ title: 'Discard receipt?' });
    fixture.cancelButton.emit('click');
    assert.equal(await cancelled, false);
    const backdropCancelled = dialog.confirm({ title: 'Clear form?' });
    fixture.backdrop.emit('click');
    assert.equal(await backdropCancelled, false);
    const escapeCancelled = dialog.confirm({ title: 'Mark Available?' });
    fixture.documentRef.emit('keydown', { key: 'Escape' });
    assert.equal(await escapeCancelled, false);
  } finally {
    globalThis.alert = nativeApis.alert;
    globalThis.confirm = nativeApis.confirm;
    globalThis.prompt = nativeApis.prompt;
  }
});

test('application workflow sources contain no browser-native dialog calls', async () => {
  const sources = await Promise.all(['../app.js', '../ui/receiptUi.js'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const source of sources) assert.doesNotMatch(source, /\b(?:alert|confirm|prompt)\s*\(/);
});

test('core receipt actions use guarded in-app confirmation or non-blocking feedback', async () => {
  const source = await readFile(new URL('../ui/receiptUi.js', import.meta.url), 'utf8');
  assert.match(source, /confirmAction\(\{ title: 'Delete saved receipt\?'/);
  assert.match(source, /confirmAction\(\{ title: 'Mark receipt Available\?'/);
  assert.match(source, /savePending = true[\s\S]+Receipt changes saved\./);
  assert.match(source, /if \(exportPending\) return;[\s\S]+confirmExport\.disabled = true/);
});

test('non-destructive confirmations start on the confirm action, destructive ones on the safe action', async () => {
  const neutral = createFixture();
  const neutralDialog = createConfirmationDialog({ ...neutral });
  const first = neutralDialog.confirm({ title: 'Mark Available?', danger: false });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(neutral.confirmButton.focusCount, 1);
  assert.equal(neutral.cancelButton.focusCount, 0);
  neutral.cancelButton.emit('click');
  assert.equal(await first, false);

  const destructive = createFixture();
  const destructiveDialog = createConfirmationDialog({ ...destructive });
  const second = destructiveDialog.confirm({ title: 'Delete saved receipt?', danger: true, confirmLabel: 'Delete receipt', cancelLabel: 'Keep receipt' });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(destructive.cancelButton.focusCount, 1, 'Enter or Space on the initial focus cancels');
  assert.equal(destructive.confirmButton.focusCount, 0);
  destructive.cancelButton.emit('click');
  assert.equal(await second, false);
});

test('a shared modal focus manager contains focus while open and receives the opener when the dialog closes', async () => {
  const calls = [];
  let escape;
  const modalFocus = { open: (modal, options) => { escape = options.onEscape; calls.push(['open', modal, options.trigger]); }, close: modal => calls.push(['close', modal]) };
  for (const finish of [fixture => fixture.confirmButton.emit('click'), fixture => fixture.cancelButton.emit('click'), fixture => fixture.backdrop.emit('click'), () => escape()]) {
    calls.length = 0;
    const fixture = createFixture();
    const dialog = createConfirmationDialog({ ...fixture, modalFocus });
    const pending = dialog.confirm({ title: 'Confirm?', trigger: fixture.trigger });
    assert.deepEqual(calls, [['open', fixture.modal, fixture.trigger]], 'the manager is told which control opened the dialog');
    assert.equal(fixture.modal.hidden, false);
    finish(fixture);
    await pending;
    assert.deepEqual(calls.map(call => call[0]), ['open', 'close'], 'every way of closing releases the manager exactly once');
    assert.equal(fixture.modal.hidden, true);
    assert.equal(fixture.trigger.focusCount, 0, 'focus restoration is delegated to the manager, so the opener is not focused twice');
  }
});

test('a second request while a confirmation is open is refused without disturbing the open dialog', async () => {
  const fixture = createFixture();
  const calls = [];
  const dialog = createConfirmationDialog({ ...fixture, modalFocus: { open: () => calls.push('open'), close: () => calls.push('close') } });
  const first = dialog.confirm({ title: 'First?' });
  assert.equal(await dialog.confirm({ title: 'Second?' }), false);
  assert.equal(fixture.title.textContent, 'First?');
  assert.deepEqual(calls, ['open']);
  fixture.confirmButton.emit('click');
  assert.equal(await first, true);
  assert.deepEqual(calls, ['open', 'close']);
});
