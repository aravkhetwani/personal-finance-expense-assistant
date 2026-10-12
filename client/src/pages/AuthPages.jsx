import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Field, HelpLink } from '../components/ui.jsx';

function Shell({ title, children, footer }) {
  const { notice, clearNotice } = useAuth();
  useEffect(() => clearNotice, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <main className="auth-wrap" id="main">
      <div className="auth-card">
        <div className="brand big"><span className="logo" aria-hidden="true">₹</span> Finance Assistant</div>
        <h1>{title}</h1>
        {notice && <Alert kind="info">{notice}</Alert>}
        {children}
        <div className="auth-foot">{footer}<HelpLink topic="Signing in and security" /></div>
      </div>
    </main>
  );
}

const PASSWORD_HINT = 'At least 10 characters, with letters and a number.';

export function Login() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [f, setF] = useState({ email: '', password: '' });
  const [mfa, setMfa] = useState(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const done = (d) => { signIn(d.token, d.user); nav(loc.state?.from || '/', { replace: true }); };

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      if (mfa) done(await api.post('/auth/login/mfa', { mfaToken: mfa.mfaToken, code }));
      else {
        const d = await api.post('/auth/login', f);
        if (d.mfaRequired) setMfa(d); else done(d);
      }
    } catch (x) {
      if (x.data?.needsVerification) return nav('/verify', { state: { email: f.email, devCode: x.data.devCode } });
      setErr(x.message);
    } finally { setBusy(false); }
  }
  return (
    <Shell title={mfa ? 'Enter your verification code' : 'Sign in'} footer={<><Link to="/register">Create account</Link> · <Link to="/forgot-password">Forgot password?</Link> </>}>
      <form onSubmit={submit} noValidate>
        {!mfa ? (
          <>
            <Field label="Email">{(p) => <input {...p} type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
            <Field label="Password">{(p) => <input {...p} type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
          </>
        ) : (
          <>
            <p>We sent a 6-digit code to your email to finish signing in.</p>
            {mfa.devCode && <Alert kind="info">Dev mode (no email server): your code is <strong>{mfa.devCode}</strong></Alert>}
            <Field label="Verification code">{(p) => <input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          </>
        )}
        <Alert>{err}</Alert>
        <button className="btn primary block" disabled={busy}>{busy ? 'Please wait…' : mfa ? 'Verify' : 'Sign in'}</button>
      </form>
    </Shell>
  );
}

export function Register() {
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const d = await api.post('/auth/register', f);
      nav('/verify', { state: { email: d.email, devCode: d.devCode } });
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <Shell title="Create your account" footer={<>Already registered? <Link to="/login">Sign in</Link> </>}>
      <form onSubmit={submit} noValidate>
        <Field label="Full name">{(p) => <input {...p} autoComplete="name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Email">{(p) => <input {...p} type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Password" hint={PASSWORD_HINT}>{(p) => <input {...p} type="password" autoComplete="new-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
        <Alert>{err}</Alert>
        <button className="btn primary block" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <p className="muted small">By continuing you agree that this tool offers general information and is not a registered financial advisor.</p>
      </form>
    </Shell>
  );
}

export function Verify() {
  const { signIn } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const email = loc.state?.email || '';
  const [e2, setE2] = useState(email);
  const [code, setCode] = useState('');
  const [dev, setDev] = useState(loc.state?.devCode || '');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  async function submit(e) {
    e.preventDefault(); setErr('');
    try { const d = await api.post('/auth/verify-otp', { email: e2, code }); signIn(d.token, d.user); nav('/', { replace: true }); } catch (x) { setErr(x.message); }
  }
  async function resend() {
    setErr('');
    try { const d = await api.post('/auth/resend-otp', { email: e2 }); setInfo(d.message); if (d.devCode) setDev(d.devCode); } catch (x) { setErr(x.message); }
  }
  return (
    <Shell title="Verify your email" footer={<Link to="/login">Back to sign in</Link>}>
      <form onSubmit={submit} noValidate>
        <p>Enter the 6-digit code we sent{email ? <> to <strong>{email}</strong></> : ''}. It expires in 10 minutes.</p>
        {dev && <Alert kind="info">Dev mode (no email server configured): your code is <strong>{dev}</strong></Alert>}
        {!email && <Field label="Email">{(p) => <input {...p} type="email" value={e2} onChange={(e) => setE2(e.target.value)} />}</Field>}
        <Field label="Verification code">{(p) => <input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
        <Alert>{err}</Alert><Alert kind="info">{info}</Alert>
        <button className="btn primary block">Verify and continue</button>
        <button type="button" className="btn link" onClick={resend}>Send a new code</button>
      </form>
    </Shell>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [dev, setDev] = useState('');
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault(); setErr('');
    try { const d = await api.post('/auth/forgot-password', { email }); setMsg(d.message); if (d.devToken) setDev(d.devToken); } catch (x) { setErr(x.message); }
  }
  return (
    <Shell title="Reset your password" footer={<Link to="/login">Back to sign in</Link>}>
      <form onSubmit={submit} noValidate>
        <p>Enter your email and we'll send a link to choose a new password.</p>
        <Field label="Email">{(p) => <input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Alert>{err}</Alert><Alert kind="success">{msg}</Alert>
        {dev && <Alert kind="info">Dev mode: <Link to={`/reset-password?token=${dev}`}>open the reset link</Link></Alert>}
        <button className="btn primary block">Send reset link</button>
      </form>
    </Shell>
  );
}

export function ResetPassword() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  async function submit(e) {
    e.preventDefault(); setErr('');
    try { const d = await api.post('/auth/reset-password', { token: sp.get('token'), password: pw }); setOk(d.message); setTimeout(() => nav('/login'), 1500); } catch (x) { setErr(x.message); }
  }
  return (
    <Shell title="Choose a new password" footer={<Link to="/login">Back to sign in</Link>}>
      <form onSubmit={submit} noValidate>
        <Field label="New password" hint={PASSWORD_HINT}>{(p) => <input {...p} type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
        <Alert>{err}</Alert><Alert kind="success">{ok}</Alert>
        <button className="btn primary block">Update password</button>
      </form>
    </Shell>
  );
}
