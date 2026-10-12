import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Empty, Field, Modal, PageHeader, Spinner, Toast, useLoad } from '../components/ui.jsx';
import { dueText, fmtDate, money, todayStr } from '../util.js';

function BillForm({ initial, onSaved, onClose }) {
  const [f, setF] = useState({ name: '', amount: '', dueDate: todayStr(), recurrence: 'none', ...initial });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setErr('');
    try {
      if (initial?.id) await api.put(`/bills/${initial.id}`, f); else await api.post('/bills', f);
      onSaved(initial?.id ? 'Bill updated.' : 'Reminder saved.');
    } catch (x) { setErr(x.message); }
  }
  return (
    <form onSubmit={submit} noValidate>
      <Field label="Bill name">{(p) => <input {...p} required maxLength={100} value={f.name} onChange={set('name')} placeholder="e.g. Electricity" autoFocus />}</Field>
      <div className="form-grid">
        <Field label="Amount">{(p) => <input {...p} type="number" min="0.01" step="0.01" required value={f.amount} onChange={set('amount')} />}</Field>
        <Field label="Due date">{(p) => <input {...p} type="date" required value={f.dueDate} onChange={set('dueDate')} />}</Field>
        <Field label="Repeats">{(p) => <select {...p} value={f.recurrence} onChange={set('recurrence')}><option value="none">Does not repeat</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select>}</Field>
      </div>
      <Alert>{err}</Alert>
      <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
    </form>
  );
}

export default function Bills() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api.get('/bills'), []);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const cur = user.currency;
  const done = (m) => { setModal(null); setToast(m); reload(); };
  async function pay(b) {
    try { await api.post(`/bills/${b.id}/pay`); setToast(b.recurrence !== 'none' ? `Marked paid — your next ${b.name} reminder has been scheduled.` : 'Marked as paid. Well done!'); reload(); } catch (x) { setToast(x.message); }
  }
  async function remove(b) {
    if (!window.confirm(`Delete the reminder for ${b.name}?`)) return;
    try { await api.del(`/bills/${b.id}`); setToast('Reminder deleted.'); reload(); } catch (x) { setToast(x.message); }
  }
  if (loading) return <Spinner />;
  const bills = data?.bills || [];
  const open = bills.filter((b) => !b.paid);
  const paid = bills.filter((b) => b.paid);
  return (
    <>
      <PageHeader title="Bill reminders" help="Bills and reminders"><button className="btn primary" onClick={() => setModal({})}>Add bill</button></PageHeader>
      <p className="muted">We'll remind you in the app and by email before bills are due (you can change timing and channels in your <Link to="/profile">profile</Link>). Past-due and imminent bills also appear on your dashboard.</p>
      <Alert>{error}</Alert>
      <section className="card" aria-labelledby="open-h">
        <h2 id="open-h">Upcoming &amp; due</h2>
        {open.length === 0 ? <Empty>No bills to pay. Add one to get reminders.</Empty> : (
          <div className="table-wrap"><table>
            <caption className="sr-only">Unpaid bills</caption>
            <thead><tr><th scope="col">Bill</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col">Repeats</th><th scope="col" className="num">Amount</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{open.map((b) => (
              <tr key={b.id}>
                <th scope="row">{b.name}</th><td>{fmtDate(b.dueDate)}</td>
                <td><span className={`pill ${b.status}`}>{dueText(b)}</span></td><td>{b.recurrence === 'none' ? '—' : b.recurrence}</td>
                <td className="num">{money(b.amount, cur)}</td>
                <td className="actions">
                  <button className="btn small primary" onClick={() => pay(b)} aria-label={`Mark ${b.name} as paid`}>Mark paid</button>
                  <button className="btn small" onClick={() => setModal({ initial: b })} aria-label={`Edit ${b.name}`}>Edit</button>
                  <button className="btn small" onClick={() => remove(b)} aria-label={`Delete ${b.name}`}>Delete</button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {paid.length > 0 && (
        <section className="card" aria-labelledby="paid-h">
          <h2 id="paid-h">Paid</h2>
          <ul className="plain">{paid.map((b) => <li key={b.id} className="row-between"><span>{b.name}</span><span>{money(b.amount, cur)} <button className="btn small" onClick={() => remove(b)}>Remove</button></span></li>)}</ul>
        </section>
      )}
      {modal && <Modal title={modal.initial ? 'Edit bill' : 'Add bill reminder'} onClose={() => setModal(null)}><BillForm initial={modal.initial} onSaved={done} onClose={() => setModal(null)} /></Modal>}
      <Toast message={toast} onDone={() => setToast('')} />
    </>
  );
}
