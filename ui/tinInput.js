// Wires smart TIN formatting (domain/tinFormat.js) to a text input. The formatter runs as the FIRST input listener of the field, so every later listener
// (unsaved flags, summaries, matching) already sees the formatted value. It only rewrites the field when formatting changes it, keeps the caret after the same digit,
// leaves IME composition alone, and never rewrites a value the user did not edit (loading a saved row does not fire an input event).
import { editTin } from '../domain/tinFormat.js';

export function attachTinFormatter(input) {
  if (!input || input.dataset?.tinFormatter) return;
  if (input.dataset) input.dataset.tinFormatter = '1';
  let previous = String(input.value ?? '');
  input.addEventListener('focus', () => { previous = String(input.value ?? ''); });
  input.addEventListener('input', event => {
    if (event?.isComposing) return;
    const raw = String(input.value ?? '');
    const caret = typeof input.selectionStart === 'number' ? input.selectionStart : raw.length;
    const result = editTin({ previous, value: raw, caret, inputType: event?.inputType ?? '' });
    if (result.value !== raw) {
      input.value = result.value;
      try { input.setSelectionRange?.(result.caret, result.caret); } catch { /* inputs that cannot hold a selection keep the browser's caret */ }
    }
    previous = result.value;
  });
}
