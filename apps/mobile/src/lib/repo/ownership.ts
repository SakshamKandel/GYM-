const ACCOUNT_OWNER_PREFIX = 'account:';
const ANONYMOUS_OWNER_PREFIX = 'anonymous:';

/**
 * Rows written before owner scoping landed are deliberately unreachable.
 * There is no safe way to infer which account created them on a shared device.
 */
export const LEGACY_QUARANTINE_OWNER_ID = 'legacy-quarantine:v1';

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label} must not be empty`);
  return normalized;
}

export function ownerIdForAccount(accountId: string): string {
  return `${ACCOUNT_OWNER_PREFIX}${requireIdentifier(accountId, 'accountId')}`;
}

export function ownerIdForAnonymousSession(sessionId: string): string {
  return `${ANONYMOUS_OWNER_PREFIX}${requireIdentifier(sessionId, 'sessionId')}`;
}

export function isUsableOwnerId(ownerId: string): boolean {
  return (
    (ownerId.startsWith(ACCOUNT_OWNER_PREFIX) && ownerId.length > ACCOUNT_OWNER_PREFIX.length) ||
    (ownerId.startsWith(ANONYMOUS_OWNER_PREFIX) &&
      ownerId.length > ANONYMOUS_OWNER_PREFIX.length)
  );
}

export function isAnonymousOwnerId(ownerId: string): boolean {
  return (
    ownerId.startsWith(ANONYMOUS_OWNER_PREFIX) &&
    ownerId.length > ANONYMOUS_OWNER_PREFIX.length
  );
}

export function assertUsableOwnerId(ownerId: string): void {
  if (!isUsableOwnerId(ownerId)) {
    throw new Error('Repository owner is not an active account or anonymous session');
  }
}

export function assertAnonymousOwnerId(ownerId: string): void {
  if (!isAnonymousOwnerId(ownerId)) {
    throw new Error('Signed-out repository owner must be an anonymous session');
  }
}
