import assert from 'node:assert/strict';
import test from 'node:test';
import { authRedirectUrl, createAuthActions } from '../services/authService.js';

test('runtime auth redirect preserves the GitHub Pages repository subpath', () => {
  assert.equal(authRedirectUrl('recovery', { href: 'https://apnfsautomation.github.io/FSresibo/' }), 'https://apnfsautomation.github.io/FSresibo/?auth=recovery');
  assert.equal(authRedirectUrl('signup', { href: 'http://192.168.0.94/fsresibo/' }), 'http://192.168.0.94/fsresibo/?auth=signup');
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
