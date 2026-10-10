export function createConfirmationDialog({ modal, backdrop, title, message, confirmButton, cancelButton, documentRef = document, modalFocus = null }) {
  let resolvePending;
  let returnFocus;
  const close = confirmed => {
    if (!resolvePending) return;
    const resolve = resolvePending;
    resolvePending = undefined;
    modal.hidden = true;
    confirmButton.disabled = false;
    confirmButton.removeAttribute('aria-busy');
    // The shared focus manager also makes the page interactive again before returning focus to the control that opened the dialog.
    if (modalFocus) modalFocus.close(modal);
    else returnFocus?.focus?.({ preventScroll: true });
    returnFocus = undefined;
    resolve(confirmed);
  };
  const request = ({ title: nextTitle, message: nextMessage, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, trigger = documentRef.activeElement } = {}) => {
    if (resolvePending) return Promise.resolve(false);
    title.textContent = nextTitle || 'Confirm action';
    message.textContent = nextMessage || '';
    confirmButton.textContent = confirmLabel;
    cancelButton.textContent = cancelLabel;
    modal.classList.toggle('is-danger', Boolean(danger));
    returnFocus = trigger;
    modal.hidden = false;
    modalFocus?.open(modal, { trigger });
    return new Promise(resolve => {
      resolvePending = resolve;
      // Destructive confirmations start on the safe action so Enter or Space cannot confirm by accident.
      const initialFocus = danger ? cancelButton : confirmButton;
      queueMicrotask(() => initialFocus.focus({ preventScroll: true }));
    });
  };
  confirmButton.addEventListener('click', () => close(true));
  cancelButton.addEventListener('click', () => close(false));
  backdrop.addEventListener('click', () => close(false));
  documentRef.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.hidden) {
      event.preventDefault();
      close(false);
    }
  });
  return { confirm: request, close, isOpen: () => Boolean(resolvePending) };
}
