export type Tier = 'starter' | 'silver' | 'gold' | 'elite';

/** Support-thread lifecycle status (plan §3 P1-11). */
export type SupportThreadStatus = 'open' | 'resolved';

/**
 * Row shape shared by the server page (@/lib/supportThreads.loadSupportThreads)
 * and GET /api/admin/support/threads — mirrors lib/supportThreads.ts's
 * SupportThreadRow exactly (kept as a separate type here so this directory's
 * client components import from a stable local path, same idiom as the rest
 * of the admin console's per-page `types.ts` files).
 */
export interface SupportThreadRow {
  account: {
    id: string;
    displayName: string;
    email: string;
    tier: Tier;
  };
  lastBody: string;
  lastAt: string;
  lastSender: 'user' | 'coach';
  unread: number;
  status: SupportThreadStatus;
  assignedTo: string | null;
  assignedToLabel: string | null;
  resolvedAt: string | null;
}

/** One message in a thread — matches GET/POST /api/admin/support/threads/[accountId]. */
export interface SupportMessage {
  id: string;
  sender: 'user' | 'coach';
  senderAccountId: string | null;
  body: string;
  createdAt: string;
}
