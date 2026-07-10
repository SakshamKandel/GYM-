import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  badgeProgress,
  type BadgeDef,
  type BadgeFamily,
  type BadgeProgress,
  type BadgeProgressStats,
} from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Sheet } from '../../../components/ui';
import { BadgeMedal } from '../../../components/ui/badges/BadgeMedal';
import type { AwardedBadge } from '../../../lib/api/badges';

/**
 * Badge detail sheet — tap any tile on the Badges screen to see what the
 * badge means, when it was earned (and coach-verified, for strength clubs),
 * or — for locked threshold badges — a quiet progress bar toward it, fed by
 * the pure badgeProgress() evaluator over the caller's OWN stats snapshot.
 *
 * Personal-only surface (design law 5): only ever rendered for the caller's
 * own badges/stats. Restrained block language (REVAMP-BRIEF): eyebrow family
 * label over the badge title beside the medal, and the status/progress area
 * as a raised charcoal inner tile (`radius.md`, fill contrast, no border) —
 * no glow, no animation.
 */

export const BADGE_FAMILY_LABEL: Record<BadgeFamily, string> = {
  strength: 'Strength clubs',
  consistency: 'Consistency',
  mileage: 'Iron mileage',
  records: 'Records',
  crew: 'Coach & crew',
};

interface Props {
  visible: boolean;
  onClose: () => void;
  badge: BadgeDef | null;
  /** The caller's awarded row for this badge, if earned. */
  earned: AwardedBadge | null;
  /** Own stats snapshot — null (old server / first offline run) hides progress. */
  stats: BadgeProgressStats | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "82.5" / "42,000" — whole numbers stay whole, big numbers get separators. */
function formatAmount(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function progressLine(p: BadgeProgress): string {
  return `${formatAmount(Math.min(p.current, p.target))} / ${formatAmount(p.target)} ${p.unit}`;
}

export function BadgeDetailSheet({ visible, onClose, badge, earned, stats }: Props) {
  if (badge === null) {
    return (
      <Sheet visible={visible} onClose={onClose}>
        <View />
      </Sheet>
    );
  }

  const isEarned = earned !== null;
  const isVerified = earned?.status === 'verified';
  const progress = !isEarned && stats !== null ? badgeProgress(badge, stats) : null;
  const ratio =
    progress !== null && progress.target > 0
      ? Math.max(0, Math.min(1, progress.current / progress.target))
      : 0;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.headRow}>
        <BadgeMedal badge={badge} status={earned?.status ?? 'locked'} size={64} />
        <View style={styles.headInfo}>
          <AppText variant="label">{BADGE_FAMILY_LABEL[badge.family]}</AppText>
          <AppText variant="title">{badge.name}</AppText>
        </View>
      </View>

      <AppText variant="body" color={colors.textDim} style={styles.description}>
        {badge.description}
      </AppText>

      {isEarned ? (
        <View style={styles.statusTile}>
          <View style={styles.statusRow}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <AppText variant="body" color={colors.text}>
              Earned {formatDate(earned.earnedAt)}
            </AppText>
          </View>
          {isVerified ? (
            <View style={styles.statusRow}>
              <Ionicons name="shield-checkmark" size={16} color={colors.success} />
              <AppText variant="body" color={colors.text}>
                Coach verified
                {earned.verifiedAt ? ` ${formatDate(earned.verifiedAt)}` : ''}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : progress !== null ? (
        <View
          style={styles.statusTile}
          accessible
          accessibilityLabel={`Progress: ${progressLine(progress)}`}
        >
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${ratio * 100}%` }]} />
          </View>
          <AppText variant="caption" tabular>
            {progressLine(progress)}
          </AppText>
        </View>
      ) : (
        <View style={styles.statusTile}>
          <View style={styles.statusRow}>
            <Ionicons name="lock-closed-outline" size={15} color={colors.textDim} />
            <AppText variant="caption">Not earned yet.</AppText>
          </View>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  headInfo: { flex: 1, gap: spacing.xs, minWidth: 0 },
  description: { marginBottom: spacing.lg },
  // Raised inner tile (brief §3 nested-tile geometry): separation by fill
  // contrast against the sheet's `surface` panel — never a border.
  statusTile: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Thick rounded bar (brief §7). Track drops to `surface` because the tile
  // itself is surfaceRaised — the fill-contrast inversion of the on-dark rule.
  barTrack: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
});
