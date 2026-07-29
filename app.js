import { isSupabaseConfigured, supabaseConfig } from './config/supabase.js';
import { getCurrentSession, login, logout, onAuthStateChange, register } from './services/authService.js';
import { scanPrintedDetails } from './services/ocrService.js';
import { findBest, toCents } from './services/optimizationService.js';
import * as receiptService from './services/receiptService.js';
import { createAuthPanel } from './ui/authPanel.js';
import { createReceiptUi } from './ui/receiptUi.js';

const elements = {
  list: document.querySelector('#receiptList'),
  template: document.querySelector('#receiptTemplate'),
  target: document.querySelector('#targetAmount'),
  addReceipt: document.querySelector('#addReceipt'),
  calculate: document.querySelector('#calculate'),
  saveDraft: document.querySelector('#saveDraft'),
  loadDraft: document.querySelector('#loadDraft'),
  clearAll: document.querySelector('#clearAll'),
  receiptCount: document.querySelector('#receiptCount'),
  resultTitle: document.querySelector('#resultTitle'),
  resultAmount: document.querySelector('#resultAmount'),
  difference: document.querySelector('#difference'),
  keptReceipts: document.querySelector('#keptReceipts'),
  adminContent: document.querySelector('#adminContent')
};

const authElements = {
  authView: document.querySelector('#authView'),
  appView: document.querySelector('#appView'),
  loginForm: document.querySelector('#loginForm'),
  registerForm: document.querySelector('#registerForm'),
  loginEmail: document.querySelector('#loginEmail'),
  loginPassword: document.querySelector('#loginPassword'),
  registerEmail: document.querySelector('#registerEmail'),
  registerPassword: document.querySelector('#registerPassword'),
  registerConfirmPassword: document.querySelector('#registerConfirmPassword'),
  showRegister: document.querySelector('#showRegister'),
  showLogin: document.querySelector('#showLogin'),
  authMessage: document.querySelector('#authMessage'),
  userEmail: document.querySelector('#userEmail'),
  logout: document.querySelector('#logout')
};

void supabaseConfig;

const receiptUi = createReceiptUi({ elements, findBest, toCents, scanPrintedDetails, receiptService });
const authPanel = createAuthPanel(authElements, { onLogin: login, onRegister: register });
let activeUserId;
let activatingUserId;

async function showAuthenticatedUser(user) {
  if (activeUserId === user.id || activatingUserId === user.id) return;
  activatingUserId = user.id;
  try {
    authPanel.hide();
    authElements.userEmail.textContent = user.email;
    await receiptUi.loadForUser(user);
    await receiptUi.importLegacyDraft(user);
    activeUserId = user.id;
  } finally { activatingUserId = undefined; }
}

authElements.logout.addEventListener('click', async () => {
  try { await logout(); } catch (error) { alert(`Could not sign out: ${error.message}`); }
});

async function start() {
  receiptUi.start();
  if (!isSupabaseConfigured()) {
    authPanel.show();
    authPanel.setMessage('Supabase configuration is required before sign-in can be used.');
    return;
  }
  const session = await getCurrentSession();
  if (session?.user) await showAuthenticatedUser(session.user);
  else authPanel.show();
  await onAuthStateChange(async (_event, nextSession) => {
    if (nextSession?.user) await showAuthenticatedUser(nextSession.user);
    else { activeUserId = undefined; activatingUserId = undefined; receiptUi.clearForLogout(); authPanel.show(); }
  });
}

start().catch(error => { authPanel.show(); authPanel.setMessage(error.message || 'Could not start the application.'); });
