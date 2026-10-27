import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { decNum } from './crypto.js';
import { addDays, today } from './http.js';
import { notify } from './services.js';
import { retryFailed } from './mailer.js';

// FR-BILL-002: proactive reminders (in-app + e-mail) based on each user's preferences.
// Called on a timer and right after a bill is created. Dedupe keys prevent repeats.
export async function runBillReminders(onlyUserId = null) {
  const t = today();
  const users = onlyUserId
    ? db.prepare('SELECT * FROM users WHERE id = ?').all(onlyUserId)
    : db.prepare('SELECT * FROM users WHERE verified = 1 AND disabled = 0').all();
  let sent = 0;
  for (const u of users) {
    const horizon = addDays(t, u.bill_lead_days);
    const bills = db.prepare('SELECT * FROM bills WHERE user_id = ? AND paid = 0 AND due_date <= ?').all(u.id, horizon);
    for (const b of bills) {
      const amount = decNum(b.amount_enc);
      const overdue = b.due_date < t;
      const ok = overdue
        ? await notify(u, 'bill', `${b.name} is past its due date`, `Your ${b.name} bill (${amount}) was due on ${b.due_date}. Paying it soon can help avoid late fees — you can mark it paid once it's done.`, `bill:${b.id}:${b.due_date}:overdue`)
        : await notify(u, 'bill', `${b.name} is coming up`, `A friendly reminder: your ${b.name} bill (${amount}) is due on ${b.due_date}.`, `bill:${b.id}:${b.due_date}:soon`);
      if (ok) sent++;
    }
  }
  return sent;
}

// DR-002: consistent snapshot of the database, keeping the most recent copies.
export function runBackup(keep = 7) {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const file = path.join(config.backupDir, `finance-${stamp}.db`);
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = fs.readdirSync(config.backupDir).filter((f) => /^finance-\d+\.db$/.test(f)).sort();
  all.slice(0, Math.max(0, all.length - keep)).forEach((f) => fs.rmSync(path.join(config.backupDir, f)));
  return { file, count: Math.min(all.length, keep) };
}

export function startJobs() {
  const hour = 3600 * 1000;
  const run = () => runBillReminders().then(() => retryFailed()).catch((e) => console.error('[jobs] reminders failed:', e.message));
  setTimeout(run, 5000).unref();
  setInterval(run, hour).unref();
  setInterval(() => {
    try { runBackup(); } catch (e) { console.error('[jobs] backup failed:', e.message); }
  }, 24 * hour).unref();
  // Housekeeping: drop expired codes/tokens and stale sessions.
  setInterval(() => {
    db.exec("DELETE FROM otps WHERE expires_at < datetime('now','-1 day'); DELETE FROM password_resets WHERE expires_at < datetime('now','-1 day'); DELETE FROM sessions WHERE revoked = 1 OR last_active < datetime('now','-2 day');");
  }, hour).unref();
}
