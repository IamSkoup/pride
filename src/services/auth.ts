import { createUserWithEmailAndPassword, deleteUser, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { get, ref, runTransaction, set, update } from 'firebase/database';
import { requireAuth, requireDb } from './firebase';
import type { Profile } from '../types';

export const normalizeUsername = (value: string) => value.trim().replace(/^@/, '').toLowerCase();
export const validUsername = (value: string) => /^[a-z0-9_]{3,24}$/.test(normalizeUsername(value));
export function explainAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  const map: Record<string, string> = {
    'auth/email-already-in-use': 'Этот email уже зарегистрирован.',
    'auth/invalid-email': 'Проверьте адрес email.',
    'auth/weak-password': 'Пароль должен содержать не менее 6 символов.',
    'auth/invalid-credential': 'Неверный логин или пароль.',
    'auth/too-many-requests': 'Слишком много попыток. Попробуйте позже.',
    'auth/network-request-failed': 'Нет соединения. Проверьте интернет.',
    'PERMISSION_DENIED': 'Доступ отклонён правилами Firebase. Проверьте настройки проекта.'
  };
  return map[code || ''] || (error instanceof Error ? error.message : 'Неизвестная ошибка');
}
export async function register(email: string, password: string, displayName: string, usernameInput: string) {
  const username = normalizeUsername(usernameInput);
  if (!validUsername(username)) throw new Error('Username: 3–24 символа, латинские буквы, цифры и _.');
  if (!displayName.trim() || displayName.trim().length > 48) throw new Error('Имя должно содержать от 1 до 48 символов.');
  const database = requireDb();
  const credentials = await createUserWithEmailAndPassword(requireAuth(), email.trim(), password);
  const uid = credentials.user.uid;
  let claimed = false;
  try {
    const claim = await runTransaction(ref(database, `usernames/${username}`), current => current === null ? { uid } : undefined, { applyLocally: false });
    if (!claim.committed) throw new Error('Этот username уже занят.');
    claimed = true;
    const profile: Profile = { uid, username, displayName: displayName.trim(), bio: '', createdAt: Date.now() };
    await updateProfile(credentials.user, { displayName: profile.displayName });
    await update(ref(database), {
      [`users/${uid}`]: profile,
      [`userPrivate/${uid}/email`]: credentials.user.email,
      [`userSettings/${uid}/theme`]: 'dark'
    });
    return profile;
  } catch (error) {
    if (claimed) await set(ref(database, `usernames/${username}`), null).catch(() => {});
    await deleteUser(credentials.user).catch(() => {});
    throw error;
  }
}
export async function login(identifier: string, password: string) {
  let email = identifier.trim();
  if (!email.includes('@') || email.startsWith('@')) {
    const url = import.meta.env.VITE_WORKER_URL;
    if (!url) throw new Error('Вход по username требует настроенный Cloudflare Worker (VITE_WORKER_URL).');
    const response = await fetch(`${url.replace(/\/$/, '')}/api/auth/resolve-username`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: normalizeUsername(identifier), password }) });
    if (!response.ok) throw new Error('Неверный логин или пароль.');
    const payload: { email: string } = await response.json();
    email = payload.email;
  }
  await signInWithEmailAndPassword(requireAuth(), email, password);
}
export async function resetPassword(email: string) { await sendPasswordResetEmail(requireAuth(), email.trim()); }
export async function logout() { await signOut(requireAuth()); }
export async function usernameAvailable(usernameInput: string) {
  const username = normalizeUsername(usernameInput);
  if (!validUsername(username)) return false;
  if (requireAuth().currentUser) return !(await get(ref(requireDb(), `usernames/${username}`))).exists();
  const base = import.meta.env.VITE_WORKER_URL;
  if (!base) throw new Error('Cloudflare Worker не настроен.');
  const response = await fetch(`${base.replace(/\/$/, '')}/api/auth/check-username`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || `Не удалось проверить username (HTTP ${response.status}).`);
  }
  return ((await response.json()) as { available: boolean }).available;
}
export async function updateMyProfile(uid: string, before: Profile, changes: Partial<Pick<Profile, 'displayName' | 'bio' | 'avatar' | 'cover' | 'mood' | 'roar' | 'roarUntil' | 'username'>>) {
  const database = requireDb();
  const next = { ...changes };
  if (next.username) next.username = normalizeUsername(next.username);
  if (next.username && next.username !== before.username) {
    if (!validUsername(next.username)) throw new Error('Недопустимый username.');
    const claim = await runTransaction(ref(database, `usernames/${next.username}`), current => current === null ? { uid } : undefined, { applyLocally: false });
    if (!claim.committed) throw new Error('Этот username уже занят.');
    try {
      const changes: Record<string, string | number | null> = { [`usernames/${before.username}`]: null };
      for (const [field, value] of Object.entries(next)) if (value !== undefined) changes[`users/${uid}/${field}`] = value;
      await update(ref(database), changes);
    } catch (error) {
      await set(ref(database, `usernames/${next.username}`), null).catch(() => {});
      throw error;
    }
  } else {
    await update(ref(database, `users/${uid}`), next);
  }
}
export async function findUser(usernameInput: string): Promise<Profile | null> {
  const username = normalizeUsername(usernameInput);
  if (!validUsername(username)) return null;
  const usernameSnap = await get(ref(requireDb(), `usernames/${username}`));
  const uid = usernameSnap.val()?.uid as string | undefined;
  if (!uid) return null;
  return (await get(ref(requireDb(), `users/${uid}`))).val() as Profile | null;
}
