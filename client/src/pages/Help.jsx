import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/ui.jsx';

// UD-1: integrated, searchable online help. Topic names match the HelpLink on each page.
const TOPICS = [
  { title: 'Dashboard', body: 'The dashboard shows income, expenses, savings and net worth for the current month, budget and goal progress bars, upcoming bills and your latest transactions. Past-due bills are highlighted at the top so they are never missed, even if an email fails to arrive. Net worth is your opening balance (set in Profile) plus all recorded income minus expenses.' },
  { title: 'Transactions', body: 'Choose "Add expense" or "Add income", enter an amount, date and category, and Save. Use the filters to narrow by date range, category, type, amount or note text. Import many transactions at once from a CSV (columns: date, type, amount, and optionally category, payment_method, notes, time). Scan a receipt to pre-fill an expense — you always review before saving. Selecting rows lets you delete several at once; you must type DELETE to confirm.' },
  { title: 'Budgets', body: 'A budget is a monthly limit for one expense category. You will receive a friendly check-in at 80% and a note when the budget is reached. You can adjust a limit, pause a budget or delete it at any time. Manage your own categories below the budgets — default categories cannot be removed.' },
  { title: 'Insights', body: 'Insights analyses up to 12 months of your spending. The doughnut chart shows the share of spending per category, the line chart shows income against expenses, and the bar chart shows net savings. Suggestions are ideas only; select "Why am I seeing this?" to see the data behind each one.' },
  { title: 'Goals and investing', body: 'Create a savings goal with a target and deadline, then add savings as you go. The investing section suggests options by risk comfort and time horizon with estimated, non-guaranteed return ranges. It is general information, not advice — this application is not a registered financial advisor.' },
  { title: 'Bills and reminders', body: 'Add a bill with an amount, due date and repeat schedule. We remind you in the app and by email a few days before the due date (adjust in Profile). Mark a bill as paid and repeating bills roll over to the next date automatically.' },
  { title: 'Tax planning', body: 'Shows common tax-saving instruments for your region and income, with limits. It is general guidance only and not personalised tax advice; rules change, so verify with official sources.' },
  { title: 'Reports and exports', body: 'Pick any date range to see totals, savings rate, spending by category and a month-by-month breakdown. Export the underlying transactions as CSV or a formatted PDF summary.' },
  { title: 'Notifications', body: 'Budget check-ins, bill reminders and other alerts appear here and in the bell icon. Mark them read or delete them. Choose in-app and/or email delivery under Profile.' },
  { title: 'Profile and settings', body: 'Update your name, contact details, currency, income (used for tax guidance), opening balance and notification preferences. Change your password, turn on two-step sign-in, download all your data, or permanently delete your account (password plus typing DELETE).' },
  { title: 'Signing in and security', body: 'New accounts verify their email with a one-time code. Passwords need at least 10 characters including letters and a number. After several failed sign-in attempts an account is locked briefly. For your protection you are signed out after 30 minutes of inactivity. Forgot your password? Use "Forgot password?" to receive a reset link.' },
  { title: 'Keyboard and accessibility', body: 'Everything can be used with the keyboard: Tab / Shift+Tab to move, Enter or Space to activate, Esc to close dialogs. A "Skip to main content" link appears when you first press Tab. Charts always have an accompanying data table.' },
];

export default function Help() {
  const [sp] = useSearchParams();
  const [q, setQ] = useState('');
  const topic = sp.get('topic');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? TOPICS.filter((t) => `${t.title} ${t.body}`.toLowerCase().includes(s)) : TOPICS;
  }, [q]);

  useEffect(() => {
    if (!topic) return;
    const el = document.getElementById(`topic-${slug(topic)}`) || document.getElementById(`topic-${slug(TOPICS.find((t) => t.title.toLowerCase().includes(topic.toLowerCase().split(' ')[0]))?.title || '')}`);
    el?.scrollIntoView({ block: 'start' });
    el?.querySelector('summary')?.focus();
  }, [topic]);

  return (
    <>
      <PageHeader title="Help" help="Signing in and security" />
      <div role="search" className="card">
        <label htmlFor="help-q">Search help</label>
        <input id="help-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. budget, receipt, password, export" />
        <p className="muted small" aria-live="polite">{list.length} topic(s)</p>
      </div>
      {list.map((t) => {
        const isOpen = topic && (t.title.toLowerCase() === topic.toLowerCase() || t.title.toLowerCase().includes(topic.toLowerCase().split(' ')[0]));
        return (
          <details key={t.title} id={`topic-${slug(t.title)}`} className="card help-topic" open={isOpen || !!q}>
            <summary><h2>{t.title}</h2></summary>
            <p>{t.body}</p>
          </details>
        );
      })}
      {list.length === 0 && <p className="empty">No help topics match "{q}".</p>}
      <p className="muted small">Disclaimer: This application provides general information and is not a registered financial advisor. See <Link to="/tax">Tax planning</Link> and <Link to="/goals">Goals &amp; Investing</Link> for details.</p>
    </>
  );
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
