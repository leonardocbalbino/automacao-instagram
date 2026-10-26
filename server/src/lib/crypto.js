import crypto from 'node:crypto';

function parseKey(raw) {
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY precisa ter 32 bytes (hex ou base64)');
  return key;
}

// Formato: v1:<iv>:<tag>:<ciphertext>, tudo em base64
export function encrypt(plaintext, rawKey) {
  const key = parseKey(rawKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(payload, rawKey) {
  const [version, iv, tag, data] = payload.split(':');
  if (version !== 'v1') throw new Error('Formato de token cifrado desconhecido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', parseKey(rawKey), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// Valida X-Hub-Signature-256 ("sha256=<hex>") sobre o corpo bruto
export function verifySignature(rawBody, header, appSecret) {
  if (!header || !header.startsWith('sha256=') || !appSecret) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = header.slice('sha256='.length);
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}

// signed_request da Meta (callback de exclusão de dados): <assinatura>.<payload>, base64url
export function parseSignedRequest(signedRequest, appSecret) {
  const [encodedSig, payload] = String(signedRequest || '').split('.');
  if (!encodedSig || !payload) return null;
  const expected = crypto.createHmac('sha256', appSecret).update(payload).digest();
  const sig = Buffer.from(encodedSig, 'base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}
