import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { appMetadata } from '../config/appMetadata.js';
import { renderApplicationIdentity, renderApplicationName } from '../ui/appIdentity.js';
import { createAuthPanel } from '../ui/authPanel.js';
import { createModalFocus } from '../ui/modalFocus.js';
import { createNavigationController, receiptRoutes } from '../ui/navigationController.js';
import { createThemeController, themeStorageKey } from '../ui/themeController.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const html = await read('../index.html');
const staticHtml = html.replace(/<template[\s\S]*?<\/template>/g, '');

// ---- identity ----------------------------------------------------------------------------------
test('the official display name comes from the one metadata value and the version is unchanged', () => {
  assert.equal(appMetadata.name, 'FS Receipt Management Tool');
  assert.equal(appMetadata.version, '3.6.0-beta.1');
});

test('runtime identity writes the title, metadata and every [data-app-name] element from appMetadata', () => {
  const brandTargets = [{ textContent: '' }, { textContent: '' }, { textContent: '' }];
  const metas = [{ content: '', setAttribute(name, value) { this.content = value; } }, { content: '', setAttribute(name, value) { this.content = value; } }];
  const documentRef = { title: 'old', querySelectorAll: selector => selector === '[data-app-name]' ? brandTargets : metas };
  assert.equal(renderApplicationName(documentRef, appMetadata), 'FS Receipt Management Tool');
  assert.equal(documentRef.title, 'FS Receipt Management Tool');
  assert.ok(brandTargets.every(target => target.textContent === 'FS Receipt Management Tool'));
  assert.ok(metas.every(meta => meta.content === 'FS Receipt Management Tool'));
  const version = { textContent: '' };
  assert.equal(renderApplicationIdentity([version], appMetadata), 'FS Receipt Management Tool v3.6.0-beta.1');
  renderApplicationName({ title: '' }, appMetadata);                      // documents without querySelectorAll are tolerated
});

test('static markup carries the official name and no user-facing legacy name', async () => {
  assert.match(html, /<title>FS Receipt Management Tool<\/title>/);
  assert.match(html, /<meta name="application-name" content="FS Receipt Management Tool" \/>/);
  const brands = [...staticHtml.matchAll(/<[^>]*data-app-name[^>]*>([^<]*)</g)].map(match => match[1]);
  assert.equal(brands.length, 3, 'sign-in title, sidebar brand and phone top bar');
  assert.ok(brands.every(text => text === 'FS Receipt Management Tool'));
  assert.doesNotMatch(html, /FSResibo|FSRESIBO/, 'the internal codename is not shown to users');
  for (const path of ['../app.js', '../ui/receiptUi.js', '../ui/monthlyFilingUi.js', '../ui/authPanel.js']) assert.doesNotMatch(await read(path), /['"`][^'"`\n]*FSResibo[^'"`\n]*['"`]/, `${path} has no user-facing legacy name`);
  assert.equal(themeStorageKey, 'fsresibo:theme-preference', 'internal storage keys keep the codename');
});

// ---- official logo ----------------------------------------------------------------------------------
test('the official logo asset ships in the repository, unmodified, 680x207 with an alpha channel', async () => {
  const bytes = await readFile(new URL('../assets/fs-automation-logo.png', import.meta.url));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), 680);
  assert.equal(bytes.readUInt32BE(20), 207);
  assert.equal(bytes[25], 6, 'RGBA colour type keeps the artwork transparent');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'f605016e8f0a66e8734c40a81aad7eba439e908011f8ded76355ddc34b65b2bf');
});

test('the sign-in logo uses a local relative URL, native proportions and no external branding assets', async () => {
  const image = staticHtml.match(/<img class="auth-logo"[^>]*>/)?.[0] ?? '';
  assert.match(image, /src="assets\/fs-automation-logo\.png"/);
  assert.match(image, /width="680" height="207"/);
  assert.match(image, /alt="FS Automation"/);
  assert.ok(!/(https?:)?\/\//.test(image), 'the logo is not hosted externally');
  for (const tag of staticHtml.match(/<img[^>]*>/g)) assert.doesNotMatch(tag, /src="(https?:)?\/\//);
  const css = await read('../auth.css');
  assert.match(css, /\.auth-logo \{[^}]*width: 212px;[^}]*height: auto;/, 'height follows the width so the aspect ratio is preserved');
  assert.match(css, /html\[data-theme="dark"\] \.auth-logo \{[^}]*background: var\(--logo-plate\)/, 'dark theme uses a light backing plate');
  assert.doesNotMatch(css, /filter\s*:|hue-rotate|invert\(/, 'the artwork is never recoloured');
});

// ---- shell markup ----------------------------------------------------------------------------------------
test('static ids are unique and the sidebar owns navigation and every account control exactly once', () => {
  const ids = [...staticHtml.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.filter((id, index) => ids.indexOf(id) !== index)}`);
  const drawer = staticHtml.match(/<aside class="application-navigation"[\s\S]*?<\/aside>/)[0];
  for (const id of ['receiptsNavigationItem', 'monthlyFilingNavigationItem', 'quickOptimizerNavigationItem', 'userEmail', 'sessionFeedback', 'themePreference', 'logout', 'appVersion']) assert.match(drawer, new RegExp(`id="${id}"`), `${id} is in the sidebar/drawer`);
  assert.equal((staticHtml.match(/id="logout"/g) ?? []).length, 1);
  assert.equal((staticHtml.match(/id="themePreference"/g) ?? []).length, 1);
  assert.equal((staticHtml.match(/id="authThemePreference"/g) ?? []).length, 1);
  assert.match(drawer, /<nav aria-label="Workflows">/);
  assert.match(drawer, /id="receiptsNavigationItem"[^>]*aria-current="page"/);
  assert.match(staticHtml, /id="navigationMenuButton"[^>]*aria-expanded="false"[^>]*aria-controls="navigationDrawer"/);
  assert.match(staticHtml, /id="navigationDrawerBackdrop"[^>]*hidden/);
});

test('page chrome is reduced: no application header, numbering, eyebrows or repeated descriptions', () => {
  assert.doesNotMatch(staticHtml, /app-header|Receipt workflows|WORKSPACE \d|WORKFLOW \d|AMOUNT CALCULATOR|header-actions/);
  assert.doesNotMatch(staticHtml, /Encode, file, or calculate/);
  const workspaces = { encodingWorkspace: 'Receipt Encoding', optimizationWorkspace: 'Receipt Optimization', monthlyFilingWorkspace: 'Monthly Filing', quickOptimizerWorkspace: 'Quick Optimizer' };
  for (const [id, heading] of Object.entries(workspaces)) {
    const section = staticHtml.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?(?=<section class="workspace-view|<div class="edit-modal|</div>\\s*</main>)`))?.[0] ?? '';
    const headings = [...section.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)].map(match => match[1]);
    assert.deepEqual(headings, [heading], `${id} has exactly one task heading`);
  }
  assert.equal((staticHtml.match(/<h3\b/g) ?? []).length, 0, 'panel titles follow the workspace h1 as h2');
  assert.match(staticHtml, /<h1 data-app-name>FS Receipt Management Tool<\/h1>/, 'the sign-in page is titled with the product name');
  assert.match(staticHtml, /id="quickOptimizerWorkspace" hidden/);
});

test('sign-in, registration, reset and new-password forms keep their ids and the neutral copy', () => {
  for (const id of ['loginForm', 'registerForm', 'resetForm', 'recoveryForm', 'loginEmail', 'loginPassword', 'showReset', 'showLogin', 'backToLogin', 'backFromRecovery', 'authMessage', 'authVersion']) assert.match(staticHtml, new RegExp(`id="${id}"`));
  assert.match(staticHtml, /Accounts are managed by FS Automation\./);
  assert.match(staticHtml, /Choose a new password for your account\./);
});

// ---- theme ----------------------------------------------------------------------------------------------------
const storageStub = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values }; };
const selectStub = () => { const listeners = []; return { value: 'system', addEventListener: (name, listener) => listeners.push(listener), change(value) { this.value = value; listeners.forEach(listener => listener()); } }; };
const mediaStub = matches => { const listeners = []; return { matches, addEventListener: (name, listener) => listeners.push(listener), set(next) { this.matches = next; listeners.forEach(listener => listener()); } }; };
const rootStub = () => ({ dataset: {}, style: {} });

test('two theme selectors (sign-in and sidebar) stay synchronized with one stored preference', () => {
  const [authSelect, appSelect] = [selectStub(), selectStub()];
  const [root, storage] = [rootStub(), storageStub()];
  createThemeController({ selects: [appSelect, authSelect], root, storage, media: mediaStub(false) }).restore();
  assert.deepEqual([authSelect.value, appSelect.value], ['system', 'system']);
  authSelect.change('dark');
  assert.equal(appSelect.value, 'dark', 'choosing on the sign-in screen updates the sidebar selector');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(storage.values.get('fsresibo:theme-preference'), 'dark');
  appSelect.change('light');
  assert.equal(authSelect.value, 'light');
  assert.equal(root.dataset.theme, 'light');
  assert.equal(storage.values.get('fsresibo:theme-preference'), 'light');
});

test('the saved preference survives a reload (logout and login) and restores into both selectors', () => {
  const storage = storageStub();
  storage.setItem('fsresibo:theme-preference', 'dark');
  const [authSelect, appSelect, root] = [selectStub(), selectStub(), rootStub()];
  const controller = createThemeController({ selects: [authSelect, appSelect], root, storage, media: mediaStub(false) });
  assert.equal(controller.restore(), 'dark');
  assert.deepEqual([authSelect.value, appSelect.value], ['dark', 'dark']);
  assert.equal(root.dataset.themePreference, 'dark');
});

test('the System preference follows the operating system and does not override explicit choices', () => {
  const [select, root, storage, media] = [selectStub(), rootStub(), storageStub(), mediaStub(true)];
  const controller = createThemeController({ selects: [select], root, storage, media });
  controller.restore();
  assert.equal(root.dataset.theme, 'dark');
  media.set(false);
  assert.equal(root.dataset.theme, 'light', 'System follows an OS change');
  select.change('dark');
  media.set(false);
  assert.equal(root.dataset.theme, 'dark', 'an explicit choice ignores OS changes');
  assert.equal(controller.getPreference(), 'dark');
});

test('the single-select controller API still works', () => {
  const [select, root, storage] = [selectStub(), rootStub(), storageStub()];
  createThemeController({ select, root, storage, media: mediaStub(false) }).restore();
  select.change('light');
  assert.equal(root.dataset.theme, 'light');
  assert.equal(storage.values.get('fsresibo:theme-preference'), 'light');
});

// ---- drawer ------------------------------------------------------------------------------------------------------
const control = () => {
  const listeners = new Map(); const attributes = new Map();
  return { hidden: false, tabIndex: 0, focusCount: 0, addEventListener: (name, listener) => listeners.set(name, listener), emit: (name, event = {}) => listeners.get(name)?.({ preventDefault() {}, ...event }),
    setAttribute(name, value) { attributes.set(name, String(value)); }, getAttribute: name => attributes.get(name) ?? null, removeAttribute: name => attributes.delete(name), hasAttribute: name => attributes.has(name), focus() { this.focusCount += 1; } };
};
const makeShell = ({ mobile = true } = {}) => {
  const documentListeners = []; const windowListeners = new Map();
  const bodyClasses = new Set();
  const document = { title: '', body: { classList: { toggle: (name, on) => on ? bodyClasses.add(name) : bodyClasses.delete(name) } }, addEventListener: (name, listener, capture) => documentListeners.push({ name, listener, capture }) };
  const location = { href: 'https://example.test/#receipts/encoding', hash: '#receipts/encoding' };
  const window = { location, addEventListener: (name, listener) => windowListeners.set(name, listener), emit: name => windowListeners.get(name)?.(), matchMedia: () => ({ matches: mobile }), history: { replaceState: (_s, _t, url) => { location.href = String(url); location.hash = new URL(String(url)).hash; } } };
  const elements = Object.fromEntries(['menuButton', 'drawer', 'drawerBackdrop', 'receiptsNav', 'monthlyNav', 'quickNav', 'encodingTab', 'optimizationTab', 'content'].map(name => [name, control()]));
  const routes = [];
  const controller = createNavigationController({ window, document, elements, onRoute: workspace => routes.push(workspace) });
  controller.start();
  const pressEscape = () => documentListeners.filter(item => item.name === 'keydown').forEach(item => item.listener({ key: 'Escape', preventDefault() {} }));
  return { controller, elements, window, location, bodyClasses, pressEscape, documentListeners, document, routes };
};

test('opening the phone drawer moves focus into it, makes the page inert, locks scrolling and reflects aria-expanded', () => {
  const { elements, bodyClasses } = makeShell();
  assert.equal(elements.drawer.hidden, true);
  assert.equal(elements.menuButton.getAttribute('aria-expanded'), 'false');
  elements.menuButton.emit('click');
  assert.equal(elements.drawer.hidden, false);
  assert.equal(elements.menuButton.getAttribute('aria-expanded'), 'true');
  assert.equal(elements.drawerBackdrop.hidden, false);
  assert.equal(elements.content.hasAttribute('inert'), true, 'the page behind the drawer is not keyboard reachable');
  assert.equal(elements.receiptsNav.focusCount, 1, 'focus moves to the first navigation item');
  assert.equal(bodyClasses.has('drawer-open'), true);
});

test('Escape, the backdrop and choosing a destination each close the drawer and release the page', () => {
  for (const close of [shell => shell.pressEscape(), shell => shell.elements.drawerBackdrop.emit('click'), shell => shell.elements.monthlyNav.emit('click')]) {
    const shell = makeShell();
    shell.elements.menuButton.emit('click');
    close(shell);
    assert.equal(shell.elements.drawer.hidden, true);
    assert.equal(shell.elements.menuButton.getAttribute('aria-expanded'), 'false');
    assert.equal(shell.elements.content.hasAttribute('inert'), false, 'the page is interactive again');
    assert.equal(shell.bodyClasses.has('drawer-open'), false, 'scrolling is unlocked');
    assert.ok(shell.elements.menuButton.focusCount >= 1, 'focus returns to the menu button');
  }
});

test('navigation from the drawer keeps the existing hash routes', () => {
  const shell = makeShell();
  shell.elements.menuButton.emit('click');
  shell.elements.quickNav.emit('click');
  assert.equal(shell.location.hash, 'quick-optimizer');
  shell.window.emit('hashchange');
  assert.equal(shell.controller.activeRoute, 'quick-optimizer');
  assert.equal(shell.elements.quickNav.getAttribute('aria-current'), 'page');
  assert.equal(shell.elements.receiptsNav.getAttribute('aria-current'), 'false');
  shell.location.hash = '#receipts/encoding';           // browser Back
  shell.window.emit('hashchange');
  assert.equal(shell.controller.activeRoute, receiptRoutes.encoding);
  assert.equal(shell.elements.receiptsNav.getAttribute('aria-current'), 'page');
});

test('on desktop the sidebar is always visible and never makes the page inert', () => {
  const shell = makeShell({ mobile: false });
  assert.equal(shell.elements.drawer.hidden, false);
  assert.equal(shell.elements.content.hasAttribute('inert'), false);
  shell.elements.monthlyNav.emit('click');
  shell.pressEscape();
  assert.equal(shell.elements.drawer.hidden, false);
  assert.equal(shell.elements.content.hasAttribute('inert'), false);
  assert.equal(shell.bodyClasses.has('drawer-open'), false);
});

test('a resize back to a wide window releases the inert page and scroll lock', () => {
  const shell = makeShell();
  shell.elements.menuButton.emit('click');
  shell.window.emit('resize');
  assert.equal(shell.elements.content.hasAttribute('inert'), false);
  assert.equal(shell.bodyClasses.has('drawer-open'), false);
});

test('a dialog owns Escape: the modal manager handles it first, so the drawer handler never competes', () => {
  const listeners = [];
  const doc = { activeElement: null, body: { children: [], classList: { toggle() {} } }, title: '', addEventListener: (name, listener, capture = false) => listeners.push({ name, listener, capture }) };
  const press = key => { let stopped = false; const event = { key, preventDefault() {}, stopImmediatePropagation() { stopped = true; } }; for (const item of [...listeners.filter(entry => entry.capture), ...listeners.filter(entry => !entry.capture)]) if (item.name === 'keydown' && !stopped) item.listener(event); };
  const modalFocus = createModalFocus({ documentRef: doc, isVisible: () => true });
  const location = { href: 'https://example.test/#receipts/encoding', hash: '#receipts/encoding' };
  const elements = Object.fromEntries(['menuButton', 'drawer', 'drawerBackdrop', 'receiptsNav', 'monthlyNav', 'quickNav', 'encodingTab', 'optimizationTab', 'content'].map(name => [name, control()]));
  createNavigationController({ window: { location, addEventListener() {}, matchMedia: () => ({ matches: true }), history: { replaceState() {} } }, document: doc, elements, onRoute() {} }).start();
  elements.drawer.hidden = false;                                    // a visible drawer that the dialog sits above
  const dialog = Object.assign(control(), { tagName: 'SECTION', parentElement: doc.body, children: [], contains: () => false, querySelectorAll: () => [] });
  doc.body.children.push(dialog);
  let closed = 0;
  modalFocus.open(dialog, { trigger: null, onEscape: () => { closed += 1; modalFocus.close(dialog); } });
  press('Escape');
  assert.equal(closed, 1, 'the dialog closed');
  assert.equal(elements.drawer.hidden, false, 'the same Escape did not also close the drawer');
  press('Escape');
  assert.equal(elements.drawer.hidden, true, 'a later Escape closes the drawer');
});

// ---- views --------------------------------------------------------------------------------------------------------------
test('sign-in, recovery and the application swap views without leaving both visible', () => {
  const form = () => ({ hidden: false, addEventListener() {} });
  const elements = { authView: { hidden: true }, appView: { hidden: true }, loginForm: form(), registerForm: form(), resetForm: form(), recoveryForm: form(), showLogin: form(), authMessage: { textContent: '' }, loginEmail: {}, loginPassword: {}, registerEmail: {}, registerPassword: {}, registerConfirmPassword: {}, resetEmail: {}, recoveryPassword: {}, recoveryConfirmPassword: {} };
  const panel = createAuthPanel(elements, {});
  panel.show();
  assert.deepEqual([elements.authView.hidden, elements.appView.hidden, elements.loginForm.hidden, elements.recoveryForm.hidden], [false, true, false, true]);
  panel.showRecovery();
  assert.deepEqual([elements.loginForm.hidden, elements.recoveryForm.hidden, elements.resetForm.hidden], [true, false, true]);
  panel.showRecoveryUnavailable();
  assert.deepEqual([elements.resetForm.hidden, elements.recoveryForm.hidden], [false, true]);
  assert.match(elements.authMessage.textContent, /invalid or expired/);
  panel.hide();
  assert.deepEqual([elements.authView.hidden, elements.appView.hidden], [true, false]);
});

// ---- CP6 review corrections ----------------------------------------------------------------------------------------------
const tabShell = ({ mobile = true } = {}) => {
  const shell = makeShell({ mobile });
  const stops = ['receiptsNav', 'monthlyNav', 'quickNav'].map(name => shell.elements[name]);
  const themeSelect = control(); const logout = control();
  const drawerStops = [...stops, themeSelect, logout];
  shell.elements.drawer.querySelectorAll = () => drawerStops;
  shell.document.activeElement = null;
  const press = (key, { shiftKey = false } = {}, target = shell.elements.drawer) => { let prevented = false; const event = { key, shiftKey, preventDefault() { prevented = true; } }; target.emit('keydown', event); return prevented; };
  return { ...shell, drawerStops, themeSelect, logout, press };
};

test('Tab and Shift+Tab stay inside the open phone drawer, wrapping between the menu button and the last control', () => {
  const shell = tabShell();
  shell.elements.menuButton.emit('click');
  shell.document.activeElement = shell.logout;
  assert.equal(shell.press('Tab'), true);
  assert.equal(shell.elements.menuButton.focusCount, 1, 'forward from Log out wraps to the first stop (the menu button)');
  shell.document.activeElement = shell.elements.menuButton;
  assert.equal(shell.press('Tab', {}, shell.elements.menuButton), true);
  assert.equal(shell.elements.receiptsNav.focusCount, 2, 'forward from the menu button enters the drawer');
  shell.document.activeElement = shell.elements.menuButton;
  const logoutBefore = shell.logout.focusCount;
  shell.press('Tab', { shiftKey: true }, shell.elements.menuButton);
  assert.equal(shell.logout.focusCount, logoutBefore + 1, 'Shift+Tab from the first stop wraps to Log out');
  shell.document.activeElement = shell.themeSelect;
  shell.press('Tab');
  assert.equal(shell.logout.focusCount, logoutBefore + 2, 'the theme select and Log out stay reachable in order');
});

test('drawer Tab handling is inactive on desktop, when the drawer is closed and for modified or already handled keys', () => {
  const desktop = tabShell({ mobile: false });
  desktop.document.activeElement = desktop.logout;
  assert.equal(desktop.press('Tab'), false);
  const closed = tabShell();
  closed.document.activeElement = closed.logout;
  assert.equal(closed.press('Tab'), false);
  const open = tabShell(); open.elements.menuButton.emit('click'); open.document.activeElement = open.logout;
  let prevented = false;
  open.elements.drawer.emit('keydown', { key: 'Tab', ctrlKey: true, preventDefault() { prevented = true; } });
  open.elements.drawer.emit('keydown', { key: 'Tab', defaultPrevented: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
});

test('showing any authentication screen releases the drawer: closed, page interactive, scroll unlocked', () => {
  const shell = makeShell();
  const form = () => ({ hidden: false, addEventListener() {} });
  const elements = { authView: { hidden: true }, appView: { hidden: false }, loginForm: form(), registerForm: form(), resetForm: form(), recoveryForm: form(), showLogin: form(), authMessage: { textContent: '' } };
  const panel = createAuthPanel(elements, { onShow: () => shell.controller.setDrawer(false) });
  for (const show of [() => panel.show(), () => panel.showRecovery(), () => panel.showRecoveryUnavailable()]) {
    shell.elements.menuButton.emit('click');                       // the phone drawer is open, as when Log out is pressed
    assert.equal(shell.bodyClasses.has('drawer-open'), true);
    show();
    assert.equal(shell.bodyClasses.has('drawer-open'), false, 'the login screen can scroll');
    assert.equal(shell.elements.content.hasAttribute('inert'), false);
    assert.equal(shell.elements.drawer.hidden, true);
    assert.equal(shell.elements.menuButton.getAttribute('aria-expanded'), 'false');
    assert.equal(elements.authView.hidden, false);
  }
  shell.elements.menuButton.emit('click');                         // a later session opens and closes the drawer normally
  assert.equal(shell.elements.drawer.hidden, false);
});

test('app.js wires the drawer release into the authentication panel and keeps logout failures in the sidebar', async () => {
  const app = await read('../app.js');
  assert.ok(app.includes('onShow: () => navigationController.setDrawer(false)'), 'the auth panel releases the drawer');
  assert.ok(app.includes('catch (error) { elements.sessionFeedback.textContent = `Could not sign out: '), 'a failed sign-out stays visible in the open drawer');
  assert.ok(!app.split('Could not sign out')[1].split('});')[0].includes('setDrawer'), 'a failed sign-out does not close the drawer');
});

test('the Edit button itself is the dialog trigger, so focus returns to it even when the click did not focus it', async () => {
  const source = await read('../ui/receiptUi.js');
  assert.ok(source.includes("compact-edit').addEventListener('click', event => openEditModal(entry.index, event.currentTarget)"));
  assert.ok(source.includes('modalFocus?.open(elements.editModal, { trigger,'));
  const doc = { activeElement: { tagName: 'BODY', isConnected: true }, body: { children: [] }, addEventListener() {} };
  const modalFocus = createModalFocus({ documentRef: doc, isVisible: () => true });
  const dialog = Object.assign(control(), { tagName: 'SECTION', parentElement: doc.body, children: [], hasAttribute: () => false });
  doc.body.children.push(dialog);
  const editButton = Object.assign(control(), { isConnected: true });
  const fallback = Object.assign(control(), { isConnected: true });
  for (const close of ['escape', 'cancel', 'save']) {
    editButton.focusCount = 0; fallback.focusCount = 0;
    modalFocus.open(dialog, { trigger: editButton, fallback });
    modalFocus.close(dialog, { fallback });
    assert.equal(editButton.focusCount, 1, close + ': focus returns to the Edit button');
    assert.equal(fallback.focusCount, 0);
  }
  editButton.isConnected = false;                                  // the card was rebuilt after a saved correction
  modalFocus.open(dialog, { trigger: editButton, fallback });
  modalFocus.close(dialog, { fallback });
  assert.equal(fallback.focusCount, 1, 'a replaced Edit button falls back; restoreEditTriggerFocus then targets the new button');
});
