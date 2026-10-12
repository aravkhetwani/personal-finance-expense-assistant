import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Disclaimer, Empty, Field, Modal, PageHeader, Progress, Spinner, Tip, Toast, useLoad } from '../components/ui.jsx';
import { fmtDate, money, todayStr } from '../util.js';

function GoalForm({ initial, onSaved, onClose }) {
  const [f, setF] = useState({ name: '', target: '', saved: '0', deadline: '', ...initial });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setErr('');
    try {
      if (initial?.id) await api.put(`/goals/${initial.id}`, f); else await api.post('/goals', f);
      onSaved(initial?.id ? 'Goal updated.' : 'Goal created.');
    } catch (x) { setErr(x.message); }
  }
  return (
    <form onSubmit={submit} noValidate>
      <Field label="Goal name">{(p) => <input {...p} required maxLength={100} value={f.name} onChange={set('name')} placeholder="e.g. Emergency fund, Vacation" autoFocus />}</Field>
      <div className="form-grid">
        <Field label="Target amount">{(p) => <input {...p} type="number" min="1" step="0.01" required value={f.target} onChange={set('target')} />}</Field>
        <Field label="Saved so far">{(p) => <input {...p} type="number" min="0" step="0.01" value={f.saved} onChange={set('saved')} />}</Field>
        <Field label="Deadline">{(p) => <input {...p} type="date" min={todayStr()} required value={f.deadline} onChange={set('deadline')} />}</Field>
      </div>
      <Alert>{err}</Alert>
      <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
    </form>
  );
}

export default function Goals() {
  const { user } = useAuth();
  const goals = useLoad(() => api.get('/goals'), []);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const [risk, setRisk] = useState(user.riskTolerance);
  const [goalId, setGoalId] = useState('');
  const [years, setYears] = useState('3');
  const recs = useLoad(() => api.get(`/goals/recommendations/list?risk=${risk}${goalId ? `&goalId=${goalId}` : `&years=${years}`}`), [risk, goalId, years]);
  const cur = user.currency;
  const done = (m) => { setModal(null); setToast(m); goals.reload(); recs.reload(); };

  async function contribute(g) {
    const a = window.prompt(`How much would you like to add to "${g.name}"?`);
    if (!a) return;
    try { await api.post(`/goals/${g.id}/contribute`, { amount: a }); setToast('Nice — progress updated!'); goals.reload(); } catch (x) { setToast(x.message); }
  }
  async function remove(g) {
    if (!window.confirm(`Delete the goal "${g.name}"?`)) return;
    try { await api.del(`/goals/${g.id}`); setToast('Goal deleted.'); goals.reload(); setGoalId(''); } catch (x) { setToast(x.message); }
  }

  if (goals.loading) return <Spinner />;
  const list = goals.data?.goals || [];
  return (
    <>
      <PageHeader title="Goals & Investing" help="Goals and investing"><button className="btn primary" onClick={() => setModal({})}>New goal</button></PageHeader>
      <Alert>{goals.error}</Alert>
      <section className="card" aria-labelledby="g-h">
        <h2 id="g-h">Savings goals</h2>
        {list.length === 0 ? <Empty>No goals yet — try an emergency fund or a trip you're excited about.</Empty> : list.map((g) => (
          <div key={g.id} className="row-progress">
            <div className="row-between"><strong>{g.name}</strong><span className="muted">{money(g.saved, cur)} of {money(g.target, cur)} · by {fmtDate(g.deadline)}</span></div>
            <Progress percent={g.percent} tone="goal" label={`${g.name} progress`} />
            <div className="row-between">
              <span className="muted small">{g.percent}% reached · {g.daysLeft} days left{g.remaining > 0 && ` · about ${money(g.monthlyNeeded, cur)}/month to stay on track`}</span>
              <span className="row-actions">
                <button className="btn small" onClick={() => contribute(g)}>Add savings</button>
                <button className="btn small" onClick={() => setModal({ initial: { ...g, target: g.target, saved: g.saved } })}>Edit</button>
                <button className="btn small" onClick={() => remove(g)}>Delete</button>
              </span>
            </div>
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="inv-h">
        <h2 id="inv-h">Investment ideas <Tip text="Options are matched to your risk comfort and how long until you need the money. Shorter horizons lean towards safer choices." /></h2>
        <Disclaimer>{recs.data?.disclaimer || 'This is general information only and not personalised advice. This application is not a registered financial advisor.'}</Disclaimer>
        <div className="form-grid">
          <Field label="Risk tolerance">{(p) => <select {...p} value={risk} onChange={(e) => setRisk(e.target.value)}><option value="low">Low — protect my money</option><option value="medium">Medium — balanced</option><option value="high">High — comfortable with ups and downs</option></select>}</Field>
          <Field label="For goal">{(p) => <select {...p} value={goalId} onChange={(e) => setGoalId(e.target.value)}><option value="">Custom time horizon</option>{list.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}</Field>
          {!goalId && <Field label="Years until needed">{(p) => <input {...p} type="number" min="0.25" max="60" step="0.25" value={years} onChange={(e) => setYears(e.target.value)} />}</Field>}
        </div>
        {recs.error && <Alert>{recs.error}</Alert>}
        {recs.data && (
          <>
            <p className="muted">Showing ideas for a horizon of about {recs.data.horizonYears} year(s).</p>
            {recs.data.options.length === 0 ? <Empty>No suggestions for this combination.</Empty> : (
              <div className="grid-3">
                {recs.data.options.map((o) => (
                  <article key={o.id} className="card inner">
                    <h3>{o.name}</h3>
                    <p><span className={`pill risk-${o.risk}`}>{o.risk} risk</span></p>
                    <p>Estimated return: <strong>{o.estimatedReturnPct[0]}%–{o.estimatedReturnPct[1]}%</strong> per year <span className="muted small">(not guaranteed)</span></p>
                    <p className="muted">{o.rationale}</p>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      {modal && <Modal title={modal.initial ? 'Edit goal' : 'New goal'} onClose={() => setModal(null)}><GoalForm initial={modal.initial} onSaved={done} onClose={() => setModal(null)} /></Modal>}
      <Toast message={toast} onDone={() => setToast('')} />
    </>
  );
}
