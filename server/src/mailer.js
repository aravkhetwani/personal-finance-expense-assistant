import nodemailer from 'nodemailer';
import { config } from './config.js';
import { db } from './db.js';

const transporter = config.smtp ? nodemailer.createTransport(config.smtp) : null;

// SI-1: send e-mail via SMTP. SI-1.2: failures are caught and recorded, never thrown to the caller.
export async function sendMail(to, subject, body) {
  let status = 'logged';
  if (transporter) {
    try {
      await transporter.sendMail({ from: config.smtp.from, to, subject, text: body });
      status = 'sent';
    } catch (e) {
      status = 'failed';
      console.error(`[mail] delivery to ${to} failed: ${e.message}`);
    }
  } else if (!config.production) {
    console.log(`[mail:dev] to=${to} subject="${subject}"\n${body}\n`);
  }
  db.prepare('INSERT INTO outbox (to_addr, subject, body, status) VALUES (?,?,?,?)').run(to, subject, body, status);
  return status !== 'failed';
}
