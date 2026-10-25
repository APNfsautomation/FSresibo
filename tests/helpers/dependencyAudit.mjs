// Repeatable audit of the third-party browser runtime dependencies (Issue #32). It reads the repository tree under `root` (the real repository, or a scratch copy that a
// test has deliberately damaged) and returns a list of violations; an empty list means the tree matches vendor/dependency-manifest.json.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const INTEGRITY_CLASSES = ['vendored-sri', 'vendored-hash', 'cdn-sri', 'cdn-pinned-unverified'];
const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.html', '.css', '.svg']);
const NOT_SCANNED_DIRECTORIES = new Set(['tests', 'docs', '.git', '.github', 'supabase', 'vendor', 'node_modules']);
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
// Application source whose URLs and imports are scanned. vendor/ is third-party content that is covered by the hash checks instead.
const SHIPPED_ENTRIES = ['index.html', 'app.js', 'auth.css', 'styles.css', 'config', 'domain', 'services', 'ui', 'assets'];

export const digest = (bytes, algorithm, encoding) => createHash(algorithm).update(bytes).digest(encoding);
export const sriOf = bytes => `sha384-${digest(bytes, 'sha384', 'base64')}`;
const lfNormalized = bytes => Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');

function filesUnder(directory, skipDirectories, base = directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (!skipDirectories.has(entry.name)) found.push(...filesUnder(full, skipDirectories, base)); }
    else found.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return found;
}

// Attributes of every <script ...> start tag in an HTML document.
export function scriptTags(html) {
  return [...html.matchAll(/<script\b([^>]*)>/gi)].map(match => {
    const attributes = {};
    for (const attribute of match[1].matchAll(/([a-zA-Z-]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g)) attributes[attribute[1].toLowerCase()] = attribute[2] ?? attribute[3] ?? '';
    return attributes;
  });
}

const isExternal = value => /^(?:https?:)?\/\//i.test(value);
const countOf = (list, value) => list.filter(item => item === value).length;

export async function auditDependencies(root) {
  const violations = [];
  const fail = message => violations.push(message);
  const read = relative => readFileSync(path.join(root, relative));
  const manifestPath = path.join(root, 'vendor/dependency-manifest.json');
  if (!existsSync(manifestPath)) return ['vendor/dependency-manifest.json is missing'];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const dependencies = manifest.dependencies ?? [];

  // 1. The manifest itself: unique ids, a known integrity class, an exact version, well-formed hashes.
  const ids = dependencies.map(dependency => dependency.id);
  for (const dependency of dependencies) {
    const label = `manifest ${dependency.id}`;
    if (countOf(ids, dependency.id) > 1) fail(`${label}: duplicate id`);
    if (!INTEGRITY_CLASSES.includes(dependency.integrityClass)) fail(`${label}: unknown integrityClass "${dependency.integrityClass}"`);
    if (!EXACT_VERSION.test(dependency.version ?? '')) fail(`${label}: version "${dependency.version}" is not an exact x.y.z version`);
    if (!/^[0-9a-f]{64}$/.test(dependency.sha256 ?? '')) fail(`${label}: sha256 is not 64 lowercase hex characters`);
    if (dependency.integrityClass !== 'vendored-hash' && !/^sha384-[A-Za-z0-9+/]{64}$/.test(dependency.sri ?? '')) fail(`${label}: sri is not a sha384 integrity value`);
    if (!dependency.license) fail(`${label}: license is missing`);
    if (!Number.isInteger(dependency.bytes) || dependency.bytes <= 0) fail(`${label}: bytes is missing`);
    const isFile = dependency.integrityClass.startsWith('vendored');
    if (isFile) {
      if (!dependency.file || !existsSync(path.join(root, dependency.file))) { fail(`${label}: vendored file ${dependency.file} is missing`); continue; }
      if (!dependency.licenseFile || !existsSync(path.join(root, dependency.licenseFile))) fail(`${label}: license file ${dependency.licenseFile} is missing`);
      const stored = read(dependency.file);
      const bytes = dependency.lineEndings === 'lf-normalized' ? lfNormalized(stored) : stored;
      if (digest(bytes, 'sha256', 'hex') !== dependency.sha256) fail(`${label}: sha256 of ${dependency.file} does not match the manifest`);
      if (bytes.length !== dependency.bytes) fail(`${label}: size of ${dependency.file} (${bytes.length}) does not match the manifest (${dependency.bytes})`);
      if (dependency.sri && sriOf(bytes) !== dependency.sri) fail(`${label}: sri of ${dependency.file} does not match the manifest`);
      if (!dependency.file.includes(dependency.version)) fail(`${label}: file name ${dependency.file} does not carry version ${dependency.version}`);
    } else {
      const url = dependency.url ?? '';
      const origin = url.match(/^https:\/\/[^/]+/)?.[0];
      if (!(manifest.allowedExternalOrigins ?? []).includes(origin)) fail(`${label}: ${url} is not on an allowed origin`);
      const segment = url.match(/\/npm\/((?:@[^/@]+\/)?[^/@]+)@v?([^/]+)\//);
      if (!segment) fail(`${label}: ${url} does not name an exact package version`);
      else if (segment[2] !== dependency.version) fail(`${label}: URL version ${segment[2]} differs from the manifest version ${dependency.version}`);
      else if (!dependency.package.startsWith(segment[1])) fail(`${label}: URL package ${segment[1]} differs from ${dependency.package}`);
    }
  }

  // 2. index.html: every external script is an exact-version manifest entry with the manifest's integrity and crossorigin; local scripts exist and carry their hash.
  const html = read('index.html').toString('utf8');
  const tags = scriptTags(html);
  const referenced = new Set();
  for (const tag of tags) {
    const src = tag.src;
    if (!src) continue;
    if (isExternal(src)) {
      const dependency = dependencies.find(candidate => candidate.url === src);
      if (!dependency) { fail(`index.html: external script ${src} is not a manifest dependency (floating or unreviewed)`); continue; }
      referenced.add(dependency.id);
      if (dependency.integrityClass !== 'cdn-sri') fail(`index.html: ${src} is loaded by a script tag but its manifest class is ${dependency.integrityClass}`);
      if (tag.integrity !== dependency.sri) fail(`index.html: ${src} integrity "${tag.integrity ?? ''}" differs from the manifest`);
      if (tag.crossorigin !== 'anonymous') fail(`index.html: ${src} needs crossorigin="anonymous" for Subresource Integrity`);
    } else {
      const file = src.split(/[?#]/)[0];
      if (!existsSync(path.join(root, file))) { fail(`index.html: local script ${file} does not exist`); continue; }
      const dependency = dependencies.find(candidate => candidate.file === file);
      if (dependency) {
        referenced.add(dependency.id);
        if (dependency.integrityClass !== 'vendored-sri') fail(`index.html: ${file} is loaded by a script tag but its manifest class is ${dependency.integrityClass}`);
        if (tag.integrity !== dependency.sri) fail(`index.html: ${file} integrity "${tag.integrity ?? ''}" differs from the manifest`);
      }
    }
  }
  for (const dependency of dependencies.filter(candidate => ['vendored-sri', 'cdn-sri'].includes(candidate.integrityClass))) {
    if (!referenced.has(dependency.id)) fail(`manifest ${dependency.id}: not loaded by any script tag in index.html`);
  }
  for (const [, attribute, value] of html.matchAll(/\s(src|href)="([^"]*)"/gi)) {
    if (isExternal(value) || /^(#|mailto:|data:|javascript:)/i.test(value) || !value) continue;
    if (!existsSync(path.join(root, value.split(/[?#]/)[0]))) fail(`index.html: ${attribute}="${value}" points at a file that does not exist`);
  }

  // 3. Every URL and import in the shipped source: nothing floating, nothing unreviewed, no remote module import.
  const allowedExact = new Set([...dependencies.map(dependency => dependency.url).filter(Boolean), 'http://www.w3.org/2000/svg']);
  const allowedPrefixes = Object.values(manifest.ocrAssetPaths ?? {});
  const shipped = SHIPPED_ENTRIES.flatMap(entry => {
    const full = path.join(root, entry);
    if (!existsSync(full)) return [];
    return statSync(full).isDirectory() ? filesUnder(full, NOT_SCANNED_DIRECTORIES, root) : [entry];
  }).filter(file => SCANNED_EXTENSIONS.has(path.extname(file)));
  for (const file of new Set(shipped)) {
    const text = read(file).toString('utf8');
    for (const url of new Set(text.match(/https?:\/\/[^\s'"`)<>\\]+/g) ?? [])) {
      if (allowedExact.has(url) || allowedPrefixes.some(prefix => url === prefix || url.startsWith(`${prefix}/`))) continue;
      if (/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) continue; // the project's own data endpoint, not a library
      fail(`${file}: unexpected external URL ${url}`);
    }
    for (const url of new Set(text.match(/https:\/\/cdn\.jsdelivr\.net\/[^\s'"`)<>\\]+/g) ?? [])) {
      if (!/^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:@[^/@]+\/)?[^/@]+@v?\d+\.\d+\.\d+(?:\/|$)/.test(url)) fail(`${file}: floating or unversioned CDN URL ${url}`);
    }
    if (/\bimport\s*\(\s*['"`]https?:/.test(text) || /\bfrom\s+['"]https?:/.test(text) || /\bimport\s+['"]https?:/.test(text)) fail(`${file}: remote module import`);
    if (/\bimportScripts\s*\(/.test(text)) fail(`${file}: importScripts in application code`);
    if (/esm\.sh/.test(text)) fail(`${file}: references esm.sh`);
  }

  // 4. The vendored directory holds only manifest files plus their documentation.
  const vendored = existsSync(path.join(root, 'vendor')) ? filesUnder(path.join(root, 'vendor'), new Set()) : [];
  const known = new Set(['vendor/dependency-manifest.json', ...dependencies.flatMap(dependency => [dependency.file, dependency.licenseFile]).filter(Boolean)].map(file => file));
  for (const file of vendored.map(file => `vendor/${file}`)) {
    if (known.has(file) || /\/README\.md$/.test(file)) continue;
    fail(`${file}: vendored file is not listed in the manifest`);
  }

  // 5. The OCR asset locations in code equal the manifest, and the entry script, worker, core and data are one consistent release set.
  const ocr = await import(`${pathToFileURL(path.join(root, 'services/ocrService.js')).href}?audit=${Date.now()}${Math.random()}`);
  const paths = ocr.OCR_ASSET_PATHS ?? {};
  for (const key of ['workerPath', 'corePath', 'langPath']) if (paths[key] !== manifest.ocrAssetPaths?.[key]) fail(`services/ocrService.js: ${key} "${paths[key]}" differs from the manifest "${manifest.ocrAssetPaths?.[key]}"`);
  const byId = Object.fromEntries(dependencies.map(dependency => [dependency.id, dependency]));
  if (paths.workerPath !== byId['tesseract-worker']?.url) fail('services/ocrService.js: workerPath is not the manifest worker URL');
  if (`${paths.corePath}/tesseract-core-simd-lstm.wasm.js` !== byId['tesseract-core-simd-lstm']?.url) fail('services/ocrService.js: corePath does not lead to the manifest SIMD core');
  if (`${paths.corePath}/tesseract-core-lstm.wasm.js` !== byId['tesseract-core-lstm']?.url) fail('services/ocrService.js: corePath does not lead to the manifest non-SIMD core');
  if (`${paths.langPath}/eng.traineddata.gz` !== byId['tesseract-eng-data']?.url) fail('services/ocrService.js: langPath does not lead to the manifest language data');
  const tesseractVersions = ['tesseract-js', 'tesseract-worker'].map(id => byId[id]?.version);
  if (new Set(tesseractVersions).size !== 1) fail('manifest: the Tesseract entry script and worker are different versions');
  if (byId['tesseract-core-simd-lstm']?.version !== byId['tesseract-core-lstm']?.version) fail('manifest: the two OCR cores are different versions');

  // 6. SheetJS keeps the hash its README records.
  const readme = existsSync(path.join(root, 'vendor/sheetjs/README.md')) ? read('vendor/sheetjs/README.md').toString('utf8') : '';
  const documented = readme.match(/SHA-256:\s*`([0-9A-Fa-f]{64})`/)?.[1]?.toLowerCase();
  if (documented !== byId.sheetjs?.sha256) fail('vendor/sheetjs/README.md: documented SHA-256 differs from the manifest');
  return violations;
}
