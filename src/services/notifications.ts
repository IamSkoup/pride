import { getMessaging, getToken } from 'firebase/messaging';
import { ref, serverTimestamp, set } from 'firebase/database';
import { app, requireDb } from './firebase';

// Public Firebase Cloud Messaging Web Push certificate used for every build.
const PUBLIC_VAPID_KEY = 'BCp0FmDtn-KMiizil-7jPNckcgDgA1XKXHOZfTrYOD_LrtijcGw2GjrEnLK9OzWkmkrcsCprv04PrF7wEhHMxdE';

export async function requestPushPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  // Keep this call directly within the submit/click gesture so browsers can show the prompt.
  return Notification.requestPermission();
}

export async function registerPushDevice(uid: string) {
  if (!app || Notification.permission !== 'granted') throw new Error('Разрешите уведомления в браузере.');
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { vapidKey: PUBLIC_VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error('Firebase не выдал токен уведомлений. Проверьте настройки Cloud Messaging.');
  let id = localStorage.getItem('pride-device-id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('pride-device-id', id); }
  const ua = navigator.userAgent;
  const browser = ua.includes('Firefox') ? 'Firefox' : ua.includes('Edg') ? 'Edge' : ua.includes('Chrome') ? 'Chrome' : ua.includes('Safari') ? 'Safari' : 'Браузер';
  await set(ref(requireDb(), `devices/${uid}/${id}`), {
    name: `${navigator.platform || 'Устройство'} · ${browser}`,
    token,
    addedAt: serverTimestamp(),
  });
}
