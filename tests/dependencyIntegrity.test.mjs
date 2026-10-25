// Issue #32 (CP10-C4-4): runtime dependency pinning and integrity. These tests check what can be checked offline and repeatably: exact versions, recorded hashes of the
// vendored files, the Subresource Integrity attributes in index.html, that no floating or unreviewed external reference exists, and that damaging any of those makes the
// audit fail. They do not, and cannot, verify bytes that a user's browser downloads from a CDN at run time (see the Tesseract worker, core and language data below).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditDependencies, digest, scriptTags, sriOf } from './helpers/dependencyAudit.mjs';
import { OCR_ASSET_PATHS, scanPrintedDetails } from '../services/ocrService.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(repository, 'vendor/dependency-manifest.json'), 'utf8'));
const dependency = id => manifest.dependencies.find(entry => entry.id === id);

test('DEP-1: the repository matches the dependency manifest with no violation', async () => {
  assert.deepEqual(await auditDependencies(repository), []);
});

test('DEP-2: every external script is one exact-version manifest entry with enforced Subresource Integrity, and nothing loads from esm.sh or a floating version', () => {
  const html = readFileSync(path.join(repository, 'index.html'), 'utf8');
  const external = scriptTags(html).filter(tag => /^https?:/.test(tag.src ?? ''));
  assert.deepEqual(external.map(tag => tag.src), ['https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js']);
  for (const tag of external) { assert.match(tag.integrity, /^sha384-[A-Za-z0-9+/]{64}$/); assert.equal(tag.crossorigin, 'anonymous'); }
  const supabase = scriptTags(html).find(tag => tag.src?.startsWith('vendor/supabase/'));
  assert.equal(supabase.src, 'vendor/supabase/supabase-js-2.118.0.umd.js');
  assert.equal(supabase.integrity, dependency('supabase-js').sri);
  assert.doesNotMatch(html, /esm\.sh|@5\/|@2\/|@latest|@next/);
  assert.doesNotMatch(readFileSync(path.join(repository, 'config/supabase.js'), 'utf8'), /esm\.sh|import\s*\(/, 'config/supabase.js has no remote or dynamic import');
});

test('DEP-3: the vendored Supabase bundle is the audited artifact and the SRI in index.html is its real hash', () => {
  const entry = dependency('supabase-js');
  const bytes = readFileSync(path.join(repository, entry.file));
  assert.equal(bytes.length, 218252);
  assert.equal(digest(bytes, 'sha256', 'hex'), 'ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3', 'sha256 recorded at audit time (matches the npm tarball file)');
  assert.equal(sriOf(bytes), 'sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK');
  assert.equal(bytes.includes(13), false, 'no carriage return: the file is byte-exact, so the same hash holds on every checkout');
  assert.match(readFileSync(path.join(repository, 'vendor/supabase/LICENSE.txt'), 'utf8'), /^MIT License/);
  assert.match(readFileSync(path.join(repository, '.gitattributes'), 'utf8'), /^vendor\/supabase\/\*\* -text$/m, 'checkout never rewrites the vendored bytes');
});

test('DEP-4: SheetJS is unchanged (the hash its README documents, taken after normalizing line endings of a Windows checkout)', () => {
  const entry = dependency('sheetjs');
  const stored = readFileSync(path.join(repository, entry.file)).toString('latin1').replace(/\r\n/g, '\n');
  assert.equal(digest(Buffer.from(stored, 'latin1'), 'sha256', 'hex'), '1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db');
  assert.equal(entry.version, '0.20.3');
  assert.equal(entry.integrityClass, 'vendored-hash');
});

test('DEP-5: the OCR asset paths are exact, equal the manifest, and keep the library defaults for LSTM-only English recognition', () => {
  assert.deepEqual({ ...OCR_ASSET_PATHS }, manifest.ocrAssetPaths);
  assert.equal(OCR_ASSET_PATHS.workerPath, 'https://cdn.jsdelivr.net/npm/tesseract.js@v5.1.1/dist/worker.min.js', 'the library default for 5.1.1');
  assert.equal(OCR_ASSET_PATHS.corePath, 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.1.1', 'the library default for core 5.1.1');
  assert.equal(OCR_ASSET_PATHS.langPath, 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int', 'the library default path with the previously missing package version');
  assert.equal(Object.isFrozen(OCR_ASSET_PATHS), true);
});

test('DEP-6: the manifest says plainly which bytes the browser does NOT verify, and no Tesseract run-time asset is claimed as verified', () => {
  const unverified = manifest.dependencies.filter(entry => entry.integrityClass === 'cdn-pinned-unverified').map(entry => entry.id).sort();
  assert.deepEqual(unverified, ['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-eng-data', 'tesseract-worker']);
  assert.deepEqual(manifest.dependencies.filter(entry => entry.integrityClass === 'cdn-sri').map(entry => entry.id), ['tesseract-js']);
  assert.match(manifest.integrityClasses['cdn-pinned-unverified'], /does NOT verify/);
});

// ---- the OCR scan passes exactly the pinned paths and keeps every message -------------------------------------------------------------------------------------------
function ocrRow() {
  const nodes = new Map();
  const part = selector => { if (!nodes.has(selector)) nodes.set(selector, { value: '', textContent: '', className: '', classList: { classes: new Set(), add(name) { this.classes.add(name); } } }); return nodes.get(selector); };
  return { querySelector: part, part };
}

test('DEP-7: scanPrintedDetails calls Tesseract.recognize(file, "eng") with the pinned worker, core and language paths and fills the card as before', async () => {
  const seen = [];
  globalThis.window = { Tesseract: true };
  globalThis.Tesseract = { recognize: async (...args) => { seen.push(args); return { data: { text: 'ACME TRADING\nSales Invoice No. 12345\nTIN 123-456-789-000\nVAT REG' } }; } };
  const row = ocrRow(); let refreshed = 0;
  await scanPrintedDetails({ name: 'receipt.png' }, row, () => { refreshed += 1; });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][1], 'eng');
  assert.deepEqual(seen[0][2], manifest.ocrAssetPaths);
  assert.equal(row.part('.receipt-store').value, 'ACME TRADING');
  assert.equal(row.part('.receipt-tin').value, '123-456-789-000');
  assert.equal(row.part('.ocr-status').textContent, 'Printed details scanned — please review and correct if needed.');
  assert.equal(refreshed, 1);
});

test('DEP-8: OCR failure and a missing OCR library show the same messages as before and never throw', async () => {
  globalThis.window = { Tesseract: true };
  globalThis.Tesseract = { recognize: async () => { throw new Error('Network error while fetching eng.traineddata.gz'); } };
  let row = ocrRow();
  await scanPrintedDetails({}, row, () => {});
  assert.equal(row.part('.ocr-status').textContent, 'Could not read printed details. Please enter them manually.');
  globalThis.window = {}; delete globalThis.Tesseract; row = ocrRow();
  await scanPrintedDetails({}, row, () => {});
  assert.equal(row.part('.ocr-status').textContent, 'Free OCR could not load. Check your internet connection.');
  delete globalThis.window;
});

// ---- Supabase client loading: same construction and cache as before, library now from the vendored global --------------------------------------------------------------
test('DEP-9: getSupabaseClient builds one client from the vendored global with the project URL and key, and caches it (also for concurrent callers)', async () => {
  const { getSupabaseClient, supabaseConfig } = await import('../config/supabase.js');
  const built = [];
  globalThis.supabase = { createClient: (url, key) => { const client = { url, key, id: built.length }; built.push(client); return client; } };
  try {
    const [first, second] = await Promise.all([getSupabaseClient(), getSupabaseClient()]);
    assert.equal(first, second, 'concurrent callers share one client (no duplicate auth instances)');
    assert.equal(await getSupabaseClient(), first, 'later callers get the cached client');
    assert.equal(built.length, 1);
    assert.equal(first.url, supabaseConfig.url); assert.equal(first.key, supabaseConfig.anonKey);
  } finally { delete globalThis.supabase; }
});

test('DEP-10: a library that did not load fails loudly, is not cached as a failure, and recovers when it later appears', async () => {
  const mod = await import(`../config/supabase.js?fresh=${Date.now()}`);
  delete globalThis.supabase;
  await assert.rejects(mod.getSupabaseClient(), /Supabase client library did not load/);
  globalThis.supabase = { createClient: () => ({ ok: true }) };
  try { assert.deepEqual(await mod.getSupabaseClient(), { ok: true }); } finally { delete globalThis.supabase; }
});

test('DEP-11: the real vendored bundle runs and exposes every Supabase call the application uses, sending the project key with REST requests', async () => {
  const requests = [];
  const sandbox = {
    WebSocket: class { constructor() { throw new Error('no sockets in this test'); } }, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, TextEncoder, TextDecoder,
    AbortController, Headers, Request, Response, queueMicrotask, structuredClone, atob, btoa, crypto: globalThis.crypto,
    fetch: async (url, init = {}) => { requests.push({ url: String(url), headers: new Headers(init.headers) }); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(repository, dependency('supabase-js').file), 'utf8'), sandbox);
  assert.equal(typeof sandbox.supabase.createClient, 'function');
  const client = sandbox.supabase.createClient('https://project.example.test', 'public-anon-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  for (const name of ['getSession', 'onAuthStateChange', 'resetPasswordForEmail', 'signInWithPassword', 'signOut', 'signUp', 'updateUser']) assert.equal(typeof client.auth[name], 'function', `auth.${name}`);
  assert.equal(typeof client.from, 'function'); assert.equal(typeof client.rpc, 'function');
  assert.equal(JSON.stringify(await client.auth.getSession()), JSON.stringify({ data: { session: null }, error: null }), 'no session and no network request'); // the bundle runs in another realm, so compare as JSON
  assert.equal(requests.length, 0);
  const result = await client.from('receipts').select('*').limit(1);
  assert.equal(JSON.stringify(result.data), '[]'); assert.equal(result.error, null);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://project.example.test/rest/v1/receipts?select=*&limit=1');
  assert.equal(requests[0].headers.get('apikey'), 'public-anon-key');
});

// ---- the audit itself must fail when a dependency is damaged (negative and mutation checks) ----------------------------------------------------------------------------
function scratchCopy() {
  const directory = mkdtempSync(path.join(tmpdir(), 'dependency-audit-'));
  for (const entry of ['index.html', 'app.js', 'auth.css', 'styles.css', 'config', 'domain', 'services', 'ui', 'assets', 'vendor']) if (existsSync(path.join(repository, entry))) cpSync(path.join(repository, entry), path.join(directory, entry), { recursive: true });
  return directory;
}
// Line endings are normalized to LF first, so the anchors behave the same in a Windows checkout (CRLF) and in CI (LF).
const edit = (directory, file, change) => { const target = path.join(directory, file); writeFileSync(target, change(readFileSync(target, 'utf8').replace(/\r\n/g, '\n'))); };
const replaceOnce = (from, to) => text => { assert.equal(text.split(from).length, 2, `anchor "${from.slice(0, 50)}" must occur exactly once`); return text.replace(from, () => to); };
const mutations = [
  ['a changed byte in the vendored Supabase bundle', d => { const file = path.join(d, 'vendor/supabase/supabase-js-2.118.0.umd.js'); const bytes = readFileSync(file); bytes[1000] ^= 1; writeFileSync(file, bytes); }, /sha256 of vendor\/supabase\/supabase-js-2\.118\.0\.umd\.js|sri of vendor\/supabase/],
  ['a changed byte in the vendored SheetJS build', d => { const file = path.join(d, 'vendor/sheetjs/xlsx-0.20.3.mjs'); const bytes = readFileSync(file); bytes[5000] ^= 1; writeFileSync(file, bytes); }, /sha256 of vendor\/sheetjs/],
  ['a manifest hash edited without the file', d => edit(d, 'vendor/dependency-manifest.json', replaceOnce('ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3', '0'.repeat(64))), /sha256 of vendor\/supabase/],
  ['the Tesseract script going back to a floating major version', d => edit(d, 'index.html', replaceOnce('tesseract.js@5.1.1/dist', 'tesseract.js@5/dist')), /not a manifest dependency|floating/],
  ['the Tesseract script losing its integrity attribute', d => edit(d, 'index.html', text => text.replace(/ integrity="sha384-GJqSu7[^"]*"/, '')), /integrity "" differs/],
  ['the Tesseract script losing crossorigin', d => edit(d, 'index.html', text => text.replace(/ crossorigin="anonymous"/, '')), /needs crossorigin/],
  ['a wrong integrity hash on the vendored Supabase script', d => edit(d, 'index.html', replaceOnce('sha384-TcHRA3zBbn', 'sha384-AcHRA3zBbn')), /integrity "sha384-AcHRA3zBbn[^"]*" differs from the manifest/],
  ['a new unreviewed external script', d => edit(d, 'index.html', replaceOnce('<script type="module" src="app.js"></script>', '<script src="https://esm.sh/some-lib@1.2.3/index.js"></script><script type="module" src="app.js"></script>')), /not a manifest dependency/],
  ['the Supabase library going back to a floating dynamic import', d => edit(d, 'config/supabase.js', replaceOnce("const createClient = globalThis.supabase?.createClient;", "const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');")), /remote module import|references esm\.sh|unexpected external URL https:\/\/esm\.sh/],
  ['a floating dynamic import to another CDN host', d => edit(d, 'services/ocrService.js', text => `${text}\nexport const lazy = () => import('https://cdn.example.test/lib@latest/index.js');\n`), /remote module import|unexpected external URL/],
  ['the English language data losing its package version', d => edit(d, 'services/ocrService.js', replaceOnce('@tesseract.js-data/eng@1.0.0/4.0.0_best_int', '@tesseract.js-data/eng/4.0.0_best_int')), /floating or unversioned CDN URL|langPath/],
  ['a Tesseract worker version that differs from the manifest', d => edit(d, 'services/ocrService.js', replaceOnce('tesseract.js@v5.1.1/dist/worker.min.js', 'tesseract.js@v5.1.2/dist/worker.min.js')), /workerPath/],
  ['an unversioned CDN path in application code', d => edit(d, 'services/ocrService.js', text => `${text}\nexport const unversioned = 'https://cdn.jsdelivr.net/npm/some-lib/dist/lib.js';\n`), /floating or unversioned CDN URL/],
  ['a version bumped in the manifest without its URL and file', d => edit(d, 'vendor/dependency-manifest.json', replaceOnce('"version": "2.118.0"', '"version": "2.118.1"')), /does not carry version 2\.118\.1/],
  ['an unknown integrity class in the manifest', d => edit(d, 'vendor/dependency-manifest.json', replaceOnce('"integrityClass": "cdn-pinned-unverified",\n      "url": "https://cdn.jsdelivr.net/npm/tesseract.js@v5.1.1/dist/worker.min.js"', '"integrityClass": "fully-verified",\n      "url": "https://cdn.jsdelivr.net/npm/tesseract.js@v5.1.1/dist/worker.min.js"')), /unknown integrityClass "fully-verified"/],
  ['a vendored file that is not in the manifest', d => writeFileSync(path.join(d, 'vendor/supabase/extra-lib.js'), 'globalThis.x = 1;\n'), /not listed in the manifest/],
  ['a local script that does not exist', d => edit(d, 'index.html', replaceOnce('vendor/supabase/supabase-js-2.118.0.umd.js', 'vendor/supabase/missing.js')), /does not exist/],
  ['an application script importing code with importScripts', d => edit(d, 'ui/themeController.js', text => `${text}\nexport const load = () => importScripts('x.js');\n`), /importScripts in application code/]
];
for (const [label, mutate, expected] of mutations) {
  test(`DEP-mutation: ${label} fails the audit`, async () => {
    const directory = scratchCopy();
    try {
      assert.deepEqual(await auditDependencies(directory), [], 'the untouched copy is clean');
      mutate(directory);
      const violations = await auditDependencies(directory);
      assert.ok(violations.length > 0, 'the damaged copy must produce a violation');
      assert.ok(violations.some(message => expected.test(message)), `expected ${expected}, got:\n${violations.slice(0, 6).join('\n')}`);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
