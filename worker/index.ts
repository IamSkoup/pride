import { canAssign, canModerate, canPost, hasPermission, type PrideRole } from './v2-permissions.ts';
import { migrateProfile, needsProfileMigration, type LegacyProfile } from './v2-migration.ts';

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
function auditPath(prideId: string, actorId: string, action: string, detail: Record<string, unknown> = {}) {
  return { [`v2/audit/${prideId}/${crypto.randomUUID()}`]: { actorId, action, at: Date.now(), ...detail } };
}
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
async function v2Request(request: Request, env: Env, user: AuthUser, action: string) {
  if (await limited(env, request, `v2:${action}:${user.uid}`, action === 'message' ? 120 : action === 'report' ? 10 : 30, 60)) return json({ error: 'Слишком много запросов. Попробуйте позже.' }, 429);
  const input = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (action === 'bootstrap') {
    const existing = await dbRequest<{ migrationVersion?: number } | null>(env, `v2/usersPublic/${user.uid}`);
    const legacy = await dbRequest<LegacyProfile | null>(env, `users/${user.uid}`);
    if (!legacy) return json({ error: 'Профиль не найден.' }, 404);
    const profile = migrateProfile(user.uid, legacy);
    if (!needsProfileMigration(existing)) {
      const current = existing as typeof profile;
      if (current.username !== profile.username || current.displayName !== profile.displayName || current.avatar !== profile.avatar || current.bio !== profile.bio) await dbRequest(env, `v2/usersPublic/${user.uid}`, 'PUT', profile);
      return json({ migrated: false, version: 2 });
    }
    await dbRequest(env, '', 'PATCH', { [`v2/usersPublic/${user.uid}`]: profile, [`v2/migrations/${user.uid}`]: { version: 2, completedAt: Date.now(), source: 'legacy-users' } });
    return json({ migrated: true, version: 2 });
  }
  if (action === 'profile-sync') {
    const legacy = await dbRequest<LegacyProfile | null>(env, `users/${user.uid}`);
    if (!legacy) return json({ error: 'Профиль не найден.' }, 404);
    await dbRequest(env, `v2/usersPublic/${user.uid}`, 'PUT', migrateProfile(user.uid, legacy));
    return json({ ok: true });
  }
  if (action === 'user-search') {
    const query = typeof input.query === 'string' ? input.query.trim().replace(/^@/, '').toLowerCase() : '';
    if (!/^[a-z0-9_]{2,24}$/.test(query)) return json({ users: [] });
    const token = await accessToken(env);
    const params = new URLSearchParams({ orderBy: JSON.stringify('$key'), startAt: JSON.stringify(query), endAt: JSON.stringify(`${query}\uf8ff`), limitToFirst: '10' });
    const response = await fetch(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/usernames.json?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Database ${response.status}`);
    const claims = await response.json() as Record<string, { uid?: string }> | null;
    const users = await Promise.all(Object.values(claims || {}).filter(claim => safeId(claim.uid)).map(async claim => dbRequest<{ uid: string; username: string; displayName: string; avatar?: string } | null>(env, `publicProfiles/${claim.uid}`)));
    return json({ users: users.filter(Boolean).map(profile => ({ uid: profile!.uid, username: profile!.username, displayName: profile!.displayName, avatar: profile!.avatar || '' })) });
  }
  if (action === 'pride') {
    const title = typeof input.title === 'string' ? input.title.trim().slice(0, 64) : '';
    if (!title) return json({ error: 'Введите название Прайда.' }, 400);
    const prideId = crypto.randomUUID(); const channelId = crypto.randomUUID(); const now = Date.now();
    const code = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    await dbRequest(env, '', 'PATCH', {
      [`v2/prides/${prideId}`]: { id: prideId, title, description: '', ownerId: user.uid, createdAt: now, inviteCode: code, migrationVersion: 2 },
      [`v2/prideMembers/${prideId}/${user.uid}`]: 'owner',
      [`v2/userPrides/${user.uid}/${prideId}`]: true,
      [`v2/channels/${prideId}/${channelId}`]: { id: channelId, prideId, title: 'общая-тропа', kind: 'text', createdAt: now },
      [`v2/channelPrides/${channelId}`]: prideId,
      ...auditPath(prideId, user.uid, 'pride_created', { channelId }),
    });
    return json({ prideId, channelId });
  }
  if (!safeId(input.prideId)) return json({ error: 'Некорректный Прайд.' }, 400);
  const prideId = input.prideId;
  const role = await dbRequest<PrideRole | null>(env, `v2/prideMembers/${prideId}/${user.uid}`);
  if (action === 'join') {
    const pride = await dbRequest<{ inviteCode?: string } | null>(env, `v2/prides/${prideId}`);
    if (!pride?.inviteCode || typeof input.code !== 'string' || input.code !== pride.inviteCode) return json({ error: 'Зов недействителен.' }, 404);
    const banned = await dbRequest<unknown | null>(env, `v2/bans/${prideId}/${user.uid}`);
    if (banned) return json({ error: 'Доступ к Прайду закрыт.' }, 403);
    if (!role) await dbRequest(env, '', 'PATCH', { [`v2/prideMembers/${prideId}/${user.uid}`]: 'member', [`v2/userPrides/${user.uid}/${prideId}`]: true, ...auditPath(prideId, user.uid, 'member_joined') });
    return json({ prideId });
  }
  if (role && await dbRequest<unknown | null>(env, `v2/bans/${prideId}/${user.uid}`)) return json({ error: 'Доступ к Прайду закрыт.' }, 403);
  if (action === 'channel') {
    if (!hasPermission(role, 'manage_channels')) return json({ error: 'Недостаточно прав.' }, 403);
    const title = typeof input.title === 'string' ? input.title.trim().slice(0, 48) : '';
    const kind = input.kind === 'chronicle' ? 'chronicle' : input.kind === 'text' ? 'text' : null;
    if (!title || !kind) return json({ error: 'Укажите название и тип Тропы.' }, 400);
    const channelId = crypto.randomUUID();
    await dbRequest(env, '', 'PATCH', { [`v2/channels/${prideId}/${channelId}`]: { id: channelId, prideId, title, kind, createdAt: Date.now() }, [`v2/channelPrides/${channelId}`]: prideId, ...auditPath(prideId, user.uid, 'channel_created', { channelId, title, kind }) });
    return json({ channelId });
  }
  if (action === 'role') {
    const targetId = input.targetId;
    if (!safeId(targetId) || (input.role !== 'admin' && input.role !== 'moderator' && input.role !== 'member')) return json({ error: 'Некорректный ранг.' }, 400);
    const targetRole = await dbRequest<PrideRole | null>(env, `v2/prideMembers/${prideId}/${targetId}`);
    if (!canAssign(role, targetRole, input.role)) return json({ error: 'Изменять ранги может только владелец.' }, 403);
    if (await dbRequest<unknown | null>(env, `v2/bans/${prideId}/${targetId}`)) return json({ error: 'Участник заблокирован.' }, 409);
    await dbRequest(env, '', 'PATCH', { [`v2/prideMembers/${prideId}/${targetId}`]: input.role, ...auditPath(prideId, user.uid, 'role_changed', { targetId, previousRole: targetRole, nextRole: input.role }) });
    return json({ ok: true });
  }
  if (action === 'kick' || action === 'ban') {
    if (!safeId(input.targetId)) return json({ error: 'Некорректный участник.' }, 400);
    const targetRole = await dbRequest<PrideRole | null>(env, `v2/prideMembers/${prideId}/${input.targetId}`);
    if (!canModerate(role, targetRole, action)) return json({ error: 'Недостаточно прав.' }, 403);
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : '';
    await dbRequest(env, '', 'PATCH', {
      [`v2/prideMembers/${prideId}/${input.targetId}`]: null,
      [`v2/userPrides/${input.targetId}/${prideId}`]: null,
      ...(action === 'ban' ? { [`v2/bans/${prideId}/${input.targetId}`]: { actorId: user.uid, at: Date.now(), reason } } : {}),
      ...auditPath(prideId, user.uid, action === 'ban' ? 'member_banned' : 'member_kicked', { targetId: input.targetId, reason }),
    });
    return json({ ok: true });
  }
  if (action === 'unban') {
    if (!hasPermission(role, 'ban_members') || !safeId(input.targetId)) return json({ error: 'Недостаточно прав.' }, 403);
    const banned = await dbRequest<unknown | null>(env, `v2/bans/${prideId}/${input.targetId}`);
    if (!banned) return json({ error: 'Участник не заблокирован.' }, 404);
    await dbRequest(env, '', 'PATCH', { [`v2/bans/${prideId}/${input.targetId}`]: null, [`v2/prideMembers/${prideId}/${input.targetId}`]: null, [`v2/userPrides/${input.targetId}/${prideId}`]: null, ...auditPath(prideId, user.uid, 'member_unbanned', { targetId: input.targetId }) });
    return json({ ok: true });
  }
  if (action === 'resolve-report') {
    if (!hasPermission(role, 'review_reports') || !safeId(input.reportId)) return json({ error: 'Недостаточно прав.' }, 403);
    const report = await dbRequest<{ status?: string } | null>(env, `v2/reports/${prideId}/${input.reportId}`);
    if (!report) return json({ error: 'Жалоба не найдена.' }, 404);
    if (report.status === 'resolved') return json({ ok: true });
    await dbRequest(env, '', 'PATCH', { [`v2/reports/${prideId}/${input.reportId}/status`]: 'resolved', [`v2/reports/${prideId}/${input.reportId}/resolvedBy`]: user.uid, [`v2/reports/${prideId}/${input.reportId}/resolvedAt`]: Date.now(), ...auditPath(prideId, user.uid, 'report_resolved', { reportId: input.reportId }) });
    return json({ ok: true });
  }
  if (action === 'message' || action === 'react' || action === 'edit' || action === 'delete' || action === 'report') {
    if (!safeId(input.channelId) || !safeId(input.messageId)) return json({ error: 'Некорректное сообщение.' }, 400);
    const channel = await dbRequest<{ kind: 'text' | 'chronicle' } | null>(env, `v2/channels/${prideId}/${input.channelId}`);
    if (!channel || !role) return json({ error: 'Нет доступа к Тропе.' }, 403);
    const path = `v2/messages/${input.channelId}/${input.messageId}`;
    if (action !== 'message') {
      const previous = await dbRequest<{ senderId?: string; deleted?: boolean; text?: string } | null>(env, path);
      if (!previous || previous.deleted) return json({ error: 'Сообщение не найдено.' }, 404);
      if (action === 'report') {
        const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : '';
        if (!reason) return json({ error: 'Укажите причину жалобы.' }, 400);
        const reportId = crypto.randomUUID();
        await dbRequest(env, `v2/reports/${prideId}/${reportId}`, 'PUT', { id: reportId, channelId: input.channelId, messageId: input.messageId, senderId: previous.senderId, reporterId: user.uid, reason, preview: previous.text?.slice(0, 200) || '', status: 'open', createdAt: Date.now() });
        return json({ reportId });
      }
      if (action === 'react') {
        if (!hasPermission(role, 'add_reactions')) return json({ error: 'Недостаточно прав.' }, 403);
        const emoji = typeof input.emoji === 'string' ? input.emoji : '';
        if (emoji && !['❤️', '🔥', '👏', '👍'].includes(emoji)) return json({ error: 'Недопустимая реакция.' }, 400);
        await dbRequest(env, `${path}/reactions/${user.uid}`, 'PUT', emoji || null);
        return json({ ok: true });
      }
      if (previous.senderId !== user.uid && !(action === 'delete' && hasPermission(role, 'manage_messages'))) return json({ error: 'Недостаточно прав.' }, 403);
      if (action === 'edit') {
        const text = typeof input.text === 'string' ? input.text.trim().slice(0, 8000) : '';
        if (!text) return json({ error: 'Введите сообщение.' }, 400);
        await dbRequest(env, path, 'PATCH', { text, editedAt: Date.now() });
        await dbRequest(env, `v2/activity/${prideId}/${input.messageId}/preview`, 'PUT', text.slice(0, 120));
      } else {
        await dbRequest(env, '', 'PATCH', { [`${path}/text`]: '', [`${path}/deleted`]: true, [`${path}/reactions`]: null, [`v2/activity/${prideId}/${input.messageId}`]: null, ...auditPath(prideId, user.uid, previous.senderId === user.uid ? 'message_deleted_by_author' : 'message_deleted_by_moderator', { channelId: input.channelId, messageId: input.messageId, targetId: previous.senderId }) });
      }
      return json({ ok: true });
    }
    if (!canPost(role, channel.kind)) return json({ error: 'У вас нет права писать в эту Тропу.' }, 403);
    const message = typeof input.text === 'string' ? input.text.trim().slice(0, 8000) : '';
    if (!message) return json({ error: 'Введите сообщение.' }, 400);
    const token = await accessToken(env);
    const payload = { id: input.messageId, channelId: input.channelId, senderId: user.uid, text: message, createdAt: Date.now(), ...(safeId(input.replyTo) ? { replyTo: input.replyTo } : {}) };
    const recordActivity = async (saved: typeof payload) => dbRequest(env, `v2/activity/${prideId}/${input.messageId}`, 'PUT', { id: input.messageId, channelId: input.channelId, senderId: saved.senderId, preview: saved.text.slice(0, 120), at: saved.createdAt });
    const response = await fetch(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/${path}.json`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': 'null_etag' }, body: JSON.stringify(payload) });
    if (response.status === 412) {
      const previous = await dbRequest<typeof payload | null>(env, path);
      if (previous?.senderId === user.uid) { await recordActivity(previous); return json({ messageId: input.messageId, duplicate: true }); }
      return json({ error: 'Конфликт идентификатора.' }, 409);
    }
    if (!response.ok) throw new Error(`Database ${response.status}`);
    await recordActivity(payload);
    return json({ messageId: input.messageId });
  }
  return json({ error: 'Not found' }, 404);
}
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
  const wallet = await dbRequest<Economy | null>(env, `economy/${user.uid}`);
  const tier = wallet?.subscription && wallet.subscription.expiresAt > Date.now() ? wallet.subscription.tier : '';
  const maxBytes = tier === 'lion' ? 100 : tier === 'leopard' ? 75 : tier === 'cheetah' ? 50 : 20;
  const mime = (request.headers.get('Content-Type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!/^(image\/(png|jpeg|gif|webp|avif)$|video\/(mp4|webm|quicktime)$|audio\/(mpeg|mp4|wav|ogg|webm|x-wav)$|application\/(pdf|zip|x-zip-compressed|octet-stream|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$|text\/plain$)/.test(mime)) return json({ error: 'Unsupported file' }, 415);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes * 1024 * 1024) return json({ error: `Размер файла превышает лимит ${maxBytes} МБ для вашего тарифа.` }, 413);
  const path = `chats/${chatId}/${user.uid}/${crypto.randomUUID()}_${name}`;
  const token = await accessToken(env);
  const storageUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(env.FIREBASE_STORAGE_BUCKET)}/o?uploadType=media&name=${encodeURIComponent(path)}`;
  const response = await fetch(storageUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime }, body: bytes });
  if (!response.ok) throw new Error(`Storage ${response.status}`);
  return json({ path });
}
async function shareMedia(request: Request, env: Env, user: AuthUser) {
  if (await limited(env, request, `share:${user.uid}`, 10, 3600)) return json({ error: 'Слишком много публичных ссылок.' }, 429);
  const input = await request.json().catch(() => ({})) as { path?: string };
  const path = input.path || '';
  const match = /^chats\/([a-zA-Z0-9_-]{5,150})\/([a-zA-Z0-9_-]{5,150})\/([^/]{1,180})$/.exec(path);
  if (!match || match[2] !== user.uid) return json({ error: 'Публиковать в профиле можно только собственные вложения из чатов.' }, 403);
  const role = await memberRole(env, match[1], user.uid);
  if (!role) return json({ error: 'Нет доступа к исходному чату.' }, 403);
  const token = await accessToken(env);
  const objectUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(env.FIREBASE_STORAGE_BUCKET)}/o/${encodeURIComponent(path)}`;
  const metadataResponse = await fetch(objectUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!metadataResponse.ok) return json({ error: 'Аудиофайл больше недоступен.' }, 404);
  const object = await metadataResponse.json() as { metageneration?: string; contentType?: string; metadata?: Record<string, string> };
  if (!object.contentType?.startsWith('audio/')) return json({ error: 'В профиль можно добавить только аудиофайл.' }, 415);
  let publicToken = object.metadata?.firebaseStorageDownloadTokens?.split(',')[0];
  if (!publicToken) {
    publicToken = crypto.randomUUID();
    const params = new URLSearchParams();
    if (object.metageneration) params.set('ifMetagenerationMatch', object.metageneration);
    const updateResponse = await fetch(`${objectUrl}?${params}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata: { ...object.metadata, firebaseStorageDownloadTokens: publicToken } }) });
    if (!updateResponse.ok) return json({ error: 'Не удалось открыть доступ к треку.' }, 502);
  }
  const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(env.FIREBASE_STORAGE_BUCKET)}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(publicToken)}`;
  return json({ url });
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
  if (!match || match[1] !== input.sourceChatId || match[2] !== source.senderId) return json({ error: 'Исходное вложение недействительно.' }, 409);
  const wallet = await dbRequest<Economy | null>(env, `economy/${user.uid}`);
  const tier = wallet?.subscription && wallet.subscription.expiresAt > Date.now() ? wallet.subscription.tier : '';
  const maxBytes = (tier === 'lion' ? 100 : tier === 'leopard' ? 75 : tier === 'cheetah' ? 50 : 20) * 1024 * 1024;
  if (source.media.size > maxBytes) return json({ error: `Пересылаемое вложение превышает ваш лимит ${maxBytes / 1024 / 1024} МБ.` }, 413);
  if (await limited(env, request, `forward:${user.uid}`, 40, 3600)) return json({ error: 'Слишком много пересылок.' }, 429);
  const token = await accessToken(env);
  const sourceResponse = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(env.FIREBASE_STORAGE_BUCKET)}/o/${encodeURIComponent(sourcePath)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!sourceResponse.ok) return json({ error: 'Исходное вложение больше недоступно.' }, 404);
  const bytes = await sourceResponse.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return json({ error: 'Размер исходного файла недопустим.' }, 413);
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
type Economy = { balance: number; subscription?: { tier: string; expiresAt: number }; frames?: Record<string, number>; equippedFrame?: string; dailyAt?: number; giftsSent?: Record<string, { to: string; giftId: string; sentAt?: number }>; giftSales?: Record<string, boolean>; operations?: Record<string, string>; ledger?: Array<{ id: string; kind: string; amount: number; label: string; at: number }> };
const PLANS: Record<string, { name: string; monthly: number; yearly: number }> = {
  cheetah: { name: 'Cheetah', monthly: 53, yearly: 530 },
  leopard: { name: 'Leopard', monthly: 99, yearly: 990 },
  lion: { name: 'Lion', monthly: 166, yearly: 1660 },
};
const FRAMES: Record<string, { name: string; price: number }> = {
  ember: { name: 'Угольный отблеск', price: 35 },
  sunset: { name: 'Саванна в закатном золоте', price: 60 },
  constellation: { name: 'Звёздная тропа', price: 90 },
  dune: { name: 'Линия дюн', price: 75 },
  acacia: { name: 'Ветви акации', price: 110 },
  copper: { name: 'Медный ореол', price: 130 },
};
const SAVANNA_GIFTS: Record<string, { name: string; price: number }> = {
  sunstone: { name: 'Солнечный камень', price: 12 },
  acacia: { name: 'Венок акации', price: 35 },
  horizon: { name: 'Золотой горизонт', price: 65 },
  baobab: { name: 'Память баобаба', price: 110 },
};
async function updateEconomy(env: Env, uid: string, mutate: (state: Economy) => void) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const token = await accessToken(env);
    const response = await fetch(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/economy/${uid}.json`, { headers: { Authorization: `Bearer ${token}`, 'X-Firebase-ETag': 'true' } });
    if (!response.ok) throw new Error(`Database ${response.status}`);
    const state = ((await response.json()) || { balance: 0, ledger: [] }) as Economy;
    const value: Economy = { ...state, balance: Math.max(0, Number(state.balance) || 0), ledger: Array.isArray(state.ledger) ? state.ledger.slice(-99) : [] };
    mutate(value);
    const write = await fetch(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/economy/${uid}.json`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': response.headers.get('ETag') || 'null_etag' }, body: JSON.stringify(value) });
    if (write.status === 412) continue;
    if (!write.ok) throw new Error(`Database ${write.status}`);
    await writePublicStyle(env, uid, value).catch(() => {});
    return value;
  }
  throw new Error('Database transaction conflict');
}
async function writePublicStyle(env: Env, uid: string, economy: Economy) {
  await dbRequest(env, `publicProfileStyles/${uid}`, 'PUT', {
    subscription: economy.subscription || null,
    equippedFrame: economy.equippedFrame || null,
    frames: economy.frames || {},
  });
}
async function economyRequest(request: Request, env: Env, user: AuthUser) {
  const uid = user.uid;
  if (request.method === 'GET') return json((await dbRequest<Economy | null>(env, `economy/${uid}`)) || { balance: 0, ledger: [] });
  if (await limited(env, request, `economy:${uid}`, 15, 60)) return json({ error: 'Слишком много операций. Попробуйте через минуту.' }, 429);
  const input = await request.json().catch(() => ({})) as { action?: string; tier?: string; period?: string; frame?: string; equipped?: string; operationId?: string };
  if (input.operationId !== undefined && !safeId(input.operationId)) return json({ error: 'Некорректный ключ операции.' }, 400);
  const now = Date.now();
  for (let attempt = 0; attempt < 6; attempt++) {
    const token = await accessToken(env);
    const response = await fetch(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/economy/${uid}.json`, { headers: { Authorization: `Bearer ${token}`, 'X-Firebase-ETag': 'true' } });
    if (!response.ok) throw new Error(`Database ${response.status}`);
    const etag = response.headers.get('ETag');
    const current = ((await response.json()) || { balance: 0, ledger: [] }) as Economy;
    const state: Economy = { ...current, balance: Math.max(0, Number(current.balance) || 0), ledger: Array.isArray(current.ledger) ? current.ledger.slice(-99) : [] };
    if (input.operationId && state.operations?.[input.operationId]) return state.operations[input.operationId] === input.action ? json(state) : json({ error: 'Ключ операции уже использован.' }, 409);
    let amount = 0, kind = '', label = '';
    if (input.action === 'daily') {
      if (state.dailyAt && now - state.dailyAt < 20 * 60 * 60 * 1000) return json({ error: 'Ежедневную награду можно забрать раз в день.' }, 409);
      amount = 3; kind = 'daily'; label = 'Награда за возвращение'; state.dailyAt = now; state.balance += 3;
    } else if (input.action === 'subscribe') {
      const plan = input.tier ? PLANS[input.tier] : undefined;
      if (!plan || (input.period !== 'month' && input.period !== 'year')) return json({ error: 'Неизвестный тариф.' }, 400);
      const price = input.period === 'year' ? plan.yearly : plan.monthly;
      if (state.balance < price) return json({ error: 'Недостаточно Claws. Получите ежедневную награду или пополните баланс, когда подключим оплату.' }, 402);
      const existing = state.subscription?.tier === input.tier && state.subscription.expiresAt > now ? state.subscription.expiresAt : now;
      state.subscription = { tier: input.tier, expiresAt: existing + (input.period === 'year' ? 365 : 30) * 86400000 };
      state.balance -= price; amount = -price; kind = 'subscription'; label = `${plan.name} · ${input.period === 'year' ? 'год' : 'месяц'}`;
    } else if (input.action === 'frame') {
      const frame = input.frame ? FRAMES[input.frame] : undefined;
      if (!frame) return json({ error: 'Неизвестное оформление.' }, 400);
      const until = state.frames?.[input.frame!] || 0;
      if (until > now) return json({ error: 'Это оформление уже активно.' }, 409);
      if (state.balance < frame.price) return json({ error: 'Недостаточно Claws для этой рамки.' }, 402);
      state.balance -= frame.price; state.frames = { ...state.frames, [input.frame!]: now + 30 * 86400000 }; state.equippedFrame = input.frame;
      amount = -frame.price; kind = 'frame'; label = `${frame.name} · 30 дней`;
    } else if (input.action === 'equip') {
      const frame = input.equipped || '';
      if (frame && (!state.frames?.[frame] || state.frames[frame] <= now)) return json({ error: 'Срок этого оформления закончился.' }, 409);
      state.equippedFrame = frame || undefined;
      amount = 0; kind = 'style'; label = frame ? `Выбрано: ${FRAMES[frame]?.name || frame}` : 'Снята рамка';
    } else return json({ error: 'Неизвестное действие.' }, 400);
    if (input.operationId) state.operations = { ...state.operations, [input.operationId]: input.action || '' };
    state.ledger.push({ id: input.operationId || crypto.randomUUID(), kind, amount, label, at: now });
    const write = await fetch(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/economy/${uid}.json`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': etag || 'null_etag' }, body: JSON.stringify(state) });
    if (write.status === 412) continue;
    if (!write.ok) throw new Error(`Database ${write.status}`);
    await writePublicStyle(env, uid, state).catch(() => {});
    return json(state);
  }
  return json({ error: 'Баланс одновременно меняется. Повторите операцию.' }, 409);
}
async function giftRequest(request: Request, env: Env, user: AuthUser, action: string) {
  if (await limited(env, request, `gifts:${user.uid}`, 18, 60)) return json({ error: 'Слишком часто. Попробуйте ещё раз через минуту.' }, 429);
  const input = await request.json().catch(() => ({})) as { chatId?: string; giftId?: string; instanceId?: string };
  if (action === 'send') {
    if (!safeId(input.chatId) || !safeId(input.giftId) || !safeId(input.instanceId)) return json({ error: 'Некорректный подарок.' }, 400);
    const chat = await dbRequest<{ id: string; kind: string; title: string } | null>(env, `chats/${input.chatId}`);
    const members = await dbRequest<Record<string, string> | null>(env, `chatMembers/${input.chatId}`);
    if (!chat || chat.kind !== 'dm' || !members?.[user.uid]) return json({ error: 'Подарки пока доступны в личных чатах.' }, 403);
    const recipientId = Object.keys(members).find(uid => uid !== user.uid);
    if (!recipientId || !safeId(recipientId)) return json({ error: 'Получатель не найден.' }, 404);
    const product = SAVANNA_GIFTS[input.giftId];
    if (!product) return json({ error: 'Неизвестный подарок.' }, 400);
    let sent: Economy;
    try {
      sent = await updateEconomy(env, user.uid, state => {
        const old = state.giftsSent?.[input.instanceId!];
        if (old) { if (old.to !== recipientId || old.giftId !== input.giftId) throw new Error('ID подарка уже использован.'); return; }
        if (state.balance < product.price) throw new Error('Недостаточно Claws для подарка.');
        state.balance -= product.price;
        state.giftsSent = { ...state.giftsSent, [input.instanceId!]: { to: recipientId, giftId: input.giftId!, sentAt: Date.now() } };
        state.ledger!.push({ id: input.instanceId!, kind: 'gift_sent', amount: -product.price, label: `Подарок · ${product.name}`, at: Date.now() });
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      if (reason === 'Недостаточно Claws для подарка.') return json({ error: reason }, 402);
      if (reason === 'ID подарка уже использован.') return json({ error: reason }, 409);
      throw error;
    }
    const createdAt = sent.giftsSent?.[input.instanceId!]?.sentAt || Date.now();
    const gift = { id: input.giftId, instanceId: input.instanceId, senderId: user.uid, recipientId, price: product.price, sentAt: createdAt };
    if (!(await dbRequest(env, `receivedGifts/${recipientId}/${input.instanceId}`))) await dbRequest(env, `receivedGifts/${recipientId}/${input.instanceId}`, 'PUT', { ...gift, visible: false, sold: false });
    if (!(await dbRequest(env, `messages/${input.chatId}/${input.instanceId}`))) {
      await dbRequest(env, `messages/${input.chatId}/${input.instanceId}`, 'PUT', { id: input.instanceId, chatId: input.chatId, senderId: user.uid, text: `Подарок: ${product.name}`, type: 'gift', gift, createdAt });
      await dbRequest(env, `chatActivity/${input.chatId}`, 'PUT', { updatedAt: createdAt, lastText: `Подарок · ${product.name}`, lastSenderId: user.uid });
    }
    return json({ ok: true, balance: sent.balance });
  }
  if (!safeId(input.instanceId)) return json({ error: 'Подарок не найден.' }, 400);
  const gift = await dbRequest<{ id: string; instanceId: string; price: number; visible?: boolean; sold?: boolean } | null>(env, `receivedGifts/${user.uid}/${input.instanceId}`);
  if (!gift || gift.instanceId !== input.instanceId) return json({ error: 'Этот подарок не найден.' }, 404);
  if (action === 'show') {
    if (gift.sold) return json({ error: 'Проданный подарок нельзя разместить в профиле.' }, 409);
    const visible = !gift.visible;
    const changes: Record<string, unknown> = { [`receivedGifts/${user.uid}/${input.instanceId}/visible`]: visible };
    changes[`publicGiftProfiles/${user.uid}/${input.instanceId}`] = visible ? { id: gift.id, instanceId: gift.instanceId, price: gift.price } : null;
    await dbRequest(env, '', 'PATCH', changes);
    return json({ ok: true, visible });
  }
  if (action === 'sell') {
    if (gift.sold) return json({ error: 'Подарок уже продан.' }, 409);
    const value = Math.floor(gift.price / 2);
    await updateEconomy(env, user.uid, state => {
      if (state.giftSales?.[input.instanceId!]) return;
      state.giftSales = { ...state.giftSales, [input.instanceId!]: true };
      state.balance += value;
      state.ledger!.push({ id: input.instanceId!, kind: 'gift_sale', amount: value, label: 'Продажа подарка · 50%', at: Date.now() });
    });
    await dbRequest(env, `receivedGifts/${user.uid}/${input.instanceId}/sold`, 'PUT', true);
    return json({ ok: true, claws: value });
  }
  return json({ error: 'Действие неизвестно.' }, 404);
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
        else if (url.pathname.startsWith('/api/v2/') && request.method === 'POST') result = await v2Request(request, env, user, url.pathname.slice('/api/v2/'.length));
        else if (url.pathname === '/api/links/join' && request.method === 'POST') result = await join(request, env, user);
        else if (url.pathname === '/api/links/join-public' && request.method === 'POST') result = await joinPublic(request, env, user);
        else if (url.pathname === '/api/chats/direct' && request.method === 'POST') result = await createDirect(request, env, user);
        else if (url.pathname === '/api/media' && request.method === 'POST') result = await uploadMedia(request, env, user, url);
        else if (url.pathname === '/api/media/share' && request.method === 'POST') result = await shareMedia(request, env, user);
        else if (url.pathname === '/api/media/forward' && request.method === 'POST') result = await forwardMedia(request, env, user);
        else if (url.pathname === '/api/media' && request.method === 'GET') result = await downloadMedia(env, user, url);
        else if (url.pathname === '/api/media/delete' && request.method === 'POST') result = await deleteMedia(request, env, user);
        else if (url.pathname === '/api/messages/delete' && request.method === 'POST') result = await deleteMessage(request, env, user);
        else if (url.pathname === '/api/push/message' && request.method === 'POST') result = await pushMessage(request, env, user);
        else if (url.pathname === '/api/economy' && (request.method === 'GET' || request.method === 'POST')) result = await economyRequest(request, env, user);
        else if (url.pathname.startsWith('/api/gifts/') && request.method === 'POST') result = await giftRequest(request, env, user, url.pathname.split('/').pop() || '');
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
