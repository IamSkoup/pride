import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.ts';

const env = { FRONTEND_ORIGIN: 'https://iamskoup.github.io' } as Parameters<typeof worker.fetch>[1];

test('v2 protected endpoints require a verified Firebase session', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/v2/pride', { method: 'POST', headers: { Origin: env.FRONTEND_ORIGIN }, body: '{}' }), env);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.FRONTEND_ORIGIN);
});

test('Worker denies an unexpected browser origin before processing requests', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/v2/pride', { method: 'POST', headers: { Origin: 'https://other.example' }, body: '{}' }), env);
  assert.equal(response.status, 403);
});

test('ban endpoint enforces rank hierarchy and records a successful ban atomically', async () => {
  const key = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const exported = Buffer.from(await crypto.subtle.exportKey('pkcs8', key.privateKey)).toString('base64');
  const privateKey = `-----BEGIN PRIVATE KEY-----\n${exported}\n-----END PRIVATE KEY-----`;
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const roles: Record<string, string> = { owner_user: 'owner', admin_user: 'admin', mod_user: 'moderator', member_user: 'member' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'identitytoolkit.googleapis.com') {
      const token = JSON.parse(String(init?.body)).idToken as string;
      return Response.json({ users: [{ localId: token }] });
    }
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-token', expires_in: 3600 });
    if (url.hostname === 'db.test') {
      const path = url.pathname.slice(1).replace(/\.json$/, '');
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) as unknown : undefined;
      calls.push({ path, method, body });
      if (method === 'GET' && path.startsWith('v2/prideMembers/pride_test/')) return Response.json(roles[path.split('/').at(-1)!] || null);
      return Response.json(null);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const testEnv = { ...env, FIREBASE_DATABASE_URL: 'https://db.test', FIREBASE_WEB_API_KEY: 'test', FIREBASE_SERVICE_ACCOUNT_EMAIL: 'test@example.com', FIREBASE_PRIVATE_KEY: privateKey, RATE_LIMIT: { get: async () => null, put: async () => {} } } as Parameters<typeof worker.fetch>[1];
  async function ban(actor: string, targetId: string) {
    return worker.fetch(new Request('https://worker.example/api/v2/ban', { method: 'POST', headers: { Origin: env.FRONTEND_ORIGIN, Authorization: `Bearer ${actor}` }, body: JSON.stringify({ prideId: 'pride_test', targetId }) }), testEnv);
  }
  try {
    assert.equal((await ban('admin_user', 'owner_user')).status, 403);
    assert.equal((await ban('mod_user', 'member_user')).status, 403);
    assert.equal((await ban('admin_user', 'member_user')).status, 200);
    const patch = calls.find(call => call.path === '' && call.method === 'PATCH');
    assert.ok(patch);
    const changes = patch.body as Record<string, unknown>;
    assert.equal(changes['v2/prideMembers/pride_test/member_user'], null);
    assert.equal(changes['v2/userPrides/member_user/pride_test'], null);
    assert.equal((changes['v2/bans/pride_test/member_user'] as { actorId: string }).actorId, 'admin_user');
    assert.ok(Object.keys(changes).some(path => path.startsWith('v2/audit/pride_test/')));
  } finally { globalThis.fetch = originalFetch; }
});
