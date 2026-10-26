import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { philippineDateStamp } from '../domain/exportDate.js';
import { createAuthPanel } from '../ui/authPanel.js';
import { monthlyFilingExportFilename } from '../ui/monthlyFilingUi.js';
import { amountCellFormat, buildExpenseDetailedReportRows, createExpenseDetailedReportWorkbook, createSelectedReceiptsWorkbook } from '../services/exportService.js';
import { read, utils, write } from '../vendor/sheetjs/xlsx-0.20.3.mjs';

const text = path => readFile(new URL(path, import.meta.url), 'utf8');

// ---- PF-01 ---------------------------------------------------------------------------------------------------------------------------------
test('PF-01: the export date is the Philippine calendar date, including the midnight boundary', () => {
  assert.equal(philippineDateStamp(new Date('2026-10-17T16:30:00Z')), '2026-10-18');
  assert.equal(philippineDateStamp(new Date('2026-10-18T15:59:59Z')), '2026-10-18');
  assert.equal(philippineDateStamp(new Date('2026-10-18T16:00:00Z')), '2026-10-19');
  assert.equal(philippineDateStamp(new Date('2026-12-31T16:00:00Z')), '2027-01-01', 'year rollover');
  assert.equal(philippineDateStamp(new Date('2026-02-28T16:00:00Z')), '2026-03-01', 'month rollover');
  assert.match(philippineDateStamp(), /^\d{4}-\d{2}-\d{2}$/);
});

test('PF-01: the result does not depend on the runtime or device timezone', () => {
  const script = "import { philippineDateStamp } from './domain/exportDate.js'; console.log(['2026-10-17T16:30:00Z', '2026-10-18T15:59:59Z', '2026-10-18T16:00:00Z'].map(value => philippineDateStamp(new Date(value))).join(','));";
  const root = new URL('..', import.meta.url);
  for (const zone of ['UTC', 'Pacific/Honolulu', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Manila', 'Pacific/Kiritimati']) {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env: { ...process.env, TZ: zone } }).toString().trim();
    assert.equal(output, '2026-10-18,2026-10-18,2026-10-19', zone);
  }
});

test('PF-01: both export paths build their filename from the Philippine date and only the filename changed', async () => {
  assert.equal(monthlyFilingExportFilename(new Date('2026-10-17T16:30:00Z')), 'fsresibo-monthly-filing-2026-10-18.xlsx');
  assert.equal(monthlyFilingExportFilename(new Date('2026-10-18T15:59:59Z')), 'fsresibo-monthly-filing-2026-10-18.xlsx');
  const exporter = await text('../services/exportService.js'); const monthly = await text('../ui/monthlyFilingUi.js'); const helper = await text('../domain/exportDate.js');
  assert.match(exporter, /filename = `fsresibo-selected-receipts-\$\{philippineDateStamp\(\)\}\.xlsx`/);
  assert.doesNotMatch(exporter, /toISOString/); assert.doesNotMatch(monthly, /toISOString/);
  assert.match(helper, /formatToParts/); assert.match(helper, /timeZone: 'Asia\/Manila'/); assert.doesNotMatch(helper, /toLocale|slice\(0, 10\)/, 'no locale string ordering');
  assert.match(monthly, /from '\.\.\/domain\/exportDate\.js'/);
});

// ---- AUTH-03 ---------------------------------------------------------------------------------------------------------------------------------
function authFixture() {
  const node = (extra = {}) => ({ hidden: false, value: '', textContent: '', listeners: {}, addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }, ...extra });
  const elements = {
    loginForm: node(), registerForm: node({ hidden: true }), resetForm: node({ hidden: true }), recoveryForm: node({ hidden: true }),
    authMessage: node(), authView: node({ hidden: true }), appView: node(), showLogin: node(), showRegister: node(), showReset: node(), backToLogin: node(), backFromRecovery: node(),
    loginEmail: node({ value: 'user@example.test' }), loginPassword: node({ value: 'secret' }), registerEmail: node({ value: 'new@example.test' }), registerPassword: node({ value: 'pw1' }), registerConfirmPassword: node({ value: 'pw1' }),
    resetEmail: node({ value: 'reset@example.test' }), recoveryPassword: node({ value: 'pw2' }), recoveryConfirmPassword: node({ value: 'pw2' })
  };
  const calls = { login: [] };
  let loginResult = Promise.resolve();
  const panel = createAuthPanel(elements, { onLogin: async (email, password) => { calls.login.push([email, password]); return loginResult; }, onRegister: async () => ({}), onPasswordReset: async () => {}, onUpdatePassword: async () => {}, onShow: () => {} });
  const submit = form => Promise.all(form.listeners.submit.map(listener => listener({ preventDefault() {} })));
  const passwords = () => ['loginPassword', 'registerPassword', 'registerConfirmPassword', 'recoveryPassword', 'recoveryConfirmPassword'].map(key => elements[key].value);
  return { elements, panel, calls, submit, passwords, failNextLogin: () => { loginResult = Promise.reject(new Error('Invalid login credentials')); loginResult.catch(() => {}); } };
}

test('AUTH-03: all five password fields are emptied when the panel opens after logout and when it closes; emails stay', () => {
  const f = authFixture();
  f.panel.show();
  assert.deepEqual(f.passwords(), ['', '', '', '', '']);
  assert.equal(f.elements.loginEmail.value, 'user@example.test'); assert.equal(f.elements.registerEmail.value, 'new@example.test'); assert.equal(f.elements.resetEmail.value, 'reset@example.test');
  f.elements.loginPassword.value = 'again'; f.elements.recoveryPassword.value = 'x'; f.elements.registerConfirmPassword.value = 'y';
  f.panel.hide(); assert.deepEqual(f.passwords(), ['', '', '', '', ''], 'closing the panel (sign-in) clears them too');
  assert.equal(f.elements.authView.hidden, true); assert.equal(f.elements.appView.hidden, false);
});

test('AUTH-03: the recovery screen opens with empty password fields, and the unavailable-link screen clears them too', () => {
  const f = authFixture();
  f.panel.showRecovery(); assert.deepEqual(f.passwords(), ['', '', '', '', '']); assert.equal(f.elements.recoveryForm.hidden, false); assert.equal(f.elements.loginForm.hidden, true);
  f.elements.recoveryPassword.value = 'typed'; f.elements.recoveryConfirmPassword.value = 'typed';
  f.panel.showRecoveryUnavailable(); assert.deepEqual(f.passwords(), ['', '', '', '', '']); assert.equal(f.elements.resetForm.hidden, false);
});

test('AUTH-03: a failed login keeps the typed password; re-showing the open form does not wipe typing', async () => {
  const f = authFixture(); f.panel.show();
  f.elements.loginPassword.value = 'wrong-pass'; f.failNextLogin();
  await f.submit(f.elements.loginForm);
  assert.deepEqual(f.calls.login, [['user@example.test', 'wrong-pass']]);
  assert.equal(f.elements.loginPassword.value, 'wrong-pass', 'the user can correct it'); assert.equal(f.elements.authMessage.textContent, 'Invalid login credentials');
  f.panel.show('Session ended elsewhere'); assert.equal(f.elements.loginPassword.value, 'wrong-pass', 'an unrelated show() while the login form is already open keeps the typing');
  f.panel.setMessage('note'); assert.equal(f.elements.loginPassword.value, 'wrong-pass');
});

test('AUTH-03: switching between the sign-in links and the recovery flow semantics are unchanged', async () => {
  const f = authFixture(); f.panel.show(); f.elements.loginPassword.value = 'kept';
  f.elements.showRegister.listeners.click[0](); assert.equal(f.elements.loginPassword.value, 'kept', 'user-driven form switches never clear anything');
  f.panel.showRecovery(); f.elements.recoveryPassword.value = 'abcdef'; f.elements.recoveryConfirmPassword.value = 'abcdef';
  const updates = []; // the form still validates and submits exactly as before
  const g = authFixture(); g.panel.showRecovery(); g.elements.recoveryPassword.value = 'abc'; g.elements.recoveryConfirmPassword.value = 'abc'; await g.submit(g.elements.recoveryForm);
  assert.equal(g.elements.authMessage.textContent, 'Use at least 6 characters for the new password.'); assert.equal(g.elements.recoveryPassword.value, 'abc'); void updates;
  const source = await text('../ui/authPanel.js');
  assert.doesNotMatch(source, /addEventListener\('input'/, 'nothing clears a field while the user types');
  const html = await text('../index.html');
  for (const [id, value] of [['loginPassword', 'current-password'], ['registerPassword', 'new-password'], ['registerConfirmPassword', 'new-password'], ['recoveryPassword', 'new-password'], ['recoveryConfirmPassword', 'new-password']]) assert.match(html, new RegExp(`id="${id}" type="password" autocomplete="${value}"`), `${id} keeps its autocomplete`);
});

// ---- PF-02 ---------------------------------------------------------------------------------------------------------------------------------
test('PF-02: a self-contained SVG favicon in the brand colours is linked by a relative path (GitHub Pages sub-path safe)', async () => {
  const html = await text('../index.html'); const svg = await text('../assets/favicon.svg'); const css = await text('../styles.css');
  assert.equal((html.match(/rel="icon"/g) ?? []).length, 1);
  assert.match(html, /<link rel="icon" href="assets\/favicon\.svg" type="image\/svg\+xml" \/>/, 'relative path, no leading slash');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64"/);
  assert.doesNotMatch(svg.replace('xmlns="http://www.w3.org/2000/svg"', ''), /https?:|href=|url\(|<image|<script|<style|@import/, 'no external dependency');
  const sigBlue = css.match(/--sig-blue: (#[0-9a-f]{6});/i)[1].toLowerCase(); const sigRed = css.match(/--sig-red: (#[0-9a-f]{6});/i)[1].toLowerCase();
  assert.ok(svg.toLowerCase().includes(sigBlue) && svg.toLowerCase().includes(sigRed), 'the brand slash blue and red');
  assert.match(svg, /skewX\(-22\)/, 'the same skew as the CSS brand slash');
  const logo = await readFile(new URL('../assets/fs-automation-logo.png', import.meta.url)); assert.equal(logo.length, 55484, 'the official logo is untouched');
});

// ---- EXPORT-UX-01 / EXPORT-UX-02 --------------------------------------------------------------------------------------------------------------
const receiptWith = (amount, extra = {}) => ({ dbId: 'x', receiptDate: '2026-07-13', store: 'Alpha', address: 'Makati', vat: 'VAT', tin: '123', invoice: 'OR-1', amount, ...extra });
const amountCell = amount => createExpenseDetailedReportWorkbook([receiptWith(amount)]).Sheets['Selected Receipts'].H3;

test('EXPORT-UX-01: Amount cells stay numeric, keep their exact value and carry the #,##0.00 format (1,250.50 / 100.00 / 0.00)', () => {
  assert.equal(amountCellFormat, '#,##0.00');
  for (const [input, value, shown] of [['1250.5', 1250.5, '1,250.50'], [100, 100, '100.00'], ['0', 0, '0.00'], ['1,234,567.89', 1234567.89, '1,234,567.89'], ['0.10', 0.1, '0.10']]) {
    const cell = amountCell(input); assert.equal(cell.t, 'n'); assert.equal(cell.v, value, 'the numeric value is untouched'); assert.equal(cell.z, '#,##0.00');
    assert.equal(utils.format_cell(cell), shown, `${input} is displayed as ${shown}`);
  }
});

test('EXPORT-UX-01: only Amount cells get the money format; the structure, merges, headers and Item No. are unchanged; the workbook round-trips', () => {
  const workbook = createSelectedReceiptsWorkbook([receiptWith('1250.5'), receiptWith('20', { store: 'Beta' })]);
  const sheet = workbook.Sheets['Selected Receipts'];
  assert.equal(sheet['!ref'], 'A1:O4'); assert.deepEqual(workbook.SheetNames, ['Selected Receipts']);
  assert.equal(sheet.A3.v, 1); assert.equal(sheet.A4.v, 2); assert.equal(sheet.B3.z, 'd-mmm');
  for (const cell of ['A3', 'C3', 'D3', 'E3', 'F3', 'G3', 'I3']) assert.notEqual(sheet[cell].z, '#,##0.00', `${cell} is not an Amount cell`);
  assert.equal(sheet['!merges'].length, 14);
  const reopened = read(write(workbook, { bookType: 'xlsx', type: 'array', cellDates: true }), { type: 'array', cellDates: true, cellNF: true }).Sheets['Selected Receipts'];
  assert.deepEqual([reopened.H3.t, reopened.H3.v, reopened.H3.z, reopened.H4.v], ['n', 1250.5, '#,##0.00', 20]);
  assert.equal(utils.format_cell(reopened.H3), '1,250.50');
});

test('EXPORT-UX-02: a missing amount is an empty cell; an explicit zero (number or text) is numeric zero; valid amounts are numeric', () => {
  for (const missing of [undefined, null, '', '   ']) { assert.equal(amountCell(missing), undefined, `${JSON.stringify(missing)} leaves no Amount cell`); assert.equal(buildExpenseDetailedReportRows([receiptWith(missing)])[2][7], null); }
  for (const zero of [0, '0', ' 0 ', '0.00']) { const cell = amountCell(zero); assert.deepEqual([cell.t, cell.v, cell.z], ['n', 0, '#,##0.00'], `${JSON.stringify(zero)} is a numeric zero`); }
  assert.equal(amountCell('0.5').v, 0.5); assert.equal(amountCell(27998).v, 27998); assert.equal(amountCell('9,999,999,999.99').v, 9999999999.99);
  const sheet = createExpenseDetailedReportWorkbook([receiptWith('5'), receiptWith(''), receiptWith('0')]).Sheets['Selected Receipts'];
  assert.deepEqual([sheet.H3.v, sheet.H4, sheet.H5.v], [5, undefined, 0], 'missing and zero are distinguishable in one workbook');
  assert.equal(utils.sheet_to_json(sheet, { header: 1 })[3][7], undefined);
});

test('EXPORT-UX-02: an invalid non-blank amount rejects workbook generation instead of becoming an empty or guessed cell', () => {
  for (const bad of ['abc', '12,34.50', '1,250.999', '-5', '1e3', 'NaN', '₱5', '10000000000.00', '5.', '.5']) {
    assert.throws(() => createExpenseDetailedReportWorkbook([receiptWith('10'), receiptWith(bad)]), /Cannot export receipt amount: Invalid amount/, `${bad} is rejected`);
    assert.throws(() => buildExpenseDetailedReportRows([receiptWith(bad)]), /Cannot export receipt amount/);
  }
});

test('EXPORT-UX-02: the exporter reuses the strict parser and both callers still validate before exporting', async () => {
  const exporter = await text('../services/exportService.js'); const encoding = await text('../ui/receiptUi.js'); const monthly = await text('../ui/monthlyFilingUi.js');
  assert.match(exporter, /import \{ parseMoneyAmount \} from '\.\.\/domain\/moneyAmount\.js';/); assert.doesNotMatch(exporter, /Number\(/);
  // C3E-1: the old invalidExportRow() check became part of the export preflight, which still validates every selected amount.
  assert.match(encoding, /preflightSelection\(\)/); assert.match(encoding, /amountProblem: row \? amountProblem\(row\) : ''/); assert.match(monthly, /parseMoneyAmount\(entry\.record\.amount\)/);
  const money = await text('../domain/moneyAmount.js'); assert.match(money, /export const maximumMoneyCents = 999999999999;/, 'the parser is untouched');
});

// ---- C3-REVIEW-01: explicit sign-out always clears --------------------------------------------------------------------------------------------
test('C3-REVIEW-01: an explicit sign-out clears all five password fields even when the login form is already showing', () => {
  const f = authFixture();
  f.panel.show();                                              // A. the login form is visible
  f.elements.loginPassword.value = 'typed'; f.elements.registerPassword.value = 'r1'; f.elements.registerConfirmPassword.value = 'r2'; f.elements.recoveryPassword.value = 'c1'; f.elements.recoveryConfirmPassword.value = 'c2'; // B. passwords entered
  assert.equal(f.elements.loginForm.hidden, false); assert.equal(f.elements.authView.hidden, false);
  f.panel.show('', { clearPasswords: true });                  // C. explicit sign-out transition
  assert.deepEqual(f.passwords(), ['', '', '', '', ''], 'D. every password is empty');
  assert.equal(f.elements.loginEmail.value, 'user@example.test', 'the email is kept');
});

test('C3-REVIEW-01: default show() still keeps typing; a failed login keeps the password; recovery behaves as before; app.js passes the option only on SIGNED_OUT', async () => {
  const f = authFixture(); f.panel.show(); f.elements.loginPassword.value = 'typing';
  f.panel.show('Notice'); assert.equal(f.elements.loginPassword.value, 'typing', 'a benign repeated show() keeps typed input');
  f.failNextLogin(); return f.submit(f.elements.loginForm).then(async () => {
    assert.equal(f.elements.loginPassword.value, 'typing', 'failed login keeps the password');
    const g = authFixture(); g.panel.showRecovery(); assert.deepEqual(g.passwords(), ['', '', '', '', '']); assert.equal(g.elements.recoveryForm.hidden, false);
    g.elements.recoveryPassword.value = 'abc'; g.panel.showRecovery(); assert.equal(g.elements.recoveryPassword.value, 'abc', 'the open recovery form is not wiped');
    const app = await text('../app.js');
    assert.equal((app.match(/clearPasswords: true/g) ?? []).length, 1, 'only one call site forces the clear');
    assert.match(app, /if \(event === 'SIGNED_OUT'\) \{[\s\S]*?authPanel\.show\(message, \{ clearPasswords: true \}\);/);
  });
});
