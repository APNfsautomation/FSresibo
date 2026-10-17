export function createAuthPanel(elements, { onLogin, onRegister, onPasswordReset, onUpdatePassword, onShow = () => {} }) {
  const forms = Object.freeze({ login: elements.loginForm, register: elements.registerForm, reset: elements.resetForm, recovery: elements.recoveryForm });
  const showMode = (mode, message = '') => {
    Object.entries(forms).forEach(([name, form]) => { if (form) form.hidden = name !== mode; });
    elements.authMessage.textContent = message;
  };
  // Passwords are emptied only when the panel opens or closes, or the recovery form opens (never on input, on a failed attempt or on an unrelated update). Emails stay.
  const passwordFields = () => [elements.loginPassword, elements.registerPassword, elements.registerConfirmPassword, elements.recoveryPassword, elements.recoveryConfirmPassword];
  const clearSecrets = () => passwordFields().forEach(field => { if (field) field.value = ''; });
  const visibleMode = () => Object.entries(forms).find(([, form]) => form && !form.hidden)?.[0];
  // Opening a mode clears the passwords when the panel was closed (logout, expiry, start-up) or a different form was showing.
  // Re-showing the form that is already open keeps what the user typed.
  const open = (mode, message, { clearPasswords = false } = {}) => {
    const unchanged = !elements.authView.hidden && visibleMode() === mode;
    onShow(); elements.authView.hidden = false; elements.appView.hidden = true;
    if (!unchanged || clearPasswords) clearSecrets();
    showMode(mode, message);
  };
  const showError = error => { elements.authMessage.textContent = error.message || 'Authentication failed. Please try again.'; };

  elements.showRegister?.addEventListener('click', () => showMode('register'));
  elements.showLogin.addEventListener('click', () => showMode('login'));
  elements.showReset?.addEventListener('click', () => showMode('reset'));
  elements.backToLogin?.addEventListener('click', () => showMode('login'));
  elements.backFromRecovery?.addEventListener('click', () => showMode('reset'));
  elements.loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    elements.authMessage.textContent = 'Signing in…';
    try { await onLogin(elements.loginEmail.value, elements.loginPassword.value); } catch (error) { showError(error); }
  });
  elements.registerForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (elements.registerPassword.value !== elements.registerConfirmPassword.value) return showError(new Error('Passwords do not match.'));
    elements.authMessage.textContent = 'Creating account…';
    try {
      const data = await onRegister(elements.registerEmail.value, elements.registerPassword.value);
      elements.authMessage.textContent = data.session ? 'Account created. Signing you in…' : 'Account created. Check your email to confirm it, then sign in.';
    } catch (error) { showError(error); }
  });
  elements.resetForm?.addEventListener('submit', async event => {
    event.preventDefault();
    elements.authMessage.textContent = 'Sending reset link…';
    try {
      await onPasswordReset(elements.resetEmail.value);
      showMode('login', 'If an account exists for that email, a password reset link has been sent.');
    } catch (error) { showError(error); }
  });
  elements.recoveryForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (elements.recoveryPassword.value.length < 6) return showError(new Error('Use at least 6 characters for the new password.'));
    if (elements.recoveryPassword.value !== elements.recoveryConfirmPassword.value) return showError(new Error('Passwords do not match.'));
    elements.authMessage.textContent = 'Updating password…';
    try { await onUpdatePassword(elements.recoveryPassword.value); } catch (error) { showError(error); }
  });

  return {
    // { clearPasswords: true } is for an explicit sign-out: it empties the passwords even if the sign-in form is already showing.
    show(message = '', options = {}) { open('login', message, options); },
    showRecovery(message = '') { open('recovery', message); },
    showRecoveryUnavailable(message = 'This password reset link is invalid or expired. Request a new reset link to continue.') { open('reset', message); },
    hide() { clearSecrets(); elements.authView.hidden = true; elements.appView.hidden = false; },
    setMessage(message) { elements.authMessage.textContent = message; }
  };
}
