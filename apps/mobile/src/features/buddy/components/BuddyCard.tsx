import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import type { BuddyEvent, BuddyLink } from '../../../lib/api/client';
import { AppText, Button, enterFade, PressableScale, TierAvatarFrame } from '../../../components/ui';
import { todayIso } from '../../../lib/dates';
import { removeLink, sendNudge } from '../actions';
import { avatarLetter, lastTrainedLabel, weekDots } from '../logic';

/**
 * One buddy, one card: who they are, whether they showed up this week
 * (7 Mon–Sun dots — status at a glance beats a timeline), and one action:
 * the nudge. Long-press reveals the quiet unlink option.
 */

interface Props {
  link: BuddyLink;
  events: BuddyEvent[];
  /** Already nudged today (persisted per-day ledger). */
  nudged: boolean;
  /** Called after a successful unlink so the screen reloads. */
  onChanged: () => void;
}

const DOT = 8;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  who: { flex: 1 },
  whoNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  whoNameText: { flexShrink: 1 },
  dotRow: { flexDirection: 'row', gap: 4 },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.surfaceRaised,
  },
  dotOn: { backgroundColor: colors.accent },
  nudgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  nudgeBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeBtnDone: { backgroundColor: colors.accent },
  removeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  removeCaption: { flex: 1 },
  smallBtn: { minHeight: 48, paddingHorizontal: 20 },
});

export function BuddyCard({ link, events, nudged, onChanged }: Props) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const today = todayIso();

  const dots = useMemo(
    () => weekDots(events, link.buddy.id, today),
    [events, link.buddy.id, today],
  );
  const trained = useMemo(
    () => lastTrainedLabel(events, link.buddy.id, today),
    [events, link.buddy.id, today],
  );

  const nudge = (): void => {
    if (nudged) return;
    // The per-day ledger flips via the store on success (or on 429).
    void sendNudge(link.linkId);
  };

  const remove = (): void => {
    if (removing) return;
    setRemoving(true);
    void (async () => {
      const ok = await removeLink(link.linkId);
      setRemoving(false);
      if (ok) onChanged();
      else setConfirmRemove(false);
    })();
  };

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Buddy ${link.buddy.displayName}, ${trained}. Long press for options`}
      haptic={false}
      pressScale={0.99}
      onLongPress={() => setConfirmRemove((v) => !v)}
      style={styles.card}
    >
      <View style={styles.topRow}>
        {/* Tier identity on avatar rows = the STATIC ring on the avatar ONLY
            (design law) — list surface, so no glow/animation, no shield. */}
        <TierAvatarFrame tier={link.buddy.tier} size={48}>
          <View style={styles.avatar}>
            <AppText variant="bodyBold">{avatarLetter(link.buddy.displayName)}</AppText>
          </View>
        </TierAvatarFrame>
        <View style={styles.who}>
          <View style={styles.whoNameRow}>
            <AppText variant="bodyBold" numberOfLines={1} style={styles.whoNameText}>
              {link.buddy.displayName}
            </AppText>
          </View>
          <AppText variant="caption">{trained}</AppText>
        </View>
        <View
          style={styles.dotRow}
          accessibilityLabel={`Trained ${dots.filter(Boolean).length} of 7 days this week`}
        >
          {dots.map((on, i) => (
            <View key={i} style={[styles.dot, on && styles.dotOn]} />
          ))}
        </View>
      </View>

      <View style={styles.nudgeRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={
            nudged
              ? `Nudged ${link.buddy.displayName} today`
              : `Nudge ${link.buddy.displayName}`
          }
          accessibilityState={{ disabled: nudged }}
          onPress={nudge}
          style={[styles.nudgeBtn, nudged && styles.nudgeBtnDone]}
        >
          <Ionicons
            name={nudged ? 'flash' : 'flash-outline'}
            size={22}
            color={nudged ? colors.onAccent : colors.text}
          />
        </PressableScale>
        <AppText variant="caption">
          {nudged ? 'Nudged today' : 'Nudge them to train'}
        </AppText>
      </View>

      {confirmRemove ? (
        <Animated.View entering={enterFade(0)} style={styles.removeRow}>
          <AppText variant="caption" style={styles.removeCaption}>
            Remove this buddy?
          </AppText>
          <Button
            label="Keep"
            variant="ghost"
            style={styles.smallBtn}
            onPress={() => setConfirmRemove(false)}
          />
          <Button
            label="Remove"
            variant="danger"
            loading={removing}
            style={styles.smallBtn}
            onPress={remove}
          />
        </Animated.View>
      ) : null}
    </PressableScale>
  );
}
