/**
 * Permission catalogue.
 *
 * Permissions are strings, roles are database rows. That combination means the
 * Owner can invent a new role at 2am without a deploy, while the set of things
 * a role *can* be granted stays reviewable in version control.
 *
 * Wildcards are supported: "store.*" matches "store.refund"; "*" matches all.
 */

export const PERMISSIONS = {
  // Profile / self-service (held by every logged-in user)
  PROFILE_EDIT: 'profile.edit',
  PROFILE_DELETE: 'profile.delete',

  // Store
  STORE_PURCHASE: 'store.purchase',
  STORE_GIFT: 'store.gift',
  STORE_MANAGE: 'store.manage',
  STORE_REFUND: 'store.refund',
  STORE_COUPON_MANAGE: 'store.coupon.manage',

  // Coins economy
  COINS_SPEND: 'coins.spend',
  COINS_VIEW_ANY: 'coins.view.any',
  COINS_ADJUST: 'coins.adjust',

  // Content
  NEWS_CREATE: 'news.create',
  NEWS_PUBLISH: 'news.publish',
  NEWS_DELETE: 'news.delete',
  COMMENT_CREATE: 'comment.create',
  COMMENT_MODERATE: 'comment.moderate',
  WIKI_EDIT: 'wiki.edit',
  EVENT_MANAGE: 'event.manage',

  // Support
  TICKET_CREATE: 'ticket.create',
  TICKET_READ_ALL: 'ticket.read.all',
  TICKET_REPLY: 'ticket.reply',
  TICKET_ASSIGN: 'ticket.assign',
  TICKET_CLOSE: 'ticket.close',

  // Moderation
  USER_READ: 'user.read',
  USER_EDIT: 'user.edit',
  USER_PUNISH: 'user.punish',
  USER_UNPUNISH: 'user.unpunish',
  USER_IMPERSONATE: 'user.impersonate',

  // Administration
  ROLE_READ: 'role.read',
  ROLE_MANAGE: 'role.manage',
  SETTINGS_MANAGE: 'settings.manage',
  MAINTENANCE_TOGGLE: 'maintenance.toggle',
  ANNOUNCEMENT_SEND: 'announcement.send',

  // Observability
  AUDIT_READ: 'audit.read',
  SECURITY_READ: 'security.read',
  ANALYTICS_READ: 'analytics.read',
  ERRORS_READ: 'errors.read',
  CONSOLE_READ: 'console.read',
  MONITORING_READ: 'monitoring.read',

  // Infrastructure
  BACKUP_CREATE: 'backup.create',
  BACKUP_RESTORE: 'backup.restore',
  FILES_READ: 'files.read',
  FILES_WRITE: 'files.write',
  APIKEY_MANAGE: 'apikey.manage',

  ALL: '*',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const PLAYER_BASE: string[] = [
  PERMISSIONS.PROFILE_EDIT,
  PERMISSIONS.PROFILE_DELETE,
  PERMISSIONS.STORE_PURCHASE,
  PERMISSIONS.STORE_GIFT,
  PERMISSIONS.COINS_SPEND,
  PERMISSIONS.COMMENT_CREATE,
  PERMISSIONS.TICKET_CREATE,
];

const MODERATOR: string[] = [
  ...PLAYER_BASE,
  PERMISSIONS.USER_READ,
  PERMISSIONS.USER_PUNISH,
  PERMISSIONS.COMMENT_MODERATE,
  PERMISSIONS.TICKET_READ_ALL,
  PERMISSIONS.TICKET_REPLY,
  PERMISSIONS.TICKET_CLOSE,
  PERMISSIONS.CONSOLE_READ,
];

const ADMINISTRATOR: string[] = [
  ...MODERATOR,
  PERMISSIONS.USER_EDIT,
  PERMISSIONS.USER_UNPUNISH,
  PERMISSIONS.TICKET_ASSIGN,
  PERMISSIONS.NEWS_CREATE,
  PERMISSIONS.NEWS_PUBLISH,
  PERMISSIONS.NEWS_DELETE,
  PERMISSIONS.WIKI_EDIT,
  PERMISSIONS.EVENT_MANAGE,
  PERMISSIONS.STORE_MANAGE,
  PERMISSIONS.STORE_COUPON_MANAGE,
  PERMISSIONS.ROLE_READ,
  PERMISSIONS.ANNOUNCEMENT_SEND,
  PERMISSIONS.AUDIT_READ,
  PERMISSIONS.SECURITY_READ,
  PERMISSIONS.ANALYTICS_READ,
  PERMISSIONS.MONITORING_READ,
  PERMISSIONS.COINS_VIEW_ANY,
  PERMISSIONS.COINS_ADJUST,
];

/**
 * Seeded roles. `weight` is the hierarchy: staff may only act on users whose
 * highest weight is strictly lower than their own, so a Moderator can never
 * ban an Administrator and nobody can edit a role above themselves.
 */
export const DEFAULT_ROLES = [
  { key: 'guest',     name: 'Guest',         weight: 0,   color: '#6B7280', isStaff: false, isDefault: false, isPurchasable: false, permissions: [] as string[] },
  { key: 'player',    name: 'Player',        weight: 10,  color: '#94A3B8', isStaff: false, isDefault: true,  isPurchasable: false, permissions: PLAYER_BASE },
  // The purchasable ladder. Colours are taken from the rank badge artwork so
  // a username in chat matches the image on the store card.
  { key: 'knight',    name: 'Knight',        weight: 20,  color: '#C9A227', isStaff: false, isDefault: false, isPurchasable: true,  permissions: PLAYER_BASE },
  { key: 'lord',      name: 'Lord',          weight: 30,  color: '#7FD13B', isStaff: false, isDefault: false, isPurchasable: true,  permissions: PLAYER_BASE },
  { key: 'paladin',   name: 'Paladin',       weight: 40,  color: '#4FD1E0', isStaff: false, isDefault: false, isPurchasable: true,  permissions: PLAYER_BASE },
  { key: 'duke',      name: 'Duke',          weight: 50,  color: '#E0483C', isStaff: false, isDefault: false, isPurchasable: true,  permissions: PLAYER_BASE },
  { key: 'king',      name: 'King',          weight: 55,  color: '#E8B923', isStaff: false, isDefault: false, isPurchasable: true,  permissions: PLAYER_BASE },
  { key: 'moderator', name: 'Moderator',     weight: 60,  color: '#38BDF8', isStaff: true,  isDefault: false, isPurchasable: false, permissions: MODERATOR },
  { key: 'admin',     name: 'Administrator', weight: 80,  color: '#F43F5E', isStaff: true,  isDefault: false, isPurchasable: false, permissions: ADMINISTRATOR },
  { key: 'developer', name: 'Developer',     weight: 95,  color: '#8B5CF6', isStaff: true,  isDefault: false, isPurchasable: false, permissions: [PERMISSIONS.ALL] },
  { key: 'owner',     name: 'Owner',         weight: 100, color: '#C77DFF', isStaff: true,  isDefault: false, isPurchasable: false, permissions: [PERMISSIONS.ALL] },
] as const;

/** Resolve a permission check against a set of granted strings, honouring wildcards. */
export function hasPermission(granted: Iterable<string>, required: string): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  if (set.has('*') || set.has(required)) return true;

  const parts = required.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    if (set.has(`${parts.slice(0, i).join('.')}.*`)) return true;
  }
  return false;
}
