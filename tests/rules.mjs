import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

const env = await initializeTestEnvironment({ projectId: 'demo-pride', database: { host: process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1', port: Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT || 9000), rules: readFileSync('database.rules.json', 'utf8') } });
try {
  await env.clearDatabase();
  const alice = env.authenticatedContext('alice', { email: 'alice@example.com' }).database();
  const bob = env.authenticatedContext('bob', { email: 'bob@example.com' }).database();
  const carol = env.authenticatedContext('carol', { email: 'carol@example.com' }).database();
  const guest = env.unauthenticatedContext().database();
  await assertFails(guest.ref('users/alice').get());
  await assertSucceeds(alice.ref('usernames/alice').set({ uid: 'alice' }));
  await assertFails(bob.ref('usernames/alice').set({ uid: 'bob' }));
  await assertSucceeds(alice.ref('publicProfiles/alice').set({ uid: 'alice', username: 'alice', displayName: 'Alice' }));
  await assertSucceeds(bob.ref('publicProfiles/alice').get());
  await assertFails(bob.ref('publicProfiles/alice').set({ uid: 'alice', username: 'alice', displayName: 'Imposter' }));
  await assertFails(alice.ref('publicProfiles/alice/email').set('alice@example.com'));
  for (const theme of ['day', 'evening', 'night']) await assertSucceeds(alice.ref('userSettings/alice/theme').set(theme));
  await assertFails(alice.ref('userSettings/alice/theme').set('sunset'));
  const profile = { uid: 'alice', username: 'alice', displayName: 'Alice', bio: '', createdAt: Date.now() };
  await assertSucceeds(alice.ref().update(Object.fromEntries(Object.entries(profile).map(([key, value]) => [`users/alice/${key}`, value]))));
  await assertFails(bob.ref('users/alice/displayName').set('Hacked'));
  await assertFails(alice.ref('users/alice/role').set('admin'));
  await assertSucceeds(alice.ref('userPrivate/alice/email').set('alice@example.com'));
  await assertFails(alice.ref('userPrivate/alice/email').set('bob@example.com'));
  await assertFails(bob.ref('userPrivate/alice/email').get());
  await assertSucceeds(alice.ref('usernames/alice2').set({ uid: 'alice' }));
  await assertSucceeds(alice.ref().update({ 'users/alice/username': 'alice2', 'usernames/alice': null }));
  assert.equal((await alice.ref('usernames/alice').get()).exists(), false);
  await assertSucceeds(bob.ref('usernames/bob').set({ uid: 'bob' }));
  await assertSucceeds(bob.ref().update({ 'users/bob/uid': 'bob', 'users/bob/username': 'bob', 'users/bob/displayName': 'Bob', 'users/bob/bio': '', 'users/bob/createdAt': Date.now(), 'userPrivate/bob/email': 'bob@example.com', 'userSettings/bob/theme': 'night' }));
  await assertFails(alice.ref('userSettings/alice/theme').set('sunset'));
  await assertSucceeds(alice.ref('userSettings/alice/theme').set('evening'));
  await assertFails(alice.ref('userSettings/alice/theme').set('ultraviolet'));
  await assertSucceeds(alice.ref('userChatPrefs/alice/group_test/background').set('savanna'));
  await assertSucceeds(alice.ref('userChatPrefs/alice/group_test/background').set('day'));
  await assertSucceeds(alice.ref('userChatPrefs/alice/group_test/background').set('night'));
  await assertSucceeds(alice.ref('userChatPrefs/alice/group_test/background').set('cheetah'));
  await assertSucceeds(alice.ref('userChatPrefs/alice/group_test/background').set('lion'));
  await assertFails(alice.ref('userChatPrefs/alice/group_test/background').set('ultraviolet'));
  await assertSucceeds(alice.ref('trail/alice/msg_saved').set({ chatId: 'group_test', messageId: 'msg_saved', preview: 'Private note', authorId: 'alice', chatTitle: 'Test', createdAt: Date.now(), mediaKind: 'image' }));
  await assertFails(bob.ref('trail/alice/msg_saved').get());
  await assertFails(bob.ref('trail/alice/forged').set({ chatId: 'group_test', messageId: 'forged', preview: 'Not mine', authorId: 'bob', chatTitle: 'Test', createdAt: Date.now() }));
  await assertSucceeds(alice.ref('userSettings/alice/notifications/preview').set(false));
  await assertFails(bob.ref('userSettings/alice/notifications/preview').get());
  const chat = { id: 'group_test', kind: 'group', title: 'Test', description: '', creatorId: 'alice', public: false, inviteCode: 'abcdefgh12345678', createdAt: Date.now(), updatedAt: Date.now() };
  await assertFails(alice.ref('chats/dm_alice_bob').set({ ...chat, id: 'dm_alice_bob', kind: 'dm' }));
  await assertFails(alice.ref('chats/dm_alice_bob').set({ ...chat, id: 'dm_alice_bob' }));
  await assertSucceeds(alice.ref('chats/group_test').set(chat));
  await assertFails(alice.ref('publicSpaces/group_test').set({ id: 'group_test', kind: 'group', title: 'Test' }));
  await assertSucceeds(alice.ref('chatMembers/group_test/alice').set('owner'));
  await assertSucceeds(alice.ref('chatMembers/group_test/bob').set('member'));
  await assertSucceeds(carol.ref('userSettings/carol/privacy/allowGroupAdds').set(false));
  await assertFails(alice.ref('chatMembers/group_test/carol').set('member'));
  await assertFails(bob.ref('userSettings/carol/privacy/allowGroupAdds').get());
  await assertSucceeds(alice.ref('userChats/bob/group_test').set(true));
  await assertSucceeds(bob.ref('chats/group_test').get());
  await assertFails(carol.ref('chats/group_test').get());
  await assertSucceeds(carol.ref('userSettings/carol/privacy/showPresence').set(false));
  await assertSucceeds(carol.ref('presence/carol').set({ online: true, lastSeen: Date.now() }));
  await assertFails(bob.ref('presence/carol').get());
  await assertSucceeds(carol.ref('presence/carol').get());
  await assertFails(bob.ref('chatMembers/group_test/bob').set('admin'));
  const message = { id: 'msg_test', chatId: 'group_test', senderId: 'alice', text: 'Hello', createdAt: Date.now() };
  await assertSucceeds(alice.ref('messages/group_test/msg_test').set(message));
  await assertFails(alice.ref('messages/group_test/forged_gift').set({ id: 'forged_gift', chatId: 'group_test', senderId: 'alice', text: 'Подарок', type: 'gift', createdAt: Date.now() }));
  await assertSucceeds(bob.ref('messages/group_test/msg_test').get());
  await assertFails(carol.ref('messages/group_test/msg_test').get());
  await assertSucceeds(alice.ref('chatMembers/group_test/bob').set('admin'));
  await assertSucceeds(carol.ref('userSettings/carol/privacy/allowGroupAdds').set(true));
  await assertSucceeds(bob.ref('chatMembers/group_test/carol').set('member'));
  await assertSucceeds(bob.ref('userChats/carol/group_test').set(true));
  await assertFails(bob.ref('chatMembers/group_test/carol').set('admin'));
  await assertFails(bob.ref('messages/group_test/msg_test/text').set('Hacked'));
  await assertSucceeds(alice.ref('messages/group_test/msg_test').update({ text: 'Edited', editedAt: Date.now() }));
  await assertSucceeds(alice.ref('chatActivity/group_test').set({ updatedAt: Date.now(), lastText: 'Edited', lastSenderId: 'alice' }));
  await assertSucceeds(bob.ref('readReceipts/group_test/bob').set(Date.now()));
  await assertSucceeds(bob.ref('userSettings/bob/privacy/readReceipts').set(false));
  await assertFails(bob.ref('readReceipts/group_test/bob').set(Date.now()));
  await assertSucceeds(bob.ref('readReceipts/group_test/bob').set(null));
  await assertSucceeds(bob.ref('userSettings/bob/privacy/typingIndicator').set(false));
  await assertFails(bob.ref('typing/group_test/bob').set(Date.now()));
  await assertSucceeds(bob.ref('typing/group_test/bob').set(null));
  await assertSucceeds(bob.ref('reactions/group_test/msg_test/bob').set('🔥'));
  await assertFails(bob.ref('messages/group_test/evil_media').set({ id: 'evil_media', chatId: 'group_test', senderId: 'bob', text: '', createdAt: Date.now(), media: { kind: 'image', name: 'x', url: 'chats/other/bob/x', size: 5, mime: 'image/png' } }));
  const channel = { ...chat, id: 'channel_test', kind: 'channel', title: 'Channel', public: true };
  await assertSucceeds(alice.ref('chats/channel_test').set(channel));
  await assertSucceeds(alice.ref('publicSpaces/channel_test').set({ id: 'channel_test', kind: 'channel', title: 'Channel', description: '' }));
  await assertSucceeds(bob.ref('publicSpaces').get());
  await assertFails(guest.ref('publicSpaces').get());
  await assertSucceeds(alice.ref('chatMembers/channel_test/alice').set('owner'));
  await assertSucceeds(alice.ref('chatMembers/channel_test/bob').set('member'));
  await assertFails(bob.ref('messages/channel_test/msg_test').set({ ...message, chatId: 'channel_test', senderId: 'bob' }));
  await assertSucceeds(alice.ref('economy/alice').get());
  await assertFails(alice.ref('economy/alice').set({ balance: 999999 }));
  await assertFails(bob.ref('economy/alice').get());
  const call = { callerId: 'alice', callerName: 'Alice', video: true, status: 'ringing', createdAt: Date.now(), offer: { type: 'offer', sdp: 'v=0' } };
  await assertSucceeds(alice.ref('calls/group_test').set(call));
  await assertSucceeds(bob.ref('calls/group_test/answer').set({ type: 'answer', sdp: 'v=0' }));
  await assertSucceeds(bob.ref('calls/group_test/status').set('active'));
  await assertSucceeds(bob.ref('calls/group_test').get());
  await assertFails(guest.ref('calls/group_test').get());
  await assertFails(alice.ref('calls/group_test/untrusted').set('unexpected'));
  const helperRole = { id: 'helper', name: 'Helper', color: '#eebb77', priority: 10, permissions: { manage_messages: true } };
  await assertSucceeds(alice.ref('chatRoles/group_test/helper').set(helperRole));
  await assertSucceeds(alice.ref('roleAssignments/group_test/carol').set('helper'));
  await assertFails(bob.ref('chatRoles/group_test/helper').set(helperRole));
  const pollMessage = { id: 'msg_poll', chatId: 'group_test', senderId: 'alice', text: '', type: 'poll', poll: { question: 'Choose an option', options: [{ id: '0', text: 'Sunrise' }, { id: '1', text: 'Sunset' }], allowChange: true }, createdAt: Date.now() };
  await assertSucceeds(alice.ref('messages/group_test/msg_poll').set(pollMessage));
  await assertSucceeds(bob.ref('pollVotes/group_test/msg_poll/bob').set('1'));
  await assertFails(bob.ref('pollVotes/group_test/msg_poll/alice').set('0'));
  await assertFails(bob.ref('devices/alice').get());
  const actual = (await alice.ref('messages/group_test/msg_test/text').get()).val();
  assert.equal(actual, 'Edited');
  const bobMessage = { id: 'msg_bob', chatId: 'group_test', senderId: 'bob', text: 'By Bob', createdAt: Date.now() };
  await assertSucceeds(bob.ref('messages/group_test/msg_bob').set(bobMessage));
  await assertFails(alice.ref('messages/group_test/msg_bob/text').set('Owner rewrite'));
  await assertSucceeds(alice.ref('messages/group_test/msg_bob').update({ deleted: true, text: '' }));
  const moderationMessage = { id: 'msg_moderation', chatId: 'group_test', senderId: 'alice', text: 'Moderate me', createdAt: Date.now() };
  await assertSucceeds(alice.ref('messages/group_test/msg_moderation').set(moderationMessage));
  await assertSucceeds(alice.ref('chatMembers/group_test/bob').set('moderator'));
  await assertFails(bob.ref('messages/group_test/msg_moderation/text').set('Moderator rewrite'));
  await assertSucceeds(bob.ref('messages/group_test/msg_moderation').update({ deleted: true, text: '' }));
  await env.withSecurityRulesDisabled(async context => {
    await context.database().ref().update({
      'v2/usersPublic/alice': { uid: 'alice', username: 'alice', displayName: 'Alice', migrationVersion: 2 },
      'v2/prides/pride_test': { id: 'pride_test', title: 'Test', ownerId: 'alice' },
      'v2/prideMembers/pride_test/alice': 'owner',
      'v2/prideMembers/pride_test/bob': 'member',
      'v2/userPrides/alice/pride_test': true,
      'v2/channels/pride_test/channel_test': { id: 'channel_test', prideId: 'pride_test', title: 'general', kind: 'text' },
      'v2/channelPrides/channel_test': 'pride_test',
      'v2/messages/channel_test/message_test': { id: 'message_test', channelId: 'channel_test', senderId: 'alice', text: 'Hello', createdAt: Date.now() },
      'v2/reports/pride_test/report_test': { id: 'report_test', reporterId: 'bob', reason: 'Spam', status: 'open', createdAt: Date.now() },
      'v2/audit/pride_test/audit_test': { actorId: 'alice', action: 'channel_created', at: Date.now() },
      'v2/bans/pride_test/carol': { actorId: 'alice', reason: 'Spam', at: Date.now() }
    });
  });
  await assertSucceeds(bob.ref('v2/prides/pride_test').get());
  await assertFails(carol.ref('v2/prides/pride_test').get());
  await assertSucceeds(bob.ref('v2/channels/pride_test').get());
  await assertFails(carol.ref('v2/channels/pride_test').get());
  await assertSucceeds(bob.ref('v2/messages/channel_test').get());
  await assertFails(carol.ref('v2/messages/channel_test').get());
  await assertFails(bob.ref('v2/messages/channel_test/message_test').set({ text: 'Forged' }));
  await assertFails(alice.ref('v2/prideMembers/pride_test/bob').set('admin'));
  await assertFails(bob.ref('v2/userPrides/alice').get());
  await assertSucceeds(alice.ref('v2/reports/pride_test').get());
  await assertFails(bob.ref('v2/reports/pride_test').get());
  await assertFails(bob.ref('v2/reports/pride_test/forged').set({ reason: 'fake' }));
  await assertSucceeds(alice.ref('v2/audit/pride_test').get());
  await assertFails(bob.ref('v2/audit/pride_test').get());
  await assertFails(bob.ref('v2/audit/pride_test/forged').set({ action: 'fake' }));
  await assertSucceeds(alice.ref('v2/bans/pride_test').get());
  await assertFails(bob.ref('v2/bans/pride_test').get());
  await assertFails(alice.ref('v2/bans/pride_test/bob').set({ reason: 'fake' }));
  await env.withSecurityRulesDisabled(async context => {
    await context.database().ref('v2/prideMembers/pride_test/bob').set('moderator');
  });
  await assertSucceeds(bob.ref('v2/reports/pride_test').get());
  await assertFails(bob.ref('v2/audit/pride_test').get());
  await assertFails(bob.ref('v2/bans/pride_test').get());
  await env.withSecurityRulesDisabled(async context => {
    await context.database().ref('v2/bans/pride_test/bob').set({ actorId: 'alice', at: Date.now(), reason: 'Ban during join' });
  });
  await assertFails(bob.ref('v2/prides/pride_test').get());
  await assertFails(bob.ref('v2/messages/channel_test').get());
  await assertFails(bob.ref('v2/reports/pride_test').get());
  await assertSucceeds(alice.ref('v2/drafts/alice/channel_test').set('Saved draft'));
  await assertFails(bob.ref('v2/drafts/alice/channel_test').get());
  console.log('Firebase rules: access checks passed');
} finally { await env.cleanup(); }
