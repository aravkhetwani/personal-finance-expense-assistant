import { db } from './db.js';

// NFR-SEC-005: security event log (logins, failures, password changes, sensitive-data access).
export function logEvent(userId, event, req, detail = '') {
  db.prepare('INSERT INTO security_logs (user_id, event, ip, detail) VALUES (?,?,?,?)').run(
    userId ?? null,
    event,
    req?.ip ?? null,
    String(detail).slice(0, 300)
  );
}
