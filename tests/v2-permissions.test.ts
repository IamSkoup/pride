import test from 'node:test';
import assert from 'node:assert/strict';
import { canAssign, canManage, canModerate, canPost, hasPermission } from '../worker/v2-permissions.ts';

test('members can speak in a Trail but cannot publish Chronicle posts', () => {
  assert.equal(canPost('member', 'text'), true);
  assert.equal(canPost('member', 'chronicle'), false);
  assert.equal(canPost(null, 'text'), false);
  assert.equal(canPost('admin', 'chronicle'), true);
  assert.equal(canPost('moderator', 'chronicle'), false);
  assert.equal(hasPermission('moderator', 'manage_messages'), true);
  assert.equal(hasPermission('member', 'manage_messages'), false);
});

test('only the owner can assign non-owner ranks to existing non-owner members', () => {
  assert.equal(canManage('admin'), true);
  assert.equal(canAssign('owner', 'member', 'admin'), true);
  assert.equal(canAssign('admin', 'member', 'admin'), false);
  assert.equal(canAssign('owner', 'owner', 'member'), false);
  assert.equal(canAssign('owner', null, 'admin'), false);
  assert.equal(canAssign('owner', 'member', 'owner'), false);
  assert.equal(canAssign('owner', 'member', 'moderator'), true);
});

test('moderation respects rank hierarchy and keeps ban authority with administrators', () => {
  assert.equal(canModerate('owner', 'admin', 'ban'), true);
  assert.equal(canModerate('admin', 'owner', 'kick'), false);
  assert.equal(canModerate('admin', 'admin', 'ban'), false);
  assert.equal(canModerate('admin', 'moderator', 'ban'), true);
  assert.equal(canModerate('moderator', 'member', 'kick'), true);
  assert.equal(canModerate('moderator', 'member', 'ban'), false);
  assert.equal(canModerate('member', 'member', 'kick'), false);
  assert.equal(canModerate('owner', null, 'ban'), false);
});
