import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(dataDir, { recursive: true });

// Secrets come from the environment; for local use they are generated once and kept in the data dir.
function secret(envName, file) {
  if (process.env[envName]) return process.env[envName];
  const p = path.join(dataDir, file);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  const v = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(p, v, { mode: 0o600 });
  return v;
}

const smtpConfigured = Boolean(process.env.SMTP_HOST);

export const config = {
  root,
  dataDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, 'finance.db'),
  backupDir: path.join(dataDir, 'backups'),
  port: Number(process.env.PORT || 4000),
  production: process.env.NODE_ENV === 'production',
  jwtSecret: secret('JWT_SECRET', '.jwt-secret'),
  // 32-byte key (hex) for AES-256-GCM field encryption (NFR-SEC-002, CO-1)
  encryptionKey: Buffer.from(secret('ENCRYPTION_KEY', '.enc-key'), 'hex'),
  sessionTimeoutMin: Number(process.env.SESSION_TIMEOUT_MIN || 30), // NFR-SEC-004
  sessionMaxHours: Number(process.env.SESSION_MAX_HOURS || 12),
  otpTtlMin: 10,
  tls: { key: process.env.TLS_KEY_FILE, cert: process.env.TLS_CERT_FILE }, // CI-1
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  smtp: smtpConfigured
    ? {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        from: process.env.SMTP_FROM || 'Finance Assistant <no-reply@localhost>',
      }
    : null,
  // Without SMTP the OTP/reset code is returned in the API response so the app is usable locally.
  devExposeCodes: process.env.DEV_EXPOSE_CODES
    ? process.env.DEV_EXPOSE_CODES === 'true'
    : !smtpConfigured && process.env.NODE_ENV !== 'production',
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  maxFailedLogins: 5,
  lockMinutes: 15,
};
