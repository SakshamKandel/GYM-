'use client';

import { Button } from '@/components/console';

/** Triggers the browser print dialog for the kitchen prep sheet. */
export function PrepPrintButton() {
  return (
    <Button variant="dark" onClick={() => window.print()}>
      Print prep sheet
    </Button>
  );
}
