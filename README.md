# Personal Finance & Expense Budgeting Assistant — Release 1.0

A web application (responsive, works on desktop and mobile browsers) implementing the SRS dated 4 Aug 2026:
secure sign-up with OTP, dashboard, expense tracking & budgeting, insights, goals & investment ideas,
bill reminders, tax guidance, receipt scanning (OCR), reports/exports, help, and an admin console.

## Stack

| Layer | Choice |
|---|---|
| API | Node.js ≥ 22.13 · Express 5 · built-in `node:sqlite` (no native build step) |
| Auth | bcrypt (cost 12) · JWT bound to a server-side session (revocable, idle timeout) · e-mail OTP · optional 2-step sign-in |
| Data protection | AES-256-GCM field encryption (amounts, notes, goals, bills, income) · helmet · rate limiting |
| Web client | React 19 · React Router · Chart.js (accessible, with data tables) · plain CSS (light/dark, responsive) |
| OCR | tesseract.js (receipts are processed in memory, never stored) |
| E-mail | nodemailer over SMTP (dev fallback: console + `outbox` table) |
| PDF | pdfkit |

## Quick start

```bash
cd finance-assistant
npm run setup      # installs server + client dependencies
npm run build      # builds the web client into client/dist
npm run seed       # optional: demo user + admin with 12 months of data
npm start          # http://localhost:4000  (API + built client on one origin)
```

Seeded accounts (change/remove before real use):

* Demo user — `demo@example.com` / `DemoPass1234`
* Administrator — `admin@example.com` / `AdminPass1234`

For development with hot reload run `npm run dev:server` and `npm run dev:client` (Vite on :5173 proxies `/api`).
Run the test-suite with `npm test` (26 tests: auth, encryption at rest, budgets, bills, CSV, reports, admin, …).

### E-mail in development
With no `SMTP_HOST` configured the app is still fully usable: verification codes and reset links are shown
in the UI ("dev mode" banner) and printed in the server console. In production configure SMTP (see `server/.env.example`);
codes are then never returned by the API.

## Requirement coverage

| SRS item | Where |
|---|---|
| FR-AUTH-001…006 register, OTP, login, reset by e-mail, logout, profile | `server/src/routes/auth.js`, `client/src/pages/AuthPages.jsx`, `Profile.jsx` |
| FR-DASH-001…004 summary, progress bars, upcoming bills, quick links | `routes/dashboard.js`, `Dashboard.jsx` |
| FR-TRACK-001…005 log/edit/delete, filters, **CSV import**, categories | `routes/transactions.js`, `routes/categories.js`, `Transactions.jsx`, `Budgets.jsx` |
| FR-BUDG-001…003 budgets, real-time alerts (80 % / 100 %), adjust/disable | `routes/budgets.js`, `services.js#checkBudgetAlerts` |
| FR-INSIGHT-001…005 12-month analysis, savings suggestions, pie, trends, CSV/PDF | `recommendations.js`, `routes/insights.js`, `routes/reports.js`, `Insights.jsx` |
| FR-INV-001…004 goals, progress, investment ideas by risk × horizon, est. returns + disclaimer | `routes/goals.js`, `recommendations.js`, `Goals.jsx` |
| FR-BILL-001…003 bills, in-app + e-mail reminders, preferences | `routes/bills.js`, `scheduler.js`, `Bills.jsx`, `Profile.jsx` |
| FR-TAX-001/002 tax guidance + disclaimer | `routes/tax.js`, `Tax.jsx` |
| FR-SCAN-001…003 upload, OCR, review before saving | `ocr.js`, `routes/receipts.js`, `Transactions.jsx` |
| NFR-PERF | Indexed queries, small payloads, code-split charts; not load-tested — see deployment notes for the 10,000-user target |
| NFR-SAF-001 disclaimers | shown on every investment/tax screen and returned by the API |
| NFR-SAF-002 neutral language | all alerts/insights are suggestion-style; a test guards against alarming words |
| NFR-SAF-003 typed `DELETE` | bulk transaction delete, account delete, admin user delete |
| NFR-SAF-004 fail-safe bills | overdue / due-soon bills are always flagged on the dashboard, independent of e-mail delivery |
| NFR-SEC-001 bcrypt · -002 encrypted at rest · -003 TLS · -004 idle timeout · -005 security log · -006 optional MFA | `auth.js`, `crypto.js`, `security.js`, admin “Security log” |
| CO-1/CO-5, BR-004 | encryption, data export (`/api/auth/me/export`), permanent account deletion |
| BR-001 | recommendations are phrased as suggestions with a visible rationale |
| BR-003 | no card numbers are ever stored (payment method is just a label) |
| DR-001/DR-002 | normalised schema, foreign keys, automatic daily backup + manual backup in Admin |
| OE-2, UI-1…6 | responsive layout, labelled forms with inline errors, charts + tables, **Help link on every page**, full keyboard use, skip link, ARIA |
| UD-1…3 | searchable Help page, contextual tooltips/help links, onboarding tour |
| SI-1/SI-2, CI-1…3 | SMTP with graceful failure handling, CSV/PDF/JPG/PNG handling, HTTPS support |
| Admin role (§2.3) | `routes/admin.js` — manage accounts, stats, security log, backups (no access to financial data) |

## Deployment notes

* **HTTPS (CI-1/NFR-SEC-003):** run behind a TLS-terminating reverse proxy (Nginx/Caddy) and set
  `TRUST_PROXY=true`, `FORCE_HTTPS=true`, `NODE_ENV=production`; or pass `TLS_KEY_FILE`/`TLS_CERT_FILE` to Node.
* **Keys:** `server/data/.enc-key` and `.jwt-secret` are generated on first run. Keep them in a secret manager and
  back them up *separately* from database backups — encrypted fields cannot be recovered without the key.
* **Database:** SQLite fits a single node (hundreds of concurrent users). For the 10,000-concurrent-user target
  (NFR-PERF-003/CO-3) put several stateless API instances behind a load balancer and move to PostgreSQL —
  all SQL is isolated in `routes/*` and `services.js`; sessions are already server-side rows.
* **Compliance:** the app stores no card data (BR-003), supports export + deletion (GDPR/CCPA), and logs security events.
  Investment/tax content is rule-based general information (TBD-004) — not advice.

## Known scope limits (from the SRS)

Bank-API integration (TBD-001), subscription tiers (TBD-002) and native iOS/Android apps are out of Release 1.0;
the responsive web app covers OE-2. Push notifications are delivered as in-app + e-mail.
