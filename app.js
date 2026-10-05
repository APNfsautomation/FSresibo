import { isSupabaseConfigured, supabaseConfig } from './config/supabase.js';
import { appMetadata } from './config/appMetadata.js';
import { authRedirectUrl, getCurrentSession, hasPasswordRecoveryIntent, login, logout, onAuthStateChange, recoveryCallbackError, register, requestPasswordReset, updatePassword } from './services/authService.js';
import { scanPrintedDetails } from './services/ocrService.js';
import { downloadSelectedReceipts } from './services/exportService.js';
import { findBest, optimizationStrategies, toCents } from './services/optimizationService.js';
import * as receiptService from './services/receiptService.js';
import * as sharedStoreService from './services/sharedStoreService.js';
import { renderApplicationIdentity } from './ui/appIdentity.js';
import { createAuthPanel } from './ui/authPanel.js';
import { createConfirmationDialog } from './ui/confirmationDialog.js';
import { createNavigationController, receiptRoutes } from './ui/navigationController.js';
import { createReceiptUi } from './ui/receiptUi.js';
import { createThemeController } from './ui/themeController.js';

const elements = {
  list: document.querySelector('#receiptList'), template: document.querySelector('#receiptTemplate'), target: document.querySelector('#targetAmount'),
  calculate: document.querySelector('#calculate'), optimizationStrategy: document.querySelector('#optimizationStrategy'), optimizationStrategyHelper: document.querySelector('#optimizationStrategyHelper'), saveDraft: document.querySelector('#saveDraft'),
  clearAll: document.querySelector('#clearAll'), receiptCount: document.querySelector('#receiptCount'), receiptStatusFilter: document.querySelector('#receiptStatusFilter'), encodingAmountCompartment: document.querySelector('#encodingAmountCompartment'), availableTotal: document.querySelector('#availableTotal'), resultTitle: document.querySelector('#resultTitle'),
  resultAmount: document.querySelector('#resultAmount'), difference: document.querySelector('#difference'), keptReceipts: document.querySelector('#keptReceipts'),
  optimizationResultSummary: document.querySelector('#optimizationResultSummary'), summaryTarget: document.querySelector('#summaryTarget'), summaryMatched: document.querySelector('#summaryMatched'), summaryDifference: document.querySelector('#summaryDifference'), summaryReceiptCount: document.querySelector('#summaryReceiptCount'), summaryStrategy: document.querySelector('#summaryStrategy'),
  adminContent: document.querySelector('#adminContent'), encodingWorkspace: document.querySelector('#encodingWorkspace'), optimizationWorkspace: document.querySelector('#optimizationWorkspace'),
  encodingTab: document.querySelector('#encodingTab'), optimizationTab: document.querySelector('#optimizationTab'), floatingAdd: document.querySelector('#floatingAddReceipt'),
  optimizationList: document.querySelector('#optimizationReceiptList'), optimizationTemplate: document.querySelector('#optimizationReceiptTemplate'),
  optimizationSearch: document.querySelector('#optimizationSearch'), clearOptimizationSearch: document.querySelector('#clearOptimizationSearch'),
  optimizationStoreFilter: document.querySelector('#optimizationStoreFilter'), optimizationStartDate: document.querySelector('#optimizationStartDate'), optimizationEndDate: document.querySelector('#optimizationEndDate'),
  optimizationMinAmount: document.querySelector('#optimizationMinAmount'), optimizationMaxAmount: document.querySelector('#optimizationMaxAmount'), optimizationSort: document.querySelector('#optimizationSort'),
  clearOptimizationFilters: document.querySelector('#clearOptimizationFilters'), optimizationResultCount: document.querySelector('#optimizationResultCount'), optimizationFilterStatus: document.querySelector('#optimizationFilterStatus'),
  optimizationRangeValidation: document.querySelector('#optimizationRangeValidation'), optimizationHiddenSelected: document.querySelector('#optimizationHiddenSelected'), exportSelected: document.querySelector('#exportSelected'),
  editModal: document.querySelector('#editReceiptModal'), editModalBackdrop: document.querySelector('#editModalBackdrop'), editForm: document.querySelector('#editReceiptForm'),
  closeEditModal: document.querySelector('#closeEditModal'), cancelEditModal: document.querySelector('#cancelEditModal'), editAmount: document.querySelector('#editAmount'),
  editReceiptDate: document.querySelector('#editReceiptDate'), editVat: document.querySelector('#editVat'), editInvoice: document.querySelector('#editInvoice'),
  editStore: document.querySelector('#editStore'), editAddress: document.querySelector('#editAddress'), editTin: document.querySelector('#editTin'),
  exportConfirmModal: document.querySelector('#exportConfirmModal'), exportConfirmBackdrop: document.querySelector('#exportConfirmBackdrop'), exportConfirmMessage: document.querySelector('#exportConfirmMessage'), confirmExport: document.querySelector('#confirmExport'), cancelExport: document.querySelector('#cancelExport'),
  confirmationModal: document.querySelector('#confirmationModal'), confirmationBackdrop: document.querySelector('#confirmationBackdrop'), confirmationTitle: document.querySelector('#confirmationTitle'), confirmationMessage: document.querySelector('#confirmationMessage'), confirmationConfirm: document.querySelector('#confirmationConfirm'), confirmationCancel: document.querySelector('#confirmationCancel'),
  encodingFeedback: document.querySelector('#encodingFeedback'), editFeedback: document.querySelector('#editFeedback'), sessionFeedback: document.querySelector('#sessionFeedback'),
  themePreference: document.querySelector('#themePreference'), authVersion: document.querySelector('#authVersion'), appVersion: document.querySelector('#appVersion')
};

const navigationElements = {
  menuButton: document.querySelector('#navigationMenuButton'), drawer: document.querySelector('#navigationDrawer'), drawerBackdrop: document.querySelector('#navigationDrawerBackdrop'),
  receiptsNav: document.querySelector('#receiptsNavigationItem'), encodingTab: elements.encodingTab, optimizationTab: elements.optimizationTab
};

const authElements = {
  authView: document.querySelector('#authView'), appView: document.querySelector('#appView'), loginForm: document.querySelector('#loginForm'),
  registerForm: document.querySelector('#registerForm'), loginEmail: document.querySelector('#loginEmail'), loginPassword: document.querySelector('#loginPassword'),
  registerEmail: document.querySelector('#registerEmail'), registerPassword: document.querySelector('#registerPassword'), registerConfirmPassword: document.querySelector('#registerConfirmPassword'),
  showRegister: document.querySelector('#showRegister'), showLogin: document.querySelector('#showLogin'), showReset: document.querySelector('#showReset'), backToLogin: document.querySelector('#backToLogin'), backFromRecovery: document.querySelector('#backFromRecovery'), authMessage: document.querySelector('#authMessage'),
  resetForm: document.querySelector('#resetForm'), resetEmail: document.querySelector('#resetEmail'), recoveryForm: document.querySelector('#recoveryForm'), recoveryPassword: document.querySelector('#recoveryPassword'), recoveryConfirmPassword: document.querySelector('#recoveryConfirmPassword'),
  userEmail: document.querySelector('#userEmail'), logout: document.querySelector('#logout')
};

void supabaseConfig;
const confirmationDialog = createConfirmationDialog({ modal: elements.confirmationModal, backdrop: elements.confirmationBackdrop, title: elements.confirmationTitle, message: elements.confirmationMessage, confirmButton: elements.confirmationConfirm, cancelButton: elements.confirmationCancel });
const receiptUi = createReceiptUi({ elements, findBest, optimizationStrategies, toCents, scanPrintedDetails, downloadSelectedReceipts, receiptService, sharedStoreService, confirmAction: confirmationDialog.confirm });
const navigationController = createNavigationController({ elements: navigationElements, onRoute: workspace => receiptUi.setWorkspace(workspace) });
const themeController = createThemeController({ select: elements.themePreference });
const authPanel = createAuthPanel(authElements, {
  onLogin: login,
  onRegister: (email, password) => register(email, password, authRedirectUrl('signup')),
  onPasswordReset: email => requestPasswordReset(email, authRedirectUrl('recovery')),
  onUpdatePassword: async password => { await updatePassword(password); recoveryCompleted = true; await logout(); }
});
let activeUserId;
let activatingUserId;
let recoveryMode = hasPasswordRecoveryIntent();
let recoverySessionEstablished = false;
let recoveryCompleted = false;
const clearRecoveryUrl = () => {
  const url = new URL(window.location.href);
  ['auth', 'type', 'error', 'error_code', 'error_description'].forEach(parameter => url.searchParams.delete(parameter));
  url.hash = '';
  window.history.replaceState({}, document.title, url);
};

async function showAuthenticatedUser(user) {
  if (activeUserId === user.id || activatingUserId === user.id) return;
  activatingUserId = user.id;
  try {
    authPanel.hide();
    authElements.userEmail.textContent = user.email;
    await receiptUi.loadForUser(user);
    await receiptUi.importLegacyDraft(user);
    navigationController.start({ fallbackRoute: receiptUi.consumeLegacyWorkspace() === 'optimization' ? receiptRoutes.optimization : receiptRoutes.encoding });
    activeUserId = user.id;
  } finally { activatingUserId = undefined; }
}

async function handleAuthState(event, nextSession) {
  if (event === 'PASSWORD_RECOVERY') {
    recoveryMode = true;
    recoverySessionEstablished = Boolean(nextSession?.user);
    if (recoverySessionEstablished) authPanel.showRecovery();
    else authPanel.showRecoveryUnavailable(recoveryCallbackError() || undefined);
    clearRecoveryUrl();
    return;
  }
  if (recoveryMode && event !== 'SIGNED_OUT') return;
  if (event === 'SIGNED_OUT') {
    activeUserId = undefined;
    activatingUserId = undefined;
    receiptUi.clearForLogout();
    const message = recoveryCompleted ? 'Password updated. Sign in with your new password.' : '';
    recoveryCompleted = false;
    recoveryMode = false;
    recoverySessionEstablished = false;
    authPanel.show(message);
    return;
  }
  if (nextSession?.user) await showAuthenticatedUser(nextSession.user);
  else {
    activeUserId = undefined;
    activatingUserId = undefined;
    receiptUi.clearForLogout();
    authPanel.show();
  }
}

authElements.logout.addEventListener('click', async () => {
  try { await logout(); } catch (error) { elements.sessionFeedback.textContent = `Could not sign out: ${error.message}`; }
});

async function start() {
  renderApplicationIdentity([elements.authVersion, elements.appVersion], appMetadata);
  themeController.restore();
  receiptUi.start();
  if (!isSupabaseConfigured()) {
    authPanel.show();
    authPanel.setMessage('Supabase configuration is required before sign-in can be used.');
    return;
  }
  await onAuthStateChange((event, nextSession) => { void handleAuthState(event, nextSession); });
  const session = await getCurrentSession();
  if (recoveryMode) {
    await new Promise(resolve => window.setTimeout(resolve, 0));
    const error = recoveryCallbackError();
    if (recoverySessionEstablished) authPanel.showRecovery();
    else { authPanel.showRecoveryUnavailable(error || undefined); clearRecoveryUrl(); }
  } else if (session?.user) await showAuthenticatedUser(session.user);
  else authPanel.show();
}

start().catch(error => { authPanel.show(); authPanel.setMessage(error.message || 'Could not start the application.'); });
