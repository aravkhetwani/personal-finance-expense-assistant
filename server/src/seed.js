// Creates demo data for trying the app: a demo user (12 months of activity) and an administrator.
import bcrypt from 'bcryptjs';
import { db, tx } from './db.js';
import { encNum, encrypt } from './crypto.js';
import { addDays, addMonths, today } from './http.js';
import { seedCategories } from './services.js';

const DEMO = { email: 'demo@example.com', password: 'DemoPass1234', name: 'Demo User' };
const ADMIN = { email: 'admin@example.com', password: 'AdminPass1234', name: 'Administrator' };

async function ensureUser(u, role) {
  let row = db.prepare('SELECT * FROM users WHERE email = ?').get(u.email);
  if (row) return { row, created: false };
  const hash = await bcrypt.hash(u.password, 12);
  const r = db.prepare('INSERT INTO users (email, password_hash, name, role, verified, onboarded) VALUES (?,?,?,?,1,1)').run(u.email, hash, u.name, role);
  row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(r.lastInsertRowid));
  seedCategories(row.id);
  return { row, created: true };
}

const { row: admin } = await ensureUser(ADMIN, 'admin');
const { row: demo, created } = await ensureUser(DEMO, 'user');

if (created) {
  const cat = (name, type) => db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ? AND type = ?').get(demo.id, name, type).id;
  const ins = db.prepare('INSERT INTO transactions (user_id, type, amount_enc, date, time, category_id, payment_method, notes_enc, source) VALUES (?,?,?,?,?,?,?,?,?)');
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const first = `${today().slice(0, 7)}-01`;
  tx(() => {
    for (let m = 11; m >= 0; m--) {
      const base = addMonths(first, -m);
      const d = (n) => addDays(base, n);
      const add = (type, name, amount, day, notes, method = 'upi') =>
        d(day) <= today() &&
        ins.run(demo.id, type, encNum(Math.round(amount)), d(day), '12:00', cat(name, type), method, encrypt(notes), 'manual');
      add('income', 'Salary', 85000, 0, 'Monthly salary', 'bank');
      if (m % 3 === 0) add('income', 'Freelance', 12000 + rnd() * 8000, 12, 'Freelance project');
      add('expense', 'Rent', 22000, 1, 'Monthly rent', 'bank');
      add('expense', 'Utilities', 2500 + rnd() * 1500, 5, 'Electricity and internet');
      for (let i = 0; i < 8; i++) add('expense', 'Food', 250 + rnd() * 700, 2 + i * 3, i % 3 === 0 ? 'Coffee with friends' : 'Groceries and dining');
      for (let i = 0; i < 6; i++) add('expense', 'Transport', 80 + rnd() * 400, 3 + i * 4, 'Commute');
      add('expense', 'Entertainment', 600 + rnd() * (m === 1 ? 5000 : 1800), 15, 'Movies and streaming');
      add('expense', 'Shopping', 1000 + rnd() * 3500, 20, 'Clothes and household');
    }
  });
  const budget = db.prepare('INSERT INTO budgets (user_id, category_id, limit_enc) VALUES (?,?,?)');
  budget.run(demo.id, cat('Food', 'expense'), encNum(7000));
  budget.run(demo.id, cat('Entertainment', 'expense'), encNum(2500));
  budget.run(demo.id, cat('Transport', 'expense'), encNum(2500));
  const goal = db.prepare('INSERT INTO goals (user_id, name, target_enc, saved_enc, deadline) VALUES (?,?,?,?,?)');
  goal.run(demo.id, 'Emergency fund', encNum(200000), encNum(85000), addMonths(first, 14));
  goal.run(demo.id, 'Goa trip', encNum(40000), encNum(12000), addMonths(first, 5));
  const bill = db.prepare('INSERT INTO bills (user_id, name, amount_enc, due_date, recurrence) VALUES (?,?,?,?,?)');
  bill.run(demo.id, 'Electricity', encNum(2800), addDays(today(), 2), 'monthly');
  bill.run(demo.id, 'Internet', encNum(999), addDays(today(), 9), 'monthly');
  bill.run(demo.id, 'Health insurance', encNum(14500), addDays(today(), 28), 'yearly');
}

console.log('Seed complete.');
console.log(`  Demo user : ${DEMO.email} / ${DEMO.password}`);
console.log(`  Admin     : ${ADMIN.email} / ${ADMIN.password}   (id ${admin.id})`);
console.log('  Change or remove these accounts before any real deployment.');
