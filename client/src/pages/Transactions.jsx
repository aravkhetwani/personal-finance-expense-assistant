import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, ConfirmDelete, Empty, Field, Modal, PageHeader, Spinner, Tip, Toast, useLoad } from '../components/ui.jsx';
import { fmtDate, money, todayStr } from '../util.js';

const METHODS = ['cash', 'card', 'upi', 'bank', 'other'];

function TxForm({ initial, categories, onSaved, onClose }) {
  const [f, setF] = useState({
    type: 'expense', amount: '', date: todayStr(), time: '', categoryId: '', paymentMethod: 'cash', notes: '', ...initial,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const cats = categories.filter((c) => c.type === f.type);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const body = { ...f, amount: f.amount, categoryId: f.categoryId || undefined, time: f.time || undefined };
    try {
      if (initial?.id) await api.put(`/transactions/${initial.id}`, body);
      else await api.post('/transactions', { ...body, source: initial?.source });
      onSaved(initial?.id ? 'Transaction updated.' : 'Transaction saved.');
    } catch (x) { setErr(x.message); setBusy(false); }
  }
  return (
    <form onSubmit={submit} noValidate>
      <fieldset className="seg">
        <legend className="sr-only">Type</legend>
        {['expense', 'income'].map((t) => (
          <label key={t} className={f.type === t ? 'on' : ''}>
            <input type="radio" name="type" value={t} checked={f.type === t} onChange={() => setF({ ...f, type: t, categoryId: '' })} /> {t === 'expense' ? 'Expense' : 'Income'}
          </label>
        ))}
      </fieldset>
      <div className="form-grid">
        <Field label="Amount">{(p) => <input {...p} type="number" inputMode="decimal" min="0.01" step="0.01" required value={f.amount} onChange={set('amount')} autoFocus />}</Field>
        <Field label="Category">{(p) => (
          <select {...p} value={f.categoryId} onChange={set('categoryId')}>
            <option value="">Uncategorised</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}</Field>
        <Field label="Date">{(p) => <input {...p} type="date" required value={f.date} onChange={set('date')} />}</Field>
        <Field label="Time (optional)">{(p) => <input {...p} type="time" value={f.time} onChange={set('time')} />}</Field>
        <Field label="Payment method">{(p) => <select {...p} value={f.paymentMethod} onChange={set('paymentMethod')}>{METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase() === 'UPI' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}</option>)}</select>}</Field>
      </div>
      <Field label="Notes (optional)">{(p) => <textarea {...p} rows={2} maxLength={500} value={f.notes} onChange={set('notes')} />}</Field>
      <Alert>{err}</Alert>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

function ScanModal({ categories, onSaved, onClose }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState(null);
  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr('');
    const fd = new FormData();
    fd.append('receipt', file);
    try {
      const d = await api.upload('/receipts/scan', fd);
      const x = d.extracted;
      setDraft({ type: 'expense', amount: x.total ?? '', date: x.date || todayStr(), notes: x.merchant ? `Receipt: ${x.merchant}` : 'Receipt', source: 'receipt' });
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  if (draft) {
    return (
      <>
        <Alert kind="info">Please review the details extracted from your receipt, correct anything that looks off, then save.</Alert>
        <TxForm initial={draft} categories={categories} onSaved={onSaved} onClose={onClose} />
      </>
    );
  }
  return (
    <div>
      <p>Upload a JPG or PNG photo of a receipt. We'll try to read the total, date and merchant, and you can review before anything is saved. The image is not stored.</p>
      <Field label="Receipt image">{(p) => <input {...p} type="file" accept="image/png,image/jpeg" onChange={pick} disabled={busy} />}</Field>
      {busy && <Spinner label="Reading receipt… this can take a few seconds." />}
      <Alert>{err}</Alert>
      <div className="modal-actions"><button className="btn" onClick={onClose}>Close</button></div>
    </div>
  );
}

function ImportModal({ onDone, onClose }) {
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  async function go(e) {
    e.preventDefault();
    const file = e.target.elements.file.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setErr('');
    try { setRes(await api.upload('/transactions/import', fd)); } catch (x) { setErr(x.message); }
  }
  return (
    <form onSubmit={go}>
      <p>Choose a CSV file with columns <code>date, type, amount</code> and optionally <code>category, payment_method, notes, time</code>. Dates use <code>YYYY-MM-DD</code>; type is <code>expense</code> or <code>income</code>.</p>
      <Field label="CSV file">{(p) => <input {...p} name="file" type="file" accept=".csv,text/csv" required />}</Field>
      <Alert>{err}</Alert>
      {res && (
        <Alert kind="success">
          Imported {res.imported} transaction(s){res.skipped ? `; skipped ${res.skipped} with problems` : ''}.
          {res.errors.length > 0 && <ul>{res.errors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}</ul>}
        </Alert>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => (res ? onDone() : onClose())}>{res ? 'Done' : 'Cancel'}</button>
        {!res && <button className="btn primary">Import</button>}
      </div>
    </form>
  );
}

export default function Transactions() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [filters, setFilters] = useState({ from: '', to: '', categoryId: '', type: '', minAmount: '', maxAmount: '', q: '' });
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const [selected, setSelected] = useState(new Set());
  const cats = useLoad(() => api.get('/categories'), []);
  const qs = useMemo(() => {
    const p = new URLSearchParams({ page, limit: 25 });
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    return p.toString();
  }, [filters, page]);
  const list = useLoad(() => api.get(`/transactions?${qs}`), [qs]);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || !cats.data) return;
    handled.current = true;
    if (sp.get('new')) setModal({ kind: 'form', initial: { type: sp.get('new') === 'income' ? 'income' : 'expense' } });
    if (sp.get('scan')) setModal({ kind: 'scan' });
    if (sp.get('new') || sp.get('scan')) setSp({}, { replace: true });
  }, [cats.data, sp, setSp]);

  const cur = user.currency;
  const categories = cats.data?.categories || [];
  const refresh = (msg) => { setModal(null); if (msg) setToast(msg); setSelected(new Set()); list.reload(); };
  const setF = (k) => (e) => { setFilters({ ...filters, [k]: e.target.value }); setPage(1); };

  async function exportCsv() {
    const p = new URLSearchParams(qs); p.delete('page'); p.delete('limit');
    try { await api.download(`/transactions/export.csv?${p}`, 'transactions.csv'); } catch (e) { setToast(e.message); }
  }
  async function remove(t) {
    if (!window.confirm(`Delete this ${t.type} of ${money(t.amount, cur)} on ${fmtDate(t.date)}?`)) return;
    try { await api.del(`/transactions/${t.id}`); refresh('Transaction deleted.'); } catch (e) { setToast(e.message); }
  }
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const items = list.data?.items || [];
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.limit)) : 1;

  return (
    <>
      <PageHeader title="Transactions" help="Transactions">
        <button className="btn primary" onClick={() => setModal({ kind: 'form', initial: { type: 'expense' } })}>Add expense</button>
        <button className="btn" onClick={() => setModal({ kind: 'form', initial: { type: 'income' } })}>Add income</button>
        <button className="btn" onClick={() => setModal({ kind: 'scan' })}>Scan receipt</button>
        <button className="btn" onClick={() => setModal({ kind: 'import' })}>Import CSV</button>
        <button className="btn" onClick={exportCsv}>Export CSV</button>
      </PageHeader>

      <form className="card filters" role="search" aria-label="Filter transactions" onSubmit={(e) => e.preventDefault()}>
        <Field label="From">{(p) => <input {...p} type="date" value={filters.from} onChange={setF('from')} />}</Field>
        <Field label="To">{(p) => <input {...p} type="date" value={filters.to} onChange={setF('to')} />}</Field>
        <Field label="Type">{(p) => <select {...p} value={filters.type} onChange={setF('type')}><option value="">All</option><option value="expense">Expenses</option><option value="income">Income</option></select>}</Field>
        <Field label="Category">{(p) => <select {...p} value={filters.categoryId} onChange={setF('categoryId')}><option value="">All</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}</select>}</Field>
        <Field label="Min amount">{(p) => <input {...p} type="number" min="0" value={filters.minAmount} onChange={setF('minAmount')} />}</Field>
        <Field label="Max amount">{(p) => <input {...p} type="number" min="0" value={filters.maxAmount} onChange={setF('maxAmount')} />}</Field>
        <Field label="Search notes">{(p) => <input {...p} type="search" value={filters.q} onChange={setF('q')} />}</Field>
        <button type="button" className="btn small" onClick={() => { setFilters({ from: '', to: '', categoryId: '', type: '', minAmount: '', maxAmount: '', q: '' }); setPage(1); }}>Clear filters</button>
      </form>

      {list.error && <Alert>{list.error}</Alert>}
      {list.loading && !list.data ? <Spinner /> : (
        <div className="card">
          {list.data && (
            <p className="row-between" aria-live="polite">
              <span>{list.data.total} transaction(s)</span>
              <span>Income <strong className="pos">{money(list.data.totals.income, cur)}</strong> · Expenses <strong className="neg">{money(list.data.totals.expense, cur)}</strong></span>
            </p>
          )}
          {selected.size > 0 && (
            <p>
              <button className="btn danger small" onClick={() => setModal({ kind: 'bulk' })}>Delete {selected.size} selected…</button>{' '}
              <button className="btn link small" onClick={() => setModal({ kind: 'bulk-all' })}>Delete ALL transactions…</button>
            </p>
          )}
          {items.length === 0 ? <Empty>No transactions match. Try adding one or clearing the filters.</Empty> : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Transaction history</caption>
                <thead>
                  <tr><th scope="col"><span className="sr-only">Select</span></th><th scope="col">Date</th><th scope="col">Category</th><th scope="col">Notes</th><th scope="col">Method</th><th scope="col" className="num">Amount</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id}>
                      <td><input type="checkbox" aria-label={`Select ${t.category || 'transaction'} on ${t.date}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} /></td>
                      <td>{fmtDate(t.date)}</td>
                      <td>{t.category || <span className="muted">Uncategorised</span>}{t.source !== 'manual' && <span className="pill">{t.source}</span>}</td>
                      <td className="notes">{t.notes}</td>
                      <td>{t.paymentMethod}</td>
                      <td className={`num ${t.type === 'income' ? 'pos' : 'neg'}`}>{t.type === 'income' ? '+' : '−'}{money(t.amount, cur)}</td>
                      <td className="actions">
                        <button className="btn small" onClick={() => setModal({ kind: 'form', initial: { ...t, categoryId: t.categoryId || '', time: t.time === '00:00' ? '' : t.time } })} aria-label={`Edit transaction on ${t.date}`}>Edit</button>
                        <button className="btn small" onClick={() => remove(t)} aria-label={`Delete transaction on ${t.date}`}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <nav className="pager" aria-label="Pagination">
              <button className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <span>Page {page} of {pages}</span>
              <button className="btn small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </nav>
          )}
        </div>
      )}

      {modal?.kind === 'form' && (
        <Modal title={modal.initial?.id ? 'Edit transaction' : modal.initial?.type === 'income' ? 'Add income' : 'Add expense'} onClose={() => setModal(null)}>
          <TxForm initial={modal.initial} categories={categories} onSaved={refresh} onClose={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === 'scan' && <Modal title="Scan a receipt" onClose={() => setModal(null)}><ScanModal categories={categories} onSaved={refresh} onClose={() => setModal(null)} /></Modal>}
      {modal?.kind === 'import' && <Modal title="Import transactions from CSV" onClose={() => setModal(null)}><ImportModal onDone={() => refresh('Import finished.')} onClose={() => setModal(null)} /></Modal>}
      {modal?.kind === 'bulk' && (
        <ConfirmDelete title="Delete selected transactions" body={`This permanently deletes ${selected.size} transaction(s). This cannot be undone.`} onClose={() => setModal(null)}
          onConfirm={async (c) => { const r = await api.post('/transactions/bulk-delete', { ids: [...selected], confirm: c }); refresh(`${r.deleted} transaction(s) deleted.`); }} />
      )}
      {modal?.kind === 'bulk-all' && (
        <ConfirmDelete title="Delete ALL transactions" body="This permanently deletes every transaction in your account. Consider exporting a CSV first. This cannot be undone." onClose={() => setModal(null)}
          onConfirm={async (c) => { const r = await api.post('/transactions/bulk-delete', { all: true, confirm: c }); refresh(`${r.deleted} transaction(s) deleted.`); }} />
      )}
      <Toast message={toast} onDone={() => setToast('')} />
      <p className="muted small">Tip: <Tip text="Amounts and notes are encrypted before being stored. Use filters to narrow by date, category or amount." /> Your data is encrypted at rest.</p>
    </>
  );
}
