import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, nowIso } from './db.js';
import { HttpError } from './http.js';

export function issueSession(user, req) {
  const sid = crypto.randomUUID();
  db.prepare('INSERT INTO sessions (id, user_id, last_active, ip) VALUES (?,?,?,?)').run(sid, user.id, nowIso(), req.ip ?? null);
  const token = jwt.sign({ sub: user.id, sid, role: user.role }, config.jwtSecret, { expiresIn: `${config.sessionMaxHours}h` });
  return token;
}

export function requireAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) throw new HttpError(401, 'Authentication required');
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Session expired. Please sign in again.');
  }
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(payload.sid);
  if (!s || s.revoked) throw new HttpError(401, 'Session ended. Please sign in again.');
  // NFR-SEC-004: inactivity timeout
  const idleMs = Date.now() - new Date(s.last_active).getTime();
  if (idleMs > config.sessionTimeoutMin * 60000) {
    db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(s.id);
    throw new HttpError(401, 'You were signed out after a period of inactivity.');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user || user.disabled || !user.verified) throw new HttpError(401, 'Account unavailable');
  db.prepare('UPDATE sessions SET last_active = ? WHERE id = ?').run(nowIso(), s.id);
  req.user = user;
  req.sid = s.id;
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') throw new HttpError(403, 'Administrator access required');
  next();
}
