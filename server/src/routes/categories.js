import { Router } from 'express';
import { db } from '../db.js';
import { HttpError, bad, id, notFound, oneOf, str } from '../http.js';

const r = Router();

r.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT id, name, type, is_default AS isDefault FROM categories WHERE user_id = ? ORDER BY type, is_default DESC, name')
    .all(req.user.id);
  res.json({ categories: rows.map((c) => ({ ...c, isDefault: !!c.isDefault })) });
});

// FR-TRACK-005: custom categories can be created, edited and deleted; defaults are protected.
r.post('/', (req, res) => {
  const name = str(req.body.name, 'Name', { min: 1, max: 50 });
  const type = oneOf(req.body.type, 'Type', ['expense', 'income']);
  if (db.prepare('SELECT 1 FROM categories WHERE user_id = ? AND name = ? AND type = ?').get(req.user.id, name, type)) {
    throw new HttpError(409, 'You already have a category with that name');
  }
  const ins = db.prepare('INSERT INTO categories (user_id, name, type) VALUES (?,?,?)').run(req.user.id, name, type);
  res.status(201).json({ category: { id: Number(ins.lastInsertRowid), name, type, isDefault: false } });
});

r.put('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(id(req.params.id), req.user.id);
  if (!c) throw notFound('Category not found');
  if (c.is_default) throw bad('Default categories cannot be renamed');
  const name = str(req.body.name, 'Name', { min: 1, max: 50 });
  if (db.prepare('SELECT 1 FROM categories WHERE user_id = ? AND name = ? AND type = ? AND id != ?').get(req.user.id, name, c.type, c.id)) {
    throw new HttpError(409, 'You already have a category with that name');
  }
  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, c.id);
  res.json({ category: { id: c.id, name, type: c.type, isDefault: false } });
});

r.delete('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(id(req.params.id), req.user.id);
  if (!c) throw notFound('Category not found');
  if (c.is_default) throw bad('Default categories cannot be deleted');
  const other = db.prepare("SELECT id FROM categories WHERE user_id = ? AND name = 'Other' AND type = ?").get(req.user.id, c.type);
  db.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ? AND user_id = ?').run(other?.id ?? null, c.id, req.user.id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(c.id);
  res.json({ ok: true, reassignedTo: 'Other' });
});

export default r;
