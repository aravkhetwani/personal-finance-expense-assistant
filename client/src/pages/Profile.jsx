import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, ConfirmDelete, Field, PageHeader, Toast } from '../components/ui.jsx';

export default function Profile() {
  const { user, setUser, signOut } = useAuth();
  const [f, setF] = useState({
    name: user.name, phone: user.phone, currency: user.currency, riskTolerance: user.riskTolerance, taxRegion: user.taxRegion,
    annualIncome: user.annualIncome ?? '', openingBalance: user.openingBalance ?? 0,
    notifyEmail: user.notifyEmail, notifyInApp: user.notifyInApp, billLeadDays: user.billLeadDays,
  });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [mfaPw, setMfaPw] = useState('');
  const [msg, setMsg] = useState({});
  const [toast, setToast] = useState('');
  const [del, setDel] = useState(false);
  const [delPw, setDelPw] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const flash = (k, v) => setMsg((m) => ({ ...m, [k]: v }));

  async function save(e) {
    e.preventDefault(); flash('save', '');
    try { const d = await api.put('/auth/me', { ...f, annualIncome: f.annualIncome === '' ? null : f.annualIncome }); setUser(d.user); setToast('Profile updated.'); } catch (x) { flash('save', x.message); }
  }
  async function changePw(e) {
    e.preventDefault(); flash('pw', '');
    try { await api.put('/auth/me/password', pw); setPw({ currentPassword: '', newPassword: '' }); setToast('Password updated. Other devices were signed out.'); } catch (x) { flash('pw', x.message); }
  }
  async function toggleMfa() {
    flash('mfa', '');
    try { await api.put('/auth/me/mfa', { enabled: !user.mfaEnabled, password: mfaPw }); setUser({ ...user, mfaEnabled: !user.mfaEnabled }); setMfaPw(''); setToast(`Two-step sign-in ${!user.mfaEnabled ? 'enabled' : 'disabled'}.`); } catch (x) { flash('mfa', x.message); }
  }

  return (
    <>
      <PageHeader title="Profile & settings" help="Profile and settings" />
      <form className="card" onSubmit={save} aria-labelledby="p1">
        <h2 id="p1">Profile</h2>
        <div className="form-grid">
          <Field label="Name">{(p) => <input {...p} required value={f.name} onChange={set('name')} />}</Field>
          <Field label="Email">{(p) => <input {...p} value={user.email} disabled />}</Field>
          <Field label="Phone / contact">{(p) => <input {...p} value={f.phone} onChange={set('phone')} />}</Field>
          <Field label="Currency">{(p) => <select {...p} value={f.currency} onChange={set('currency')}>{['INR', 'USD', 'EUR', 'GBP'].map((c) => <option key={c}>{c}</option>)}</select>}</Field>
          <Field label="Annual income" hint="Used for tax guidance. Optional.">{(p) => <input {...p} type="number" min="0" value={f.annualIncome} onChange={set('annualIncome')} />}</Field>
          <Field label="Opening balance" hint="Savings you had before you started tracking — included in net worth.">{(p) => <input {...p} type="number" value={f.openingBalance} onChange={set('openingBalance')} />}</Field>
          <Field label="Investment risk comfort">{(p) => <select {...p} value={f.riskTolerance} onChange={set('riskTolerance')}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>}</Field>
          <Field label="Tax region">{(p) => <select {...p} value={f.taxRegion} onChange={set('taxRegion')}><option value="IN">India</option><option value="US">United States</option></select>}</Field>
        </div>
        <h3>Notifications</h3>
        <label className="check"><input type="checkbox" checked={f.notifyInApp} onChange={set('notifyInApp')} /> In-app notifications</label>
        <label className="check"><input type="checkbox" checked={f.notifyEmail} onChange={set('notifyEmail')} /> Email notifications</label>
        <Field label="Remind me about bills this many days before they're due">{(p) => <input {...p} type="number" min="0" max="30" value={f.billLeadDays} onChange={set('billLeadDays')} />}</Field>
        <Alert>{msg.save}</Alert>
        <button className="btn primary">Save changes</button>
      </form>

      <div className="grid-2">
        <form className="card" onSubmit={changePw} aria-labelledby="p2">
          <h2 id="p2">Change password</h2>
          <Field label="Current password">{(p) => <input {...p} type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>
          <Field label="New password" hint="At least 10 characters, with letters and a number.">{(p) => <input {...p} type="password" autoComplete="new-password" required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}</Field>
          <Alert>{msg.pw}</Alert>
          <button className="btn">Update password</button>
        </form>

        <section className="card" aria-labelledby="p3">
          <h2 id="p3">Two-step sign-in</h2>
          <p>{user.mfaEnabled ? 'Enabled — we email you a code each time you sign in.' : 'Add an extra layer of protection: we will email you a one-time code when you sign in.'}</p>
          <Field label="Confirm your password">{(p) => <input {...p} type="password" autoComplete="current-password" value={mfaPw} onChange={(e) => setMfaPw(e.target.value)} />}</Field>
          <Alert>{msg.mfa}</Alert>
          <button className="btn" onClick={toggleMfa} disabled={!mfaPw}>{user.mfaEnabled ? 'Turn off' : 'Turn on'}</button>
        </section>
      </div>

      <section className="card" aria-labelledby="p4">
        <h2 id="p4">Your data</h2>
        <p>Download everything we hold about you (profile, categories and transactions) as a JSON file, or permanently delete your account.</p>
        <button className="btn" onClick={() => api.download('/auth/me/export', 'my-finance-data.json').catch((e) => setToast(e.message))}>Download my data</button>{' '}
        <button className="btn danger" onClick={() => setDel(true)}>Delete my account…</button>
      </section>

      {del && (
        <ConfirmDelete
          title="Delete your account" confirmLabel="Delete account permanently"
          body="This permanently erases your account and ALL associated data: transactions, budgets, goals, bills and notifications. It cannot be undone."
          extra={<Field label="Your password">{(p) => <input {...p} type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />}</Field>}
          onClose={() => setDel(false)}
          onConfirm={async (c) => { await api.post('/auth/me/delete', { password: delPw, confirm: c }); await signOut(); }}
        />
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </>
  );
}
