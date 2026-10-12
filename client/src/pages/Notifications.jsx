import { api } from '../api.js';
import { Alert, Empty, PageHeader, Spinner, useLoad } from '../components/ui.jsx';

export default function Notifications() {
  const { data, error, loading, reload } = useLoad(() => api.get('/notifications'), []);
  async function markAll() { await api.post('/notifications/read-all'); reload(); }
  async function read(n) { if (!n.read) { await api.post(`/notifications/${n.id}/read`); reload(); } }
  async function remove(n) { await api.del(`/notifications/${n.id}`); reload(); }
  if (loading) return <Spinner />;
  const list = data?.notifications || [];
  return (
    <>
      <PageHeader title="Notifications" help="Notifications">
        <button className="btn" onClick={markAll} disabled={!data?.unread}>Mark all as read</button>
      </PageHeader>
      <Alert>{error}</Alert>
      <section className="card">
        {list.length === 0 ? <Empty>You're all caught up.</Empty> : (
          <ul className="plain notif">
            {list.map((n) => (
              <li key={n.id} className={n.read ? 'read' : 'unread'}>
                <div>
                  <strong>{!n.read && <span className="dot" aria-label="Unread" />} {n.title}</strong>
                  <p>{n.message}</p>
                  <span className="muted small">{new Date(n.createdAt.replace(' ', 'T') + (n.createdAt.endsWith('Z') ? '' : 'Z')).toLocaleString()}</span>
                </div>
                <div className="row-actions">
                  {!n.read && <button className="btn small" onClick={() => read(n)}>Mark read</button>}
                  <button className="btn small" onClick={() => remove(n)} aria-label={`Delete notification: ${n.title}`}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
