import { getMessaging, getToken } from 'firebase/messaging';
import { ref, serverTimestamp, set } from 'firebase/database';
import { app, requireDb } from './firebase';

export async function requestPushPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  // Keep this call directly within the submit/click gesture so browsers can show the prompt.
  return Notification.requestPermission();
}

export async function registerPushDevice(uid: string) {
  if (!app || Notification.permission !== 'granted') throw new Error('Разрешите уведомления в браузере.');
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!vapidKey) throw new Error('Push пока не настроен: отсутствует публичный VAPID-ключ Firebase.');
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
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
