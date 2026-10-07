type Env = {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_DATABASE_URL: string;
  FIREBASE_STORAGE_BUCKET: string;
  FIREBASE_WEB_API_KEY: string;
  FIREBASE_SERVICE_ACCOUNT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
  FRONTEND_ORIGIN: string;
  RATE_LIMIT: { get(key: string): Promise<string | null>; put(key: string, value: string, options: { expirationTtl: number }): Promise<void> };
};
type AuthUser = { uid: string; email?: string };
let cachedToken: { value: string; until: number } | null = null;
const encoder = new TextEncoder();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
function base64url(value: Uint8Array | string) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeServicePrivateKey(raw: string) {
  let value = raw.trim();
  try {
    const parsed = JSON.parse(value) as { private_key?: unknown } | string;
    if (typeof parsed === 'string') value = parsed;
    else if (typeof parsed.private_key === 'string') value = parsed.private_key;
  } catch { /* A raw PEM value is also accepted. */ }
  value = value.replace(/^['"]|['"]$/g, '').replace(/\\+r?\\n/g, '\n').replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\r\n?/g, '\n');
  const match = /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(value);
  if (!match) throw new Error('FIREBASE_PRIVATE_KEY must contain a PKCS#8 PEM key');
  const encoded = match[1].replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new Error('FIREBASE_PRIVATE_KEY has invalid PEM base64');
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function accessToken(env: Env) {
  if (cachedToken && cachedToken.until > Date.now() + 60000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const head = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: env.FIREBASE_SERVICE_ACCOUNT_EMAIL, scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/devstorage.read_write https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const key = await crypto.subtle.importKey('pkcs8', decodeServicePrivateKey(env.FIREBASE_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(`${head}.${claims}`)));
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${base64url(signature)}` }) });
  if (!response.ok) throw new Error(`OAuth ${response.status}`);
  const result = await response.json() as { access_token: string; expires_in: number };
  cachedToken = { value: result.access_token, until: Date.now() + result.expires_in * 1000 };
  return result.access_token;
}
async function dbRequest<T>(env: Env, path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = await accessToken(env);
  const response = await fetch(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/${path}.json`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`Database ${response.status}`);
  return response.json() as Promise<T>;
}
async function verifyUser(request: Request, env: Env): Promise<AuthUser | null> {
  const token = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '')?.[1];
  if (!token) return null;
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }) });
  if (!response.ok) return null;
  const user = ((await response.json()) as { users?: Array<{ localId: string; email?: string }> }).users?.[0];
  return user ? { uid: user.localId, email: user.email } : null;
}
async function limited(env: Env, request: Request, bucket: string, maximum: number, seconds: number) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const window = Math.floor(Date.now() / (seconds * 1000));
  const key = `rate:${bucket}:${ip}:${window}`;
  const count = Number(await env.RATE_LIMIT.get(key) || '0');
  if (count >= maximum) return true;
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: seconds + 60 });
  return false;
}
function safeId(value: unknown) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{5,150}$/.test(value); }
function safeUsername(value: unknown) { return typeof value === 'string' && /^[a-z0-9_]{3,24}$/.test(value); }
async function resolveUsername(request: Request, env: Env) {
  if (await limited(env, request, 'login', 10, 60)) return json({ error: 'Too many attempts' }, 429);
  const input = await request.json().catch(() => ({})) as { username?: string; password?: string };
  const username = input.username?.toLowerCase();
  if (!safeUsername(username) || !input.password || input.password.length > 256) return json({ error: 'Invalid credentials' }, 401);
  const claim = await dbRequest<{ uid: string } | null>(env, `usernames/${username}`);
  if (!claim?.uid) return json({ error: 'Invalid credentials' }, 401);
  const email = await dbRequest<string | null>(env, `userPrivate/${claim.uid}/email`);
  if (!email) return json({ error: 'Invalid credentials' }, 401);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: input.password, returnSecureToken: true }) });
  if (!response.ok) return json({ error: 'Invalid credentials' }, 401);
  const signedIn = await response.json() as { localId: string };
  if (signedIn.localId !== claim.uid) return json({ error: 'Invalid credentials' }, 401);
  return json({ email });
}
async function checkUsername(request: Request, env: Env) {
  if (await limited(env, request, 'check', 30, 60)) return json({ error: 'Too many attempts' }, 429);
  const input = await request.json().catch(() => ({})) as { username?: string };
  if (!safeUsername(input.username)) return json({ available: false });
  const claim = await dbRequest<{ uid: string } | null>(env, `usernames/${input.username}`);
  return json({ available: !claim });
}
async function join(request: Request, env: Env, user: AuthUser) {
  const input = await request.json().catch(() => ({})) as { chatId?: string; code?: string };
  if (!safeId(input.chatId) || typeof input.code !== 'string') return json({ error: 'Invalid invite' }, 400);
  const chat = await dbRequest<{ inviteCode?: string; kind?: string } | null>(env, `chats/${input.chatId}`);
  if (!chat || !chat.inviteCode || chat.inviteCode !== input.code || chat.kind === 'dm') return json({ error: 'Invalid invite' }, 404);
  if (!(await memberRole(env, input.chatId, user.uid))) await dbRequest(env, `chatMembers/${input.chatId}/${user.uid}`, 'PUT', 'member');
  await dbRequest(env, `userChats/${user.uid}/${input.chatId}`, 'PUT', true);
  return json({ chatId: input.chatId });
}
async function joinPublic(request: Request, env: Env, user: AuthUser) {
  const input = await request.json().catch(() => ({})) as { chatId?: string };
  if (!safeId(input.chatId)) return json({ error: 'Invalid space' }, 400);
  const chat = await dbRequest<{ public?: boolean; kind?: string } | null>(env, `chats/${input.chatId}`);
  if (!chat?.public || chat.kind === 'dm') return json({ error: 'Space not found' }, 404);
  if (!(await memberRole(env, input.chatId, user.uid))) await dbRequest(env, `chatMembers/${input.chatId}/${user.uid}`, 'PUT', 'member');
  await dbRequest(env, `userChats/${user.uid}/${input.chatId}`, 'PUT', true);
  return json({ chatId: input.chatId });
}
async function memberRole(env: Env, chatId: string, uid: string) { return dbRequest<string | null>(env, `chatMembers/${chatId}/${uid}`); }
async function createDirect(request: Request, env: Env, user: AuthUser) {
  if (await limited(env, request, `dm:${user.uid}`, 30, 3600)) return json({ error: 'Too many chats' }, 429);
  const input = await request.json().catch(() => ({})) as { otherUid?: string };
  if (!safeId(input.otherUid) || input.otherUid === user.uid) return json({ error: 'Invalid user' }, 400);
  const other = await dbRequest<{ uid: string } | null>(env, `users/${input.otherUid}`);
  if (!other || other.uid !== input.otherUid) return json({ error: 'User not found' }, 404);
  const chatId = `dm_${[user.uid, input.otherUid].sort().join('_')}`;
  const existing = await dbRequest<unknown | null>(env, `chats/${chatId}`);
  if (!existing) {
    const privacy = await dbRequest<{ allowNewDMs?: boolean } | null>(env, `userSettings/${input.otherUid}/privacy`);
    if (privacy?.allowNewDMs === false) return json({ error: 'Этот пользователь запретил новые личные сообщения.' }, 403);
  }
  const token = await accessToken(env);
  const chat = { id: chatId, kind: 'dm', title: '', creatorId: user.uid, createdAt: Date.now(), updatedAt: Date.now() };
  const response = await fetch(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/chats/${chatId}.json`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': 'null_etag' }, body: JSON.stringify(chat) });
  if (!response.ok && response.status !== 412) throw new Error(`Database ${response.status}`);
  const finalChat = response.status === 412 ? await dbRequest<{ creatorId: string; kind: string }>(env, `chats/${chatId}`) : chat;
  if (finalChat.kind !== 'dm' || ![user.uid, input.otherUid].includes(finalChat.creatorId)) return json({ error: 'Chat conflict' }, 409);
  const otherUid = input.otherUid;
  await dbRequest(env, `chatMembers/${chatId}/${finalChat.creatorId}`, 'PUT', 'owner');
  await dbRequest(env, `chatMembers/${chatId}/${finalChat.creatorId === user.uid ? otherUid : user.uid}`, 'PUT', 'member');
  await dbRequest(env, `userChats/${user.uid}/${chatId}`, 'PUT', true);
  await dbRequest(env, `userChats/${otherUid}/${chatId}`, 'PUT', true);
  return json({ chatId });
}
async function uploadMedia(request: Request, env: Env, user: AuthUser, url: URL) {
  const chatId = url.searchParams.get('chatId'); const name = url.searchParams.get('name');
  if (!safeId(chatId) || !name || name.length > 120 || /[\\/\u0000-\u001f]/.test(name)) return json({ error: 'Invalid path' }, 400);
  const role = await memberRole(env, chatId, user.uid);
  if (!role) return json({ error: 'Forbidden' }, 403);
  const chat = await dbRequest<{ kind: string } | null>(env, `chats/${chatId}`);
  if (chat?.kind === 'channel' && role !== 'owner' && role !== 'admin') return json({ error: 'Forbidden' }, 403);
  if (await limited(env, request, `upload:${user.uid}`, 40, 3600)) return json({ error: 'Upload limit' }, 429);
  const mime = (request.headers.get('Content-Type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!/^(image\/(png|jpeg|gif|webp|avif)$|video\/(mp4|webm|quicktime)$|audio\/(mpeg|mp4|wav|ogg|webm|x-wav)$|application\/(pdf|zip|x-zip-compressed|octet-stream|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$|text\/plain$)/.test(mime)) return json({ error: 'Unsupported file' }, 415);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > 25 * 1024 * 1024) return json({ error: 'File too large' }, 413);
  const path = `chats/${chatId}/${user.uid}/${crypto.randomUUID()}_${name}`;
  const token = await accessToken(env);
  const storageUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(env.FIREBASE_STORAGE_BUCKET)}/o?uploadType=media&name=${encodeURIComponent(path)}`;
  const response = await fetch(storageUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime }, body: bytes });
  if (!response.ok) throw new Error(`Storage ${response.status}`);
  return json({ path });
}
async function forwardMedia(request: Request, env: Env, user: AuthUser) {
  const input = await request.json().catch(() => ({})) as { sourceChatId?: string; sourceMessageId?: string; targetChatId?: string };
  if (!safeId(input.sourceChatId) || !safeId(input.sourceMessageId) || !safeId(input.targetChatId)) return json({ error: 'Некорректный запрос на пересылку.' }, 400);
  const [sourceRole, targetRole, targetChat, source] = await Promise.all([
    memberRole(env, input.sourceChatId, user.uid), memberRole(env, input.targetChatId, user.uid),
    dbRequest<{ kind: string } | null>(env, `chats/${input.targetChatId}`),
    dbRequest<{ senderId: string; media?: { kind: string; name: string; url: string; size: number; mime: string } } | null>(env, `messages/${input.sourceChatId}/${input.sourceMessageId}`),
  ]);
  if (!sourceRole || !targetRole || !source?.media || !targetChat) return json({ error: 'Исходное вложение или доступ к чату недоступны.' }, 403);
  if (targetChat.kind === 'channel' && targetRole !== 'owner' && targetRole !== 'admin') return json({ error: 'В канале публикуют только администраторы.' }, 403);
  const sourcePath = source.media.url;
  const match = /^chats\/([a-zA-Z0-9_-]{5,150})\/([a-zA-Z0-9_-]{5,150})\/([^/]{1,160})$/.exec(sourcePath);
  if (!match || match[1] !== input.sourceChatId || match[2] !== source.senderId || source.media.size > 25 * 1024 * 1024) return json({ error: 'Исходное вложение недействительно.' }, 409);
  if (await limited(env, request, `forward:${user.uid}`, 40, 3600)) return json({ error: 'Слишком много пересылок.' }, 429);
  const token = await accessToken(env);
  const sourceResponse = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(env.FIREBASE_STORAGE_BUCKET)}/o/${encodeURIComponent(sourcePath)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!sourceResponse.ok) return json({ error: 'Исходное вложение больше недоступно.' }, 404);
  const bytes = await sourceResponse.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > 25 * 1024 * 1024) return json({ error: 'Размер исходного файла недопустим.' }, 413);
  const path = `chats/${input.targetChatId}/${user.uid}/${crypto.randomUUID()}_${safeStorageName(source.media.name)}`;
  const uploadResponse = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(env.FIREBASE_STORAGE_BUCKET)}/o?uploadType=media&name=${encodeURIComponent(path)}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': source.media.mime }, body: bytes });
  if (!uploadResponse.ok) throw new Error(`Storage ${uploadResponse.status}`);
  return json({ media: { ...source.media, url: path } });
}
function safeStorageName(name: string) { return name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 120) || 'attachment'; }
async function downloadMedia(env: Env, user: AuthUser, url: URL) {
  const path = url.searchParams.get('path');
  const match = /^chats\/([a-zA-Z0-9_-]{5,150})\/([a-zA-Z0-9_-]{5,150})\/([^/]{1,160})$/.exec(path || '');
  if (!match) return json({ error: 'Invalid path' }, 400);
  if (!(await memberRole(env, match[1], user.uid))) return json({ error: 'Forbidden' }, 403);
  const token = await accessToken(env);
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(env.FIREBASE_STORAGE_BUCKET)}/o/${encodeURIComponent(path!) }?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return json({ error: 'File unavailable' }, response.status === 404 ? 404 : 502);
  return new Response(response.body, { headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
async function deleteMedia(request: Request, env: Env, user: AuthUser) {
  const input = await request.json().catch(() => ({})) as { chatId?: string; messageId?: string; path?: string };
  if (!safeId(input.chatId) || !safeId(input.messageId) || typeof input.path !== 'string') return json({ error: 'Некорректные данные файла.' }, 400);
  const match = /^chats\/([a-zA-Z0-9_-]{5,150})\/([a-zA-Z0-9_-]{5,150})\/([^/]{1,160})$/.exec(input.path);
  if (!match || match[1] !== input.chatId) return json({ error: 'Некорректный путь файла.' }, 400);
  const [message, role] = await Promise.all([
    dbRequest<{ senderId: string; media?: { url: string } } | null>(env, `messages/${input.chatId}/${input.messageId}`),
    memberRole(env, input.chatId, user.uid),
  ]);
  if (!message || message.media?.url !== input.path || !role) return json({ error: 'Файл не найден или у вас нет доступа.' }, 404);
  if (message.senderId !== user.uid && role !== 'owner' && role !== 'admin' && role !== 'moderator') return json({ error: 'Удалить это вложение может только автор или модератор.' }, 403);
  const token = await accessToken(env);
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(env.FIREBASE_STORAGE_BUCKET)}/o/${encodeURIComponent(input.path)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok && response.status !== 404) return json({ error: `Не удалось удалить файл из Storage (HTTP ${response.status}).` }, 502);
  return json({ deleted: true });
}
async function deleteMessage(request: Request, env: Env, user: AuthUser) {
  if (await limited(env, request, `delete:${user.uid}`, 60, 3600)) return json({ error: 'Слишком много удалений. Попробуйте позже.' }, 429);
  const input = await request.json().catch(() => ({})) as { chatId?: string; messageId?: string };
  if (!safeId(input.chatId) || !safeId(input.messageId)) return json({ error: 'Некорректное сообщение.' }, 400);
  const [message, role] = await Promise.all([
    dbRequest<{ id: string; senderId: string; text?: string; media?: { url: string }; createdAt: number } | null>(env, `messages/${input.chatId}/${input.messageId}`),
    memberRole(env, input.chatId, user.uid),
  ]);
  if (!message || !role) return json({ error: 'Сообщение не найдено или у вас нет доступа.' }, 404);
  if (message.senderId !== user.uid && role !== 'owner' && role !== 'moderator') return json({ error: 'Удалить сообщение у всех может только автор или модератор.' }, 403);
  const token = await accessToken(env);
  if (message.media?.url) {
    const match = /^chats\/([a-zA-Z0-9_-]{5,150})\/([a-zA-Z0-9_-]{5,150})\/([^/]{1,160})$/.exec(message.media.url);
    if (!match || match[1] !== input.chatId) return json({ error: 'Некорректный путь вложения.' }, 409);
    const mediaResponse = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(env.FIREBASE_STORAGE_BUCKET)}/o/${encodeURIComponent(message.media.url)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (!mediaResponse.ok && mediaResponse.status !== 404) return json({ error: `Не удалось удалить вложение (HTTP ${mediaResponse.status}).` }, 502);
  }
  const latestResponse = await fetch(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/messages/${input.chatId}.json?orderBy=%22createdAt%22&limitToLast=2`, { headers: { Authorization: `Bearer ${token}` } });
  if (!latestResponse.ok) throw new Error(`Database ${latestResponse.status}`);
  const latest = await latestResponse.json() as Record<string, { id: string; senderId: string; text?: string; media?: { name: string }; createdAt: number }> | null;
  const candidates = Object.values(latest || {}).filter(item => item.id !== input.messageId).sort((a, b) => b.createdAt - a.createdAt);
  const replacement = candidates[0];
  const updates: Record<string, unknown> = { [`messages/${input.chatId}/${input.messageId}`]: null, [`reactions/${input.chatId}/${input.messageId}`]: null };
  updates[`chatActivity/${input.chatId}`] = replacement ? { updatedAt: replacement.createdAt, lastText: (replacement.text || (replacement.media ? `Вложение · ${replacement.media.name}` : '')).slice(0, 90), lastSenderId: replacement.senderId } : null;
  const updateResponse = await fetch(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/.json`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
  if (!updateResponse.ok) throw new Error(`Database ${updateResponse.status}`);
  return json({ deleted: true });
}
async function pushMessage(request: Request, env: Env, user: AuthUser) {
  const input = await request.json().catch(() => ({})) as { chatId?: string; messageId?: string };
  if (!safeId(input.chatId) || !safeId(input.messageId)) return json({ error: 'Invalid message' }, 400);
  const message = await dbRequest<{ senderId: string; text?: string; type?: string; media?: { name: string } } | null>(env, `messages/${input.chatId}/${input.messageId}`);
  if (!message || message.senderId !== user.uid || !(await memberRole(env, input.chatId, user.uid))) return json({ error: 'Forbidden' }, 403);
  const onceKey = `push:${input.chatId}:${input.messageId}`;
  if (await env.RATE_LIMIT.get(onceKey)) return json({ delivered: 0 });
  await env.RATE_LIMIT.put(onceKey, '1', { expirationTtl: 86400 });
  const members = await dbRequest<Record<string, string> | null>(env, `chatMembers/${input.chatId}`);
  const sender = await dbRequest<{ displayName: string } | null>(env, `users/${user.uid}`);
  const title = sender?.displayName || 'Pride Messenger';
  const chat = await dbRequest<{ title?: string; kind?: string } | null>(env, `chats/${input.chatId}`);
  const body = message.text?.slice(0, 100) || (message.media ? `Вложение · ${message.media.name}` : 'Новое сообщение');
  const token = await accessToken(env);
  let delivered = 0;
  for (const uid of Object.keys(members || {}).filter(uid => uid !== user.uid).slice(0, 200)) {
    const [devices, settings, chatPrefs] = await Promise.all([
      dbRequest<Record<string, { token: string }> | null>(env, `devices/${uid}`),
      dbRequest<{ notifications?: { enabled?: boolean; preview?: boolean } } | null>(env, `userSettings/${uid}`),
      dbRequest<{ mutedUntil?: number } | null>(env, `userChatPrefs/${uid}/${input.chatId}`),
    ]);
    if (settings?.notifications?.enabled === false || (chatPrefs?.mutedUntil || 0) > Date.now()) continue;
    const visibleBody = settings?.notifications?.preview === false ? (message.type === 'announcement' ? 'Новый Клич в Pride Messenger' : 'Новое сообщение в Pride Messenger') : body;
    for (const [deviceId, device] of Object.entries(devices || {}).slice(0, 10)) {
      const pushTitle = message.type === 'announcement' ? `Клич · ${chat?.title || title}` : chat?.title ? `${title} · ${chat.title}` : title;
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/messages:send`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { token: device.token, data: { title: pushTitle, body: visibleBody, type: message.type || 'normal', url: `/pride/chat/${input.chatId}`, tag: `chat-${input.chatId}` }, webpush: { headers: { Urgency: 'high' } } } }) });
      if (response.ok) delivered++;
      else if (response.status === 404 || response.status === 400) {
        const failure = await response.clone().json().catch(() => ({})) as { error?: { details?: Array<{ errorCode?: string }>; message?: string } };
        const diagnostic = `${failure.error?.message || ''} ${failure.error?.details?.map(item => item.errorCode || '').join(' ') || ''}`;
        if (/UNREGISTERED|registration-token-not-registered/i.test(diagnostic)) await dbRequest(env, `devices/${uid}/${deviceId}`, 'DELETE');
        else console.error('FCM delivery failed', response.status, diagnostic.slice(0, 240));
      } else console.error('FCM delivery failed', response.status);
    }
  }
  return json({ delivered });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const allowedOrigins = new Set([env.FRONTEND_ORIGIN, 'http://localhost:5173']);
    if (origin && !allowedOrigins.has(origin)) return json({ error: 'Origin denied' }, 403);
    const cors = { 'Access-Control-Allow-Origin': origin || env.FRONTEND_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let result: Response;
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/health' && request.method === 'GET') result = json({ ok: true });
      else if (url.pathname === '/api/auth/resolve-username' && request.method === 'POST') result = await resolveUsername(request, env);
      else if (url.pathname === '/api/auth/check-username' && request.method === 'POST') result = await checkUsername(request, env);
      else {
        const user = await verifyUser(request, env);
        if (!user) result = json({ error: 'Unauthorized' }, 401);
        else if (url.pathname === '/api/links/join' && request.method === 'POST') result = await join(request, env, user);
        else if (url.pathname === '/api/links/join-public' && request.method === 'POST') result = await joinPublic(request, env, user);
        else if (url.pathname === '/api/chats/direct' && request.method === 'POST') result = await createDirect(request, env, user);
        else if (url.pathname === '/api/media' && request.method === 'POST') result = await uploadMedia(request, env, user, url);
        else if (url.pathname === '/api/media/forward' && request.method === 'POST') result = await forwardMedia(request, env, user);
        else if (url.pathname === '/api/media' && request.method === 'GET') result = await downloadMedia(env, user, url);
        else if (url.pathname === '/api/media/delete' && request.method === 'POST') result = await deleteMedia(request, env, user);
        else if (url.pathname === '/api/messages/delete' && request.method === 'POST') result = await deleteMessage(request, env, user);
        else if (url.pathname === '/api/push/message' && request.method === 'POST') result = await pushMessage(request, env, user);
        else result = json({ error: 'Not found' }, 404);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown server error';
      console.error('Pride Worker request failed:', reason);
      result = json({ error: reason.startsWith('Database ') || reason.startsWith('OAuth ') || reason.startsWith('Storage ') ? `Сервис временно недоступен (${reason}).` : 'Внутренняя ошибка сервиса.' }, 500);
    }
    const headers = new Headers(result.headers); Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
    return new Response(result.body, { status: result.status, headers });
  }
};
