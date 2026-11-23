import { createHmac } from 'crypto';

const SECRET = process.env.TOKEN_SECRET;
const EXPIRY = 30 * 24 * 60 * 60 * 1000;

export function createToken(naam) {
  if (!SECRET) throw new Error('TOKEN_SECRET is niet ingesteld op de server');
  const payload = Buffer.from(JSON.stringify({ naam, exp: Date.now() + EXPIRY })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}

export function verifyToken(token) {
  if (!SECRET) return null;
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

// Controleert de Bearer-token van een request. Stuurt zelf een 401 en geeft
// null terug als de gebruiker niet is ingelogd; anders de token-gegevens.
export function requireAuth(req, res) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'Niet ingelogd. Log opnieuw in via het portaal.' });
    return null;
  }
  return user;
}
