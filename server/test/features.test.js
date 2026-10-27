import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-feat-'));
process.env.DATA_DIR = dir;
process.env.AUTH_RATE_LIMIT = '10000';
process.env.NODE_ENV = 'test';
process.env.PUSH_DISABLE_SEND = 'true';
delete process.env.SMTP_HOST;

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { retryFailed } = await import('../src/mailer.js');

let server, base;
before(async () => {
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function call(method, url, { token, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}
async function signup(email, password = 'Sup3rSecret99') {
  const reg = await call('POST', '/auth/register', { body: { email, password, name: 'Feature Tester' } });
  assert.equal(reg.status, 201);
  const v = await call('POST', '/auth/verify-otp', { body: { email, code: reg.data.devCode } });
  assert.equal(v.status, 200);
  return v.data.token;
}
async function adminToken(email) {
  await signup(email);
  db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(email);
  return (await call('POST', '/auth/login', { body: { email, password: 'Sup3rSecret99' } })).data.token;
}
const monthStr = (offset = 0) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 7); };

// A very small SMTP server that accepts every message and keeps what it received.
function fakeSmtp() {
  const received = [];
  const srv = net.createServer((sock) => {
    let buf = '', inData = false, msg = '';
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          msg += buf;
          buf = '';
          const end = msg.indexOf('\r\n.\r\n'); // the marker can arrive split across chunks
          if (end === -1) return;
          received.push(msg.slice(0, end));
          buf = msg.slice(end + 5);
          msg = '';
          inData = false;
          sock.write('250 queued\r\n');
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl === -1) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-fake\r\n250 8BITMIME\r\n');
        else if (cmd === 'MAIL' || cmd === 'RCPT' || cmd === 'RSET' || cmd === 'NOOP') sock.write('250 OK\r\n');
        else if (cmd === 'DATA') { inData = true; sock.write('354 go ahead\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, received })));
}

test('mail settings are admin-only, validated and never reveal the password', async () => {
  const plain = await signup('plainmail@example.com');
  assert.equal((await call('GET', '/admin/email', { token: plain })).status, 403);
  const admin = await adminToken('adminmail@example.com');
  assert.equal((await call('GET', '/admin/email', { token: admin })).data.configured, false);
  assert.equal((await call('PUT', '/admin/email', { token: admin, body: { host: 'bad host!', port: 25 } })).status, 400);
  assert.equal((await call('PUT', '/admin/email', { token: admin, body: { host: 'smtp.example.com', port: 70000 } })).status, 400);
  const ok = await call('PUT', '/admin/email', { token: admin, body: { host: 'smtp.example.com', port: 587, user: 'me@example.com', pass: 'app-password-123' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.hasPassword, true);
  assert.ok(!JSON.stringify(ok.data).includes('app-password-123'), 'password is never returned');
  const raw = db.prepare("SELECT value_enc FROM settings WHERE key = 'smtp'").get().value_enc;
  assert.ok(!raw.includes('smtp.example.com') && !raw.includes('app-password'), 'settings are stored encrypted');
  // saving again without a password keeps the stored one
  await call('PUT', '/admin/email', { token: admin, body: { host: 'smtp.example.com', port: 465, secure: true, user: 'me@example.com' } });
  assert.equal((await call('GET', '/admin/email', { token: admin })).data.hasPassword, true);
  assert.equal((await call('DELETE', '/admin/email', { token: admin })).data.configured, false);
});

test('a refused connection is recorded as failed, shown in the outbox, and does not break the app (SI-1.2)', async () => {
  const admin = await adminToken('adminfail@example.com');
  await call('PUT', '/admin/email', { token: admin, body: { host: '127.0.0.1', port: 1, user: '' } });
  const t = await call('POST', '/admin/email/test', { token: admin, body: { to: 'someone@example.com' } });
  assert.equal(t.status, 200);
  assert.equal(t.data.status, 'failed');
  const box = (await call('GET', '/admin/outbox', { token: admin })).data;
  const row = box.messages.find((m) => m.to_addr === 'someone@example.com');
  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, 1);
  assert.ok(row.last_error);
  assert.equal(box.counts.failed >= 1, true);
  // signing up still works while mail is down
  const reg = await call('POST', '/auth/register', { body: { email: 'maildown@example.com', password: 'Sup3rSecret99', name: 'x' } });
  assert.equal(reg.status, 201);
  const retry = await call('POST', `/admin/outbox/${row.id}/retry`, { token: admin });
  assert.equal(retry.data.status, 'failed');
  assert.equal(db.prepare('SELECT attempts FROM outbox WHERE id = ?').get(row.id).attempts, 2);
  await call('DELETE', '/admin/email', { token: admin });
});

test('e-mail is really delivered through SMTP, with an HTML part, and failed mail is retried', async () => {
  const smtp = await fakeSmtp();
  try {
    const admin = await adminToken('adminok@example.com');
    // 1) mail is down: the message fails
    await call('PUT', '/admin/email', { token: admin, body: { host: '127.0.0.1', port: 1 } });
    await call('POST', '/admin/email/test', { token: admin, body: { to: 'retry-me@example.com' } });
    const failedRow = db.prepare("SELECT * FROM outbox WHERE to_addr = 'retry-me@example.com'").get();
    assert.equal(failedRow.status, 'failed');
    // 2) mail comes back: the retry job delivers it
    await call('PUT', '/admin/email', { token: admin, body: { host: '127.0.0.1', port: smtp.port, from: 'Finance Assistant <no-reply@example.com>' } });
    assert.ok((await retryFailed()) >= 1);
    assert.equal(db.prepare('SELECT status FROM outbox WHERE id = ?').get(failedRow.id).status, 'sent');
    // 3) direct send, and the codes are no longer exposed in API responses once a mail server exists
    const t = await call('POST', '/admin/email/test', { token: admin, body: { to: 'real@example.com' } });
    assert.equal(t.data.status, 'sent');
    const all = smtp.received.join('\n');
    assert.match(all, /Subject: Test e-mail from Finance Assistant/);
    assert.match(all, /Content-Type: text\/html/);
    assert.match(all, /real@example\.com/);
    const reg = await call('POST', '/auth/register', { body: { email: 'realcode@example.com', password: 'Sup3rSecret99', name: 'Real' } });
    assert.equal(reg.status, 201);
    assert.equal(reg.data.devCode, undefined, 'one-time code is only e-mailed');
    assert.match(smtp.received.join('\n'), /one-time code/);
    await call('DELETE', '/admin/email', { token: admin });
    const reg2 = await call('POST', '/auth/register', { body: { email: 'dev-again@example.com', password: 'Sup3rSecret99', name: 'Dev' } });
    assert.match(reg2.data.devCode, /^\d{6}$/, 'development fallback returns after the settings are removed');
  } finally {
    smtp.srv.close();
  }
});

test('welcome, security and test e-mails are sent to the user', async () => {
  const token = await signup('notices@example.com');
  const subjects = () => db.prepare("SELECT subject FROM outbox WHERE to_addr = 'notices@example.com'").all().map((r) => r.subject);
  assert.ok(subjects().includes('Welcome to Finance Assistant'));
  await call('PUT', '/auth/me/password', { token, body: { currentPassword: 'Sup3rSecret99', newPassword: 'AnotherPass2026' } });
  assert.ok(subjects().includes('Your password was changed'));
  await call('PUT', '/auth/me/mfa', { token, body: { enabled: true, password: 'AnotherPass2026' } });
  assert.ok(subjects().some((s) => /Two-step sign-in turned on/.test(s)));
  const t = await call('POST', '/auth/me/test-email', { token });
  assert.equal(t.status, 200);
  assert.equal(t.data.status, 'logged');
  assert.match(t.data.message, /No mail server/);
  assert.ok(subjects().includes('Test e-mail from Finance Assistant'));
  // five wrong passwords lock the account and tell the owner
  for (let i = 0; i < 5; i++) await call('POST', '/auth/login', { body: { email: 'notices@example.com', password: 'wrong-password-1' } });
  assert.ok(subjects().includes('Your account was temporarily locked'));
});

test('push notification subscriptions (FR-BILL-002)', async () => {
  const token = await signup('pusher@example.com');
  const key = await call('GET', '/push/key', { token });
  assert.ok(key.data.publicKey.length > 60);
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'BPublicKeyExample', auth: 'authSecret' } };
  assert.equal((await call('POST', '/push/subscribe', { token, body: { ...sub, endpoint: 'https://evil.example.com/x' } })).status, 400, 'unknown push service rejected');
  assert.equal((await call('POST', '/push/subscribe', { token, body: { ...sub, endpoint: 'http://fcm.googleapis.com/x' } })).status, 400, 'https required');
  assert.equal((await call('POST', '/push/subscribe', { token, body: { endpoint: sub.endpoint } })).status, 400, 'keys required');
  const ok = await call('POST', '/push/subscribe', { token, body: sub });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.devices, 1);
  assert.equal((await call('GET', '/auth/me', { token })).data.user.notifyPush, true);
  // a push is attempted when an alert is created (delivery is stubbed in tests)
  const t = await call('POST', '/push/test', { token });
  assert.equal(t.data.sent, 1);
  const bill = await call('POST', '/bills', { token, body: { name: 'Water', amount: 100, dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10) } });
  assert.equal(bill.status, 201);
  const un = await call('POST', '/push/unsubscribe', { token, body: { endpoint: sub.endpoint } });
  assert.equal(un.data.devices, 0);
  assert.equal((await call('GET', '/auth/me', { token })).data.user.notifyPush, false);
  assert.equal((await call('POST', '/push/test', { token })).status, 400);
});

test('insurance and debt restructuring suggestions (SRS 1.4)', async () => {
  const token = await signup('advice@example.com');
  const cats = (await call('GET', '/categories', { token })).data.categories;
  const id = (n, t = 'expense') => cats.find((c) => c.name === n && c.type === t).id;
  assert.ok(cats.some((c) => c.name === 'Loan EMI'), 'Loan EMI is a default category');
  const add = (b) => call('POST', '/transactions', { token, body: b });
  for (const off of [-4, -3, -2, -1]) {
    const m = monthStr(off);
    await add({ type: 'income', amount: 50000, date: `${m}-01`, categoryId: id('Salary', 'income') });
    await add({ type: 'expense', amount: 5000, date: `${m}-05`, categoryId: id('Food') });
    if (off === -1) await add({ type: 'expense', amount: 24000, date: `${m}-07`, categoryId: id('Loan EMI'), notes: 'Home loan EMI' });
  }
  const ins = (await call('GET', '/insights', { token })).data.recommendations;
  const ids = ins.map((r) => r.id);
  assert.ok(ids.includes('insurance-none'));
  const debt = ins.find((r) => r.id === 'debt-high');
  assert.ok(debt, 'debt share of 48% triggers a restructuring idea');
  assert.match(debt.message, /not financial advice/);
  assert.match(debt.message, /refinancing|consolidating/);
  // paying a premium removes the insurance suggestion
  await add({ type: 'expense', amount: 3000, date: `${monthStr(-2)}-10`, categoryId: id('Insurance'), notes: 'Health insurance premium' });
  const again = (await call('GET', '/insights', { token })).data.recommendations.map((r) => r.id);
  assert.ok(!again.includes('insurance-none'));
});
