import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Empty, PageHeader, Progress, Spinner, useLoad } from '../components/ui.jsx';
import { dueText, fmtDate, money } from '../util.js';

export default function Dashboard() {
  const { user } = useAuth();
  const { data: d, error, loading } = useLoad(() => api.get('/dashboard'), []);
  const cur = user.currency;
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const s = d.summary;

  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(' ')[0] || 'there'}`} help="Dashboard" />
      <p className="muted">Your finances at a glance for {new Date(`${d.month}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}.</p>

      {/* NFR-SAF-004: fail-safe flag for past-due / imminent bills, independent of notification delivery */}
      {d.flaggedBills.length > 0 && (
        <section className="alert warn" role="region" aria-label="Bills needing attention">
          <strong>Bills that need your attention</strong>
          <ul>
            {d.flaggedBills.map((b) => (
              <li key={b.id}><Link to="/bills">{b.name}</Link> — {money(b.amount, cur)} · <strong>{dueText(b)}</strong> ({fmtDate(b.dueDate)})</li>
            ))}
          </ul>
        </section>
      )}

      <div className="cards" role="list">
        <div className="card stat" role="listitem"><span className="stat-label">Income this month</span><span className="stat-value pos">{money(s.income, cur)}</span></div>
        <div className="card stat" role="listitem"><span className="stat-label">Expenses this month</span><span className="stat-value neg">{money(s.expense, cur)}</span></div>
        <div className="card stat" role="listitem"><span className="stat-label">Saved this month</span><span className={`stat-value ${s.net >= 0 ? 'pos' : 'neg'}`}>{money(s.net, cur)}</span></div>
        <div className="card stat" role="listitem"><span className="stat-label">Net worth <span className="muted small">(opening balance + all income − expenses)</span></span><span className="stat-value">{money(d.netWorth, cur)}</span></div>
      </div>

      <nav aria-label="Quick links" className="quick">
        {d.quickLinks.map((q) => <Link key={q.label} className="btn" to={q.to}>{q.label}</Link>)}
      </nav>

      <div className="grid-2">
        <section className="card" aria-labelledby="bud-h">
          <h2 id="bud-h">Budget progress</h2>
          {d.budgets.length === 0 ? <Empty>No budgets yet. <Link to="/budgets">Create one</Link> to track a category.</Empty> : d.budgets.map((b) => (
            <div key={b.id} className="row-progress">
              <div className="row-between"><span>{b.category}</span><span className="muted">{money(b.spent, cur)} of {money(b.limit, cur)} ({b.percent}%)</span></div>
              <Progress percent={b.percent} label={`${b.category} budget used`} />
            </div>
          ))}
        </section>

        <section className="card" aria-labelledby="goal-h">
          <h2 id="goal-h">Savings goals</h2>
          {d.goals.length === 0 ? <Empty>No goals yet. <Link to="/goals">Set a goal</Link> such as an emergency fund.</Empty> : d.goals.map((g) => (
            <div key={g.id} className="row-progress">
              <div className="row-between"><span>{g.name}</span><span className="muted">{money(g.saved, cur)} / {money(g.target, cur)}</span></div>
              <Progress percent={g.percent} tone="goal" label={`${g.name} progress`} />
            </div>
          ))}
        </section>

        <section className="card" aria-labelledby="bills-h">
          <h2 id="bills-h">Upcoming bills</h2>
          {d.upcomingBills.length === 0 ? <Empty>Nothing due in the next 30 days.</Empty> : (
            <ul className="plain">
              {d.upcomingBills.map((b) => (
                <li key={b.id} className="row-between"><span>{b.name}</span><span><strong>{money(b.amount, cur)}</strong> <span className={`pill ${b.status}`}>{dueText(b)}</span></span></li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="recent-h">
          <h2 id="recent-h">Recent transactions</h2>
          {d.recent.length === 0 ? <Empty>No transactions this month yet.</Empty> : (
            <ul className="plain">
              {d.recent.map((t) => (
                <li key={t.id} className="row-between"><span>{t.category || 'Uncategorised'} <span className="muted small">{fmtDate(t.date)}</span></span><span className={t.type === 'income' ? 'pos' : 'neg'}>{t.type === 'income' ? '+' : '−'}{money(t.amount, cur)}</span></li>
              ))}
            </ul>
          )}
          <Link to="/transactions">View all</Link>
        </section>
      </div>
    </>
  );
}
