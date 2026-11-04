// Keyboard-first single-choice combobox over a FIXED option list (Issue #50: Expense Account and Classification of Expense).
// The input only ever holds either a committed option or the text being typed. Leaving the field with text that is not an option restores the last committed
// choice, so no uncontrolled free text can be saved. Typing never selects anything by itself: a choice is made with Tab or Enter on the highlighted suggestion,
// a click on a suggestion, or by typing an option's full name. Ctrl+Enter / Ctrl+S are left alone so the workspace shortcuts keep working.
import { filterOptions, resolveOption } from '../domain/expenseClassification.js';

let sequence = 0;

export function attachOptionCombobox({ input, list, options, label = '', onCommit = () => {} }) {
  const id = `option-list-${++sequence}`;
  let committed = String(input.value ?? '');
  let shown = []; let active = -1; let internal = false;
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-haspopup', 'listbox'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('autocomplete', 'off');
  if (list) { list.setAttribute('role', 'listbox'); list.id = list.id || id; list.hidden = true; input.setAttribute('aria-controls', list.id); if (label) list.setAttribute('aria-label', label); }

  const fire = name => { internal = true; try { input.dispatchEvent?.(new globalThis.Event(name, { bubbles: true })); } finally { internal = false; } };
  const close = () => { shown = []; active = -1; if (list) { list.hidden = true; list.replaceChildren(); } input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const render = () => {
    if (!list) return;
    list.replaceChildren(...shown.map((option, index) => {
      const item = globalThis.document.createElement('li');
      item.id = `${list.id}-${index}`; item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(index === active)); item.textContent = option; item.className = index === active ? 'is-active' : '';
      item.addEventListener('mousedown', event => { event.preventDefault(); commit(option); }); // mousedown, so the input keeps focus and blur does not revert first
      return item;
    }));
    list.hidden = shown.length === 0;
    input.setAttribute('aria-expanded', String(shown.length > 0));
    if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${active}`); else input.removeAttribute('aria-activedescendant');
  };
  const open = query => { shown = filterOptions(options, query); active = query.trim() && shown.length ? 0 : -1; render(); };
  function commit(option) {
    input.value = option; const changed = option !== committed; committed = option; close();
    if (changed) { fire('input'); fire('change'); onCommit(option); }
  }
  input.addEventListener('focus', () => { committed = String(input.value ?? ''); });
  input.addEventListener('input', () => {
    if (internal) return;
    open(String(input.value ?? ''));
  });
  input.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return; // workspace shortcuts and browser commands are not ours
    if (event.isComposing || event.keyCode === 229) return;
    const isOpen = shown.length > 0;
    if (event.key === 'ArrowDown') { event.preventDefault(); if (!isOpen) open(String(input.value ?? '')); else active = (active + 1) % shown.length; render(); return; }
    if (event.key === 'ArrowUp' && isOpen) { event.preventDefault(); active = (active - 1 + shown.length) % shown.length; render(); return; }
    if (event.key === 'Escape' && isOpen) { event.preventDefault(); event.stopPropagation?.(); close(); return; }
    if (event.key === 'Enter' && isOpen && active >= 0) { event.preventDefault(); commit(shown[active]); return; }
    if (event.key === 'Tab' && !event.shiftKey && isOpen && active >= 0) commit(shown[active]); // Tab commits and then moves on, as normal
  });
  input.addEventListener('blur', () => {
    const exact = resolveOption(options, input.value);
    if (exact) { commit(exact); return; }
    if (!String(input.value ?? '').trim()) { commit(''); return; } // clearing the field is allowed: both fields are optional until export
    if (String(input.value ?? '') !== committed) { input.value = committed; fire('input'); fire('change'); } // unknown text is never kept
    close();
  });
  return { close, commit, isOpen: () => shown.length > 0, options: () => shown.slice() };
}
