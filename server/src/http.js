export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const bad = (m, extra) => new HttpError(400, m, extra);
export const notFound = (m = 'Not found') => new HttpError(404, m);

export const str = (v, name, { min = 0, max = 200, required = true } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required`);
    return '';
  }
  if (typeof v !== 'string') throw bad(`${name} must be text`);
  const s = v.trim();
  if (s.length < min) throw bad(`${name} must be at least ${min} characters`);
  if (s.length > max) throw bad(`${name} must be at most ${max} characters`);
  return s;
};

export const num = (v, name, { min = 0, max = 1e12, required = true, positive = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${name} must be a number`);
  if (positive && n <= 0) throw bad(`${name} must be greater than 0`);
  if (n < min || n > max) throw bad(`${name} is out of range`);
  return Math.round(n * 100) / 100;
};

export const oneOf = (v, name, list, def) => {
  if ((v === undefined || v === null || v === '') && def !== undefined) return def;
  if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}`);
  return v;
};

export const isoDate = (v, name, { required = true } = {}) => {
  if (!v) {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw bad(`${name} must be a valid date (YYYY-MM-DD)`);
  }
  return v;
};

export const timeStr = (v) => {
  if (!v) return '00:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw bad('time must be HH:MM');
  return v;
};

export const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad('Invalid id');
  return n;
};

export const today = () => new Date().toISOString().slice(0, 10);
export const monthOf = (d) => d.slice(0, 7);
export const round2 = (n) => Math.round(n * 100) / 100;

export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(dateStr, months) {
  const [y, m, day] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}
