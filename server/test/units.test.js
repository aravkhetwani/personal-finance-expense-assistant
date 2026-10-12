import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-unit-'));

const { parseCsv, toCsv } = await import('../src/csv.js');
const { parseReceiptText } = await import('../src/ocr.js');
const { encrypt, decrypt } = await import('../src/crypto.js');
const { investmentOptions, taxInstruments } = await import('../src/recommendations.js');
const { addMonths } = await import('../src/http.js');

test('csv handles quotes, commas, newlines and BOM', () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n"multi\nline",3\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"'], ['multi\nline', '3']]);
});

test('csv export neutralises spreadsheet formulas', () => {
  const out = toCsv(['n'], [['=HYPERLINK("x")'], ['-12.5'], ['@cmd']]);
  assert.match(out, /'=HYPERLINK/);
  assert.match(out, /\r\n-12.5\r\n/);
  assert.match(out, /'@cmd/);
});

test('field encryption round-trips and is non-deterministic', () => {
  const a = encrypt('1234.56'), b = encrypt('1234.56');
  assert.notEqual(a, b);
  assert.equal(decrypt(a), '1234.56');
  assert.throws(() => decrypt(a.slice(0, -2) + 'AA'));
});

test('receipt parser extracts total, date and merchant (FR-SCAN-002)', () => {
  const text = `Fresh Mart Superstore\n12 MG Road, Pune\nTel 02012345678\nDate: 14/03/2026\nMilk 2L           58.00\nBread             40.00\nSubtotal          98.00\nGST 5%             4.90\nTOTAL            102.90\nThank you!`;
  const r = parseReceiptText(text);
  assert.equal(r.merchant, 'Fresh Mart Superstore');
  assert.equal(r.date, '2026-03-14');
  assert.equal(r.total, 102.9);
  assert.equal(parseReceiptText('Cafe Bean\n5 Jan 2026\nCoffee 3.50\nCake 4.25\nGrand Total $1,207.75').total, 1207.75);
  assert.equal(parseReceiptText('Shop\n2026-02-30\n10.00').date, null, 'rejects impossible dates');
  assert.equal(parseReceiptText('no numbers here').total, null);
});

test('investment options respect risk tolerance and horizon', () => {
  const low = investmentOptions({ risk: 'low', years: 10 });
  assert.ok(low.length && low.every((o) => o.risk === 'low'));
  const hi = investmentOptions({ risk: 'high', years: 15 });
  assert.ok(hi.some((o) => o.risk === 'high') && hi.some((o) => o.risk === 'low'));
  assert.ok(investmentOptions({ risk: 'high', years: 0.2 }).every((o) => o.risk === 'low'));
  assert.ok(investmentOptions({ risk: 'medium', years: 3, region: 'US' }).some((o) => /CD|bond|fund/i.test(o.name)));
});

test('tax instruments by region', () => {
  assert.ok(taxInstruments({ region: 'IN', annualIncome: 600000 }).notes.length >= 2);
  assert.ok(taxInstruments({ region: 'US' }).instruments.some((i) => /HSA|Health Savings/.test(i.name)));
});

test('month arithmetic clamps to month end', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-03-15', -3), '2025-12-15');
});
