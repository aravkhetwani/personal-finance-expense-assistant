import { Router } from 'express';
import multer from 'multer';
import { db, tx } from '../db.js';
import { encNum, encrypt } from '../crypto.js';
import { bad, id, isoDate, notFound, num, oneOf, str, timeStr, today, round2 } from '../http.js';
import { checkBudgetAlerts, loadTransactions, mapTx, resolveCategory, totals } from '../services.js';
import { parseCsv, toCsv } from '../csv.js';
import { logEvent } from '../security.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
const METHODS = ['cash', 'card', 'upi', 'bank', 'other'];

function filters(q) {
  return {
    from: q.from ? isoDate(q.from, 'from') : undefined,
    to: q.to ? isoDate(q.to, 'to') : undefined,
    type: q.type ? oneOf(q.type, 'type', ['expense', 'income']) : undefined,
    categoryId: q.categoryId ? id(q.categoryId) : undefined,
  };
}

// FR-TRACK-003: filter by date range, category and amount (plus free-text search on notes/category).
function applyAmountAndText(list, q) {
  const min = q.minAmount !== undefined && q.minAmount !== '' ? Number(q.minAmount) : null;
  const max = q.maxAmount !== undefined && q.maxAmount !== '' ? Number(q.maxAmount) : null;
  const text = (q.q || '').toString().toLowerCase();
  return list.filter(
    (t) =>
      (min === null || t.amount >= min) &&
      (max === null || t.amount <= max) &&
      (!text || t.notes.toLowerCase().includes(text) || (t.category || '').toLowerCase().includes(text))
  );
}

function readTxBody(b, userId) {
  const type = oneOf(b.type, 'Type', ['expense', 'income']);
  const amount = num(b.amount, 'Amount', { positive: true });
  const date = b.date ? isoDate(b.date, 'Date') : today();
  const time = timeStr(b.time);
  const method = oneOf(b.paymentMethod, 'Payment method', METHODS, 'cash');
  const notes = str(b.notes, 'Notes', { max: 500, required: false });
  let cat = null;
  if (b.categoryId || b.categoryName) {
    cat = resolveCategory(userId, type, { categoryId: b.categoryId ? id(b.categoryId) : null, categoryName: b.categoryName && str(b.categoryName, 'Category', { max: 50 }) });
    if (!cat) throw bad('Category not found');
    if (cat.type !== type) throw bad(`Category "${cat.name}" is not a${type === 'income' ? 'n' : ''} ${type} category`);
  }
  return { type, amount, date, time, method, notes, cat };
}

// Static routes first (before :id)
r.get('/export.csv', (req, res) => {
  const list = applyAmountAndText(loadTransactions(req.user.id, filters(req.query)), req.query);
  logEvent(req.user.id, 'transactions_exported', req);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
  res.send(
    toCsv(
      ['date', 'time', 'type', 'amount', 'category', 'payment_method', 'notes'],
      list.map((t) => [t.date, t.time, t.type, t.amount, t.category || '', t.paymentMethod, t.notes])
    )
  );
});

// FR-TRACK-004: bulk CSV import
r.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) throw bad('Please attach a CSV file');
  const rows = parseCsv(req.file.buffer.toString('utf8'));
  if (rows.length < 2) throw bad('The file has no data rows');
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  for (const need of ['date', 'type', 'amount']) if (!head.includes(need)) throw bad(`Missing required column: ${need}`);
  const col = (row, name) => (head.includes(name) ? (row[head.indexOf(name)] ?? '').trim() : '');
  const errors = [];
  const valid = [];
  rows.slice(1, 5001).forEach((row, i) => {
    try {
      valid.push(
        readTxBody(
          {
            type: col(row, 'type').toLowerCase(),
            amount: col(row, 'amount'),
            date: col(row, 'date'),
            time: col(row, 'time') || undefined,
            categoryName: col(row, 'category') || undefined,
            paymentMethod: col(row, 'payment_method').toLowerCase() || undefined,
            notes: col(row, 'notes'),
          },
          req.user.id
        )
      );
    } catch (e) {
      errors.push({ row: i + 2, error: e.message });
    }
  });
  const ins = db.prepare('INSERT INTO transactions (user_id, type, amount_enc, date, time, category_id, payment_method, notes_enc, source) VALUES (?,?,?,?,?,?,?,?,?)');
  tx(() => valid.forEach((v) => ins.run(req.user.id, v.type, encNum(v.amount), v.date, v.time, v.cat?.id ?? null, v.method, v.notes ? encrypt(v.notes) : null, 'csv')));
  res.json({ imported: valid.length, skipped: errors.length, errors: errors.slice(0, 20) });
});

// NFR-SAF-003: bulk deletion requires explicit typed confirmation.
r.post('/bulk-delete', (req, res) => {
  if (req.body.confirm !== 'DELETE') throw bad('Type DELETE to confirm bulk deletion');
  let n;
  if (req.body.all === true) {
    n = Number(db.prepare('DELETE FROM transactions WHERE user_id = ?').run(req.user.id).changes);
  } else {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(id) : [];
    if (!ids.length) throw bad('Select at least one transaction');
    const del = db.prepare('DELETE FROM transactions WHERE user_id = ? AND id = ?');
    n = tx(() => ids.reduce((a, i) => a + Number(del.run(req.user.id, i).changes), 0));
  }
  logEvent(req.user.id, 'transactions_bulk_deleted', req, `${n} rows`);
  res.json({ deleted: n });
});

r.get('/', (req, res) => {
  const list = applyAmountAndText(loadTransactions(req.user.id, filters(req.query)), req.query);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  res.json({ items: list.slice((page - 1) * limit, page * limit), total: list.length, page, limit, totals: totals(list) });
});

r.post('/', async (req, res) => {
  const v = readTxBody(req.body, req.user.id);
  const ins = db
    .prepare('INSERT INTO transactions (user_id, type, amount_enc, date, time, category_id, payment_method, notes_enc, source) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(req.user.id, v.type, encNum(v.amount), v.date, v.time, v.cat?.id ?? null, v.method, v.notes ? encrypt(v.notes) : null, req.body.source === 'receipt' ? 'receipt' : 'manual');
  const row = db.prepare('SELECT t.*, c.name AS category_name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.id = ?').get(Number(ins.lastInsertRowid));
  if (v.type === 'expense') await checkBudgetAlerts(req.user, v.cat?.id, v.date);
  res.status(201).json({ transaction: mapTx(row), message: 'Transaction saved.' });
});

r.put('/:id', async (req, res) => {
  const tid = id(req.params.id);
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(tid, req.user.id);
  if (!existing) throw notFound('Transaction not found');
  const v = readTxBody(req.body, req.user.id);
  db.prepare('UPDATE transactions SET type=?, amount_enc=?, date=?, time=?, category_id=?, payment_method=?, notes_enc=? WHERE id=?')
    .run(v.type, encNum(v.amount), v.date, v.time, v.cat?.id ?? null, v.method, v.notes ? encrypt(v.notes) : null, tid);
  const row = db.prepare('SELECT t.*, c.name AS category_name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.id = ?').get(tid);
  if (v.type === 'expense') await checkBudgetAlerts(req.user, v.cat?.id, v.date);
  res.json({ transaction: mapTx(row) });
});

r.delete('/:id', (req, res) => {
  const ok = db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(id(req.params.id), req.user.id);
  if (!ok.changes) throw notFound('Transaction not found');
  res.json({ ok: true });
});

export default r;
export { round2 };
