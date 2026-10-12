import crypto from 'node:crypto';
import { config } from './config.js';

// AES-256-GCM field encryption for sensitive financial values stored at rest.
export function encrypt(value) {
  if (value === null || value === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  const ct = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}

export function decrypt(blob) {
  if (blob === null || blob === undefined) return null;
  const [iv, tag, ct] = String(blob).split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', config.encryptionKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

export const encNum = (n) => encrypt(String(n));
export const decNum = (s) => (s === null || s === undefined ? 0 : Number(decrypt(s)));

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
export const randomOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
