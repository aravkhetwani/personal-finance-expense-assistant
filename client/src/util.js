export const todayStr = () => new Date().toISOString().slice(0, 10);
export const monthStr = (offset = 0) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
};

export function money(n, currency = 'INR') {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

export const fmtDate = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

export const PALETTE = ['#0f766e', '#2563eb', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#65a30d', '#db2777', '#4b5563', '#ea580c'];

export function dueText(b) {
  if (b.status === 'paid') return 'Paid';
  if (b.daysUntil < 0) return `${-b.daysUntil} day${b.daysUntil === -1 ? '' : 's'} past due`;
  if (b.daysUntil === 0) return 'Due today';
  return `Due in ${b.daysUntil} day${b.daysUntil === 1 ? '' : 's'}`;
}
