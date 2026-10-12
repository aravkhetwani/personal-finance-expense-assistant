import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { Spinner } from './components/ui.jsx';
import Onboarding from './components/Onboarding.jsx';
import { Forgot, Login, Register, ResetPassword, Verify } from './pages/AuthPages.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import Budgets from './pages/Budgets.jsx';
const Insights = lazy(() => import('./pages/Insights.jsx'));
import Goals from './pages/Goals.jsx';
import Bills from './pages/Bills.jsx';
import Tax from './pages/Tax.jsx';
import Reports from './pages/Reports.jsx';
import Notifications from './pages/Notifications.jsx';
import Profile from './pages/Profile.jsx';
import Help from './pages/Help.jsx';
import Admin from './pages/Admin.jsx';

const NAV = [
  ['/', 'Dashboard', true],
  ['/transactions', 'Transactions'],
  ['/budgets', 'Budgets'],
  ['/insights', 'Insights'],
  ['/goals', 'Goals & Investing'],
  ['/bills', 'Bills'],
  ['/tax', 'Tax planning'],
  ['/reports', 'Reports'],
];

function Layout() {
  const { user, signOut } = useAuth();
  const [unread, setUnread] = useState(0);
  const [menu, setMenu] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    let alive = true;
    const load = () => api.get('/notifications').then((d) => alive && setUnread(d.unread)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [loc.pathname]);

  useEffect(() => { setMenu(false); document.getElementById('main')?.focus({ preventScroll: true }); }, [loc.pathname]);

  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="topbar">
        <div className="brand"><span className="logo" aria-hidden="true">₹</span> Finance Assistant</div>
        <button className="menu-btn" aria-expanded={menu} aria-controls="sidenav" onClick={() => setMenu((m) => !m)}>
          {menu ? 'Close menu' : 'Menu'}
        </button>
        <div className="top-actions">
          <NavLink to="/notifications" className="bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
            <span aria-hidden="true">🔔</span>{unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
          </NavLink>
          <NavLink to="/profile" className="user-link">{user.name || user.email}</NavLink>
          <button className="btn small" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <div className="shell">
        <nav id="sidenav" className={`sidenav ${menu ? 'open' : ''}`} aria-label="Main">
          <ul>
            {NAV.map(([to, label, end]) => (
              <li key={to}><NavLink to={to} end={end}>{label}</NavLink></li>
            ))}
            <li className="nav-sep" aria-hidden="true" />
            <li><NavLink to="/help">Help</NavLink></li>
            {user.role === 'admin' && <li><NavLink to="/admin">Administration</NavLink></li>}
          </ul>
        </nav>
        <main id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      {!user.onboarded && <Onboarding />}
    </>
  );
}

function Protected() {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Spinner label="Loading your account…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <Layout />;
}

function Public({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <Spinner />;
  return user ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Public><Login /></Public>} />
      <Route path="/register" element={<Public><Register /></Public>} />
      <Route path="/verify" element={<Public><Verify /></Public>} />
      <Route path="/forgot-password" element={<Public><Forgot /></Public>} />
      <Route path="/reset-password" element={<Public><ResetPassword /></Public>} />
      <Route element={<Protected />}>
        <Route index element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/budgets" element={<Budgets />} />
        <Route path="/insights" element={<Suspense fallback={<Spinner />}><Insights /></Suspense>} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/bills" element={<Bills />} />
        <Route path="/tax" element={<Tax />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/help" element={<Help />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
