import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, ConfirmDelete, Field, PageHeader, Spinner, Toast, useLoad } from '../components/ui.jsx';

function EmailSettings({ setToast }) {
  const cfg = useLoad(() => api.get('/admin/email'), []);
  const box = useLoad(() => api.get('/admin/outbox?limit=20'), []);
  const [f, setF] = useState(null);
  const [to, setTo] = useState('');
  const [err, setErr] = useState('');
  const c = cfg.data;
  if (c && !f) setF({ host: c.host || '', port: c.port || 587, secure: !!c.secure, user: c.user || '', pass: '', from: c.from && c.source !== 'none' ? c.from : '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function save(e) {
    e.preventDefault(); setErr('');
    try { await api.put('/admin/email', f); setF(null); cfg.reload(); setToast('Mail server settings saved.'); } catch (x) { setErr(x.message); }
  }
  async function remove() {
    if (!window.confirm('Remove the saved mail server settings?')) return;
    try { await api.del('/admin/email'); setF(null); cfg.reload(); setToast('Saved settings removed.'); } catch (x) { setErr(x.message); }
  }
  async function test(e) {
    e.preventDefault(); setErr('');
    try {
      const r = await api.post('/admin/email/test', { to });
      setToast(r.status === 'sent' ? 'Test e-mail sent.' : r.status === 'logged' ? 'No mail server is configured: the message was only logged.' : `Sending failed: ${r.error}`);
      box.reload();
    } catch (x) { setErr(x.message); }
  }
  async function retry(m) { try { const r = await api.post(`/admin/outbox/${m.id}/retry`); setToast(r.status === 'sent' ? 'Delivered.' : `Still failing: ${r.error || r.status}`); box.reload(); } catch (x) { setToast(x.message); } }
  if (!c || !f) return null;
  return (
    <section className="card" aria-labelledby="em-h">
      <h2 id="em-h">E-mail (SMTP) settings</h2>
      <p className="muted">{c.configured ? <>Using <strong>{c.host}:{c.port}</strong> (saved in {c.source === 'database' ? 'the database' : 'server environment variables'}).</> : 'No mail server is configured. Messages are only written to the server log, and sign-up codes are shown on screen. Enter your provider’s SMTP details below. For Gmail use smtp.gmail.com, port 465 with “Use SSL”, your address and an app password.'}</p>
      <form onSubmit={save}>
        <div className="form-grid">
          <Field label="SMTP host">{(p) => <input {...p} required value={f.host} onChange={set('host')} placeholder="smtp.gmail.com" />}</Field>
          <Field label="Port">{(p) => <input {...p} type="number" min="1" max="65535" required value={f.port} onChange={set('port')} />}</Field>
          <Field label="Username">{(p) => <input {...p} autoComplete="off" value={f.user} onChange={set('user')} />}</Field>
          <Field label="Password" hint={c.hasPassword && c.source === 'database' ? 'Leave blank to keep the saved password.' : undefined}>{(p) => <input {...p} type="password" autoComplete="new-password" value={f.pass} onChange={set('pass')} />}</Field>
          <Field label="From address" hint="e.g. Finance Assistant <you@example.com>">{(p) => <input {...p} value={f.from} onChange={set('from')} />}</Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.secure} onChange={set('secure')} /> Use SSL/TLS (port 465)</label>
        <Alert>{err}</Alert>
        <button className="btn primary">Save settings</button>{' '}
        {c.source === 'database' && <button type="button" className="btn" onClick={remove}>Remove saved settings</button>}
      </form>
      <form className="inline-form" onSubmit={test} style={{ marginTop: '1rem' }}>
        <Field label="Send a test e-mail to">{(p) => <input {...p} type="email" required value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        <button className="btn">Send test</button>
      </form>
      <h3>Recent messages</h3>
      {box.data && (
        <>
          <p className="muted small">Sent {box.data.counts.sent || 0} · Failed {box.data.counts.failed || 0} · Logged only {box.data.counts.logged || 0}. Failed messages are retried automatically up to three times.</p>
          <div className="table-wrap"><table className="compact">
            <caption className="sr-only">Recent e-mail messages</caption>
            <thead><tr><th scope="col">When (UTC)</th><th scope="col">To</th><th scope="col">Subject</th><th scope="col">Status</th><th scope="col">Tries</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{box.data.messages.map((m) => (
              <tr key={m.id}><td>{m.created_at}</td><td>{m.to_addr}</td><td>{m.subject}</td>
                <td><span className={`pill ${m.status === 'failed' ? 'overdue' : m.status === 'sent' ? 'paid' : ''}`}>{m.status}</span>{m.last_error && <div className="muted small">{m.last_error}</div>}</td>
                <td>{m.attempts}</td>
                <td>{m.status === 'failed' && <button className="btn small" onClick={() => retry(m)}>Retry</button>}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </section>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const stats = useLoad(() => api.get('/admin/stats'), []);
  const users = useLoad(() => api.get('/admin/users'), []);
  const logs = useLoad(() => api.get('/admin/security-logs?limit=100'), []);
  const [toast, setToast] = useState('');
  const [del, setDel] = useState(null);
  if (user.role !== 'admin') return <Navigate to="/" replace />;

  async function patch(u, body) {
    try { await api.patch(`/admin/users/${u.id}`, body); users.reload(); setToast('Updated.'); } catch (e) { setToast(e.message); }
  }
  async function backup() {
    try { const r = await api.post('/admin/backup'); setToast(`${r.message} (${r.file})`); } catch (e) { setToast(e.message); }
  }
  if (stats.loading || users.loading) return <Spinner />;
  const s = stats.data;
  return (
    <>
      <PageHeader title="Administration" help="Administration"><button className="btn" onClick={backup}>Back up database now</button></PageHeader>
      <Alert>{stats.error || users.error || logs.error}</Alert>
      {s && (
        <div className="cards">
          <div className="card stat"><span className="stat-label">Users</span><span className="stat-value">{s.users}</span></div>
          <div className="card stat"><span className="stat-label">Active sessions</span><span className="stat-value">{s.activeSessions}</span></div>
          <div className="card stat"><span className="stat-label">Failed logins (24h)</span><span className="stat-value">{s.failedLogins24h}</span></div>
          <div className="card stat"><span className="stat-label">Uptime / memory</span><span className="stat-value">{Math.round(s.uptimeSeconds / 60)} min · {s.memoryMb} MB</span></div>
        </div>
      )}
      <EmailSettings setToast={setToast} />
      <section className="card" aria-labelledby="au-h">
        <h2 id="au-h">User accounts</h2>
        <p className="muted small">Administrators can manage accounts but cannot see any user's financial data.</p>
        <div className="table-wrap"><table>
          <caption className="sr-only">All user accounts</caption>
          <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last sign-in</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{users.data.users.map((u) => (
            <tr key={u.id}>
              <th scope="row">{u.name}</th><td>{u.email}</td><td>{u.role}</td>
              <td>{u.disabled ? <span className="pill overdue">disabled</span> : u.verified ? <span className="pill paid">active</span> : <span className="pill">unverified</span>}</td>
              <td>{u.lastLogin ? new Date(u.lastLogin.replace(' ', 'T') + 'Z').toLocaleString() : '—'}</td>
              <td className="actions">{u.id !== user.id && (
                <>
                  <button className="btn small" onClick={() => patch(u, { disabled: !u.disabled })}>{u.disabled ? 'Enable' : 'Disable'}</button>
                  <button className="btn small" onClick={() => patch(u, { role: u.role === 'admin' ? 'user' : 'admin' })}>Make {u.role === 'admin' ? 'user' : 'admin'}</button>
                  <button className="btn small" onClick={() => setDel(u)}>Delete</button>
                </>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <section className="card" aria-labelledby="sl-h">
        <h2 id="sl-h">Security log</h2>
        <div className="table-wrap"><table className="compact">
          <caption className="sr-only">Recent security events</caption>
          <thead><tr><th scope="col">Time (UTC)</th><th scope="col">Event</th><th scope="col">User id</th><th scope="col">IP</th><th scope="col">Detail</th></tr></thead>
          <tbody>{(logs.data?.logs || []).map((l) => <tr key={l.id}><td>{l.created_at}</td><td>{l.event}</td><td>{l.user_id ?? '—'}</td><td>{l.ip}</td><td>{l.detail}</td></tr>)}</tbody>
        </table></div>
      </section>
      {del && (
        <ConfirmDelete title={`Delete ${del.email}`} body="This permanently deletes the account and all of its data." onClose={() => setDel(null)}
          onConfirm={async (c) => { await api.del(`/admin/users/${del.id}`, { confirm: c }); setDel(null); users.reload(); setToast('User deleted.'); }} />
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </>
  );
}
