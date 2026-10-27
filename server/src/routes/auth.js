import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db, inFuture, nowIso, tx } from '../db.js';
import { randomOtp, randomToken, sha256, encNum } from '../crypto.js';
import { HttpError, bad, str, num, oneOf } from '../http.js';
import { issueSession, requireAuth } from '../auth.js';
import { exposeCodes, sendMail } from '../mailer.js';
import { logEvent } from '../security.js';
import { publicUser, seedCategories, loadTransactions } from '../services.js';

const r = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// FR-AUTH-001: valid email + secure password (NIST 800-63B: length first, plus basic composition).
export function checkPassword(pw) {
  if (typeof pw !== 'string') throw bad('Password is required');
  if (pw.length < 10) throw bad('Password must be at least 10 characters');
  if (pw.length > 128) throw bad('Password is too long');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password must include letters and at least one number');
  if (/^(password|123456|qwerty)/i.test(pw)) throw bad('That password is too common');
}

async function createOtp(user, purpose) {
  db.prepare('UPDATE otps SET used = 1 WHERE user_id = ? AND purpose = ? AND used = 0').run(user.id, purpose);
  const code = randomOtp();
  db.prepare('INSERT INTO otps (user_id, purpose, code_hash, expires_at) VALUES (?,?,?,?)').run(
    user.id, purpose, sha256(`${user.id}:${purpose}:${code}`), inFuture(config.otpTtlMin)
  );
  const label = purpose === 'verify' ? 'verify your email address' : 'complete your sign-in';
  await sendMail(user.email, 'Your verification code', `Use this one-time code to ${label}: ${code}\nIt expires in ${config.otpTtlMin} minutes. If you did not request it, you can ignore this message.`);
  return code;
}

function checkOtp(user, purpose, code) {
  const row = db
    .prepare('SELECT * FROM otps WHERE user_id = ? AND purpose = ? AND used = 0 ORDER BY id DESC LIMIT 1')
    .get(user.id, purpose);
  if (!row || row.expires_at < nowIso()) throw bad('That code has expired. Please request a new one.');
  if (row.attempts >= 5) throw bad('Too many attempts. Please request a new code.');
  if (row.code_hash !== sha256(`${user.id}:${purpose}:${String(code).trim()}`)) {
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    throw bad('That code is not correct.');
  }
  db.prepare('UPDATE otps SET used = 1 WHERE id = ?').run(row.id);
}

const withDev = (body, code) => (exposeCodes() && code ? { ...body, devCode: code } : body);

r.post('/register', async (req, res) => {
  const email = str(req.body.email, 'Email', { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw bad('Please enter a valid email address');
  const name = str(req.body.name, 'Name', { min: 1, max: 100 });
  checkPassword(req.body.password);
  const hash = await bcrypt.hash(req.body.password, 12); // NFR-SEC-001
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user?.verified) throw new HttpError(409, 'An account with this email already exists');
  if (user) {
    db.prepare('UPDATE users SET password_hash = ?, name = ? WHERE id = ?').run(hash, name, user.id);
  } else {
    const ins = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?,?,?)').run(email, hash, name);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(ins.lastInsertRowid));
    seedCategories(user.id);
  }
  const code = await createOtp(user, 'verify');
  logEvent(user.id, 'register', req);
  res.status(201).json(withDev({ message: 'We sent a 6-digit verification code to your email.', email }, code));
});

r.post('/verify-otp', async (req, res) => {
  const email = str(req.body.email, 'Email').toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) throw bad('That code is not correct.');
  if (!user.verified) {
    checkOtp(user, 'verify', req.body.code); // FR-AUTH-002
    db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(user.id);
    logEvent(user.id, 'email_verified', req);
    await sendMail(user.email, 'Welcome to Finance Assistant', `Hi ${user.name},\n\nYour email is verified and your account is ready. A good way to start is to add your first expense, then set a monthly budget for a category you want to keep an eye on.\n\nYou can turn reminders, e-mail and push notifications on or off any time under Profile. Every page has a Help link if you get stuck.`);
  } else {
    throw bad('This email is already verified. Please sign in.');
  }
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
  res.json({ token: issueSession(fresh, req), user: publicUser(fresh) });
});

r.post('/resend-otp', async (req, res) => {
  const email = str(req.body.email, 'Email').toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  let code;
  if (user && !user.verified) code = await createOtp(user, 'verify');
  res.json(withDev({ message: 'If that email is awaiting verification, a new code has been sent.' }, code));
});

r.post('/login', async (req, res) => {
  const email = str(req.body.email, 'Email').toLowerCase();
  const password = str(req.body.password, 'Password', { max: 200 });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const fail = () => new HttpError(401, 'Email or password is incorrect');

  if (!user) {
    await bcrypt.compare(password, '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5y7oSx0x0o7mOa6ZUzVqD5pYQ9oXrWa'); // constant-ish timing
    logEvent(null, 'login_failed', req, `unknown:${email}`);
    throw fail();
  }
  if (user.locked_until && user.locked_until > nowIso()) {
    logEvent(user.id, 'login_blocked_locked', req);
    throw new HttpError(429, 'Too many failed attempts. Please try again in a few minutes.');
  }
  if (!(await bcrypt.compare(password, user.password_hash))) {
    const attempts = user.failed_attempts + 1;
    if (attempts >= config.maxFailedLogins) {
      db.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?').run(inFuture(config.lockMinutes), user.id);
      logEvent(user.id, 'account_locked', req);
      await sendMail(user.email, 'Your account was temporarily locked', `There were several unsuccessful sign-in attempts on your account, so it has been locked for ${config.lockMinutes} minutes as a precaution.\n\nIf this was you, just wait and try again. If it was not you, we suggest resetting your password once the lock ends.`);
    } else {
      db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, user.id);
    }
    logEvent(user.id, 'login_failed', req);
    throw fail();
  }
  if (user.disabled) throw new HttpError(403, 'This account is disabled. Please contact support.');
  if (!user.verified) {
    const code = await createOtp(user, 'verify');
    return res.status(403).json(withDev({ error: 'Please verify your email to continue.', needsVerification: true, email }, code));
  }
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
  if (user.mfa_enabled) {
    const code = await createOtp(user, 'mfa'); // NFR-SEC-006 (optional MFA)
    const mfaToken = jwt.sign({ sub: user.id, purpose: 'mfa' }, config.jwtSecret, { expiresIn: '10m' });
    return res.json(withDev({ mfaRequired: true, mfaToken }, code));
  }
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
  logEvent(user.id, 'login_success', req);
  res.json({ token: issueSession(user, req), user: publicUser(user) });
});

r.post('/login/mfa', (req, res) => {
  let p;
  try {
    p = jwt.verify(String(req.body.mfaToken || ''), config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Sign-in step expired. Please start again.');
  }
  if (p.purpose !== 'mfa') throw new HttpError(401, 'Invalid token');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(p.sub);
  if (!user || user.disabled) throw new HttpError(401, 'Account unavailable');
  checkOtp(user, 'mfa', req.body.code);
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
  logEvent(user.id, 'login_success_mfa', req);
  res.json({ token: issueSession(user, req), user: publicUser(user) });
});

// FR-AUTH-004: password recovery by e-mailed link. Response never reveals whether the account exists.
r.post('/forgot-password', async (req, res) => {
  const email = str(req.body.email, 'Email').toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND verified = 1').get(email);
  let token;
  if (user) {
    token = randomToken(32);
    db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)').run(user.id, sha256(token), inFuture(30));
    const link = `${config.appUrl}/reset-password?token=${token}`;
    await sendMail(email, 'Reset your password', `Use this link to choose a new password (valid for 30 minutes):\n${link}\nIf you didn't ask for this, you can safely ignore this email.`);
    logEvent(user.id, 'password_reset_requested', req);
  }
  const body = { message: 'If an account exists for that email, a reset link has been sent.' };
  res.json(exposeCodes() && token ? { ...body, devToken: token } : body);
});

r.post('/reset-password', async (req, res) => {
  checkPassword(req.body.password);
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0').get(sha256(String(req.body.token || '')));
  if (!row || row.expires_at < nowIso()) throw bad('This reset link is invalid or has expired.');
  const hash = await bcrypt.hash(req.body.password, 12);
  tx(() => {
    db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hash, row.user_id);
    db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(row.id);
    db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(row.user_id);
  });
  logEvent(row.user_id, 'password_reset_completed', req);
  const who = db.prepare('SELECT email FROM users WHERE id = ?').get(row.user_id);
  if (who) await sendMail(who.email, 'Your password was changed', 'Your password was just reset and all devices were signed out. If this was not you, please reset it again straight away and turn on two-step sign-in.');
  res.json({ message: 'Your password has been updated. You can sign in now.' });
});

// ---- authenticated -------------------------------------------------------------------------
r.post('/logout', requireAuth, (req, res) => {
  db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(req.sid); // FR-AUTH-005
  logEvent(req.user.id, 'logout', req);
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

r.put('/me', requireAuth, (req, res) => {
  const b = req.body;
  const u = req.user;
  const name = b.name !== undefined ? str(b.name, 'Name', { min: 1, max: 100 }) : u.name;
  const phone = b.phone !== undefined ? str(b.phone, 'Phone', { max: 30, required: false }) : u.phone;
  const currency = b.currency !== undefined ? oneOf(b.currency, 'Currency', ['INR', 'USD', 'EUR', 'GBP']) : u.currency;
  const risk = b.riskTolerance !== undefined ? oneOf(b.riskTolerance, 'Risk tolerance', ['low', 'medium', 'high']) : u.risk_tolerance;
  const region = b.taxRegion !== undefined ? oneOf(b.taxRegion, 'Tax region', ['IN', 'US']) : u.tax_region;
  const income = b.annualIncome !== undefined ? (b.annualIncome === null || b.annualIncome === '' ? null : num(b.annualIncome, 'Annual income')) : undefined;
  const opening = b.openingBalance !== undefined ? num(b.openingBalance, 'Opening balance', { min: -1e12 }) : undefined;
  db.prepare(
    `UPDATE users SET name=?, phone=?, currency=?, risk_tolerance=?, tax_region=?,
       annual_income_enc = CASE WHEN ? = 1 THEN ? ELSE annual_income_enc END,
       opening_balance_enc = CASE WHEN ? = 1 THEN ? ELSE opening_balance_enc END,
       notify_email = ?, notify_inapp = ?, notify_push = ?, bill_lead_days = ?, onboarded = ? WHERE id = ?`
  ).run(
    name, phone, currency, risk, region,
    income === undefined ? 0 : 1, income === null || income === undefined ? null : encNum(income),
    opening === undefined ? 0 : 1, opening === undefined ? null : encNum(opening),
    b.notifyEmail !== undefined ? (b.notifyEmail ? 1 : 0) : u.notify_email,
    b.notifyInApp !== undefined ? (b.notifyInApp ? 1 : 0) : u.notify_inapp,
    b.notifyPush !== undefined ? (b.notifyPush ? 1 : 0) : u.notify_push,
    b.billLeadDays !== undefined ? num(b.billLeadDays, 'Reminder lead days', { min: 0, max: 30 }) : u.bill_lead_days,
    b.onboarded !== undefined ? (b.onboarded ? 1 : 0) : u.onboarded,
    u.id
  );
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

r.put('/me/password', requireAuth, async (req, res) => {
  const ok = await bcrypt.compare(String(req.body.currentPassword || ''), req.user.password_hash);
  if (!ok) throw new HttpError(403, 'Current password is incorrect');
  checkPassword(req.body.newPassword);
  const hash = await bcrypt.hash(req.body.newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND id != ?').run(req.user.id, req.sid);
  logEvent(req.user.id, 'password_changed', req);
  await sendMail(req.user.email, 'Your password was changed', 'Your password was just changed from your profile and your other devices were signed out. If this was not you, reset your password straight away.');
  res.json({ message: 'Password updated.' });
});

r.put('/me/mfa', requireAuth, async (req, res) => {
  if (!(await bcrypt.compare(String(req.body.password || ''), req.user.password_hash))) throw new HttpError(403, 'Password is incorrect');
  db.prepare('UPDATE users SET mfa_enabled = ? WHERE id = ?').run(req.body.enabled ? 1 : 0, req.user.id);
  logEvent(req.user.id, req.body.enabled ? 'mfa_enabled' : 'mfa_disabled', req);
  await sendMail(req.user.email, `Two-step sign-in ${req.body.enabled ? 'turned on' : 'turned off'}`, `Two-step sign-in was ${req.body.enabled ? 'turned on' : 'turned off'} for your account. If you did not do this, please change your password.`);
  res.json({ mfaEnabled: !!req.body.enabled });
});

// Lets a user check that e-mail from the application reaches them.
r.post('/me/test-email', requireAuth, async (req, res) => {
  const result = await sendMail(req.user.email, 'Test e-mail from Finance Assistant', 'This is a test message. If you can read it, e-mail notifications are working for your account.');
  const messages = {
    sent: 'Test e-mail sent. Please check your inbox.',
    logged: 'No mail server is configured yet, so the message was only written to the server log. An administrator can set one up.',
    failed: 'The mail server did not accept the message. It will be retried automatically.',
  };
  res.json({ status: result.status, delivered: result.status === 'sent', message: messages[result.status] });
});

// CO-5 / DR: data portability — everything the user owns, as JSON.
r.get('/me/export', requireAuth, (req, res) => {
  const uid = req.user.id;
  logEvent(uid, 'data_export', req);
  const pick = (sql) => db.prepare(sql).all(uid);
  res.setHeader('Content-Disposition', 'attachment; filename="my-finance-data.json"');
  res.json({
    exportedAt: nowIso(),
    profile: publicUser(req.user),
    categories: pick('SELECT id, name, type FROM categories WHERE user_id = ?'),
    transactions: loadTransactions(uid),
    note: 'Budgets, goals and bills are available in their respective screens and reports.',
  });
});

// BR-004 / NFR-SAF-003: permanent deletion needs password + typed "DELETE".
r.post('/me/delete', requireAuth, async (req, res) => {
  if (req.body.confirm !== 'DELETE') throw bad('Type DELETE to confirm account deletion');
  if (!(await bcrypt.compare(String(req.body.password || ''), req.user.password_hash))) throw new HttpError(403, 'Password is incorrect');
  const uid = req.user.id;
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  logEvent(null, 'account_deleted', req, `user:${uid}`);
  res.json({ message: 'Your account and all associated data have been permanently deleted.' });
});

export default r;
