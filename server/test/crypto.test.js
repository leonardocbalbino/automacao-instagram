import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encrypt, decrypt, verifySignature, parseSignedRequest } from '../src/lib/crypto.js';

const key = crypto.randomBytes(32).toString('hex');

test('encrypt/decrypt ida e volta', () => {
  const sealed = encrypt('IGAAtoken123', key);
  assert.notEqual(sealed, 'IGAAtoken123');
  assert.equal(decrypt(sealed, key), 'IGAAtoken123');
});

test('decrypt falha com texto adulterado', () => {
  const parts = encrypt('abc', key).split(':');
  parts[3] = Buffer.from('xyz').toString('base64');
  assert.throws(() => decrypt(parts.join(':'), key));
});

test('verifySignature aceita só a assinatura correta', () => {
  const body = Buffer.from('{"object":"instagram"}');
  const sig = 'sha256=' + crypto.createHmac('sha256', 'segredo').update(body).digest('hex');
  assert.ok(verifySignature(body, sig, 'segredo'));
  assert.ok(!verifySignature(body, sig, 'outro'));
  assert.ok(!verifySignature(body, undefined, 'segredo'));
});

test('parseSignedRequest valida HMAC', () => {
  const payload = Buffer.from(JSON.stringify({ user_id: '123' })).toString('base64url');
  const sig = crypto.createHmac('sha256', 'segredo').update(payload).digest('base64url');
  assert.deepEqual(parseSignedRequest(`${sig}.${payload}`, 'segredo'), { user_id: '123' });
  assert.equal(parseSignedRequest(`${sig}.${payload}`, 'outro'), null);
});
