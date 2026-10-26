import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('one shared modal focus manager serves the confirmation, edit and export dialogs', async () => {
  const app = await read('../app.js');
  assert.equal([...app.matchAll(/createModalFocus\(\)/g)].length, 1, 'a single manager instance is created');
  assert.match(app, /createConfirmationDialog\(\{[^}]*modalFocus \}\)/);
  assert.match(app, /createReceiptUi\(\{[^}]*confirmAction: confirmationDialog\.confirm, modalFocus \}\)/);
});

test('Edit Receipt and export dialogs register with the manager and release it on every close path', async () => {
  const source = await read('../ui/receiptUi.js');
  assert.match(source, /modalFocus\?\.open\(elements\.editModal,/);
  assert.match(source, /elements\.editModal\.hidden = true;[\s\S]*?modalFocus\?\.close\(elements\.editModal,/);
  assert.match(source, /modalFocus\?\.open\(elements\.exportConfirmModal,/);
  assert.match(source, /elements\.exportConfirmModal\.hidden = true;\s*modalFocus\?\.close\(elements\.exportConfirmModal,/);
  // Escape, backdrop, Cancel and the close button all still go through the same close functions.
  assert.match(source, /event\.key === 'Escape' && !elements\.editModal\.hidden\) closeEditModal\(\)/);
  assert.match(source, /elements\.editModalBackdrop\.addEventListener\('click', closeEditModal\)/);
  assert.match(source, /elements\.cancelEditModal\.addEventListener\('click', closeEditModal\)/);
  assert.match(source, /elements\.closeEditModal\.addEventListener\('click', closeEditModal\)/);
  assert.match(source, /elements\.cancelExport\.addEventListener\('click', closeExportConfirmation\)/);
});

test('after a saved correction or a completed export, keyboard focus lands on a control that still exists', async () => {
  const source = await read('../ui/receiptUi.js');
  assert.match(source, /refreshOptimizationCards\(\);\s*restoreEditTriggerFocus\(index\);/);
  assert.match(source, /card\.dataset\.receiptIndex = String\(entry\.index\);/);
  assert.match(source, /\(elements\.exportSelected\.disabled \? elements\.calculate : elements\.exportSelected\)\.focus/);
});

test('every dialog in the markup is a modal dialog with an accessible name', async () => {
  const html = await read('../index.html');
  for (const id of ['editReceiptModal', 'exportConfirmModal', 'confirmationModal']) {
    const tag = html.match(new RegExp(`<section[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
    assert.match(tag, /role="dialog"/, `${id} is a dialog`);
    assert.match(tag, /aria-modal="true"/, `${id} is modal`);
    assert.match(tag, /aria-labelledby="/, `${id} is named`);
  }
});

test('destructive receipt actions still request danger confirmations', async () => {
  const source = await read('../ui/receiptUi.js');
  assert.match(source, /confirmLabel: 'Clear form', cancelLabel: 'Keep receipts', danger: true/);
});
