import { orderNumber } from '@gym/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader } from '@/components/console';
import { getDb } from '@/lib/db';
import {
  loadPartnerDisputes,
  loadPartnerRatingSummary,
  requirePartnerPage,
  type PartnerDisputeRow,
  type PartnerRatingSummary,
} from '../_data';
import {
  DISPUTE_REASON_LABEL,
  DISPUTE_STATUS_LABEL,
  DISPUTE_STATUS_TONE,
  formatDateLabel,
  formatKtmDateTime,
  formatMoney,
  starRow,
  windowShort,
} from '../_format';
import styles from './feedback.module.css';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Customer feedback' };
export const dynamic = 'force-dynamic';

/**
 * What customers said about this kitchen: their star ratings, the notes they
 * wrote, and any problem they reported.
 *
 * All three already existed in the product and none of them reached the
 * restaurant. Stars were folded into public discovery only, notes were stored
 * and never shown to anyone who could act on them, and a reported problem went
 * straight to staff, so the one party who could actually explain what happened
 * to the food never learned there was a complaint.
 *
 * Read-only by design. A rating cannot be edited or answered inline (that would
 * be a restaurant editing its own reviews), and a reported problem is decided by
 * the platform team, never here. What the page does give is the order it is
 * about and a way to write to the team about it.
 */
export default async function PartnerFeedbackPage() {
  const { partnerId, partnerName } = await requirePartnerPage();
  const db = getDb();

  const [ratings, disputes] = await Promise.all([
    loadPartnerRatingSummary(db, partnerId),
    loadPartnerDisputes(db, partnerId),
  ]);

  const liveDisputes = disputes.filter((d) => d.status === 'open' || d.status === 'reviewing');
  const settledDisputes = disputes.filter((d) => d.status !== 'open' && d.status !== 'reviewing');

  return (
    <div className={styles.page}>
      <PageHeader
        title="Customer feedback"
        subtitle={`${partnerName} · What customers rated, what they wrote, and anything they reported.`}
      />

      <RatingCard ratings={ratings} />

      <section className={styles.section} aria-labelledby="notes-title">
        <h2 id="notes-title" className={styles.sectionTitle}>
          What customers wrote
        </h2>
        {ratings.recent.length === 0 ? (
          <EmptyState
            title="No written notes yet"
            description="When a customer adds a note to their rating, it shows up here with the order it was about."
          />
        ) : (
          <div className={styles.noteGrid}>
            {ratings.recent.map((note) => (
              <Card key={note.orderId}>
                <div className={styles.noteHead}>
                  <span
                    className={styles.stars}
                    role="img"
                    aria-label={`${note.stars} out of 5`}
                  >
                    {starRow(note.stars)}
                  </span>
                  <span className={styles.noteWhen}>{formatKtmDateTime(note.createdAt)}</span>
                </div>
                <p className={styles.noteBody}>{note.note}</p>
                <p className={styles.noteOrder}>
                  {orderNumber(note.orderId)} · {formatDateLabel(note.deliveryDate)} ·{' '}
                  {windowShort(note.window)}
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="problems-title">
        <div className={styles.sectionHead}>
          <h2 id="problems-title" className={styles.sectionTitle}>
            Reported problems
          </h2>
          {liveDisputes.length > 0 ? (
            <Badge tone="critical">
              {liveDisputes.length} still open
            </Badge>
          ) : null}
        </div>
        <p className={styles.sectionCopy}>
          A customer can report a problem with a delivered order. The platform team decides what
          happens next, including any refund. You cannot change a report here, but you can see it and
          tell the team your side.
        </p>

        {disputes.length === 0 ? (
          <EmptyState
            title="Nothing reported"
            description="No customer has reported a problem with one of your orders."
          />
        ) : (
          <div className={styles.disputeStack}>
            {[...liveDisputes, ...settledDisputes].map((d) => (
              <DisputeCard key={d.id} dispute={d} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RatingCard({ ratings }: { ratings: PartnerRatingSummary }) {
  if (ratings.count === 0) {
    return (
      <Card>
        <div className={styles.emptyRating}>
          <h2 className={styles.sectionTitle}>No ratings yet</h2>
          <p className={styles.sectionCopy}>
            Customers can rate an order once it is delivered. Your average shows up here as soon as
            the first one lands.
          </p>
        </div>
      </Card>
    );
  }

  const most = Math.max(...ratings.distribution.map((d) => d.count), 1);

  return (
    <Card>
      <div className={styles.ratingCard}>
        <div className={styles.ratingHero}>
          <div className={styles.ratingAverage}>{ratings.average.toFixed(1)}</div>
          <div className={styles.stars} aria-hidden="true">
            {starRow(ratings.average)}
          </div>
          <div className={styles.ratingCount}>
            {ratings.count} rating{ratings.count === 1 ? '' : 's'}
          </div>
        </div>
        <ul className={styles.spread}>
          {ratings.distribution.map((row) => (
            <li key={row.stars} className={styles.spreadRow}>
              <span className={styles.spreadLabel}>{row.stars}</span>
              <span className={styles.spreadTrack}>
                <span
                  className={styles.spreadFill}
                  style={{ width: `${Math.round((row.count / most) * 100)}%` }}
                />
              </span>
              <span className={styles.spreadCount}>{row.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function DisputeCard({ dispute }: { dispute: PartnerDisputeRow }) {
  const code = orderNumber(dispute.orderId);
  return (
    <Card>
      <div className={styles.disputeHead}>
        <div className={styles.disputeTitleGroup}>
          <strong className={styles.disputeReason}>{DISPUTE_REASON_LABEL[dispute.reason]}</strong>
          <Badge tone={DISPUTE_STATUS_TONE[dispute.status]}>
            {DISPUTE_STATUS_LABEL[dispute.status]}
          </Badge>
        </div>
        <span className={styles.disputeWhen}>{formatKtmDateTime(dispute.createdAt)}</span>
      </div>

      <p className={styles.disputeOrder}>
        {code} · {formatDateLabel(dispute.deliveryDate)} · {windowShort(dispute.window)} ·{' '}
        {formatMoney(dispute.totalMinor, dispute.currency)}
      </p>

      {dispute.note ? (
        <blockquote className={styles.disputeNote}>
          <span className={styles.disputeNoteLabel}>What the customer said</span>
          {dispute.note}
        </blockquote>
      ) : (
        <p className={styles.disputeNoteEmpty}>The customer did not add any details.</p>
      )}

      {dispute.resolution ? (
        <blockquote className={styles.disputeResolution}>
          <span className={styles.disputeNoteLabel}>
            What the team decided
            {dispute.decidedAt ? ` on ${formatKtmDateTime(dispute.decidedAt)}` : ''}
          </span>
          {dispute.resolution}
        </blockquote>
      ) : null}

      <Link
        href={`/partner/support?about=${encodeURIComponent(code)}`}
        className={styles.disputeAction}
      >
        Tell the team your side
      </Link>
    </Card>
  );
}
