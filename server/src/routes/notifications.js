import { Router } from 'express';
import { db } from '../db.js';
import { id, notFound } from '../http.js';

const r = Router();
const map = (n) => ({ id: n.id, kind: n.kind, title: n.title, message: n.message, read: !!n.is_read, createdAt: n.created_at });

r.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).c;
  res.json({ notifications: rows.map(map), unread });
});

r.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

r.post('/:id/read', (req, res) => {
  const ok = db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id(req.params.id), req.user.id);
  if (!ok.changes) throw notFound();
  res.json({ ok: true });
});

r.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(id(req.params.id), req.user.id);
  res.json({ ok: true });
});

export default r;
