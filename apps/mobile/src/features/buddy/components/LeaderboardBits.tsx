import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ordinalLabel } from '@gym/shared';
import { colors, radius, type } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import { MEDAL_DISC } from '../../../components/ui/badges/achievementMetals';

/**
 * Shared consistency-board row pieces used by BOTH the buddy leaderboard and
 * the public gym board so the two read as one system: a flat metal medal
 * disc for positions 1–3 (ties share a medal — competition ranking) and a
 * quiet ▲/▼ movement caption. Flat fills only — no glow, no gradients.
 */

// Flat metal fills for the 1st/2nd/3rd medal discs — same metal family as
// the earned-rank emblems, sourced from the shared achievement palette
// (no raw hex in feature files), deliberately NOT the accent red.
const MEDAL_FILL: Record<number, string> = {
  1: MEDAL_DISC.gold,
  2: MEDAL_DISC.silver,
  3: MEDAL_DISC.bronze,
};

/**
 * Position marker: medal disc for 1–3 (ties included), Oswald ordinal after
 * (ranks are numbers — condensed display type, brief §4). `ink` recolors the
 * ordinal for rows on a colored block (the red me-row passes `onBlock`).
 */
export function PositionMarker({
  position,
  ink,
}: {
  position: number;
  ink?: string | undefined;
}) {
  const fill = MEDAL_FILL[position];
  if (!fill) {
    return (
      <AppText tabular color={ink ?? colors.textDim} style={styles.ordinal}>
        {ordinalLabel(position)}
      </AppText>
    );
  }
  return (
    <View
      style={[styles.medal, { backgroundColor: fill }]}
      accessible
      accessibilityLabel={ordinalLabel(position)}
    >
      <AppText style={styles.medalText} tabular>
        {position}
      </AppText>
    </View>
  );
}

/**
 * Quiet movement caption vs. a week ago: ▲n climbed / ▼n slipped / – held /
 * "new" (wasn't on the board a week ago). Render only when the board has
 * movement data at all — the caller gates with `available`.
 */
export function MovementMark({ delta, available }: { delta: number | null; available: boolean }) {
  if (!available) return null;
  // textDim (not textFaint) keeps these 13px marks ≥4.5:1 on charcoal rows
  // and on the near-black pill the red me-row wraps them in.
  if (delta === null) {
    return (
      <AppText variant="caption" color={colors.textDim} style={styles.movementText}>
        new
      </AppText>
    );
  }
  if (delta === 0) {
    return (
      <AppText variant="caption" color={colors.textDim} style={styles.movementText}>
        –
      </AppText>
    );
  }
  const up = delta > 0;
  return (
    <View
      style={styles.movementRow}
      accessible
      accessibilityLabel={up ? `Up ${delta} since last week` : `Down ${-delta} since last week`}
    >
      <Ionicons
        name={up ? 'caret-up' : 'caret-down'}
        size={11}
        color={up ? colors.success : colors.textDim}
      />
      <AppText variant="caption" tabular color={up ? colors.success : colors.textDim}>
        {Math.abs(delta)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  // Oswald rank ordinal — condensed display numerals, tabular so a column
  // of ranks never jitters.
  ordinal: {
    fontFamily: type.display,
    fontSize: 16,
    letterSpacing: 0.5,
  },
  medal: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalText: {
    fontFamily: type.display,
    fontSize: 14,
    color: colors.bg,
  },
  movementRow: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  movementText: { minWidth: 14, textAlign: 'right' },
});
