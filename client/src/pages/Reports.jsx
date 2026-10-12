import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Empty, Field, PageHeader, Spinner, Toast, useLoad } from '../components/ui.jsx';
import { money, monthLabel, monthStr, todayStr } from '../util.js';

export default function Reports() {
  const { user } = useAuth();
  const [range, setRange] = useState({ from: `${monthStr(-11)}-01`, to: todayStr() });
  const [applied, setApplied] = useState(range);
  const [toast, setToast] = useState('');
  const { data, error, loading } = useLoad(() => api.get(`/reports/summary?from=${applied.from}&to=${applied.to}`), [applied]);
  const cur = user.currency;

  async function dl(kind) {
    try { await api.download(`/reports/export.${kind}?from=${applied.from}&to=${applied.to}`, `report_${applied.from}_${applied.to}.${kind}`); } catch (e) { setToast(e.message); }
  }
  const preset = (months) => {
    const r = { from: `${monthStr(-(months - 1))}-01`, to: todayStr() };
    setRange(r); setApplied(r);
  };

  return (
    <>
      <PageHeader title="Reports" help="Reports and exports">
        <button className="btn" onClick={() => dl('csv')}>Export CSV</button>
        <button className="btn" onClick={() => dl('pdf')}>Export PDF</button>
      </PageHeader>
      <form className="card filters" onSubmit={(e) => { e.preventDefault(); setApplied(range); }}>
        <Field label="From">{(p) => <input {...p} type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />}</Field>
        <Field label="To">{(p) => <input {...p} type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />}</Field>
        <button className="btn primary">Run report</button>
        <span className="presets"><button type="button" className="btn small" onClick={() => preset(1)}>This month</button><button type="button" className="btn small" onClick={() => preset(3)}>3 months</button><button type="button" className="btn small" onClick={() => preset(12)}>12 months</button></span>
      </form>
      <Alert>{error}</Alert>
      {loading && !data ? <Spinner /> : data && (
        <>
          <div className="cards">
            <div className="card stat"><span className="stat-label">Total income</span><span className="stat-value pos">{money(data.totals.income, cur)}</span></div>
            <div className="card stat"><span className="stat-label">Total expenses</span><span className="stat-value neg">{money(data.totals.expense, cur)}</span></div>
            <div className="card stat"><span className="stat-label">Net savings</span><span className="stat-value">{money(data.totals.net, cur)}</span></div>
            <div className="card stat"><span className="stat-label">Savings rate</span><span className="stat-value">{data.savingsRate === null ? '—' : `${data.savingsRate}%`}</span></div>
          </div>
          <div className="grid-2">
            <section className="card" aria-labelledby="rc-h">
              <h2 id="rc-h">Spending by category</h2>
              {data.byCategory.length === 0 ? <Empty>No expenses in this period.</Empty> : (
                <table className="compact"><thead><tr><th scope="col">Category</th><th scope="col" className="num">Amount</th><th scope="col" className="num">Share</th></tr></thead>
                  <tbody>{data.byCategory.map((c) => <tr key={c.category}><th scope="row">{c.category}</th><td className="num">{money(c.amount, cur)}</td><td className="num">{c.percent}%</td></tr>)}</tbody></table>
              )}
            </section>
            <section className="card" aria-labelledby="rm-h">
              <h2 id="rm-h">By month</h2>
              <table className="compact"><thead><tr><th scope="col">Month</th><th scope="col" className="num">Income</th><th scope="col" className="num">Expenses</th><th scope="col" className="num">Net</th></tr></thead>
                <tbody>{data.byMonth.map((m) => <tr key={m.month}><th scope="row">{monthLabel(m.month)}</th><td className="num">{money(m.income, cur)}</td><td className="num">{money(m.expense, cur)}</td><td className={`num ${m.net >= 0 ? 'pos' : 'neg'}`}>{money(m.net, cur)}</td></tr>)}</tbody></table>
            </section>
          </div>
          <p className="muted">{data.transactionCount} transactions · average monthly spending {money(data.avgMonthlyExpense, cur)}</p>
        </>
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </>
  );
}
