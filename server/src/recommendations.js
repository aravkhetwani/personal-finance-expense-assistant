import { addMonths, round2 } from './http.js';

export const INVESTMENT_DISCLAIMER =
  'Important: This is general information, not personalised financial advice. The Personal Finance & Expense Budgeting Assistant is not a registered financial advisor. Estimated returns are illustrative, not guaranteed, and all investments carry risk. Please do your own research or consult a licensed professional before investing.';

export const TAX_DISCLAIMER =
  'Important: This is general guidance only and not personalised tax advice. Tax rules, limits and eligibility change and depend on your circumstances. Please verify with official sources or a qualified tax professional. This application is not a registered financial advisor.';

// TBD-004: rule-based catalogue (risk level × horizon). Names differ by region; return ranges are indicative only.
const CATALOGUE = [
  { id: 'liquid', risk: 'low', minYears: 0, maxYears: 2, returnPct: [3, 4.5], names: { IN: 'Savings account / liquid fund', US: 'High-yield savings account' }, why: 'Keeps money easily accessible with very little price movement.' },
  { id: 'deposit', risk: 'low', minYears: 0.5, maxYears: 5, returnPct: [6, 7.5], names: { IN: 'Fixed / recurring deposit', US: 'Certificate of deposit (CD)' }, why: 'Fixed returns for a fixed period, suitable when a goal has a firm deadline.' },
  { id: 'govt', risk: 'low', minYears: 1, maxYears: 30, returnPct: [6, 7.2], names: { IN: 'Government securities / PPF', US: 'Treasury bonds / I-bonds' }, why: 'Government-backed instruments with low default risk.' },
  { id: 'debt', risk: 'medium', minYears: 2, maxYears: 30, returnPct: [6.5, 8.5], names: { IN: 'Debt / corporate bond mutual funds', US: 'Bond index funds' }, why: 'Steady income with moderate price movement.' },
  { id: 'hybrid', risk: 'medium', minYears: 3, maxYears: 30, returnPct: [8, 11], names: { IN: 'Balanced / hybrid mutual funds', US: 'Target-date or balanced funds' }, why: 'Mixes equity and debt to smooth out ups and downs.' },
  { id: 'index', risk: 'medium', minYears: 5, maxYears: 50, returnPct: [9, 12], names: { IN: 'Large-cap index funds', US: 'Broad market index funds / ETFs' }, why: 'Low-cost exposure to the overall market over the long term.' },
  { id: 'equity', risk: 'high', minYears: 7, maxYears: 50, returnPct: [11, 15], names: { IN: 'Mid/small-cap equity funds', US: 'Growth / small-cap ETFs' }, why: 'Higher growth potential with larger swings in value.' },
  { id: 'stocks', risk: 'high', minYears: 7, maxYears: 50, returnPct: [0, 18], names: { IN: 'Direct stocks (diversified)', US: 'Individual stocks (diversified)' }, why: 'Highest variability; results can differ widely from estimates.' },
];
const RANK = { low: 1, medium: 2, high: 3 };

// FR-INV-003/004: recommendations from goal horizon and risk tolerance, with estimated (non-guaranteed) returns.
export function investmentOptions({ risk = 'medium', years = 3, region = 'IN' }) {
  return CATALOGUE.filter((c) => RANK[c.risk] <= RANK[risk] && years >= c.minYears && years <= c.maxYears)
    .map((c) => ({
      id: c.id,
      name: c.names[region] || c.names.IN,
      risk: c.risk,
      estimatedReturnPct: c.returnPct,
      rationale: c.why,
      note: 'Estimated annual return range; not guaranteed.',
    }))
    .sort((a, b) => RANK[a.risk] - RANK[b.risk]);
}

export function taxInstruments({ region = 'IN', annualIncome = 0 }) {
  if (region === 'US') {
    const list = [
      { name: '401(k) / employer retirement plan', limit: 'about $23,500 (2025), more if 50+', why: 'Pre-tax contributions reduce taxable income.', section: 'IRC §401(k)' },
      { name: 'Traditional IRA', limit: 'about $7,000 (2025)', why: 'Contributions may be deductible depending on income and workplace plan coverage.', section: 'IRC §219' },
      { name: 'Health Savings Account (HSA)', limit: 'about $4,300 self / $8,550 family (2025)', why: 'Triple tax advantage if you have a high-deductible health plan.', section: 'IRC §223' },
      { name: '529 education savings plan', limit: 'varies by state', why: 'Tax-free growth for education; some states offer a deduction.', section: 'IRC §529' },
    ];
    return { region, notes: ['Limits shown are approximate and change annually — please check IRS.gov.'], instruments: list };
  }
  const list = [
    { name: 'PPF, ELSS, EPF/VPF, 5-year tax-saver FD, NSC', limit: '₹1,50,000 combined', why: 'Eligible for deduction under Section 80C (old tax regime).', section: '80C' },
    { name: 'Health insurance premium', limit: '₹25,000 (₹50,000 for senior citizens)', why: 'Protects against medical costs and is deductible under Section 80D.', section: '80D' },
    { name: 'National Pension System (NPS) — additional', limit: '₹50,000 over and above 80C', why: 'Long-term retirement saving with an extra deduction.', section: '80CCD(1B)' },
    { name: 'Home-loan interest (self-occupied)', limit: 'up to ₹2,00,000', why: 'Interest paid on a housing loan can be deducted.', section: '24(b)' },
    { name: 'Education-loan interest', limit: 'no upper limit (interest, up to 8 years)', why: 'Interest on loans for higher education is deductible.', section: '80E' },
  ];
  const notes = ['Most deductions above apply under the old tax regime; the new regime generally offers lower slab rates without them.'];
  if (annualIncome && annualIncome <= 700000) notes.push('At your income level, the new regime rebate may already reduce your tax to zero — compare both regimes before investing for tax purposes.');
  return { region, notes, instruments: list };
}

// FR-INSIGHT-001/002: rule-based, suggestion-style (BR-001) and neutral in tone (NFR-SAF-002).
export function buildInsights({ transactions, budgets, currentMonth }) {
  const money = (n) => Math.round(n).toLocaleString('en-IN');
  const out = [];
  const exp = transactions.filter((t) => t.type === 'expense');
  const inc = transactions.filter((t) => t.type === 'income');
  const lastMonth = addMonths(`${currentMonth}-01`, -1).slice(0, 7);

  const byCatMonth = new Map(); // cat -> month -> sum
  for (const t of exp) {
    const c = t.category || 'Uncategorised';
    const m = t.date.slice(0, 7);
    if (!byCatMonth.has(c)) byCatMonth.set(c, new Map());
    byCatMonth.get(c).set(m, round2((byCatMonth.get(c).get(m) || 0) + t.amount));
  }

  for (const [cat, months] of byCatMonth) {
    const prior = [...months.entries()].filter(([m]) => m !== lastMonth && m !== currentMonth).map(([, v]) => v);
    const last = months.get(lastMonth);
    if (last && prior.length >= 2) {
      const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
      if (avg > 0 && last > avg * 1.25 && last - avg > 50) {
        const pct = Math.round(((last - avg) / avg) * 100);
        out.push({
          id: `above-avg-${cat}`, kind: 'saving', title: `${cat} spending was above your usual`,
          message: `Your ${cat} spending last month was ${money(last)}, about ${pct}% above your typical ${money(avg)}. Trimming it by 20% could free up roughly ${money(last * 0.2)}.`,
          rationale: `Compared with your average of ${money(avg)} across ${prior.length} earlier months.`,
          data: { category: cat, lastMonth: last, average: round2(avg) },
        });
      }
    }
  }

  // Example from SRS FR-INSIGHT-002: "You spent X on coffee last month, consider reducing by 20%."
  const coffee = exp.filter((t) => t.date.startsWith(lastMonth) && /coffee|cafe|café|starbucks|\btea\b/i.test(`${t.notes} ${t.category || ''}`));
  const coffeeTotal = round2(coffee.reduce((a, t) => a + t.amount, 0));
  if (coffeeTotal > 0) {
    out.push({
      id: 'coffee', kind: 'saving', title: 'Coffee & café spending',
      message: `You spent ${money(coffeeTotal)} on coffee and cafés last month. If you'd like to save, cutting back by 20% would keep about ${money(coffeeTotal * 0.2)} in your pocket.`,
      rationale: `Based on ${coffee.length} transaction(s) mentioning coffee, tea or cafés.`,
      data: { total: coffeeTotal, count: coffee.length },
    });
  }

  const lastExp = exp.filter((t) => t.date.startsWith(lastMonth));
  const lastInc = inc.filter((t) => t.date.startsWith(lastMonth));
  const sumE = lastExp.reduce((a, t) => a + t.amount, 0);
  const sumI = lastInc.reduce((a, t) => a + t.amount, 0);
  if (sumI > 0) {
    const rate = Math.round(((sumI - sumE) / sumI) * 100);
    if (rate >= 20) {
      out.push({ id: 'savings-great', kind: 'positive', title: 'Nice savings momentum', message: `You kept about ${rate}% of your income last month — a healthy pace. Consider setting a goal so this surplus has a purpose.`, rationale: 'A common guideline is saving around 20% of income.', data: { savingsRate: rate } });
    } else if (rate < 10) {
      out.push({ id: 'savings-low', kind: 'saving', title: 'Room to grow your savings rate', message: `Last month you kept about ${Math.max(rate, 0)}% of your income. Even small adjustments to one or two categories could lift this toward the commonly suggested 20%.`, rationale: `Income ${money(sumI)}, spending ${money(sumE)}.`, data: { savingsRate: rate } });
    }
  }

  const budgeted = new Set(budgets.map((b) => b.category));
  const totalByCat = [...byCatMonth.entries()]
    .map(([c, m]) => [c, m.get(lastMonth) || 0])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const top = totalByCat[0];
  if (top && sumE > 0 && !budgeted.has(top[0])) {
    out.push({ id: `budget-${top[0]}`, kind: 'tip', title: `Consider a budget for ${top[0]}`, message: `${top[0]} was your largest category last month (${Math.round((top[1] / sumE) * 100)}% of spending). Setting a monthly budget could make it easier to see where you stand.`, rationale: 'Budgeting your biggest category tends to have the most impact.', data: { category: top[0], amount: top[1] } });
  }
  if (!out.length) {
    out.push({ id: 'none', kind: 'tip', title: 'Keep logging to unlock insights', message: 'Add a few more transactions across different months and personalised suggestions will appear here.', rationale: 'Insights need at least a couple of months of history.', data: {} });
  }
  return out;
}
