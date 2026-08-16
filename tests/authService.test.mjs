import assert from 'node:assert/strict';
import test from 'node:test';
import { authCallbackParams, authRedirectUrl, createAuthActions, hasPasswordRecoveryIntent, recoveryCallbackError } from '../services/authService.js';

test('runtime auth redirect preserves the GitHub Pages repository subpath', () => {
  assert.equal(authRedirectUrl('recovery', { href: 'https://apnfsautomation.github.io/FSresibo/' }), 'https://apnfsautomation.github.io/FSresibo/?auth=recovery');
  assert.equal(authRedirectUrl('signup', { href: 'http://192.168.0.94/fsresibo/' }), 'http://192.168.0.94/fsresibo/?auth=signup');
});

test('recovery-intent callbacks are recognized from query or fragment before any normal session is considered', () => {
  assert.equal(hasPasswordRecoveryIntent({ href: 'https://app.example/FSresibo/?auth=recovery' }), true);
  assert.equal(hasPasswordRecoveryIntent({ href: 'https://app.example/FSresibo/#access_token=token&type=recovery' }), true);
  assert.equal(hasPasswordRecoveryIntent({ href: 'https://app.example/FSresibo/?auth=signup' }), false);
  assert.equal(recoveryCallbackError({ href: 'https://app.example/FSresibo/?auth=recovery&error=access_denied&error_description=Link+has+expired' }), 'Link has expired');
  assert.equal(authCallbackParams({ href: 'https://app.example/FSresibo/#type=recovery&error=access_denied' }).get('type'), 'recovery');
});

test('auth actions pass explicit redirect URLs and use recovery-safe Supabase methods', async () => {
  const calls = [];
  const client = { auth: {
    signUp: async args => { calls.push(['signUp', args]); return { data: { session: null }, error: null }; },
    resetPasswordForEmail: async (...args) => { calls.push(['resetPasswordForEmail', args]); return { data: {}, error: null }; },
    updateUser: async args => { calls.push(['updateUser', args]); return { data: {}, error: null }; }
  } };
  const actions = createAuthActions(async () => client);
  await actions.register('tester@example.com', 'password', 'https://example.test/FSresibo/?auth=signup');
  await actions.requestPasswordReset('tester@example.com', 'https://example.test/FSresibo/?auth=recovery');
  await actions.updatePassword('new-password');
  assert.deepEqual(calls, [
    ['signUp', { email: 'tester@example.com', password: 'password', options: { emailRedirectTo: 'https://example.test/FSresibo/?auth=signup' } }],
    ['resetPasswordForEmail', ['tester@example.com', { redirectTo: 'https://example.test/FSresibo/?auth=recovery' }]],
    ['updateUser', { password: 'new-password' }]
  ]);
});
