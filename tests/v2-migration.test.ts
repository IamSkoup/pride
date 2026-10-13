import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateProfile, needsProfileMigration } from '../worker/v2-migration.ts';

test('profile migration retains identity and public profile fields', () => {
  const result = migrateProfile('existing-uid', { username: 'acacia', displayName: 'Acacia', avatar: 'https://example.org/a.png', bio: 'Hello' });
  assert.equal(result.uid, 'existing-uid');
  assert.equal(result.legacyUid, 'existing-uid');
  assert.equal(result.username, 'acacia');
  assert.equal(result.avatar, 'https://example.org/a.png');
  assert.equal(result.migrationVersion, 2);
});

test('completed migration is skipped on retry', () => {
  assert.equal(needsProfileMigration(null), true);
  assert.equal(needsProfileMigration({ migrationVersion: 1 }), true);
  assert.equal(needsProfileMigration({ migrationVersion: 2 }), false);
});
