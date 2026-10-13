export type LegacyProfile = {
  username?: string;
  displayName?: string;
  avatar?: string;
  bio?: string;
};

export function needsProfileMigration(
  current: { migrationVersion?: number } | null,
) {
  return current?.migrationVersion !== 2;
}

export function migrateProfile(uid: string, legacy: LegacyProfile) {
  return {
    uid,
    username: legacy.username || "",
    displayName: legacy.displayName || "",
    avatar: legacy.avatar || "",
    bio: legacy.bio || "",
    migrationVersion: 2,
    legacyUid: uid,
  };
}
