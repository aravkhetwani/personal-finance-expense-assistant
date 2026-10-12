import { Router } from 'express';
import { addMonths, monthOf, num, oneOf, today } from '../http.js';
import { decNum } from '../crypto.js';
import { loadTransactions } from '../services.js';
import { TAX_DISCLAIMER, taxInstruments } from '../recommendations.js';

const r = Router();

// FR-TAX-001/002: guidance from the user's income data, always with a disclaimer (NFR-SAF-001).
r.get('/', (req, res) => {
  const region = oneOf(req.query.region, 'region', ['IN', 'US'], req.user.tax_region);
  let income = req.query.income !== undefined && req.query.income !== '' ? num(req.query.income, 'income') : null;
  let source = 'entered';
  if (income === null && req.user.annual_income_enc) {
    income = decNum(req.user.annual_income_enc);
    source = 'profile';
  }
  if (income === null) {
    const start = addMonths(`${monthOf(today())}-01`, -11);
    income = loadTransactions(req.user.id, { from: start, type: 'income' }).reduce((a, t) => a + t.amount, 0);
    source = 'transactions';
  }
  res.json({ annualIncome: income, incomeSource: source, ...taxInstruments({ region, annualIncome: income }), disclaimer: TAX_DISCLAIMER });
});

export default r;
