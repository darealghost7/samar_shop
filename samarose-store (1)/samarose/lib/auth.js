import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';

const scrypt = promisify(crypto.scrypt);
const P = { N: 16384, r: 8, p: 1 };
export const COOKIE = 'sr_admin';
const SESSION_MS = 8 * 60 * 60 * 1000;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, P);
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  try {
    const [v, s, k] = stored.split('$');
    if (v !== 's1') return false;
    const key = await scrypt(pw, Buffer.from(s, 'base64'), 64, P);
    const kb = Buffer.from(k, 'base64');
    return kb.length === key.length && crypto.timingSafeEqual(kb, key);
  } catch { return false; }
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').run(sha(token), userId, csrf, Date.now() + SESSION_MS);
  return { token, csrf, maxAge: SESSION_MS };
}
const readCookie = (req, name) => {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
};
export function sessionFrom(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const row = db.prepare('SELECT s.csrf, s.expires_at, u.id, u.email, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(sha(token));
  return row && row.expires_at > Date.now() ? row : null;
}
export function destroySession(req) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token));
}
export const purgeSessions = () => db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());

/** Express middleware. roles = allowed roles (omit = any signed-in user). Mutations need the CSRF header. */
export const requireAuth = (roles) => (req, res, next) => {
  const s = sessionFrom(req);
  if (!s) return res.status(401).json({ error: 'Please sign in.' });
  if (roles && !roles.includes(s.role)) return res.status(403).json({ error: 'Your account cannot do that.' });
  if (!['GET', 'HEAD'].includes(req.method)) {
    const a = Buffer.from(String(req.get('x-csrf-token') || '')), b = Buffer.from(s.csrf);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'Session check failed. Reload the page.' });
  }
  req.user = s;
  next();
};
