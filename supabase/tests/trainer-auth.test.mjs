import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { passwordHash, verifyTrainerPassword, randomSalt } from '../functions/_shared/trainer-auth.ts';

test('Password changes reject the old password and enforce lockouts', async () => {
  const salt = randomSalt();
  const oldPassword = 'test-old-password';
  const newPassword = 'test-new-password';
  const initialHash = pbkdf2Sync(oldPassword, Buffer.from(salt, 'hex'), 600000, 32, 'sha256').toString('hex');
  assert.equal(await passwordHash(oldPassword, salt), initialHash);
  assert.match(salt, /^[a-f0-9]{48}$/);
  let row = { password_hash: initialHash, password_salt: salt, iterations: 600000, locked_until: null };
  let failures = 0;
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
    rpc: async () => { failures++; return { error: null }; },
  };
  assert.equal((await verifyTrainerPassword(db, 'test-club', oldPassword)).valid, true);
  assert.equal((await verifyTrainerPassword(db, 'test-club', 'wrong')).valid, false);
  assert.equal(failures, 1);
  row.locked_until = new Date(Date.now() + 60000).toISOString();
  assert.equal((await verifyTrainerPassword(db, 'test-club', oldPassword)).valid, false);
  row = { ...row, locked_until: null, password_hash: await passwordHash(newPassword, salt) };
  assert.equal((await verifyTrainerPassword(db, 'test-club', oldPassword)).valid, false);
  assert.equal((await verifyTrainerPassword(db, 'test-club', newPassword)).valid, true);
  row = null;
  assert.equal((await verifyTrainerPassword(db, 'test-club', oldPassword)).configured, false);
});

test('Database failures cannot enable legacy password fallback', async () => {
  const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ error: { code: '08006' } }) }) }) }) };
  await assert.rejects(verifyTrainerPassword(db, 'test-club', 'test-password'));
});
