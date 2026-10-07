import { get, onDisconnect, push, ref, serverTimestamp, set, update } from 'firebase/database';
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { requireDb, requireStorage, requireAuth } from './firebase';
import type { Chat, ChatKind, Media, Message, Profile, Role } from '../types';

const clean = (text: string, max: number) => text.trim().slice(0, max);
const safeName = (name: string) => name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 120);
export function dmId(a: string, b: string) { return `dm_${[a, b].sort().join('_')}`; }
export async function startDirectChat(me: string, other: Profile): Promise<string> {
  if (me === other.uid) throw new Error('Нельзя начать чат с собой.');
  const response = await apiFetch('/api/chats/direct', { method: 'POST', body: JSON.stringify({ otherUid: other.uid }) });
  if (!response.ok) throw new Error('Не удалось открыть личный чат.');
  return ((await response.json()) as { chatId: string }).chatId;
}
export async function createSpace(me: string, kind: Exclude<ChatKind, 'dm'>, title: string, description: string, isPublic: boolean, people: Profile[]): Promise<string> {
  const database = requireDb();
  const id = push(ref(database, 'chats')).key!;
  const inviteCode = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const chat: Chat = { id, kind, title: clean(title, 64), description: clean(description, 280), creatorId: me, public: isPublic, inviteCode, createdAt: Date.now(), updatedAt: Date.now() };
  if (!chat.title) throw new Error('Введите название.');
  await set(ref(database, `chats/${id}`), chat);
  await set(ref(database, `chatMembers/${id}/${me}`), 'owner');
  await set(ref(database, `userChats/${me}/${id}`), true);
  if (isPublic) await set(ref(database, `publicSpaces/${id}`), { id, kind, title: chat.title, description: chat.description || '' });
  for (const person of people.filter(p => p.uid !== me)) await addMember(id, me, person.uid);
  return id;
}
export async function addMember(chatId: string, actorId: string, userId: string) {
  const database = requireDb();
  const role = (await get(ref(database, `chatMembers/${chatId}/${actorId}`))).val() as Role | null;
  if (role !== 'owner' && role !== 'admin') throw new Error('Недостаточно прав.');
  await set(ref(database, `chatMembers/${chatId}/${userId}`), 'member');
  await set(ref(database, `userChats/${userId}/${chatId}`), true);
}
export async function joinByInvite(chatId: string, code: string, uid: string) {
  if (!uid) throw new Error('Войдите в аккаунт.');
  const response = await apiFetch('/api/links/join', { method: 'POST', body: JSON.stringify({ chatId, code }) });
  if (!response.ok) throw new Error('Ссылка приглашения недействительна.');
}
export async function joinPublicSpace(chatId: string) {
  const response = await apiFetch('/api/links/join-public', { method: 'POST', body: JSON.stringify({ chatId }) });
  if (!response.ok) throw new Error('Не удалось вступить в пространство.');
}
export async function leaveChat(chatId: string, uid: string) {
  const database = requireDb();
  await set(ref(database, `userChats/${uid}/${chatId}`), null);
  await set(ref(database, `chatMembers/${chatId}/${uid}`), null);
}
export async function changeRole(chatId: string, actorId: string, targetId: string, role: Role) {
  const database = requireDb();
  const actor = (await get(ref(database, `chatMembers/${chatId}/${actorId}`))).val();
  if (actor !== 'owner' || targetId === actorId || role === 'owner') throw new Error('Только владелец может менять роли.');
  await set(ref(database, `chatMembers/${chatId}/${targetId}`), role);
}
export async function removeMember(chatId: string, actorId: string, targetId: string) {
  const database = requireDb();
  const actor = (await get(ref(database, `chatMembers/${chatId}/${actorId}`))).val();
  if (actor !== 'owner' || targetId === actorId) throw new Error('Только владелец может удалять участников.');
  await set(ref(database, `userChats/${targetId}/${chatId}`), null);
  await set(ref(database, `chatMembers/${chatId}/${targetId}`), null);
}
export async function sendMessage(chatId: string, senderId: string, text: string, media?: Media, replyTo?: string, forwardedFrom?: string, id?: string) {
  const database = requireDb();
  const messageId = id || push(ref(database, `messages/${chatId}`)).key!;
  const value: Record<string, unknown> = { id: messageId, chatId, senderId, text: clean(text, 8000), createdAt: serverTimestamp() };
  if (media) value.media = media;
  if (replyTo) value.replyTo = replyTo;
  if (forwardedFrom) value.forwardedFrom = forwardedFrom;
  if (!value.text && !media) throw new Error('Напишите сообщение или добавьте файл.');
  await set(ref(database, `messages/${chatId}/${messageId}`), value);
  await set(ref(database, `chatActivity/${chatId}`), { updatedAt: serverTimestamp(), lastText: media ? `Вложение · ${media.name}` : String(value.text).slice(0, 90), lastSenderId: senderId });
  apiFetch('/api/push/message', { method: 'POST', body: JSON.stringify({ chatId, messageId }) }).catch(() => {});
  return messageId;
}
export async function editMessage(chatId: string, messageId: string, text: string) {
  await update(ref(requireDb(), `messages/${chatId}/${messageId}`), { text: clean(text, 8000), editedAt: serverTimestamp() });
}
export async function deleteMessage(chatId: string, messageId: string, forEveryone: boolean, uid: string) {
  const database = requireDb();
  if (forEveryone) {
    const message = (await get(ref(database, `messages/${chatId}/${messageId}`))).val() as Message | null;
    if (message?.media?.url) {
      const response = await apiFetch('/api/media/delete', { method: 'POST', body: JSON.stringify({ chatId, messageId, path: message.media.url }) });
      if (!response.ok) throw new Error(await responseError(response, 'Не удалось удалить вложение из хранилища.'));
    }
    await update(ref(database, `messages/${chatId}/${messageId}`), { deleted: true, text: '', media: null });
  }
  else await set(ref(database, `hiddenMessages/${uid}/${chatId}/${messageId}`), true);
}
export async function reactToMessage(chatId: string, messageId: string, uid: string, emoji: string | null) {
  await set(ref(requireDb(), `reactions/${chatId}/${messageId}/${uid}`), emoji);
}
export async function markRead(chatId: string, uid: string) { await set(ref(requireDb(), `readReceipts/${chatId}/${uid}`), serverTimestamp()); }
export async function setTyping(chatId: string, uid: string, active: boolean) {
  await set(ref(requireDb(), `typing/${chatId}/${uid}`), active ? serverTimestamp() : null);
}
export async function setPresence(uid: string) {
  const database = requireDb();
  const statusRef = ref(database, `presence/${uid}`);
  await onDisconnect(statusRef).set({ online: false, lastSeen: serverTimestamp() });
  await set(statusRef, { online: true, lastSeen: serverTimestamp() });
}
export async function uploadAvatar(uid: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) throw new Error('Аватар: изображение до 5 МБ.');
  const fileRef = storageRef(requireStorage(), `users/${uid}/avatars/${crypto.randomUUID()}`);
  await uploadBytesResumable(fileRef, file, { contentType: file.type });
  return getDownloadURL(fileRef);
}
export async function uploadChatMedia(chatId: string, uid: string, file: File, onProgress?: (progress: number) => void): Promise<Media> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Файл не должен превышать 25 МБ.');
  const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'file';
  if (!uid) throw new Error('Войдите снова.');
  const base = import.meta.env.VITE_WORKER_URL;
  if (!base) throw new Error('Для файлов нужен Cloudflare Worker.');
  const token = await requireAuth().currentUser?.getIdToken();
  if (!token) throw new Error('Войдите снова.');
  const path = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base.replace(/\/$/, '')}/api/media?chatId=${encodeURIComponent(chatId)}&name=${encodeURIComponent(safeName(file.name))}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new Error('Сбой сети при загрузке файла. Проверьте соединение и повторите попытку.'));
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve((JSON.parse(xhr.responseText) as { path: string }).path); else { let reason = 'Не удалось загрузить файл.'; try { reason = JSON.parse(xhr.responseText).error || reason; } catch {} reject(new Error(reason)); } };
    xhr.send(file);
  });
  return { kind, name: safeName(file.name), url: path, size: file.size, mime: file.type || 'application/octet-stream' };
}
export async function apiFetch(path: string, options: RequestInit = {}) {
  const base = import.meta.env.VITE_WORKER_URL;
  if (!base) throw new Error('Cloudflare Worker не настроен.');
  const token = await requireAuth().currentUser?.getIdToken();
  if (!token) throw new Error('Войдите снова.');
  return fetch(`${base.replace(/\/$/, '')}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers } });
}
export async function mediaObjectUrl(path: string): Promise<string> {
  const base = import.meta.env.VITE_WORKER_URL;
  if (!base) throw new Error('Для просмотра вложений нужен Cloudflare Worker.');
  const token = await requireAuth().currentUser?.getIdToken();
  if (!token) throw new Error('Войдите снова.');
  const response = await fetch(`${base.replace(/\/$/, '')}/api/media?path=${encodeURIComponent(path)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(await responseError(response, 'Не удалось открыть файл.'));
  return URL.createObjectURL(await response.blob());
}
async function responseError(response: Response, fallback: string) { try { const payload = await response.json() as { error?: string }; return payload.error || fallback; } catch { return fallback; } }
export function messagePreview(message: Message) { return message.deleted ? 'Сообщение удалено' : message.media ? `Вложение · ${message.media.name}` : message.text; }
