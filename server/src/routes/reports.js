import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { isoDate, monthOf, addMonths, round2, today } from '../http.js';
import { loadTransactions, totals } from '../services.js';
import { distribution, monthlyTrend } from './insights.js';
import { toCsv } from '../csv.js';
import { logEvent } from '../security.js';

const r = Router();

function range(q) {
  const to = q.to ? isoDate(q.to, 'to') : today();
  const from = q.from ? isoDate(q.from, 'from') : addMonths(`${monthOf(to)}-01`, -11);
  return { from, to };
}

function build(userId, q) {
  const { from, to } = range(q);
  const txs = loadTransactions(userId, { from, to });
  const t = totals(txs);
  const months = Math.max(1, Math.round((new Date(to) - new Date(from)) / (30.44 * 86400000)));
  return {
    from, to, totals: t,
    savingsRate: t.income > 0 ? Math.round((t.net / t.income) * 100) : null,
    avgMonthlyExpense: round2(t.expense / months),
    byCategory: distribution(txs),
    byMonth: monthlyTrend(txs, Math.min(months + 1, 36), monthOf(to)).filter((m) => m.month >= monthOf(from)),
    transactionCount: txs.length,
    transactions: txs,
  };
}

// Reporting (Section 2.2): spending/income/savings for any period. NFR-PERF-002: runs well within 5s for typical data.
r.get('/summary', (req, res) => {
  const { transactions, ...rest } = build(req.user.id, req.query);
  res.json(rest);
});

// FR-INSIGHT-005
r.get('/export.csv', (req, res) => {
  const rep = build(req.user.id, req.query);
  logEvent(req.user.id, 'report_exported', req, 'csv');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="report_${rep.from}_${rep.to}.csv"`);
  res.send(toCsv(['date', 'type', 'amount', 'category', 'payment_method', 'notes'], rep.transactions.map((t) => [t.date, t.type, t.amount, t.category || '', t.paymentMethod, t.notes])));
});

r.get('/export.pdf', (req, res) => {
  const rep = build(req.user.id, req.query);
  const cur = req.user.currency;
  const fmt = (n) => `${cur} ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  logEvent(req.user.id, 'report_exported', req, 'pdf');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="report_${rep.from}_${rep.to}.pdf"`);
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  doc.pipe(res);
  doc.fontSize(20).text('Financial Summary Report');
  doc.fontSize(10).fillColor('#555').text(`${req.user.name}  |  ${rep.from} to ${rep.to}`).moveDown();
  doc.fillColor('#000').fontSize(12);
  doc.text(`Total income: ${fmt(rep.totals.income)}`);
  doc.text(`Total expenses: ${fmt(rep.totals.expense)}`);
  doc.text(`Net savings: ${fmt(rep.totals.net)}${rep.savingsRate !== null ? `  (${rep.savingsRate}% of income)` : ''}`);
  doc.text(`Average monthly spending: ${fmt(rep.avgMonthlyExpense)}`).moveDown();
  doc.fontSize(14).text('Spending by category').moveDown(0.3).fontSize(11);
  rep.byCategory.forEach((c) => doc.text(`${c.category}: ${fmt(c.amount)} (${c.percent}%)`));
  doc.moveDown().fontSize(14).text('Monthly overview').moveDown(0.3).fontSize(11);
  rep.byMonth.forEach((m) => doc.text(`${m.month}   income ${fmt(m.income)}   expenses ${fmt(m.expense)}   net ${fmt(m.net)}`));
  doc.moveDown().fontSize(14).text('Transactions').moveDown(0.3).fontSize(9);
  rep.transactions.slice(0, 300).forEach((t) => {
    if (doc.y > 760) doc.addPage();
    doc.text(`${t.date}  ${t.type.padEnd(7)}  ${fmt(t.amount)}  ${t.category || '-'}  ${t.notes ? '— ' + t.notes : ''}`);
  });
  if (rep.transactions.length > 300) doc.text(`… and ${rep.transactions.length - 300} more (see CSV export).`);
  doc.end();
});

export default r;
