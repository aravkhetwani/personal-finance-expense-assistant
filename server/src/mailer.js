import nodemailer from 'nodemailer';
import { config } from './config.js';
import { db } from './db.js';
import { decrypt, encrypt } from './crypto.js';

// ---- configuration: settings saved by an administrator win over environment variables -----------
function fromEnv() {
  const s = config.smtp;
  if (!s) return null;
  return { host: s.host, port: s.port, secure: s.secure, user: s.auth?.user || '', pass: s.auth?.pass || '', from: s.from, source: 'environment' };
}

export function getSmtp() {
  const row = db.prepare("SELECT value_enc FROM settings WHERE key = 'smtp'").get();
  if (row) {
    try { return { ...JSON.parse(decrypt(row.value_enc)), source: 'database' }; } catch { /* unreadable: fall back */ }
  }
  return fromEnv();
}

export function saveSmtp(cfg) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value_enc) VALUES ('smtp', ?)").run(encrypt(JSON.stringify(cfg)));
}
export function clearSmtp() {
  db.prepare("DELETE FROM settings WHERE key = 'smtp'").run();
}

// Without any mail server the OTP / reset codes are returned in API responses (development only).
export const exposeCodes = () =>
  process.env.DEV_EXPOSE_CODES ? process.env.DEV_EXPOSE_CODES === 'true' : !getSmtp() && !config.production;

// ---- transport ---------------------------------------------------------------------------------
let cached = { key: '', transport: null };
function transportFor(smtp) {
  const key = JSON.stringify([smtp.host, smtp.port, smtp.secure, smtp.user, smtp.pass]);
  if (cached.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: smtp.host, port: smtp.port, secure: !!smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
      }),
    };
  }
  return cached.transport;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Plain-text bodies are wrapped in a simple branded HTML layout (the text version is always included too).
export function renderHtml(subject, text) {
  const body = esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0f766e">$1</a>').replace(/\n/g, '<br>');
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Segoe UI,Arial,sans-serif;color:#1b2430">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #d9dee5;border-radius:12px">
<tr><td style="background:#0f766e;color:#fff;padding:14px 22px;border-radius:12px 12px 0 0;font-weight:700">Finance Assistant</td></tr>
<tr><td style="padding:22px"><h2 style="margin:0 0 12px;font-size:18px">${esc(subject)}</h2><div style="line-height:1.55;font-size:15px">${body}</div></td></tr>
<tr><td style="padding:14px 22px;border-top:1px solid #d9dee5;font-size:12px;color:#5b6776">You are receiving this because you have an account with the Personal Finance &amp; Expense Budgeting Assistant. This message is general information and not financial advice.</td></tr>
</table></td></tr></table></body></html>`;
}

// SI-1: send via SMTP. SI-1.2: failures are caught and recorded (and retried later), never thrown to the caller.
export async function deliver(id) {
  const row = db.prepare('SELECT * FROM outbox WHERE id = ?').get(id);
  if (!row) return { ok: false, status: 'missing' };
  const smtp = getSmtp();
  let status, error = null;
  if (!smtp) {
    status = 'logged';
    if (!config.production) console.log(`[mail:dev] to=${row.to_addr} subject="${row.subject}"\n${row.body}\n`);
  } else {
    try {
      await transportFor(smtp).sendMail({ from: smtp.from, to: row.to_addr, subject: row.subject, text: row.body, html: renderHtml(row.subject, row.body) });
      status = 'sent';
    } catch (e) {
      status = 'failed';
      error = String(e.message || e).slice(0, 300);
      console.error(`[mail] delivery to ${row.to_addr} failed: ${error}`);
    }
  }
  db.prepare('UPDATE outbox SET status = ?, attempts = attempts + 1, last_error = ? WHERE id = ?').run(status, error, id);
  return { ok: status !== 'failed', status, error };
}

export async function sendMail(to, subject, body) {
  const ins = db.prepare('INSERT INTO outbox (to_addr, subject, body, status) VALUES (?,?,?,?)').run(to, subject, body, 'pending');
  return deliver(Number(ins.lastInsertRowid));
}

// Retry e-mails that failed (for example during a mail outage), up to three attempts within two days.
export async function retryFailed() {
  const rows = db.prepare("SELECT id FROM outbox WHERE status = 'failed' AND attempts < 3 AND created_at > datetime('now','-2 days') ORDER BY id LIMIT 50").all();
  let sent = 0;
  for (const r of rows) if ((await deliver(r.id)).status === 'sent') sent++;
  return sent;
}

export function describeSmtp() {
  const s = getSmtp();
  if (!s) return { configured: false, source: 'none' };
  return { configured: true, source: s.source, host: s.host, port: s.port, secure: !!s.secure, user: s.user || '', from: s.from, hasPassword: !!s.pass };
}
