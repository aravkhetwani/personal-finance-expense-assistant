import { api } from './api.js';

export const pushSupported = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyToBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function registerWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  return reg ? reg.pushManager.getSubscription() : null;
}

// Asks the browser for permission, subscribes this device and tells the server.
export async function enablePush() {
  if (!pushSupported()) throw new Error('This browser does not support push notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in the browser settings and try again.');
  await registerWorker();
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.get('/push/key');
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
  await api.post('/push/subscribe', sub.toJSON());
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (sub) {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } else {
    await api.post('/push/unsubscribe', {}).catch(() => {});
  }
}
