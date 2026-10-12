import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Modal } from './ui.jsx';

// UD-3: brief onboarding tutorial for new users.
const STEPS = [
  { title: 'Welcome 👋', body: 'This assistant helps you see where your money goes, plan ahead and build savings — at your own pace. Here is a 30-second tour.' },
  { title: 'Add your first expense', body: 'Open Transactions and choose "Add expense". Enter the amount, date, category and an optional note. Your dashboard updates immediately. You can also scan a receipt or import a CSV.', cta: ['Go to Transactions', '/transactions?new=expense'] },
  { title: 'Create a budget', body: 'In Budgets, set a monthly limit for a category such as Food. You will get gentle check-ins as you approach it — no pressure.', cta: ['Go to Budgets', '/budgets'] },
  { title: 'Goals, bills and insights', body: 'Set savings goals, add bill reminders so nothing is missed, and visit Insights for charts and suggestions. Every page has a Help link if you need it.' },
];

export default function Onboarding() {
  const { user, setUser } = useAuth();
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const s = STEPS[i];
  async function finish(to) {
    try {
      const d = await api.put('/auth/me', { onboarded: true });
      setUser(d.user);
    } catch { setUser({ ...user, onboarded: true }); }
    if (to) nav(to);
  }
  return (
    <Modal title={s.title} onClose={() => finish()}>
      <p>{s.body}</p>
      <p className="muted" aria-live="polite">Step {i + 1} of {STEPS.length}</p>
      <div className="modal-actions">
        <button className="btn" onClick={() => finish()}>Skip tour</button>
        {s.cta && <button className="btn" onClick={() => finish(s.cta[1])}>{s.cta[0]}</button>}
        {i < STEPS.length - 1 ? <button className="btn primary" onClick={() => setI(i + 1)}>Next</button> : <button className="btn primary" onClick={() => finish()}>Get started</button>}
      </div>
    </Modal>
  );
}
