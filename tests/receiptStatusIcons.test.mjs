import assert from 'node:assert/strict';
import test from 'node:test';
import { installReceiptSummaryTooltips, setReceiptStatusTooltip, statusTooltipText } from '../ui/receiptStatusIcons.js';
import { receiptFixture } from './helpers/receiptUiFixture.mjs';

function makeIndicator() {
  const listeners = new Map();
  const classes = new Set();
  const attrs = {};
  const indicator = {
    hidden: false, dataset: {}, attrs, blurCount: 0,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name)
    },
    setAttribute: (name, value) => { attrs[name] = String(value); },
    addEventListener: (name, cb) => listeners.set(name, cb),
    blur() { this.blurCount++; this.emit('blur'); },
    emit(name, props = {}) {
      const event = { key: props.key, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; } };
      listeners.get(name)?.(event);
      return event;
    }
  };
  return indicator;
}

test('receipt status tooltip descriptions preserve different receipt states', () => {
  const indicator = makeIndicator();
  indicator.classList.add('is-tooltip-open');
  setReceiptStatusTooltip(indicator, statusTooltipText.onHold);
  assert.equal(indicator.dataset.tooltip, 'On Hold — Excluded from optimization, manual selection and export.');
  assert.equal(indicator.attrs['aria-label'], indicator.dataset.tooltip);
  assert.equal(indicator.classList.contains('is-tooltip-open'), false);
  setReceiptStatusTooltip(indicator, statusTooltipText.unsaved);
  assert.match(indicator.attrs['aria-label'], /Unsaved changes/);
  assert.notEqual(statusTooltipText.outsideRange, statusTooltipText.outsideFilters);
  assert.notEqual(statusTooltipText.newReceipt, statusTooltipText.unsaved);
});

test('status-icon taps and keyboard activation display help without activating parent receipt summary', () => {
  const first = makeIndicator();
  const second = makeIndicator();
  const listeners = new Map();
  const row = {
    querySelectorAll: selector => selector === '.summary-flags > .receipt-status-icon' ? [first, second] : [],
    addEventListener: (name, cb) => listeners.set(name, cb),
    emit(name) { listeners.get(name)?.(); }
  };
  installReceiptSummaryTooltips(row);
  let event = first.emit('click');
  assert.equal(event.prevented, true, 'prevent the native summary click default');
  assert.equal(event.stopped, true, 'stop delegated summary handlers');
  assert.equal(first.classList.contains('is-tooltip-open'), true);
  event = second.emit('keydown', { key: 'Enter' });
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(first.classList.contains('is-tooltip-open'), false, 'only one tooltip stays open');
  assert.equal(second.classList.contains('is-tooltip-open'), true);
  event = second.emit('keydown', { key: ' ' });
  assert.equal(event.prevented, true, 'Space does not scroll or toggle the receipt');
  assert.equal(second.classList.contains('is-tooltip-open'), false);
  first.emit('click');
  first.emit('blur');
  assert.equal(first.classList.contains('is-tooltip-open'), false);
  first.emit('click');
  row.emit('toggle');
  assert.equal(first.classList.contains('is-tooltip-open'), false, 'closing/opening the receipt dismisses help');
  first.emit('keydown', { key: 'Enter' });
  event = first.emit('keydown', { key: 'Escape' });
  assert.equal(event.stopped, true);
  assert.equal(first.blurCount, 1);
  assert.equal(first.classList.contains('is-tooltip-open'), false);
  first.hidden = true;
  first.emit('click');
  assert.equal(first.classList.contains('is-tooltip-open'), false, 'a hidden status cannot open its help');
});

test('actual Encoding rows synchronize On Hold, Consumed and unsaved change descriptions', async () => {
  const f = await receiptFixture({ loaded: [
    { dbId: 'held', store: 'Held Store', amount: '300', isOnHold: true },
    { dbId: 'consumed', store: 'Consumed Store', amount: '200', status: 'consumed' }
  ] });
  const [held, consumed] = f.rows();
  const holdIcon = held.part('.receipt-hold-badge');
  assert.equal(holdIcon.hidden, false);
  assert.equal(holdIcon.dataset.tooltip, statusTooltipText.onHold);
  assert.equal(holdIcon.attrs['aria-label'], statusTooltipText.onHold);
  const consumedIcon = consumed.part('.receipt-status-badge');
  assert.equal(consumedIcon.hidden, false);
  assert.equal(consumedIcon.dataset.tooltip, statusTooltipText.consumed);
  await f.type(held, 'store', 'New edited store');
  const unsaved = held.part('.receipt-unsaved-flag');
  assert.equal(unsaved.hidden, false);
  assert.equal(unsaved.dataset.tooltip, statusTooltipText.unsaved);
  assert.equal(unsaved.attrs['aria-label'], statusTooltipText.unsaved);
});
