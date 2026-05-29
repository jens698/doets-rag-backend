import { createHmac } from 'crypto';

const SECRET = process.env.TOKEN_SECRET || 'doets-fallback-secret-please-set-env';
const EXPIRY = 30 * 24 * 60 * 60 * 1000;

export function createToken(naam) {
  const payload = Buffer.from(JSON.stringify({ naam, exp: Date.now() + EXPIRY })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}

export function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}
