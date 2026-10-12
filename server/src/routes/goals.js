import { Router } from 'express';
import { db } from '../db.js';
import { decNum, encNum } from '../crypto.js';
import { bad, id, isoDate, notFound, num, oneOf, round2, str, today } from '../http.js';
import { INVESTMENT_DISCLAIMER, investmentOptions } from '../recommendations.js';

const r = Router();

function mapGoal(g) {
  const target = decNum(g.target_enc);
  const saved = decNum(g.saved_enc);
  const days = Math.max(0, Math.ceil((new Date(g.deadline) - new Date(today())) / 86400000));
  const monthsLeft = Math.max(days / 30.44, 0);
  return {
    id: g.id,
    name: g.name,
    target,
    saved,
    deadline: g.deadline,
    percent: target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0, // FR-INV-002
    remaining: round2(Math.max(target - saved, 0)),
    daysLeft: days,
    monthlyNeeded: monthsLeft > 0 ? round2(Math.max(target - saved, 0) / Math.max(monthsLeft, 1)) : round2(Math.max(target - saved, 0)),
  };
}

r.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY deadline').all(req.user.id);
  res.json({ goals: rows.map(mapGoal) });
});

// FR-INV-001: goals with target amount and deadline
r.post('/', (req, res) => {
  const name = str(req.body.name, 'Goal name', { min: 1, max: 100 });
  const target = num(req.body.target, 'Target amount', { positive: true });
  const saved = num(req.body.saved ?? 0, 'Saved amount', { min: 0 });
  const deadline = isoDate(req.body.deadline, 'Deadline');
  const ins = db.prepare('INSERT INTO goals (user_id, name, target_enc, saved_enc, deadline) VALUES (?,?,?,?,?)').run(req.user.id, name, encNum(target), encNum(saved), deadline);
  res.status(201).json({ goal: mapGoal(db.prepare('SELECT * FROM goals WHERE id = ?').get(Number(ins.lastInsertRowid))) });
});

r.put('/:id', (req, res) => {
  const gid = id(req.params.id);
  const g = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(gid, req.user.id);
  if (!g) throw notFound('Goal not found');
  const name = req.body.name !== undefined ? str(req.body.name, 'Goal name', { min: 1, max: 100 }) : g.name;
  const target = req.body.target !== undefined ? num(req.body.target, 'Target amount', { positive: true }) : decNum(g.target_enc);
  const saved = req.body.saved !== undefined ? num(req.body.saved, 'Saved amount', { min: 0 }) : decNum(g.saved_enc);
  const deadline = req.body.deadline !== undefined ? isoDate(req.body.deadline, 'Deadline') : g.deadline;
  db.prepare('UPDATE goals SET name=?, target_enc=?, saved_enc=?, deadline=? WHERE id=?').run(name, encNum(target), encNum(saved), deadline, gid);
  res.json({ goal: mapGoal(db.prepare('SELECT * FROM goals WHERE id = ?').get(gid)) });
});

r.post('/:id/contribute', (req, res) => {
  const gid = id(req.params.id);
  const g = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(gid, req.user.id);
  if (!g) throw notFound('Goal not found');
  const amt = num(req.body.amount, 'Amount', { positive: true });
  db.prepare('UPDATE goals SET saved_enc = ? WHERE id = ?').run(encNum(round2(decNum(g.saved_enc) + amt)), gid);
  res.json({ goal: mapGoal(db.prepare('SELECT * FROM goals WHERE id = ?').get(gid)) });
});

r.delete('/:id', (req, res) => {
  const ok = db.prepare('DELETE FROM goals WHERE id = ? AND user_id = ?').run(id(req.params.id), req.user.id);
  if (!ok.changes) throw notFound('Goal not found');
  res.json({ ok: true });
});

// FR-INV-003/004 + NFR-SAF-001: always returned together with the disclaimer.
r.get('/recommendations/list', (req, res) => {
  const risk = oneOf(req.query.risk, 'risk', ['low', 'medium', 'high'], req.user.risk_tolerance);
  let years = req.query.years !== undefined ? Number(req.query.years) : null;
  let goal = null;
  if (req.query.goalId) {
    const g = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(id(req.query.goalId), req.user.id);
    if (!g) throw notFound('Goal not found');
    goal = mapGoal(g);
    years = goal.daysLeft / 365;
  }
  if (years === null || !Number.isFinite(years) || years < 0) years = 3;
  if (years > 60) throw bad('Horizon is too long');
  res.json({
    risk,
    horizonYears: round2(years),
    goal,
    options: investmentOptions({ risk, years, region: req.user.tax_region }),
    disclaimer: INVESTMENT_DISCLAIMER,
  });
});

export default r;
