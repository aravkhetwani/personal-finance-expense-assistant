import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Empty, Field, Modal, PageHeader, Progress, Spinner, Toast, useLoad } from '../components/ui.jsx';
import { money } from '../util.js';

function BudgetForm({ categories, budgets, initial, onSaved, onClose }) {
  const [categoryId, setCategoryId] = useState(initial?.categoryId || '');
  const [limit, setLimit] = useState(initial?.limit ?? '');
  const [err, setErr] = useState('');
  const used = new Set(budgets.map((b) => b.categoryId));
  async function submit(e) {
    e.preventDefault(); setErr('');
    try {
      if (initial) await api.put(`/budgets/${initial.id}`, { limit });
      else await api.post('/budgets', { categoryId, limit });
      onSaved(initial ? 'Budget updated.' : 'Budget saved.');
    } catch (x) { setErr(x.message); }
  }
  return (
    <form onSubmit={submit} noValidate>
      {!initial && (
        <Field label="Category">{(p) => (
          <select {...p} required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose a category…</option>
            {categories.filter((c) => c.type === 'expense' && !used.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}</Field>
      )}
      <Field label="Monthly limit" hint="The most you plan to spend in this category each month.">{(p) => <input {...p} type="number" min="1" step="0.01" required value={limit} onChange={(e) => setLimit(e.target.value)} autoFocus={!!initial} />}</Field>
      <Alert>{err}</Alert>
      <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
    </form>
  );
}

function Categories({ categories, reload, setToast }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('expense');
  const [err, setErr] = useState('');
  async function add(e) {
    e.preventDefault(); setErr('');
    try { await api.post('/categories', { name, type }); setName(''); setToast('Category added.'); reload(); } catch (x) { setErr(x.message); }
  }
  async function rename(c) {
    const n = window.prompt('Rename category', c.name);
    if (!n || n === c.name) return;
    try { await api.put(`/categories/${c.id}`, { name: n }); reload(); } catch (x) { setToast(x.message); }
  }
  async function remove(c) {
    if (!window.confirm(`Delete "${c.name}"? Its transactions will be moved to "Other".`)) return;
    try { await api.del(`/categories/${c.id}`); setToast('Category deleted.'); reload(); } catch (x) { setToast(x.message); }
  }
  return (
    <section className="card" aria-labelledby="cat-h">
      <h2 id="cat-h">Categories</h2>
      <form className="inline-form" onSubmit={add}>
        <Field label="New category name">{(p) => <input {...p} required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Type">{(p) => <select {...p} value={type} onChange={(e) => setType(e.target.value)}><option value="expense">Expense</option><option value="income">Income</option></select>}</Field>
        <button className="btn">Add category</button>
      </form>
      <Alert>{err}</Alert>
      <div className="grid-2">
        {['expense', 'income'].map((t) => (
          <div key={t}>
            <h3 className="cap">{t} categories</h3>
            <ul className="plain">
              {categories.filter((c) => c.type === t).map((c) => (
                <li key={c.id} className="row-between">
                  <span>{c.name} {c.isDefault && <span className="pill">default</span>}</span>
                  {!c.isDefault && <span><button className="btn small" onClick={() => rename(c)}>Rename</button> <button className="btn small" onClick={() => remove(c)}>Delete</button></span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Budgets() {
  const { user } = useAuth();
  const budgets = useLoad(() => api.get('/budgets'), []);
  const cats = useLoad(() => api.get('/categories'), []);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const cur = user.currency;
  const saved = (m) => { setModal(null); setToast(m); budgets.reload(); };

  async function toggle(b) {
    try { await api.put(`/budgets/${b.id}`, { active: !b.active }); budgets.reload(); } catch (x) { setToast(x.message); }
  }
  async function remove(b) {
    if (!window.confirm(`Delete the ${b.category} budget?`)) return;
    try { await api.del(`/budgets/${b.id}`); setToast('Budget deleted.'); budgets.reload(); } catch (x) { setToast(x.message); }
  }
  if (budgets.loading || cats.loading) return <Spinner />;
  const list = budgets.data?.budgets || [];
  return (
    <>
      <PageHeader title="Budgets" help="Budgets"><button className="btn primary" onClick={() => setModal({ kind: 'new' })}>New budget</button></PageHeader>
      <p className="muted">Budgets are monthly spending plans per category. You'll get gentle check-ins at 80% and when a budget is reached — they're guides, not rules.</p>
      <Alert>{budgets.error || cats.error}</Alert>
      <section className="card" aria-labelledby="b-h">
        <h2 id="b-h">This month ({budgets.data?.month})</h2>
        {list.length === 0 ? <Empty>No budgets yet. Create one to start tracking a category.</Empty> : list.map((b) => (
          <div key={b.id} className={`row-progress ${b.active ? '' : 'disabled'}`}>
            <div className="row-between">
              <strong>{b.category} {!b.active && <span className="pill">paused</span>}</strong>
              <span className="muted">{money(b.spent, cur)} of {money(b.limit, cur)} · {b.remaining >= 0 ? `${money(b.remaining, cur)} left` : `${money(-b.remaining, cur)} above plan`}</span>
            </div>
            <Progress percent={b.percent} label={`${b.category} budget used`} />
            <div className="row-actions">
              <button className="btn small" onClick={() => setModal({ kind: 'edit', b })}>Adjust limit</button>
              <button className="btn small" onClick={() => toggle(b)}>{b.active ? 'Pause' : 'Resume'}</button>
              <button className="btn small" onClick={() => remove(b)}>Delete</button>
            </div>
          </div>
        ))}
      </section>
      {cats.data && <Categories categories={cats.data.categories} reload={cats.reload} setToast={setToast} />}
      {modal && (
        <Modal title={modal.kind === 'new' ? 'New budget' : `Adjust ${modal.b.category} budget`} onClose={() => setModal(null)}>
          <BudgetForm categories={cats.data.categories} budgets={list} initial={modal.b} onSaved={saved} onClose={() => setModal(null)} />
        </Modal>
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </>
  );
}
