export type PrideRole = 'owner' | 'admin' | 'moderator' | 'member';
export type ChannelKind = 'text' | 'chronicle';
export type PridePermission = 'send_messages' | 'publish_chronicle' | 'add_reactions' | 'manage_messages' | 'manage_channels' | 'manage_roles' | 'kick_members' | 'ban_members' | 'view_audit_log' | 'review_reports';

const permissions: Record<PrideRole, readonly PridePermission[]> = {
  owner: ['send_messages', 'publish_chronicle', 'add_reactions', 'manage_messages', 'manage_channels', 'manage_roles', 'kick_members', 'ban_members', 'view_audit_log', 'review_reports'],
  admin: ['send_messages', 'publish_chronicle', 'add_reactions', 'manage_messages', 'manage_channels', 'kick_members', 'ban_members', 'view_audit_log', 'review_reports'],
  moderator: ['send_messages', 'add_reactions', 'manage_messages', 'kick_members', 'review_reports'],
  member: ['send_messages', 'add_reactions'],
};

export function hasPermission(role: PrideRole | null, permission: PridePermission) {
  return role !== null && permissions[role]?.includes(permission) === true;
}

export function canManage(role: PrideRole | null) {
  return hasPermission(role, 'manage_channels');
}

export function canPost(role: PrideRole | null, kind: ChannelKind) {
  return hasPermission(role, kind === 'chronicle' ? 'publish_chronicle' : 'send_messages');
}

export function canAssign(actor: PrideRole | null, target: PrideRole | null, next: PrideRole) {
  return hasPermission(actor, 'manage_roles') && target !== null && target !== 'owner' && next !== 'owner';
}

export function canModerate(actor: PrideRole | null, target: PrideRole | null, action: 'kick' | 'ban') {
  if (!hasPermission(actor, action === 'kick' ? 'kick_members' : 'ban_members') || target === null) return false;
  if (actor === 'owner') return target !== 'owner';
  if (actor === 'admin') return target === 'moderator' || target === 'member';
  return actor === 'moderator' && target === 'member' && action === 'kick';
}
