/**
 * Legacy import path — the marketing shell moved to components/marketing/Shell
 * in the 2026-07-21 site revamp. Pages that still import MarketingShell get
 * the new chrome automatically.
 */
import type { ReactNode } from 'react';
import { Shell } from '@/components/marketing/Shell';

export function MarketingShell({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}
