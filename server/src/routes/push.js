import { Router } from 'express';
import { db } from '../db.js';
import { bad, str } from '../http.js';
import { publicKey, sendPush, subscriptionCount, validEndpoint } from '../push.js';

const r = Router();

r.get('/key', (_req, res) => res.json({ publicKey: publicKey() }));

// Registers this browser for push notifications and turns the preference on.
r.post('/subscribe', (req, res) => {
  const endpoint = str(req.body.endpoint, 'endpoint', { max: 1000 });
  const p256dh = str(req.body.keys?.p256dh, 'p256dh key', { max: 200 });
  const auth = str(req.body.keys?.auth, 'auth key', { max: 100 });
  if (!validEndpoint(endpoint)) throw bad('That push service is not supported');
  db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth')
    .run(req.user.id, endpoint, p256dh, auth);
  db.prepare('UPDATE users SET notify_push = 1 WHERE id = ?').run(req.user.id);
  res.status(201).json({ subscribed: true, devices: subscriptionCount(req.user.id) });
});

r.post('/unsubscribe', (req, res) => {
  if (req.body.endpoint) db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.user.id, String(req.body.endpoint));
  else db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(req.user.id);
  const left = subscriptionCount(req.user.id);
  if (!left) db.prepare('UPDATE users SET notify_push = 0 WHERE id = ?').run(req.user.id);
  res.json({ subscribed: left > 0, devices: left });
});

r.get('/status', (req, res) => res.json({ devices: subscriptionCount(req.user.id), enabled: !!req.user.notify_push }));

r.post('/test', async (req, res) => {
  if (!subscriptionCount(req.user.id)) throw bad('No device is registered yet. Turn on push notifications first.');
  const sent = await sendPush(req.user.id, { title: 'Test notification', body: 'Push notifications are working on this device.', url: '/notifications', tag: 'test' });
  res.json({ sent });
});

export default r;
