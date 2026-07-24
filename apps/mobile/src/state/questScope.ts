/** Stable persistence namespace for an authenticated account or local guest. */
export function questScopeId(accountId: string | null | undefined): string {
  return accountId ? `account:${accountId}` : 'anonymous';
}
