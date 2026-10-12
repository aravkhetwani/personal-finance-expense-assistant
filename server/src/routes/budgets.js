import { Router } from 'express';
import { db } from '../db.js';
import { encNum } from '../crypto.js';
import { HttpError, bad, id, notFound, num, today, monthOf } from '../http.js';
import { budgetStatus } from '../services.js';

const r = Router();

r.get('/', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : monthOf(today());
  res.json({ month, budgets: budgetStatus(req.user.id, month) });
});

// FR-BUDG-001: monthly budget per expense category
r.post('/', (req, res) => {
  const categoryId = id(req.body.categoryId);
  const limit = num(req.body.limit, 'Budget limit', { positive: true });
  const cat = db.prepare("SELECT * FROM categories WHERE id = ? AND user_id = ? AND type = 'expense'").get(categoryId, req.user.id);
  if (!cat) throw bad('Choose one of your expense categories');
  if (db.prepare('SELECT 1 FROM budgets WHERE user_id = ? AND category_id = ?').get(req.user.id, categoryId)) {
    throw new HttpError(409, `You already have a budget for ${cat.name}. Edit it instead.`);
  }
  const ins = db.prepare('INSERT INTO budgets (user_id, category_id, limit_enc) VALUES (?,?,?)').run(req.user.id, categoryId, encNum(limit));
  const b = budgetStatus(req.user.id).find((x) => x.id === Number(ins.lastInsertRowid));
  res.status(201).json({ budget: b });
});

// FR-BUDG-003: adjust or disable at any time
r.put('/:id', (req, res) => {
  const bid = id(req.params.id);
  const b = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(bid, req.user.id);
  if (!b) throw notFound('Budget not found');
  const limit = req.body.limit !== undefined ? num(req.body.limit, 'Budget limit', { positive: true }) : null;
  db.prepare('UPDATE budgets SET limit_enc = COALESCE(?, limit_enc), active = ? WHERE id = ?').run(
    limit === null ? null : encNum(limit),
    req.body.active === undefined ? b.active : req.body.active ? 1 : 0,
    bid
  );
  res.json({ budget: budgetStatus(req.user.id).find((x) => x.id === bid) });
});

r.delete('/:id', (req, res) => {
  const ok = db.prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?').run(id(req.params.id), req.user.id);
  if (!ok.changes) throw notFound('Budget not found');
  res.json({ ok: true });
});

export default r;
