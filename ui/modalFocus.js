// Lightweight modal focus management shared by every dialog: keeps Tab inside the open dialog, makes the page behind it inert,
// and returns focus to the control that opened the dialog (or a fallback) when it closes. Dialog visibility stays with each dialog's owner.
const tabbableSelector = 'a[href], button, input, select, textarea, summary, [tabindex]';
const ignoredBodyChildren = new Set(['SCRIPT', 'TEMPLATE', 'STYLE', 'LINK', 'NOSCRIPT']);

const defaultIsVisible = element => typeof element.getClientRects === 'function' ? element.getClientRects().length > 0 : !element.hidden;

export function isTabbable(element, isVisible = defaultIsVisible) {
  if (!element || element.disabled || element.hidden) return false;
  if (element.type === 'hidden') return false;
  const tabindex = element.getAttribute?.('tabindex');
  if (tabindex !== null && tabindex !== undefined && Number(tabindex) < 0) return false;
  return isVisible(element);
}

export const tabbableWithin = (container, isVisible = defaultIsVisible) => [...container.querySelectorAll(tabbableSelector)].filter(element => isTabbable(element, isVisible));

const canReceiveFocus = (element, isVisible) => Boolean(element) && element.isConnected !== false && !element.disabled && !element.hidden && isVisible(element) && typeof element.focus === 'function';

export function createModalFocus({ documentRef = document, isVisible = defaultIsVisible } = {}) {
  const stack = [];
  const topLevelAncestor = modal => {
    let node = modal;
    while (node.parentElement && node.parentElement !== documentRef.body) node = node.parentElement;
    return node;
  };
  const makeInert = (entry, covered) => {
    [...documentRef.body.children].forEach(child => {
      if (child === covered || ignoredBodyChildren.has(child.tagName) || child.hasAttribute('inert')) return;
      child.setAttribute('inert', '');
      entry.inerted.push(child);
    });
  };
  const handleKeydown = event => {
    if (event.key !== 'Tab' || !stack.length || event.ctrlKey || event.altKey || event.metaKey) return;
    const { modal } = stack[stack.length - 1];
    const tabbable = tabbableWithin(modal, isVisible);
    if (!tabbable.length) { event.preventDefault(); modal.focus?.(); return; }
    const first = tabbable[0];
    const last = tabbable[tabbable.length - 1];
    const active = documentRef.activeElement;
    if (!modal.contains(active)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };
  // Escape belongs to the topmost dialog only: it is handled here once, and the event is stopped so no other listener can also close a lower dialog.
  const handleEscape = event => {
    if (event.key !== 'Escape' || !stack.length) return;
    const { onEscape } = stack[stack.length - 1];
    if (!onEscape) return;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    onEscape();
  };
  documentRef.addEventListener('keydown', handleKeydown, true);
  documentRef.addEventListener('keydown', handleEscape, true);

  return {
    // Call after the dialog is visible. `trigger` receives focus when the dialog closes; `fallback` is used if it is gone or disabled.
    open(modal, { trigger = documentRef.activeElement, fallback = null, initialFocus = null, onEscape = null } = {}) {
      if (stack.some(entry => entry.modal === modal)) return;
      const entry = { modal, trigger, fallback, inerted: [], reinert: null, onEscape };
      const covered = topLevelAncestor(modal);
      // A dialog opened over another one may have been made inert by that dialog; it must be usable while it is the top dialog.
      if (covered.hasAttribute('inert')) { covered.removeAttribute('inert'); entry.reinert = covered; }
      makeInert(entry, covered);
      stack.push(entry);
      if (initialFocus) initialFocus.focus?.({ preventScroll: true });
    },
    // Call after the dialog is hidden.
    close(modal, { restoreFocus = true, fallback } = {}) {
      const index = stack.findIndex(entry => entry.modal === modal);
      if (index < 0) return;
      const [entry] = stack.splice(index, 1);
      entry.inerted.forEach(child => child.removeAttribute('inert'));
      if (entry.reinert && stack.length) entry.reinert.setAttribute('inert', '');
      if (!restoreFocus) return;
      const target = [entry.trigger, fallback ?? entry.fallback].find(candidate => canReceiveFocus(candidate, isVisible));
      target?.focus({ preventScroll: true });
    },
    isOpen: () => stack.length > 0,
    handleKeydown,
    handleEscape
  };
}
