import { useEffect, useId, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';

// UI-5: every page has a contextual Help link.
export function HelpLink({ topic }) {
  return (
    <Link className="help-link" to={`/help?topic=${encodeURIComponent(topic)}`} aria-label={`Help for this page: ${topic}`}>
      <span aria-hidden="true">?</span> Help
    </Link>
  );
}

// UD-2: contextual tooltip (also available on keyboard focus).
export function Tip({ text }) {
  const id = useId();
  return (
    <span className="tip">
      <button type="button" className="tip-btn" aria-describedby={id} aria-label="More information">i</button>
      <span role="tooltip" id={id} className="tip-text">{text}</span>
    </span>
  );
}

export function PageHeader({ title, help, children }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      <div className="page-actions">
        {children}
        <HelpLink topic={help || title} />
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, id: given }) {
  const gen = useId();
  const id = given || gen;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {typeof children === 'function' ? children({ id, 'aria-describedby': hint || error ? `${id}-d` : undefined, 'aria-invalid': error ? true : undefined }) : children}
      {(hint || error) && <p id={`${id}-d`} className={error ? 'field-error' : 'field-hint'}>{error || hint}</p>}
    </div>
  );
}

export function Alert({ kind = 'error', children }) {
  if (!children) return null;
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`alert ${kind}`}>{children}</div>;
}

export function Disclaimer({ children }) {
  return (
    <aside className="disclaimer" role="note" aria-label="Important disclaimer">
      <strong>Not financial advice. </strong>{children}
    </aside>
  );
}

export function Progress({ percent, label, tone }) {
  const p = Math.max(0, Math.min(100, percent));
  const t = tone || (percent >= 100 ? 'over' : percent >= 80 ? 'near' : 'ok');
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label}>
      <div className={`progress-bar ${t}`} style={{ width: `${p}%` }} />
    </div>
  );
}

export function Empty({ children }) {
  return <p className="empty">{children}</p>;
}

export function Spinner({ label = 'Loading…' }) {
  return <p className="loading" role="status">{label}</p>;
}

// Accessible modal: focus is trapped, Esc closes, focus returns to the opener.
export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const focusables = () => el.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
    (focusables()[0] || el).focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const f = [...focusables()];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// NFR-SAF-003: destructive actions require typing DELETE.
export function ConfirmDelete({ title, body, confirmLabel = 'Delete permanently', onConfirm, onClose, extra }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await onConfirm(text); } catch (x) { setErr(x.message); setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={go}>
        <p>{body}</p>
        {extra}
        <Field label='Type "DELETE" to confirm'>{(p) => <input {...p} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />}</Field>
        <Alert>{err}</Alert>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn danger" disabled={text !== 'DELETE' || busy}>{busy ? 'Deleting…' : confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

// Small data-loading hook with reload.
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const run = useCallback(async () => {
    try {
      const data = await fn();
      setState({ data, error: '', loading: false });
    } catch (e) {
      setState((s) => ({ ...s, error: e.message, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export function Toast({ message, onDone }) {
  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [message, onDone]);
  return <div className="toast-region" role="status" aria-live="polite">{message && <div className="toast">{message}</div>}</div>;
}
