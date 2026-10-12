// FR-SCAN-002: extract total amount, date and merchant from OCR text.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

export function parseReceiptText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Merchant: first line with letters that does not look like an address/phone/date/total.
  const merchant =
    lines.find((l) => /[A-Za-z]{3,}/.test(l) && !/^(tel|ph|phone|gst|vat|date|invoice|bill|receipt|www|http)/i.test(l) && !/\d{5,}/.test(l)) || '';

  // Date: ISO, DD/MM/YYYY (or DD-MM-YY), or "12 Mar 2026".
  let date = null;
  for (const l of lines) {
    let m;
    if ((m = l.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) date = validDate(+m[1], +m[2], +m[3]);
    else if ((m = l.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/))) date = validDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
    else if ((m = l.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})\b/)) && MONTHS[m[2].toLowerCase()]) date = validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    if (date) break;
  }

  // Total: prefer amounts on lines containing "total"/"amount due" (not "subtotal"); otherwise the largest amount.
  const amountsIn = (l) => [...l.matchAll(/(?:^|[^\d.])((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})(?!\d)/g)].map((x) => Number(x[1].replace(/,/g, '')));
  let total = null;
  const totalLines = lines.filter((l) => /(grand\s*total|total\s*(amount|due|payable)?|amount\s*(due|payable)|net\s*pay|balance\s*due)/i.test(l) && !/sub\s*-?\s*total/i.test(l));
  const fromTotal = totalLines.flatMap(amountsIn);
  if (fromTotal.length) total = Math.max(...fromTotal);
  else {
    const all = lines.flatMap(amountsIn);
    if (all.length) total = Math.max(...all);
  }
  return { total, date, merchant: merchant.slice(0, 60) };
}

let workerPromise = null;
export async function recognize(buffer) {
  let mod;
  try {
    mod = await import('tesseract.js');
  } catch {
    const e = new Error('The OCR engine is not installed on this server. You can still enter the expense manually.');
    e.code = 'OCR_UNAVAILABLE';
    throw e;
  }
  try {
    workerPromise ??= mod.createWorker('eng');
    const worker = await workerPromise;
    const { data } = await Promise.race([
      worker.recognize(buffer),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000)),
    ]);
    return data.text || '';
  } catch (err) {
    workerPromise = null;
    const e = new Error('We could not read that receipt automatically. Please enter the details manually.');
    e.code = 'OCR_FAILED';
    e.cause = err;
    throw e;
  }
}
