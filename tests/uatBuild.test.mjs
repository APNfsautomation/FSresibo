// Issue #49: the UAT build only ever carries the UAT project and a browser-safe key, and never production configuration.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertBrowserSafeKey, buildUat, productionProjectRef, uatProjectRef, uatUrl } from '../tools/build-uat.mjs';

const jwt = payload => `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
const uatAnon = jwt({ iss: 'supabase', ref: uatProjectRef, role: 'anon' });

test('UAT-1: only a browser-safe key for the UAT project is accepted', () => {
  assert.equal(assertBrowserSafeKey('sb_publishable_abc123'), 'sb_publishable_abc123');
  assert.equal(assertBrowserSafeKey(uatAnon), uatAnon);
  for (const bad of ['', undefined, 'sb_secret_abc', jwt({ ref: uatProjectRef, role: 'service_role' }), jwt({ ref: productionProjectRef, role: 'anon' }), 'not-a-key', 'a.b.c']) assert.throws(() => assertBrowserSafeKey(bad), String(bad));
});

test('UAT-2: the build points at the UAT project, marks the version with the exact commit, excludes tests and the audit manifest, and contains no production reference', () => {
  const out = mkdtempSync(join(tmpdir(), 'uat-build-'));
  try {
    const commit = 'c1991d794bce671d9a5fa676281d5fc6e3a24e28';
    buildUat({ out, key: uatAnon, commit });
    const config = readFileSync(join(out, 'config/supabase.js'), 'utf8');
    assert.ok(config.includes(uatUrl)); assert.ok(config.includes(uatAnon)); assert.ok(!config.includes(productionProjectRef)); assert.match(config, /export async function getSupabaseClient/);
    assert.match(readFileSync(join(out, 'config/appMetadata.js'), 'utf8'), /version: '\d+\.\d+\.\d+-uat\+c1991d7'/);
    const info = JSON.parse(readFileSync(join(out, 'BUILD-INFO.json'), 'utf8'));
    assert.deepEqual([info.environment, info.sourceCommit, info.supabaseProject, info.basePath], ['UAT', commit, uatProjectRef, '/FSresibo-UAT/']);
    for (const absent of ['tests', 'docs', 'supabase', '.github', 'vendor/dependency-manifest.json']) assert.equal(existsSync(join(out, absent)), false, absent);
    for (const present of ['index.html', 'app.js', '.nojekyll', 'vendor/sheetjs/xlsx-0.20.3.mjs', 'vendor/supabase/supabase-js-2.118.0.umd.js']) assert.equal(existsSync(join(out, present)), true, present);
    assert.throws(() => buildUat({ out: join(out, 'again'), key: 'sb_secret_x', commit }), /secret|service-role/i);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
