import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { db } from './db.js';
import { createApp } from './app.js';
import { startJobs } from './scheduler.js';
import { ensureDefaultCategories, seedCategories } from './services.js';
import { exposeCodes, getSmtp } from './mailer.js';
import { checkPassword } from './routes/auth.js';

async function ensureAdmin() {
  if (!config.adminEmail || !config.adminPassword) return;
  checkPassword(config.adminPassword);
  const email = config.adminEmail.toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return;
  const hash = await bcrypt.hash(config.adminPassword, 12);
  const r = db.prepare("INSERT INTO users (email, password_hash, name, role, verified, onboarded) VALUES (?,?,?,'admin',1,1)").run(email, hash, 'Administrator');
  seedCategories(Number(r.lastInsertRowid));
  console.log(`[setup] administrator account created for ${email}`);
}

await ensureAdmin();
ensureDefaultCategories();
const app = createApp();
const server =
  config.tls.key && config.tls.cert
    ? https.createServer({ key: fs.readFileSync(config.tls.key), cert: fs.readFileSync(config.tls.cert) }, app)
    : http.createServer(app);
server.listen(config.port, () => {
  console.log(`Finance Assistant API listening on ${config.tls.key ? 'https' : 'http'}://localhost:${config.port}`);
  if (exposeCodes()) console.log('[dev] No mail server configured: OTP/reset codes are returned in API responses and logged here. An administrator can add SMTP settings on the Administration page.');
  else if (getSmtp()) console.log(`[mail] using SMTP server ${getSmtp().host} (${getSmtp().source})`);
  if (config.production && !config.tls.key) console.log('[warn] No TLS configured; terminate HTTPS at a reverse proxy (see README).');
});
startJobs();
