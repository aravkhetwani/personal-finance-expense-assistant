import { Router } from 'express';
import os from 'node:os';
import { db } from '../db.js';
import { HttpError, bad, id, notFound } from '../http.js';
import { logEvent } from '../security.js';
import { runBackup } from '../scheduler.js';

const r = Router();

const mapUser = (u) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, verified: !!u.verified, disabled: !!u.disabled,
  mfaEnabled: !!u.mfa_enabled, createdAt: u.created_at, lastLogin: u.last_login,
});

// Admin manages accounts and monitors the system; no endpoint here exposes any user's financial data.
r.get('/users', (_req, res) => {
  res.json({ users: db.prepare('SELECT * FROM users ORDER BY id').all().map(mapUser) });
});

r.patch('/users/:id', (req, res) => {
  const uid = id(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!u) throw notFound('User not found');
  if (uid === req.user.id) throw bad('You cannot change your own account here');
  if (req.body.disabled !== undefined) {
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(req.body.disabled ? 1 : 0, uid);
    if (req.body.disabled) db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(uid);
    logEvent(req.user.id, req.body.disabled ? 'admin_disabled_user' : 'admin_enabled_user', req, `user:${uid}`);
  }
  if (req.body.role !== undefined) {
    if (!['user', 'admin'].includes(req.body.role)) throw bad('Invalid role');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, uid);
    logEvent(req.user.id, 'admin_changed_role', req, `user:${uid} -> ${req.body.role}`);
  }
  res.json({ user: mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(uid)) });
});

r.delete('/users/:id', (req, res) => {
  const uid = id(req.params.id);
  if (uid === req.user.id) throw bad('You cannot delete your own account here');
  if (req.body?.confirm !== 'DELETE') throw bad('Type DELETE to confirm');
  const ok = db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  if (!ok.changes) throw notFound('User not found');
  logEvent(req.user.id, 'admin_deleted_user', req, `user:${uid}`);
  res.json({ ok: true });
});

r.get('/stats', (_req, res) => {
  const c = (sql) => db.prepare(sql).get().c;
  res.json({
    users: c('SELECT COUNT(*) AS c FROM users'),
    activeSessions: c("SELECT COUNT(*) AS c FROM sessions WHERE revoked = 0 AND last_active > datetime('now','-30 minutes')"),
    transactions: c('SELECT COUNT(*) AS c FROM transactions'),
    failedLogins24h: c("SELECT COUNT(*) AS c FROM security_logs WHERE event = 'login_failed' AND created_at > datetime('now','-1 day')"),
    uptimeSeconds: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    loadAvg: os.loadavg().map((x) => Math.round(x * 100) / 100),
    node: process.version,
  });
});

r.get('/security-logs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({ logs: db.prepare('SELECT * FROM security_logs ORDER BY id DESC LIMIT ?').all(limit) });
});

r.post('/backup', (req, res) => {
  try {
    const b = runBackup();
    logEvent(req.user.id, 'backup_created', req);
    res.json({ message: 'Backup created.', file: b.file.split(/[\\/]/).pop(), kept: b.count });
  } catch (e) {
    throw new HttpError(500, `Backup failed: ${e.message}`);
  }
});

export default r;
