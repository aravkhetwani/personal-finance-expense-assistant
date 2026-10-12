import { Router } from 'express';
import { db } from '../db.js';
import { decNum, encNum } from '../crypto.js';
import { addDays, addMonths, id, isoDate, notFound, num, oneOf, str, today } from '../http.js';
import { runBillReminders } from '../scheduler.js';

const r = Router();

export function nextDue(due, recurrence) {
  if (recurrence === 'weekly') return addDays(due, 7);
  if (recurrence === 'monthly') return addMonths(due, 1);
  if (recurrence === 'yearly') return addMonths(due, 12);
  return due;
}

export function mapBill(b) {
  const t = today();
  const daysUntil = Math.round((new Date(b.due_date) - new Date(t)) / 86400000);
  return {
    id: b.id,
    name: b.name,
    amount: decNum(b.amount_enc),
    dueDate: b.due_date,
    recurrence: b.recurrence,
    paid: !!b.paid,
    daysUntil,
    status: b.paid ? 'paid' : daysUntil < 0 ? 'overdue' : daysUntil <= 3 ? 'due-soon' : 'upcoming',
  };
}

r.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM bills WHERE user_id = ? ORDER BY paid, due_date').all(req.user.id);
  res.json({ bills: rows.map(mapBill) });
});

// FR-BILL-001
r.post('/', async (req, res) => {
  const name = str(req.body.name, 'Bill name', { min: 1, max: 100 });
  const amount = num(req.body.amount, 'Amount', { positive: true });
  const dueDate = isoDate(req.body.dueDate, 'Due date');
  const recurrence = oneOf(req.body.recurrence, 'Recurrence', ['none', 'weekly', 'monthly', 'yearly'], 'none');
  const ins = db.prepare('INSERT INTO bills (user_id, name, amount_enc, due_date, recurrence) VALUES (?,?,?,?,?)').run(req.user.id, name, encNum(amount), dueDate, recurrence);
  await runBillReminders(req.user.id); // immediate reminder if it is already due soon
  res.status(201).json({ bill: mapBill(db.prepare('SELECT * FROM bills WHERE id = ?').get(Number(ins.lastInsertRowid))), message: 'Reminder saved.' });
});

r.put('/:id', (req, res) => {
  const bid = id(req.params.id);
  const b = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(bid, req.user.id);
  if (!b) throw notFound('Bill not found');
  const name = req.body.name !== undefined ? str(req.body.name, 'Bill name', { min: 1, max: 100 }) : b.name;
  const amount = req.body.amount !== undefined ? num(req.body.amount, 'Amount', { positive: true }) : decNum(b.amount_enc);
  const dueDate = req.body.dueDate !== undefined ? isoDate(req.body.dueDate, 'Due date') : b.due_date;
  const recurrence = req.body.recurrence !== undefined ? oneOf(req.body.recurrence, 'Recurrence', ['none', 'weekly', 'monthly', 'yearly']) : b.recurrence;
  db.prepare('UPDATE bills SET name=?, amount_enc=?, due_date=?, recurrence=?, paid=? WHERE id=?').run(
    name, encNum(amount), dueDate, recurrence, req.body.paid !== undefined ? (req.body.paid ? 1 : 0) : b.paid, bid
  );
  res.json({ bill: mapBill(db.prepare('SELECT * FROM bills WHERE id = ?').get(bid)) });
});

// Marks a bill paid; recurring bills roll forward to the next due date.
r.post('/:id/pay', (req, res) => {
  const bid = id(req.params.id);
  const b = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(bid, req.user.id);
  if (!b) throw notFound('Bill not found');
  if (b.recurrence !== 'none') db.prepare('UPDATE bills SET due_date = ?, paid = 0 WHERE id = ?').run(nextDue(b.due_date, b.recurrence), bid);
  else db.prepare('UPDATE bills SET paid = 1 WHERE id = ?').run(bid);
  res.json({ bill: mapBill(db.prepare('SELECT * FROM bills WHERE id = ?').get(bid)) });
});

r.delete('/:id', (req, res) => {
  const ok = db.prepare('DELETE FROM bills WHERE id = ? AND user_id = ?').run(id(req.params.id), req.user.id);
  if (!ok.changes) throw notFound('Bill not found');
  res.json({ ok: true });
});

export default r;
