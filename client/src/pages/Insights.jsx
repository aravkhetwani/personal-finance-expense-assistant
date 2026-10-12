import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Empty, PageHeader, Spinner, useLoad } from '../components/ui.jsx';
import { CategoryPie, SavingsBar, TrendLine } from '../components/charts.jsx';
import { money, monthLabel } from '../util.js';

const KIND = { saving: 'Savings idea', tip: 'Tip', positive: 'Good news' };

export default function Insights() {
  const { user } = useAuth();
  const { data, error, loading } = useLoad(() => api.get('/insights'), []);
  const [scope, setScope] = useState('month');
  const [open, setOpen] = useState(null);
  const cur = user.currency;
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const dist = scope === 'month' ? data.distribution : data.distribution12m;

  return (
    <>
      <PageHeader title="Insights" help="Insights" />
      <p className="muted">Suggestions are based on your own history over the last 12 months. They are ideas to consider — you know your situation best.</p>

      <section aria-labelledby="rec-h" className="card">
        <h2 id="rec-h">Suggestions for you</h2>
        <ul className="plain rec-list">
          {data.recommendations.map((r) => (
            <li key={r.id} className={`rec ${r.kind}`}>
              <span className="pill">{KIND[r.kind] || 'Tip'}</span>
              <h3>{r.title}</h3>
              <p>{r.message}</p>
              <button className="btn link small" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Why am I seeing this?'}</button>
              {open === r.id && <p className="rationale">{r.rationale}</p>}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="dist-h">
          <div className="row-between">
            <h2 id="dist-h">Where your money goes</h2>
            <div role="group" aria-label="Period" className="seg small">
              <button className={scope === 'month' ? 'on' : ''} aria-pressed={scope === 'month'} onClick={() => setScope('month')}>This month</button>
              <button className={scope === '12m' ? 'on' : ''} aria-pressed={scope === '12m'} onClick={() => setScope('12m')}>12 months</button>
            </div>
          </div>
          <CategoryPie data={dist} currency={cur} />
          {dist.length > 0 && (
            <table className="compact">
              <caption className="sr-only">Spending by category</caption>
              <thead><tr><th scope="col">Category</th><th scope="col" className="num">Amount</th><th scope="col" className="num">Share</th></tr></thead>
              <tbody>{dist.map((d) => <tr key={d.category}><th scope="row">{d.category}</th><td className="num">{money(d.amount, cur)}</td><td className="num">{d.percent}%</td></tr>)}</tbody>
            </table>
          )}
        </section>

        <section className="card" aria-labelledby="trend-h">
          <h2 id="trend-h">Income vs expenses (12 months)</h2>
          <TrendLine trend={data.trend} currency={cur} />
          <h3>Net savings per month</h3>
          <SavingsBar trend={data.trend} currency={cur} />
        </section>
      </div>

      <section className="card" aria-labelledby="tbl-h">
        <h2 id="tbl-h">Monthly figures</h2>
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th scope="col">Month</th><th scope="col" className="num">Income</th><th scope="col" className="num">Expenses</th><th scope="col" className="num">Net</th></tr></thead>
            <tbody>{data.trend.map((t) => <tr key={t.month}><th scope="row">{monthLabel(t.month)}</th><td className="num">{money(t.income, cur)}</td><td className="num">{money(t.expense, cur)}</td><td className={`num ${t.net >= 0 ? 'pos' : 'neg'}`}>{money(t.net, cur)}</td></tr>)}</tbody>
          </table>
        </div>
        {data.trend.every((t) => !t.income && !t.expense) && <Empty>Nothing recorded yet.</Empty>}
      </section>
    </>
  );
}
