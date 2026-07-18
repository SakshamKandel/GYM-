import { ktmDateString } from '@gym/shared';
import Link from 'next/link';
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/console';
import { getDb } from '@/lib/db';
import { materializeDueOrders } from '@/lib/meals';
import { PrepPrintButton } from '../_components/PrepPrintButton';
import { loadActiveOrders, requirePartnerPage } from '../_data';
import { buildPrepSummary, formatDateLabel, windowLabel } from '../_format';
import './print.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Kitchen prep summary — the aggregated meal × quantity list the kitchen must
 * cook TODAY, split by delivery window. Built from the live (non-terminal)
 * orders for the current KTM day; only orders still awaiting cooking count
 * (pending / confirmed / preparing). Includes a print sheet.
 */
export default async function PartnerPrepPage() {
  const { partnerId, partnerName } = await requirePartnerPage();
  const db = getDb();

  await materializeDueOrders(db, { kind: 'partner', partnerId });

  const today = ktmDateString(new Date());
  const active = await loadActiveOrders(db, partnerId);
  const todays = active.filter((o) => o.deliveryDate === today);
  const summary = buildPrepSummary(todays);
  const anything = summary.some((w) => w.lines.length > 0);

  return (
    <div>
      <div className="pp-no-print">
        <PageHeader
          title="Prep summary"
          subtitle="What the kitchen needs to cook today, aggregated by delivery window."
          secondaryAction={
            <Link
              href="/partner"
              style={{ fontSize: 14, color: 'var(--gt-accent-strong)', textDecoration: 'none', fontWeight: 600 }}
            >
              Back to board
            </Link>
          }
          action={anything ? <PrepPrintButton /> : undefined}
        />
      </div>

      <div className="pp-print-area">
        <div className="pp-print-meta">
          {partnerName} · {formatDateLabel(today)}
        </div>

        {!anything ? (
          <div className="pp-no-print">
            <EmptyState
              title="Nothing to prep yet"
              description="Aggregated cook quantities appear here as today's orders come in."
            />
          </div>
        ) : (
          summary.map((win) =>
            win.lines.length === 0 ? null : (
              <Card key={win.window} padded={false} className="pp-card">
                <CardHeader
                  title={windowLabel(win.window)}
                  action={
                    <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                      {win.totalItems} item{win.totalItems === 1 ? '' : 's'} · {win.totalOrders} order
                      {win.totalOrders === 1 ? '' : 's'}
                    </span>
                  }
                />
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {win.lines.map((line) => (
                    <li
                      key={line.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '12px 18px',
                        borderBottom: '1px solid var(--gt-border)',
                      }}
                    >
                      <span style={{ fontSize: 15 }}>{line.name}</span>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                        <span style={{ fontSize: 12, color: 'var(--gt-text-faint)' }}>
                          {line.orders} order{line.orders === 1 ? '' : 's'}
                        </span>
                        <strong className="gt-numeric" style={{ fontSize: 20 }}>
                          ×{line.qty}
                        </strong>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ),
          )
        )}
      </div>
    </div>
  );
}
