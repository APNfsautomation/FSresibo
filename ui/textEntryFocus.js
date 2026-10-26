// While a text field has focus the on-screen keyboard is probably open. Workspaces use this flag to move floating or sticky
// action bars out of the way (see the .is-editing rules in styles.css). Presentation only: nothing here reads or changes data.
const textEntrySelector = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="file"]), textarea';

export const isTextEntry = node => Boolean(node?.matches?.(textEntrySelector));

// Returns the function that re-evaluates the flag. Selects, buttons and file inputs never count as text entry,
// so Tab can always reach an action bar and a focused action is never hidden.
export function trackTextEntry(root, { document = root?.ownerDocument, className = 'is-editing' } = {}) {
  if (!root?.addEventListener || !root.classList) return () => {};
  const sync = () => root.classList.toggle(className, isTextEntry(document?.activeElement) && Boolean(root.contains?.(document.activeElement)));
  root.addEventListener('focusin', sync);
  root.addEventListener('focusout', () => setTimeout(sync, 0));
  return sync;
}
