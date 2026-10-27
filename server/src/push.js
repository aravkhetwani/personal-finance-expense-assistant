import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { config } from './config.js';
import { db } from './db.js';

// Web Push (FR-BILL-002 lists push notifications). VAPID keys come from the environment or are generated once.
function loadKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const file = path.join(config.dataDir, '.vapid.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const k = webpush.generateVAPIDKeys();
  fs.writeFileSync(file, JSON.stringify(k), { mode: 0o600 });
  return k;
}
const keys = loadKeys();
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@localhost.invalid', keys.publicKey, keys.privateKey);

export const publicKey = () => keys.publicKey;

// Only the browsers' own push services are accepted, so the server cannot be pointed at arbitrary hosts.
const ALLOWED = [/(^|\.)googleapis\.com$/, /(^|\.)mozilla\.com$/, /(^|\.)windows\.com$/, /(^|\.)apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/];
export function validEndpoint(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && url.length <= 1000 && ALLOWED.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export function subscriptionCount(userId) {
  return db.prepare('SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?').get(userId).c;
}

// Never throws: a push failure must not break the action that triggered it.
export async function sendPush(userId, payload) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  if (!subs.length) return 0;
  if (process.env.PUSH_DISABLE_SEND === 'true') return subs.length; // used by the automated tests
  let sent = 0;
  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600, timeout: 8000 });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id); // expired
      else console.error(`[push] delivery failed (${e.statusCode || e.code || e.message})`);
    }
  }));
  return sent;
}
