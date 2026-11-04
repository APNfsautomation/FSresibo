// Smart TIN formatting (Issue #50, requirement 7). Pure helpers: no DOM, storage or network access.
// A TIN is shown as 000-000-000-000 (12 digits) or 000-000-000-00000 (14 digits): digits grouped 3-3-3 and the rest. While typing, the hyphens appear only
// BETWEEN digits (never a trailing one), leading zeros are kept (the value is always text), and no digit is ever dropped: a 13- or 15-digit entry is grouped the
// same way so the user can see and fix it. Matching elsewhere (domain/sharedStoreProfiles.js) compares digits only, so formatting never changes whether two TINs match.

export const tinDigits = value => String(value ?? '').replace(/\D/g, '');

const groupSizes = [3, 3, 3];

export function formatTin(value) {
  const digits = tinDigits(value);
  const groups = []; let at = 0;
  for (const size of groupSizes) { if (at >= digits.length) break; groups.push(digits.slice(at, at + size)); at += size; }
  if (at < digits.length) groups.push(digits.slice(at));
  return groups.join('-');
}

// 'complete' = exactly 12 or 14 digits; 'empty' = no digits; anything else is 'incomplete' (shown as typed, never rejected or truncated).
export const tinStatus = value => { const count = tinDigits(value).length; return count === 0 ? 'empty' : count === 12 || count === 14 ? 'complete' : 'incomplete'; };

// For values that were NOT typed (shared-store autofill, historical rows, scans): a purely numeric TIN (digits, spaces, hyphens, dots) is grouped; anything else
// (for example a note such as "N/A") is returned exactly as it is. Stored historical text is never rewritten by merely loading it.
export const formatTinForDisplay = value => /^[\d\s.-]*$/.test(String(value ?? '')) && tinDigits(value) ? formatTin(value) : String(value ?? '');

const caretAfterDigits = (formatted, count) => {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) if (/\d/.test(formatted[index]) && ++seen === count) return index + 1;
  return formatted.length;
};

// One edit of the text field. previous: the field's value before the edit; value/caret: after it; inputType: the browser's InputEvent.inputType (may be '').
// Returns { value, caret } to put back into the field. Letters and other symbols are dropped (a TIN is numeric); the caret stays after the same digit.
// Deleting only a hyphen would otherwise be undone by re-formatting and trap the caret, so that edit deletes the neighbouring digit instead.
export function editTin({ previous = '', value = '', caret = String(value).length, inputType = '' }) {
  const text = String(value ?? ''); const position = Math.max(0, Math.min(caret ?? text.length, text.length));
  let digits = tinDigits(text); let before = tinDigits(text.slice(0, position)).length;
  const formatted = formatTin(digits);
  if (/^delete/.test(inputType) && formatted === String(previous ?? '') && tinDigits(previous).length === digits.length) {
    if (/Backward/.test(inputType) && before > 0) { digits = digits.slice(0, before - 1) + digits.slice(before); before -= 1; }
    else if (/Forward/.test(inputType) && before < digits.length) digits = digits.slice(0, before) + digits.slice(before + 1);
  }
  const next = formatTin(digits);
  return { value: next, caret: caretAfterDigits(next, before) };
}
