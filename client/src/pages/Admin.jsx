import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, ConfirmDelete, PageHeader, Spinner, Toast, useLoad } from '../components/ui.jsx';

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
