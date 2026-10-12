import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-test-'));
process.env.DATA_DIR = dir;
process.env.AUTH_RATE_LIMIT = '10000';
process.env.NODE_ENV = 'test';
delete process.env.SMTP_HOST;

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { runBillReminders } = await import('../src/scheduler.js');

let server, base;
before(async () => {
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function call(method, url, { token, body, raw } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

async function signup(email, password = 'Sup3rSecret99', name = 'Test User') {
  const reg = await call('POST', '/auth/register', { body: { email, password, name } });
  assert.equal(reg.status, 201);
  assert.match(reg.data.devCode, /^\d{6}$/);
  const v = await call('POST', '/auth/verify-otp', { body: { email, code: reg.data.devCode } });
  assert.equal(v.status, 200);
  return v.data.token;
}
const monthStr = (offset = 0) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 7); };
const cats = async (token) => (await call('GET', '/categories', { token })).data.categories;

test('registration enforces password rules, OTP verification and unique email (FR-AUTH-001/002)', async () => {
  assert.equal((await call('POST', '/auth/register', { body: { email: 'bad', password: 'Sup3rSecret99', name: 'x' } })).status, 400);
  assert.equal((await call('POST', '/auth/register', { body: { email: 'a@x.com', password: 'short1', name: 'x' } })).status, 400);
  assert.equal((await call('POST', '/auth/register', { body: { email: 'a@x.com', password: 'onlyletterspass', name: 'x' } })).status, 400);
  const token = await signup('reg@example.com');
  const me = await call('GET', '/auth/me', { token });
  assert.equal(me.data.user.email, 'reg@example.com');
  const dup = await call('POST', '/auth/register', { body: { email: 'REG@example.com', password: 'Sup3rSecret99', name: 'x' } });
  assert.equal(dup.status, 409);
  const raw = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('reg@example.com');
  assert.match(raw.password_hash, /^\$2[aby]\$/, 'password stored as bcrypt hash (NFR-SEC-001)');
  // wrong OTP
  const r2 = await call('POST', '/auth/register', { body: { email: 'otp@example.com', password: 'Sup3rSecret99', name: 'o' } });
  assert.equal((await call('POST', '/auth/verify-otp', { body: { email: 'otp@example.com', code: r2.data.devCode === '000000' ? '111111' : '000000' } })).status, 400);
});

test('login, lockout, logout and unauthenticated access (FR-AUTH-003/005, NFR-SEC-005)', async () => {
  await signup('login@example.com');
  assert.equal((await call('POST', '/auth/login', { body: { email: 'login@example.com', password: 'wrong-password1' } })).status, 401);
  const ok = await call('POST', '/auth/login', { body: { email: 'login@example.com', password: 'Sup3rSecret99' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/dashboard')).status, 401);
  assert.equal((await call('POST', '/auth/logout', { token: ok.data.token })).status, 200);
  assert.equal((await call('GET', '/dashboard', { token: ok.data.token })).status, 401, 'token unusable after logout');
  for (let i = 0; i < 5; i++) await call('POST', '/auth/login', { body: { email: 'login@example.com', password: 'nope-nope-nope1' } });
  const locked = await call('POST', '/auth/login', { body: { email: 'login@example.com', password: 'Sup3rSecret99' } });
  assert.equal(locked.status, 429, 'account temporarily locked after repeated failures');
  const events = db.prepare("SELECT DISTINCT event FROM security_logs").all().map((e) => e.event);
  for (const e of ['login_success', 'login_failed', 'account_locked', 'logout']) assert.ok(events.includes(e), `logged ${e}`);
});

test('password reset by email link (FR-AUTH-004) revokes old sessions', async () => {
  const token = await signup('reset@example.com');
  const f = await call('POST', '/auth/forgot-password', { body: { email: 'reset@example.com' } });
  assert.ok(f.data.devToken);
  const unknown = await call('POST', '/auth/forgot-password', { body: { email: 'nobody@example.com' } });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.message, f.data.message, 'does not reveal whether the account exists');
  assert.equal((await call('POST', '/auth/reset-password', { body: { token: f.data.devToken, password: 'weak' } })).status, 400);
  assert.equal((await call('POST', '/auth/reset-password', { body: { token: f.data.devToken, password: 'BrandNewPass77' } })).status, 200);
  assert.equal((await call('POST', '/auth/reset-password', { body: { token: f.data.devToken, password: 'BrandNewPass78' } })).status, 400, 'token is single use');
  assert.equal((await call('GET', '/auth/me', { token })).status, 401);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'reset@example.com', password: 'BrandNewPass77' } })).status, 200);
});

test('optional MFA (NFR-SEC-006) and profile update (FR-AUTH-006)', async () => {
  const token = await signup('mfa@example.com');
  assert.equal((await call('PUT', '/auth/me/mfa', { token, body: { enabled: true, password: 'wrong' } })).status, 403);
  assert.equal((await call('PUT', '/auth/me/mfa', { token, body: { enabled: true, password: 'Sup3rSecret99' } })).status, 200);
  const l = await call('POST', '/auth/login', { body: { email: 'mfa@example.com', password: 'Sup3rSecret99' } });
  assert.equal(l.data.mfaRequired, true);
  assert.equal((await call('POST', '/auth/login/mfa', { body: { mfaToken: l.data.mfaToken, code: '000000' } })).status, 400);
  const ok = await call('POST', '/auth/login/mfa', { body: { mfaToken: l.data.mfaToken, code: l.data.devCode } });
  assert.equal(ok.status, 200);
  const up = await call('PUT', '/auth/me', { token: ok.data.token, body: { name: 'Renamed', phone: '999', annualIncome: 900000, currency: 'USD' } });
  assert.equal(up.data.user.name, 'Renamed');
  assert.equal(up.data.user.annualIncome, 900000);
  const pw = await call('PUT', '/auth/me/password', { token: ok.data.token, body: { currentPassword: 'Sup3rSecret99', newPassword: 'AnotherPass2026' } });
  assert.equal(pw.status, 200);
});

test('inactivity timeout ends the session (NFR-SEC-004)', async () => {
  const token = await signup('idle@example.com');
  db.prepare("UPDATE sessions SET last_active = datetime('now','-2 hours') WHERE user_id = (SELECT id FROM users WHERE email = 'idle@example.com')").run();
  db.prepare("UPDATE sessions SET last_active = '2000-01-01T00:00:00.000Z' WHERE user_id = (SELECT id FROM users WHERE email = 'idle@example.com')").run();
  assert.equal((await call('GET', '/auth/me', { token })).status, 401);
});

test('transactions: CRUD, filters, encryption at rest, validation (FR-TRACK-001/002/003)', async () => {
  const token = await signup('tx@example.com');
  const c = await cats(token);
  const food = c.find((x) => x.name === 'Food' && x.type === 'expense');
  const salary = c.find((x) => x.name === 'Salary');
  const mk = (b) => call('POST', '/transactions', { token, body: b });
  const month = monthStr();
  const e1 = await mk({ type: 'expense', amount: 120.5, date: `${month}-03`, time: '09:30', categoryId: food.id, paymentMethod: 'card', notes: 'Lunch with team' });
  assert.equal(e1.status, 201);
  assert.equal(e1.data.transaction.amount, 120.5);
  await mk({ type: 'income', amount: 5000, date: `${month}-01`, categoryId: salary.id });
  await mk({ type: 'expense', amount: 900, date: `${month}-10`, categoryId: food.id, notes: 'Groceries' });
  assert.equal((await mk({ type: 'expense', amount: -5 })).status, 400);
  assert.equal((await mk({ type: 'expense', amount: 'abc' })).status, 400);
  assert.equal((await mk({ type: 'income', amount: 5, categoryId: food.id })).status, 400, 'category type must match');
  const raw = db.prepare('SELECT amount_enc, notes_enc FROM transactions WHERE user_id = (SELECT id FROM users WHERE email = ?)').all('tx@example.com');
  assert.ok(raw.every((r) => r.amount_enc.split('.').length === 3 && Number.isNaN(Number(r.amount_enc))), 'amounts are encrypted at rest (NFR-SEC-002): iv.tag.ciphertext, not a number');
  assert.ok(raw.every((r) => !['120.5', '900', '5000'].includes(r.amount_enc)), 'no plaintext amounts');
  assert.ok(raw.filter((r) => r.notes_enc).every((r) => !r.notes_enc.includes('Lunch')));

  const all = await call('GET', '/transactions', { token });
  assert.equal(all.data.total, 3);
  assert.equal(all.data.totals.income, 5000);
  assert.equal(all.data.totals.expense, 1020.5);
  assert.equal((await call('GET', `/transactions?categoryId=${food.id}`, { token })).data.total, 2);
  assert.equal((await call('GET', '/transactions?minAmount=500&maxAmount=1000', { token })).data.total, 1);
  assert.equal((await call('GET', `/transactions?from=${month}-02&to=${month}-05`, { token })).data.total, 1);
  assert.equal((await call('GET', '/transactions?q=lunch', { token })).data.total, 1);

  const upd = await call('PUT', `/transactions/${e1.data.transaction.id}`, { token, body: { type: 'expense', amount: 99, date: `${month}-03`, categoryId: food.id } });
  assert.equal(upd.data.transaction.amount, 99);
  assert.equal((await call('DELETE', `/transactions/${e1.data.transaction.id}`, { token })).status, 200);
  assert.equal((await call('DELETE', `/transactions/${e1.data.transaction.id}`, { token })).status, 404);
});

test('users cannot see or modify each other\'s data', async () => {
  const a = await signup('iso-a@example.com');
  const b = await signup('iso-b@example.com');
  const t = await call('POST', '/transactions', { token: a, body: { type: 'expense', amount: 10, date: monthStr() + '-02' } });
  assert.equal((await call('PUT', `/transactions/${t.data.transaction.id}`, { token: b, body: { type: 'expense', amount: 1 } })).status, 404);
  assert.equal((await call('DELETE', `/transactions/${t.data.transaction.id}`, { token: b })).status, 404);
  assert.equal((await call('GET', '/transactions', { token: b })).data.total, 0);
});

test('CSV import/export and bulk deletion needs typed confirmation (FR-TRACK-004, NFR-SAF-003)', async () => {
  const token = await signup('csv@example.com');
  const m = monthStr();
  const csv = `date,type,amount,category,payment_method,notes\n${m}-02,expense,250,Food,card,"Dinner, with ""friends"""\n${m}-03,income,3000,Salary,bank,Pay\nnot-a-date,expense,10,Food,cash,bad\n${m}-04,expense,-5,Food,cash,neg\n`;
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'x.csv');
  const imp = await call('POST', '/transactions/import', { token, body: fd });
  assert.equal(imp.status, 200);
  assert.equal(imp.data.imported, 2);
  assert.equal(imp.data.skipped, 2);
  const exp = await call('GET', '/transactions/export.csv', { token, raw: true });
  const text = await exp.text();
  assert.match(text, /Dinner, with ""friends""/);
  const list = await call('GET', '/transactions', { token });
  assert.equal((await call('POST', '/transactions/bulk-delete', { token, body: { all: true } })).status, 400);
  assert.equal((await call('POST', '/transactions/bulk-delete', { token, body: { all: true, confirm: 'delete' } })).status, 400);
  const del = await call('POST', '/transactions/bulk-delete', { token, body: { ids: [list.data.items[0].id], confirm: 'DELETE' } });
  assert.equal(del.data.deleted, 1);
});

test('categories: defaults protected, custom CRUD (FR-TRACK-005)', async () => {
  const token = await signup('cat@example.com');
  const list = await cats(token);
  assert.ok(['Food', 'Rent', 'Utilities', 'Entertainment'].every((n) => list.some((c) => c.name === n)));
  const food = list.find((c) => c.name === 'Food');
  assert.equal((await call('DELETE', `/categories/${food.id}`, { token })).status, 400);
  const mk = await call('POST', '/categories', { token, body: { name: 'Pets', type: 'expense' } });
  assert.equal(mk.status, 201);
  assert.equal((await call('POST', '/categories', { token, body: { name: 'Pets', type: 'expense' } })).status, 409);
  assert.equal((await call('PUT', `/categories/${mk.data.category.id}`, { token, body: { name: 'Pet care' } })).status, 200);
  await call('POST', '/transactions', { token, body: { type: 'expense', amount: 40, categoryId: mk.data.category.id } });
  assert.equal((await call('DELETE', `/categories/${mk.data.category.id}`, { token })).status, 200);
  const t = await call('GET', '/transactions', { token });
  assert.equal(t.data.items[0].category, 'Other', 'transactions re-assigned to Other');
});

test('budgets track spending and send neutral alerts (FR-BUDG-001/002/003, NFR-SAF-002)', async () => {
  const token = await signup('budget@example.com');
  const food = (await cats(token)).find((c) => c.name === 'Food');
  const b = await call('POST', '/budgets', { token, body: { categoryId: food.id, limit: 1000 } });
  assert.equal(b.status, 201);
  assert.equal((await call('POST', '/budgets', { token, body: { categoryId: food.id, limit: 500 } })).status, 409);
  const d = `${monthStr()}-05`;
  await call('POST', '/transactions', { token, body: { type: 'expense', amount: 850, date: d, categoryId: food.id } });
  let n = (await call('GET', '/notifications', { token })).data;
  assert.equal(n.notifications.length, 1, 'approaching alert at 80%');
  await call('POST', '/transactions', { token, body: { type: 'expense', amount: 300, date: d, categoryId: food.id } });
  n = (await call('GET', '/notifications', { token })).data;
  assert.equal(n.notifications.length, 2, 'exceeded alert');
  const text = n.notifications.map((x) => `${x.title} ${x.message}`).join(' ').toLowerCase();
  assert.ok(!/warning|alarming|overspent|failed|danger|irresponsible/.test(text), 'language stays neutral');
  await call('POST', '/transactions', { token, body: { type: 'expense', amount: 10, date: d, categoryId: food.id } });
  assert.equal((await call('GET', '/notifications', { token })).data.notifications.length, 2, 'no duplicate alerts');
  const status = (await call('GET', '/budgets', { token })).data.budgets[0];
  assert.equal(status.percent, 116);
  const up = await call('PUT', `/budgets/${b.data.budget.id}`, { token, body: { limit: 2000, active: false } });
  assert.equal(up.data.budget.limit, 2000);
  assert.equal(up.data.budget.active, false);
  assert.equal((await call('POST', '/notifications/read-all', { token })).status, 200);
  assert.equal((await call('GET', '/notifications', { token })).data.unread, 0);
});

test('goals, progress and investment recommendations with disclaimer (FR-INV-001..004, NFR-SAF-001)', async () => {
  const token = await signup('goal@example.com');
  const dl = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const g = await call('POST', '/goals', { token, body: { name: 'Vacation', target: 10000, saved: 2500, deadline: dl } });
  assert.equal(g.status, 201);
  assert.equal(g.data.goal.percent, 25);
  const c = await call('POST', `/goals/${g.data.goal.id}/contribute`, { token, body: { amount: 2500 } });
  assert.equal(c.data.goal.percent, 50);
  const rec = await call('GET', `/goals/recommendations/list?goalId=${g.data.goal.id}&risk=low`, { token });
  assert.ok(rec.data.options.length > 0);
  assert.ok(rec.data.options.every((o) => o.risk === 'low' && o.estimatedReturnPct.length === 2));
  assert.match(rec.data.disclaimer, /not a registered financial advisor/i);
  const high = await call('GET', '/goals/recommendations/list?risk=high&years=10', { token });
  assert.ok(high.data.options.some((o) => o.risk === 'high'));
  const short = await call('GET', '/goals/recommendations/list?risk=high&years=0.3', { token });
  assert.ok(short.data.options.every((o) => o.risk === 'low'), 'short horizons stay conservative');
});

test('bills: reminders, fail-safe dashboard flag, recurrence (FR-BILL-001..003, NFR-SAF-004)', async () => {
  const token = await signup('bill@example.com');
  const dayStr = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const soon = await call('POST', '/bills', { token, body: { name: 'Internet', amount: 999, dueDate: dayStr(2), recurrence: 'monthly' } });
  assert.equal(soon.status, 201);
  await call('POST', '/bills', { token, body: { name: 'Rent', amount: 20000, dueDate: dayStr(-2) } });
  await call('POST', '/bills', { token, body: { name: 'Insurance', amount: 5000, dueDate: dayStr(40) } });
  assert.equal((await call('POST', '/bills', { token, body: { name: 'x', amount: 1, dueDate: 'bad' } })).status, 400);
  const n = (await call('GET', '/notifications', { token })).data.notifications;
  assert.equal(n.length, 2, 'reminders only for soon/overdue bills');
  assert.equal(await runBillReminders(), 0, 'no duplicate reminders on later runs');
  const outbox = db.prepare("SELECT COUNT(*) AS c FROM outbox WHERE to_addr = 'bill@example.com' AND subject LIKE '%Rent%'").get().c;
  assert.equal(outbox, 1, 'email attempted as well');
  const dash = (await call('GET', '/dashboard', { token })).data;
  assert.equal(dash.flaggedBills.length, 2);
  assert.ok(dash.flaggedBills.some((b) => b.status === 'overdue'));
  const paid = await call('POST', `/bills/${soon.data.bill.id}/pay`, { token });
  assert.ok(paid.data.bill.dueDate > soon.data.bill.dueDate, 'recurring bill rolls forward');
  const rent = (await call('GET', '/bills', { token })).data.bills.find((b) => b.name === 'Rent');
  await call('POST', `/bills/${rent.id}/pay`, { token });
  assert.equal((await call('GET', '/bills', { token })).data.bills.find((b) => b.name === 'Rent').paid, true);
});

test('email failure never breaks the flow (SI-1.2)', async () => {
  const token = await signup('fail@example.com');
  assert.equal((await call('PUT', '/auth/me', { token, body: { notifyEmail: false } })).status, 200);
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.equal((await call('POST', '/bills', { token, body: { name: 'Water', amount: 100, dueDate: day } })).status, 201);
  assert.equal((await call('GET', '/notifications', { token })).data.notifications.length, 1, 'in-app reminder still delivered');
});

test('dashboard, insights, reports, exports (FR-DASH-*, FR-INSIGHT-*)', async () => {
  const token = await signup('dash@example.com');
  const c = await cats(token);
  const id = (n, t = 'expense') => c.find((x) => x.name === n && x.type === t).id;
  const add = (b) => call('POST', '/transactions', { token, body: b });
  await call('PUT', '/auth/me', { token, body: { openingBalance: 1000 } });
  for (const off of [-4, -3, -2, -1]) {
    const m = monthStr(off);
    await add({ type: 'income', amount: 10000, date: `${m}-01`, categoryId: id('Salary', 'income') });
    await add({ type: 'expense', amount: off === -1 ? 3000 : 1000, date: `${m}-05`, categoryId: id('Entertainment') });
    await add({ type: 'expense', amount: 600, date: `${m}-06`, categoryId: id('Food'), notes: off === -1 ? 'Coffee runs' : 'Lunch' });
  }
  const cur = monthStr();
  await add({ type: 'income', amount: 8000, date: `${cur}-01`, categoryId: id('Salary', 'income') });
  await add({ type: 'expense', amount: 500, date: `${cur}-02`, categoryId: id('Food') });
  const dash = (await call('GET', '/dashboard', { token })).data;
  assert.equal(dash.summary.income, 8000);
  assert.equal(dash.summary.expense, 500);
  assert.equal(dash.netWorth, 1000 + 4 * 10000 + 8000 - (1000 * 3 + 3000 + 600 * 4 + 500));
  assert.ok(dash.quickLinks.length >= 3);
  const ins = (await call('GET', '/insights', { token })).data;
  assert.equal(ins.trend.length, 12);
  assert.ok(ins.distribution.length >= 1);
  const rec = ins.recommendations.map((r) => r.id);
  assert.ok(rec.some((r) => r.startsWith('above-avg-Entertainment')), 'flags above-average spend');
  assert.ok(rec.includes('coffee'), 'coffee suggestion');
  const rep = (await call('GET', `/reports/summary?from=${monthStr(-4)}-01&to=${cur}-28`, { token })).data;
  assert.equal(rep.totals.income, 48000);
  const csv = await call('GET', `/reports/export.csv?from=${monthStr(-4)}-01`, { token, raw: true });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const pdf = await call('GET', `/reports/export.pdf?from=${monthStr(-4)}-01`, { token, raw: true });
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
});

test('tax guidance carries a disclaimer (FR-TAX-001/002)', async () => {
  const token = await signup('tax@example.com');
  const t = await call('GET', '/tax?income=1500000', { token });
  assert.equal(t.status, 200);
  assert.ok(t.data.instruments.length >= 3);
  assert.match(t.data.disclaimer, /not personalised tax advice/i);
  const us = await call('GET', '/tax?region=US&income=90000', { token });
  assert.ok(us.data.instruments.some((i) => /401/.test(i.name)));
});

test('receipt endpoint validates uploads (FR-SCAN-001)', async () => {
  const token = await signup('scan@example.com');
  const fd = new FormData();
  fd.append('receipt', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
  assert.equal((await call('POST', '/receipts/scan', { token, body: fd })).status, 400);
  const fd2 = new FormData();
  fd2.append('receipt', new Blob(['not really an image'], { type: 'image/png' }), 'x.png');
  assert.equal((await call('POST', '/receipts/scan', { token, body: fd2 })).status, 400, 'magic-number check');
});

test('admin endpoints are restricted and work for admins', async () => {
  const user = await signup('plain@example.com');
  assert.equal((await call('GET', '/admin/users', { token: user })).status, 403);
  db.prepare("UPDATE users SET role = 'admin' WHERE email = 'plain@example.com'").run();
  const adminToken = (await call('POST', '/auth/login', { body: { email: 'plain@example.com', password: 'Sup3rSecret99' } })).data.token;
  const other = await signup('victim@example.com');
  const users = (await call('GET', '/admin/users', { token: adminToken })).data.users;
  const victim = users.find((u) => u.email === 'victim@example.com');
  assert.equal((await call('PATCH', `/admin/users/${victim.id}`, { token: adminToken, body: { disabled: true } })).status, 200);
  assert.equal((await call('GET', '/auth/me', { token: other })).status, 401, 'disabled users are signed out');
  assert.equal((await call('GET', '/admin/stats', { token: adminToken })).data.users >= 2, true);
  assert.ok((await call('GET', '/admin/security-logs', { token: adminToken })).data.logs.length > 0);
  const bk = await call('POST', '/admin/backup', { token: adminToken });
  assert.equal(bk.status, 200);
  assert.ok(fs.existsSync(path.join(dir, 'backups', bk.data.file)), 'backup file created (DR-002)');
});

test('export own data and delete account permanently (BR-004, CO-5, NFR-SAF-003)', async () => {
  const token = await signup('gone@example.com');
  await call('POST', '/transactions', { token, body: { type: 'expense', amount: 5, date: monthStr() + '-02' } });
  const ex = await call('GET', '/auth/me/export', { token });
  assert.equal(ex.data.transactions.length, 1);
  assert.equal((await call('POST', '/auth/me/delete', { token, body: { password: 'Sup3rSecret99', confirm: 'delete' } })).status, 400);
  assert.equal((await call('POST', '/auth/me/delete', { token, body: { password: 'wrongwrong1', confirm: 'DELETE' } })).status, 403);
  assert.equal((await call('POST', '/auth/me/delete', { token, body: { password: 'Sup3rSecret99', confirm: 'DELETE' } })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM users WHERE email = 'gone@example.com'").get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE user_id NOT IN (SELECT id FROM users)').get().c, 0, 'all associated data removed');
});

test('security headers and generic errors', async () => {
  const res = await fetch(base + '/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const bad = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(bad.status, 400);
  assert.equal((await call('GET', '/nope', { token: 'x' })).status, 401);
});
