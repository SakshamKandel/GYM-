import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { AppText, Tag } from '../../../components/ui';
import type { CoachTier } from '../api';

/**
 * Coach seniority badge + verified mark — shared by the discovery cards and
 * the public profile hero so the elite/gold/silver color coding never drifts.
 * Seniority is NOT a billing tier (see coach_profiles.coachTier).
 *
 * - elite  → accent-filled pill (black ink — black-on-red law)
 * - gold   → cream-filled pill
 * - silver → quiet dim pill
 */
export function CoachTierBadge({ tier }: { tier: CoachTier }) {
  if (tier === 'elite') return <Tag label="Elite" variant="filled" color={colors.accent} />;
  if (tier === 'gold') return <Tag label="Gold" variant="filled" color={colors.blockCream} />;
  return <Tag label="Silver" variant="dim" />;
}

const styles = StyleSheet.create({
  verified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
  verifiedText: {
    fontFamily: type.display,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});

/**
 * "Verified" mark — every coach surfaced by /api/coaches holds the reviewed
 * staff coach role, so the public profile states it explicitly.
 * `tone='onBlock'` renders the near-black pill for use inside the red hero.
 */
export function VerifiedMark({ tone = 'surface' }: { tone?: 'surface' | 'onBlock' }) {
  const bg = tone === 'onBlock' ? colors.onBlock : colors.surfaceRaised;
  const ink = tone === 'onBlock' ? colors.text : colors.textDim;
  return (
    <View
      style={[styles.verified, { backgroundColor: bg }]}
      accessible
      accessibilityLabel="Verified coach"
    >
      <Ionicons name="shield-checkmark" size={12} color={colors.success} />
      <AppText tabular={false} numberOfLines={1} style={[styles.verifiedText, { color: ink }]}>
        Verified
      </AppText>
    </View>
  );
}
