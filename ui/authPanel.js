export function createAuthPanel(elements, { onLogin, onRegister, onPasswordReset, onUpdatePassword }) {
  const forms = Object.freeze({ login: elements.loginForm, register: elements.registerForm, reset: elements.resetForm, recovery: elements.recoveryForm });
  const showMode = (mode, message = '') => {
    Object.entries(forms).forEach(([name, form]) => { if (form) form.hidden = name !== mode; });
    elements.authMessage.textContent = message;
  };
  const showError = error => { elements.authMessage.textContent = error.message || 'Authentication failed. Please try again.'; };

  elements.showRegister.addEventListener('click', () => showMode('register'));
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
    show(message = '') { elements.authView.hidden = false; elements.appView.hidden = true; showMode('login', message); },
    showRecovery(message = '') { elements.authView.hidden = false; elements.appView.hidden = true; showMode('recovery', message); },
    showRecoveryUnavailable(message = 'This password reset link is invalid or expired. Request a new reset link to continue.') { elements.authView.hidden = false; elements.appView.hidden = true; showMode('reset', message); },
    hide() { elements.authView.hidden = true; elements.appView.hidden = false; },
    setMessage(message) { elements.authMessage.textContent = message; }
  };
}
