import { Router } from 'express';
import { db } from '../db.js';
import { decNum } from '../crypto.js';
import { addDays, monthOf, round2, today } from '../http.js';
import { budgetStatus, loadTransactions, monthBounds, totals } from '../services.js';
import { mapBill } from './bills.js';

const r = Router();

// FR-DASH-001..004 and NFR-SAF-004 (past-due / imminent bills are flagged here regardless of e-mail delivery).
r.get('/', (req, res) => {
  const uid = req.user.id;
  const month = monthOf(today());
  const { from, to } = monthBounds(month);
  const monthTx = loadTransactions(uid, { from, to });
  const all = loadTransactions(uid);
  const allTotals = totals(all);
  const opening = req.user.opening_balance_enc ? decNum(req.user.opening_balance_enc) : 0;

  const goals = db.prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY deadline LIMIT 5').all(uid).map((g) => {
    const target = decNum(g.target_enc), saved = decNum(g.saved_enc);
    return { id: g.id, name: g.name, target, saved, deadline: g.deadline, percent: target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0 };
  });

  const horizon = addDays(today(), 30);
  const bills = db.prepare('SELECT * FROM bills WHERE user_id = ? AND paid = 0 AND due_date <= ? ORDER BY due_date').all(uid, horizon).map(mapBill);
  const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0').get(uid).c;

  res.json({
    month,
    summary: { ...totals(monthTx) },
    netWorth: round2(opening + allTotals.net),
    budgets: budgetStatus(uid, month).filter((b) => b.active),
    goals,
    upcomingBills: bills,
    flaggedBills: bills.filter((b) => b.status === 'overdue' || b.status === 'due-soon'),
    recent: monthTx.slice(0, 5),
    unreadNotifications: unread,
    quickLinks: [
      { label: 'Add Expense', to: '/transactions?new=expense' },
      { label: 'Add Income', to: '/transactions?new=income' },
      { label: 'View Reports', to: '/reports' },
      { label: 'Scan Receipt', to: '/transactions?scan=1' },
    ],
  });
});

export default r;
