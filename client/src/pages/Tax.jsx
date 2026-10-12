import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Disclaimer, Field, PageHeader, Spinner, useLoad } from '../components/ui.jsx';
import { money } from '../util.js';

export default function Tax() {
  const { user } = useAuth();
  const [region, setRegion] = useState(user.taxRegion);
  const [income, setIncome] = useState('');
  const [applied, setApplied] = useState('');
  const { data, error, loading } = useLoad(() => api.get(`/tax?region=${region}${applied ? `&income=${applied}` : ''}`), [region, applied]);
  const src = { profile: 'your profile', transactions: 'your last 12 months of recorded income', entered: 'the amount you entered' };
  return (
    <>
      <PageHeader title="Tax planning" help="Tax planning" />
      <Disclaimer>{data?.disclaimer || 'General guidance only — not personalised tax advice. This application is not a registered financial advisor.'}</Disclaimer>
      <form className="card filters" onSubmit={(e) => { e.preventDefault(); setApplied(income); }}>
        <Field label="Tax region">{(p) => <select {...p} value={region} onChange={(e) => setRegion(e.target.value)}><option value="IN">India</option><option value="US">United States</option></select>}</Field>
        <Field label="Annual income (optional)" hint="Leave blank to use your profile or recorded income.">{(p) => <input {...p} type="number" min="0" value={income} onChange={(e) => setIncome(e.target.value)} />}</Field>
        <button className="btn">Update</button>
      </form>
      <Alert>{error}</Alert>
      {loading && !data ? <Spinner /> : data && (
        <>
          <p>Based on an annual income of <strong>{money(data.annualIncome, user.currency)}</strong> (from {src[data.incomeSource]}).</p>
          {data.notes.map((n) => <p key={n} className="muted">ℹ️ {n}</p>)}
          <div className="grid-2">
            {data.instruments.map((i) => (
              <article key={i.name} className="card inner">
                <h2 className="h3">{i.name}</h2>
                <p><span className="pill">{i.section}</span> <strong>Limit:</strong> {i.limit}</p>
                <p className="muted">{i.why}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}
