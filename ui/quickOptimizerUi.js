import { findBestMatches, maximumOptimizationExcessCents, optimizationStrategies } from '../services/optimizationService.js';

export const invalidQuickAmountMessage = 'Invalid amount detected. Please check your inputs and try again.';
export const quickCapacityMessage = 'Adding these amounts would exceed the 32-receipt limit. No amounts were added.';
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
export function formatQuickMoney(cents) {
  if (!Number.isSafeInteger(cents)) throw new RangeError('Money requires safe integer centavos.');
  const value = BigInt(cents);
  const magnitude = value < 0n ? -value : value;
  const fraction = String(magnitude % 100n).padStart(2, '0');
  const formatted = money.formatToParts(magnitude / 100n)
    .map(part => part.type === 'fraction' ? fraction : part.value).join('');
  return cents < 0 ? `−${formatted}` : formatted;
}
export const formatQuickDifference = cents => cents > 0 ? `+${formatQuickMoney(cents)}` : formatQuickMoney(cents);
const strategyValues = Object.values(optimizationStrategies);

// Parse decimal digits directly: floating-point rounding is not an input boundary.
export function parseQuickAmount(raw) {
  const match = String(raw).trim().match(/^(?:₱\s*|PHP\s+)?((?:\d+|\d{1,3}(?:,\d{3})+))(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = BigInt(match[1].replaceAll(',', '')) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

// Call once per application instance; hiding the workspace preserves temporary data.
// All state is closure-owned; the optional DOM is only a view of that state.
// Two frame callbacks allow the busy view to paint before synchronous calculation.
export function createQuickOptimizerUi({ root = null, document = root?.ownerDocument, nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) } = {}) {
  let state;
  let revision = 0;
  const defaults = () => ({ target: '', strategy: optimizationStrategies.closest, rows: [1, 2, 3].map(number => ({ id: `R${number}`, raw: '' })), nextLabel: 4, results: [], selectedResult: null, message: '', busy: false });
  state = defaults();
  const field = name => root?.querySelector(`[data-quick="${name}"]`);
  const controls = Object.fromEntries(['target', 'strategy', 'helper', 'rows', 'bulk', 'append', 'add', 'clear', 'calculate', 'feedback', 'results', 'breakdown'].map(name => [name, field(name)]));
  const editAmounts = field('edit-amounts');
  const entryHeading = field('entry-heading');
  const getState = () => structuredClone(state);
  function invalidate() {
    revision++;
    state.results = [];
    state.selectedResult = null;
    state.message = 'Run Find Best Match to calculate recommendations.';
    state.busy = false;
  }
  function fail(message = invalidQuickAmountMessage) {
    state.message = message;
    render(false);
    return false;
  }
  function validateRows(rows = state.rows) {
    const entered = rows.filter(row => row.raw.trim());
    if (entered.length > 32) return null;
    let total = 0;
    const receipts = [];
    for (const row of entered) {
      const cents = parseQuickAmount(row.raw);
      if (cents === null || cents > Number.MAX_SAFE_INTEGER - total) return null;
      total += cents;
      receipts.push({ id: row.id, cents });
    }
    return receipts;
  }
  function setTarget(raw) { state.target = String(raw); invalidate(); render(false); }
  function setStrategy(strategy) {
    if (!strategyValues.includes(strategy)) return fail();
    state.strategy = strategy; invalidate(); render(false);
  }
  function setAmount(id, raw) {
    const row = state.rows.find(row => row.id === id);
    if (!row) return false;
    row.raw = String(raw); invalidate(); render(false); return true;
  }
  function addRow() {
    if (state.rows.length >= 32) return fail('Maximum 32 receipt rows. Fill or remove an existing row.');
    const id = `R${state.nextLabel++}`;
    state.rows.push({ id, raw: '' }); invalidate(); render();
    controls.rows?.querySelector(`#quick-amount-${id}`)?.focus();
    return id;
  }
  function removeRow(id) {
    const index = state.rows.findIndex(row => row.id === id);
    if (index < 0) return false;
    state.rows.splice(index, 1); invalidate(); render();
    const neighbor = state.rows[Math.min(index, state.rows.length - 1)];
    if (neighbor) controls.rows?.querySelector(`#quick-amount-${neighbor.id}`)?.focus();
    else controls.add?.focus();
    return true;
  }
  function appendBulk(raw) {
    const values = String(raw).split(/\r\n|\n|\r/).map(line => line.trim()).filter(Boolean);
    if (values.some(value => parseQuickAmount(value) === null)) return fail();
    if (state.rows.filter(row => row.raw.trim()).length + values.length > 32) return fail(quickCapacityMessage);
    if (!values.length) return true;
    const rows = state.rows.map(row => ({ ...row }));
    let nextLabel = state.nextLabel;
    for (const value of values) {
      const blank = rows.find(row => !row.raw.trim());
      if (blank) blank.raw = value;
      else rows.push({ id: `R${nextLabel++}`, raw: value });
    }
    if (!validateRows(rows)) return fail();
    state.rows = rows; state.nextLabel = nextLabel;
    invalidate(); render();
    if (controls.bulk) controls.bulk.value = '';
    return true;
  }
  async function calculate() {
    if (state.busy) return false;
    invalidate();
    const target = parseQuickAmount(state.target);
    const receipts = validateRows();
    // The engine requires room for its allowance even for Do Not Exceed.
    if (target === null || target > Number.MAX_SAFE_INTEGER - maximumOptimizationExcessCents || !receipts || !receipts.length) return fail();
    const currentRevision = revision;
    const strategy = state.strategy;
    const keepFocus = Boolean(controls.calculate) && document?.activeElement === controls.calculate;
    state.busy = true; state.message = 'Calculating…'; render(false);
    try {
      await nextFrame();
      if (revision !== currentRevision) return false;
      state.results = findBestMatches(receipts, target, strategy, 3).map(result => ({
        total: result.total, difference: result.total - target,
        receipts: result.items.map(index => ({ ...receipts[index] }))
      }));
      state.selectedResult = state.results.length ? 0 : null;
      state.message = state.results.length ? 'Select a match to view its receipts.' : 'No qualifying combination found.';
      return true;
    } catch { return fail(); }
    finally {
      if (revision === currentRevision) { state.busy = false; render(false); if (keepFocus) controls.calculate.focus({ preventScroll: true }); if (state.results.length) revealResults(); }
    }
  }
  function selectResult(index) {
    if (!Number.isInteger(index) || !state.results[index]) return false;
    state.selectedResult = index; render(false); return true;
  }
  function clear() {
    revision++; state = defaults();
    if (controls.bulk) controls.bulk.value = '';
    render();
  }
  // Presentation helpers only: they read layout and move the viewport, never state. Focus stays where the user left it.
  const stackedLayout = () => document?.defaultView?.matchMedia?.('(max-width: 980px)').matches ?? false;
  const scrollBehavior = () => document?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  // When the results sit below the fold in the stacked (tablet/phone) layout, bring them into view after a successful calculation.
  function revealResults() {
    const panel = controls.results?.closest?.('.quick-results-panel');
    if (!panel?.scrollIntoView || !stackedLayout()) return;
    const { top } = panel.getBoundingClientRect();
    const height = document.defaultView.innerHeight;
    if (top < 0 || top > height * 0.6) panel.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }
  // "Edit amounts" returns to the temporary amount list; the list heading takes focus (no keyboard pops up, the entered amounts are untouched).
  function goToAmounts() {
    const panel = controls.rows?.closest?.('.quick-entry') ?? controls.rows;
    panel?.scrollIntoView?.({ behavior: scrollBehavior(), block: 'start' });
    entryHeading?.focus?.({ preventScroll: true });
  }
  // While a text field has focus the on-screen keyboard is likely open: the phone layout moves the floating Calculate button away (it returns on blur or when it is focused by keyboard).
  const isTextEntry = node => Boolean(node?.matches?.('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea'));
  function syncEditing() { root.classList.toggle('is-editing', isTextEntry(document.activeElement) && root.contains(document.activeElement)); }
  function setModuleVisible(visible) { if (root) root.hidden = !visible; }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function render(rebuildRows = true) {
    if (!root) return;
    controls.target.value = state.target;
    controls.strategy.value = state.strategy;
    controls.helper.textContent = state.strategy === optimizationStrategies.withoutExceeding ? 'No amount above target is permitted.' : 'Maximum ₱50.00 above target.';
    controls.feedback.textContent = state.message;
    controls.calculate.disabled = state.busy;
    controls.calculate.textContent = state.busy ? 'Calculating…' : 'Find Best Match';
    controls.results.setAttribute('aria-busy', String(state.busy));
    if (editAmounts) editAmounts.hidden = !state.results.length;
    controls.add.disabled = state.rows.length >= 32;
    if (rebuildRows) {
      controls.rows.replaceChildren(...state.rows.map(row => {
        const container = element('div', undefined, 'quick-amount-row');
        container.dataset.receiptId = row.id;
        const label = element('label', row.id);
        label.htmlFor = `quick-amount-${row.id}`;
        const input = element('input');
        input.id = label.htmlFor; input.type = 'text'; input.inputMode = 'decimal'; input.value = row.raw;
        input.autocomplete = 'off';
        input.addEventListener('input', () => setAmount(row.id, input.value));
        const remove = element('button', 'Remove', 'ghost');
        remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${row.id}`);
        remove.addEventListener('click', () => removeRow(row.id));
        container.append(label, input, remove);
        return container;
      }));
    }
    const selected = state.results[state.selectedResult];
    const selectedIds = new Set(selected?.receipts.map(receipt => receipt.id));
    for (const row of controls.rows.children) {
      row.classList.toggle('is-selected', selectedIds.has(row.dataset.receiptId));
      row.querySelector('input').value = state.rows.find(value => value.id === row.dataset.receiptId).raw;
    }
    controls.results.replaceChildren(...state.results.map((result, index) => {
      const card = element('button', undefined, 'quick-result');
      card.type = 'button'; card.setAttribute('aria-pressed', String(index === state.selectedResult));
      card.append(element('strong', ['Best Match', 'Alternative 1', 'Alternative 2'][index]),
        element('span', result.receipts.map(receipt => receipt.id).join(' + ')),
        element('span', `Total: ${formatQuickMoney(result.total)}`),
        element('span', `Difference: ${formatQuickDifference(result.difference)}`),
        element('span', `Receipts: ${result.receipts.length}`),
        element('span', result.receipts.map(receipt => `${receipt.id}: ${formatQuickMoney(receipt.cents)}`).join(' · ')));
      card.addEventListener('click', () => {
        selectResult(index);
        // Re-rendered native buttons retain keyboard focus after selection.
        controls.results.children[index]?.focus();
      });
      return card;
    }));
    controls.breakdown.replaceChildren(...(selected ? selected.receipts.map(receipt => element('li', `${receipt.id}: ${formatQuickMoney(receipt.cents)}`)) : [element('li', 'No match selected.')]));
  }
  if (root) {
    controls.target.addEventListener('input', () => setTarget(controls.target.value));
    controls.strategy.addEventListener('change', () => setStrategy(controls.strategy.value));
    controls.add.addEventListener('click', addRow);
    controls.append.addEventListener('click', () => appendBulk(controls.bulk.value));
    controls.clear.addEventListener('click', clear);
    controls.calculate.addEventListener('click', calculate);
    editAmounts?.addEventListener('click', goToAmounts);
    if (root.classList && root.addEventListener) {
      root.addEventListener('focusin', syncEditing);
      root.addEventListener('focusout', () => setTimeout(syncEditing, 0));
    }
    render();
  }
  return { getState, setTarget, setStrategy, setAmount, addRow, removeRow, appendBulk, calculate, selectResult, clear, clearForLogout: clear, setModuleVisible };
}
