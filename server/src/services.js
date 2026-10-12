import { db } from './db.js';
import { decNum, decrypt, encNum, encrypt } from './crypto.js';
import { monthOf, round2, today, addDays, addMonths } from './http.js';
import { sendMail } from './mailer.js';

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Food', 'Rent', 'Utilities', 'Entertainment', 'Transport', 'Health', 'Shopping', 'Education', 'Insurance', 'Other',
];
export const DEFAULT_INCOME_CATEGORIES = ['Salary', 'Freelance', 'Investments', 'Gifts', 'Other'];

export function seedCategories(userId) {
  const ins = db.prepare('INSERT OR IGNORE INTO categories (user_id, name, type, is_default) VALUES (?,?,?,1)');
  DEFAULT_EXPENSE_CATEGORIES.forEach((n) => ins.run(userId, n, 'expense'));
  DEFAULT_INCOME_CATEGORIES.forEach((n) => ins.run(userId, n, 'income'));
}

export function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    mfaEnabled: !!u.mfa_enabled,
    currency: u.currency,
    riskTolerance: u.risk_tolerance,
    taxRegion: u.tax_region,
    annualIncome: u.annual_income_enc ? decNum(u.annual_income_enc) : null,
    openingBalance: u.opening_balance_enc ? decNum(u.opening_balance_enc) : 0,
    notifyEmail: !!u.notify_email,
    notifyInApp: !!u.notify_inapp,
    billLeadDays: u.bill_lead_days,
    onboarded: !!u.onboarded,
    createdAt: u.created_at,
  };
}

// ---- notifications (FR-BILL-002/003, FR-BUDG-002) --------------------------------------------
// Neutral/positive language only (NFR-SAF-002). Duplicates are suppressed with a dedupe key.
export async function notify(user, kind, title, message, dedupeKey = null) {
  if (user.notify_inapp) {
    const r = db
      .prepare('INSERT OR IGNORE INTO notifications (user_id, kind, title, message, dedupe_key) VALUES (?,?,?,?,?)')
      .run(user.id, kind, title, message, dedupeKey);
    if (r.changes === 0) return false;
  } else if (dedupeKey) {
    const seen = db.prepare('SELECT 1 FROM notifications WHERE user_id = ? AND dedupe_key = ?').get(user.id, dedupeKey);
    if (seen) return false;
    db.prepare('INSERT INTO notifications (user_id, kind, title, message, dedupe_key, is_read) VALUES (?,?,?,?,?,1)').run(
      user.id, kind, title, message, dedupeKey
    );
  }
  if (user.notify_email) await sendMail(user.email, title, `${message}\n\n— Personal Finance & Expense Budgeting Assistant`);
  return true;
}

// ---- transactions -----------------------------------------------------------------------------
export function mapTx(r) {
  return {
    id: r.id,
    type: r.type,
    amount: decNum(r.amount_enc),
    date: r.date,
    time: r.time,
    categoryId: r.category_id,
    category: r.category_name ?? null,
    paymentMethod: r.payment_method,
    notes: r.notes_enc ? decrypt(r.notes_enc) : '',
    source: r.source,
  };
}

// Amounts are encrypted, so filtering by amount and aggregation happen after decryption (per-user data set).
export function loadTransactions(userId, { from, to, type, categoryId } = {}) {
  const where = ['t.user_id = ?'];
  const args = [userId];
  if (from) { where.push('t.date >= ?'); args.push(from); }
  if (to) { where.push('t.date <= ?'); args.push(to); }
  if (type) { where.push('t.type = ?'); args.push(type); }
  if (categoryId) { where.push('t.category_id = ?'); args.push(categoryId); }
  const rows = db
    .prepare(
      `SELECT t.*, c.name AS category_name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${where.join(' AND ')} ORDER BY t.date DESC, t.time DESC, t.id DESC`
    )
    .all(...args);
  return rows.map(mapTx);
}

export function monthBounds(month) {
  const from = `${month}-01`;
  const to = addDays(addMonths(from, 1), -1);
  return { from, to };
}

export function spendByCategory(userId, month) {
  const { from, to } = monthBounds(month);
  const out = new Map();
  for (const t of loadTransactions(userId, { from, to, type: 'expense' })) {
    out.set(t.categoryId, round2((out.get(t.categoryId) || 0) + t.amount));
  }
  return out;
}

export function totals(txs) {
  let income = 0, expense = 0;
  for (const t of txs) (t.type === 'income' ? (income += t.amount) : (expense += t.amount));
  return { income: round2(income), expense: round2(expense), net: round2(income - expense) };
}

// ---- budgets ----------------------------------------------------------------------------------
export function budgetStatus(userId, month = monthOf(today())) {
  const spent = spendByCategory(userId, month);
  const rows = db
    .prepare('SELECT b.*, c.name AS category_name FROM budgets b JOIN categories c ON c.id = b.category_id WHERE b.user_id = ? ORDER BY c.name')
    .all(userId);
  return rows.map((b) => {
    const limit = decNum(b.limit_enc);
    const s = spent.get(b.category_id) || 0;
    return {
      id: b.id,
      categoryId: b.category_id,
      category: b.category_name,
      limit,
      active: !!b.active,
      spent: s,
      remaining: round2(limit - s),
      percent: limit > 0 ? Math.round((s / limit) * 100) : 0,
    };
  });
}

// FR-BUDG-002: real-time alerts when approaching (>=80%) or exceeding a budget limit.
export async function checkBudgetAlerts(user, categoryId, date) {
  if (!categoryId) return;
  const month = monthOf(date);
  const b = budgetStatus(user.id, month).find((x) => x.categoryId === categoryId && x.active);
  if (!b || b.limit <= 0) return;
  if (b.percent >= 100) {
    await notify(
      user,
      'budget',
      `${b.category} budget update`,
      `Your ${b.category} spending for ${month} has reached ${b.percent}% of the planned budget. You may want to review upcoming ${b.category} expenses or adjust the budget.`,
      `budget:${b.categoryId}:${month}:over`
    );
  } else if (b.percent >= 80) {
    await notify(
      user,
      'budget',
      `${b.category} budget check-in`,
      `You have used ${b.percent}% of your ${b.category} budget for ${month}, with ${b.remaining} remaining. You're on track to stay within plan if the pace eases a little.`,
      `budget:${b.categoryId}:${month}:near`
    );
  }
}

export function resolveCategory(userId, type, { categoryId, categoryName }) {
  if (categoryId) {
    const c = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(categoryId, userId);
    return c || null;
  }
  if (categoryName) {
    let c = db.prepare('SELECT * FROM categories WHERE user_id = ? AND name = ? AND type = ?').get(userId, categoryName, type);
    if (!c) {
      const r = db.prepare('INSERT INTO categories (user_id, name, type) VALUES (?,?,?)').run(userId, categoryName, type);
      c = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(r.lastInsertRowid));
    }
    return c;
  }
  return null;
}

export const enc = { num: encNum, text: encrypt };
