export type Tier = 'starter' | 'silver' | 'gold' | 'elite';

/** Row shape shared by the server page (loadThreads) and GET /api/admin/support/threads. */
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
}

/** One message in a thread — matches GET/POST /api/admin/support/threads/[accountId]. */
export interface SupportMessage {
  id: string;
  sender: 'user' | 'coach';
  senderAccountId: string | null;
  body: string;
  createdAt: string;
}
