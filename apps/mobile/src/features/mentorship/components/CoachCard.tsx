import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, IconChip, PressableScale, Tag } from '../../../components/ui';
import type { CoachCardData } from '../api';
import { pushPath } from '../nav';

/**
 * One coach in the discovery hub — a charcoal row card (block language:
 * borderless, separation by fill contrast): 52dp avatar block, name +
 * one-line headline, up to three specialty pills (+N overflow), and an
 * availability tag on the right rail. The whole row taps through to the
 * coach's profile.
 */

const AVATAR = 52;
const MAX_SPECIALTIES = 3;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    // Nested-tile radius — matches IconChip's rounded square (brief §3).
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  main: { flex: 1, gap: 2 },
  specialties: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  rail: { flexShrink: 0, alignItems: 'flex-end' },
});

export function CoachCard({ coach }: { coach: CoachCardData }) {
  const accepting = coach.acceptingClients && coach.hasCapacity;
  const shown = coach.specialties.slice(0, MAX_SPECIALTIES);
  const overflow = coach.specialties.length - shown.length;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${coach.displayName}. ${coach.headline}. ${
        accepting ? 'Accepting clients' : 'Not taking clients'
      }. View profile`}
      onPress={() => pushPath(`/coaches/${coach.id}`)}
      style={styles.row}
    >
      {coach.avatarUrl !== null ? (
        <Image
          source={{ uri: coach.avatarUrl }}
          style={styles.avatar}
          contentFit="cover"
          accessibilityElementsHidden
        />
      ) : (
        <IconChip icon="person" size={AVATAR} />
      )}

      <View style={styles.main}>
        <AppText variant="bodyBold" numberOfLines={1}>
          {coach.displayName}
        </AppText>
        <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
          {coach.headline}
        </AppText>
        {shown.length > 0 ? (
          <View style={styles.specialties}>
            {shown.map((s) => (
              <Tag key={s} label={s} variant="dim" />
            ))}
            {overflow > 0 ? <Tag label={`+${overflow}`} variant="dim" /> : null}
          </View>
        ) : null}
      </View>

      <View style={styles.rail}>
        {accepting ? (
          <Tag label="Accepting" variant="outline" color={colors.success} />
        ) : (
          <Tag label="Full" variant="dim" />
        )}
      </View>
    </PressableScale>
  );
}
