export function createAuthPanel(elements, { onLogin, onRegister }) {
  const showMode = mode => {
    const isRegister = mode === 'register';
    elements.loginForm.hidden = isRegister;
    elements.registerForm.hidden = !isRegister;
    elements.authMessage.textContent = '';
  };
  const showError = error => { elements.authMessage.textContent = error.message || 'Authentication failed. Please try again.'; };

  elements.showRegister.addEventListener('click', () => showMode('register'));
  elements.showLogin.addEventListener('click', () => showMode('login'));
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

  return {
    show() { elements.authView.hidden = false; elements.appView.hidden = true; showMode('login'); },
    hide() { elements.authView.hidden = true; elements.appView.hidden = false; },
    setMessage(message) { elements.authMessage.textContent = message; }
  };
}
