import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './http.js';
import { requireAdmin, requireAuth } from './auth.js';
import authRoutes from './routes/auth.js';
import categoryRoutes from './routes/categories.js';
import txRoutes from './routes/transactions.js';
import budgetRoutes from './routes/budgets.js';
import dashboardRoutes from './routes/dashboard.js';
import insightRoutes from './routes/insights.js';
import goalRoutes from './routes/goals.js';
import billRoutes from './routes/bills.js';
import notificationRoutes from './routes/notifications.js';
import taxRoutes from './routes/tax.js';
import reportRoutes from './routes/reports.js';
import receiptRoutes from './routes/receipts.js';
import adminRoutes from './routes/admin.js';

export function createApp() {
  const app = express();
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);

  // CI-1 / NFR-SEC-003: behind a TLS-terminating proxy, refuse plain HTTP when FORCE_HTTPS=true.
  if (process.env.FORCE_HTTPS === 'true') {
    app.use((req, res, next) => (req.secure ? next() : res.redirect(308, `https://${req.headers.host}${req.originalUrl}`)));
  }
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"] } } }));
  app.use(cors({ origin: config.clientOrigin, credentials: false }));
  app.use(express.json({ limit: '1mb' }));

  const authLimit = Number(process.env.AUTH_RATE_LIMIT || 40);
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: authLimit, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please try again shortly.' } }));
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.API_RATE_LIMIT || 2000), standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please try again shortly.' } }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

  app.use('/api/auth', authRoutes);
  const secured = express.Router();
  secured.use(requireAuth);
  secured.use('/categories', categoryRoutes);
  secured.use('/transactions', txRoutes);
  secured.use('/budgets', budgetRoutes);
  secured.use('/dashboard', dashboardRoutes);
  secured.use('/insights', insightRoutes);
  secured.use('/goals', goalRoutes);
  secured.use('/bills', billRoutes);
  secured.use('/notifications', notificationRoutes);
  secured.use('/tax', taxRoutes);
  secured.use('/reports', reportRoutes);
  secured.use('/receipts', receiptRoutes);
  secured.use('/admin', requireAdmin, adminRoutes);
  app.use('/api', secured);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // Serve the built web client (single-origin production deployment)
  const dist = path.resolve(config.root, '..', 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err?.name === 'MulterError') return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large' : 'Upload failed' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err?.status === 400 && err?.message) return res.status(400).json({ error: err.message });
    console.error('[error]', err);
    res.status(500).json({ error: 'Something went wrong on our side. Your data is safe — please try again.' });
  });
  return app;
}
