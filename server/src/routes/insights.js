import { Router } from 'express';
import { addMonths, monthOf, round2, today } from '../http.js';
import { budgetStatus, loadTransactions, monthBounds } from '../services.js';
import { buildInsights } from '../recommendations.js';

const r = Router();

export function monthlyTrend(txs, months = 12, endMonth = monthOf(today())) {
  const list = [];
  for (let i = months - 1; i >= 0; i--) list.push(addMonths(`${endMonth}-01`, -i).slice(0, 7));
  const m = new Map(list.map((k) => [k, { month: k, income: 0, expense: 0 }]));
  for (const t of txs) {
    const row = m.get(t.date.slice(0, 7));
    if (row) row[t.type] = round2(row[t.type] + t.amount);
  }
  return [...m.values()].map((x) => ({ ...x, net: round2(x.income - x.expense) }));
}

export function distribution(txs) {
  const by = new Map();
  for (const t of txs.filter((x) => x.type === 'expense')) by.set(t.category || 'Uncategorised', round2((by.get(t.category || 'Uncategorised') || 0) + t.amount));
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount, percent: total ? Math.round((amount / total) * 100) : 0 }));
}

// FR-INSIGHT-001..004: last 12 months analysis, distribution (pie) and trends (line/bar), plus suggestions.
r.get('/', (req, res) => {
  const current = monthOf(today());
  const start = addMonths(`${current}-01`, -11);
  const txs = loadTransactions(req.user.id, { from: start });
  const { from, to } = monthBounds(current);
  const monthTx = txs.filter((t) => t.date >= from && t.date <= to);
  res.json({
    month: current,
    distribution: distribution(monthTx),
    distribution12m: distribution(txs),
    trend: monthlyTrend(txs, 12, current),
    recommendations: buildInsights({ transactions: txs, budgets: budgetStatus(req.user.id, current), currentMonth: current }),
  });
});

export default r;
