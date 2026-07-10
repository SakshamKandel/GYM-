import { useMemo, useState } from 'react';
import { type AccessibilityActionEvent, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
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
  // Rounded charcoal row-card — no border, `radius.md` list geometry so it
  // stacks with sibling rows on gaps alone (brief §11c).
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
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
  // Nudge = a pill (brief §6): raised charcoal at rest; done state flips to
  // the red fill with BLACK icon/label (black-on-red law — never white).
  nudgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.min,
    borderRadius: radius.full,
    paddingHorizontal: spacing.gutter,
    backgroundColor: colors.surfaceRaised,
    alignSelf: 'flex-start',
  },
  nudgePillDone: { backgroundColor: colors.accent },
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
  // Optimistic flip so the button reads as "nudged" in <100ms and rapid
  // re-taps can't fire duplicate POSTs before the store/prop catches up.
  const [pendingNudge, setPendingNudge] = useState(false);
  const today = todayIso();
  const showNudged = nudged || pendingNudge;

  const dots = useMemo(
    () => weekDots(events, link.buddy.id, today),
    [events, link.buddy.id, today],
  );
  const trained = useMemo(
    () => lastTrainedLabel(events, link.buddy.id, today),
    [events, link.buddy.id, today],
  );

  const nudge = (): void => {
    if (showNudged) return;
    // Flip the visual immediately; the per-day ledger flips via the store on
    // success (or on 429 = nudge_limit). Revert only on a hard failure.
    setPendingNudge(true);
    void (async () => {
      const ok = await sendNudge(link.linkId);
      if (!ok) setPendingNudge(false);
    })();
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
      // Not a button: a container that groups its children would make the
      // inner Nudge/Remove controls unreachable to VoiceOver. Keep the
      // long-press affordance for sighted users; screen readers reach the
      // same toggle via the summary row's accessibility action below.
      accessible={false}
      haptic={false}
      pressScale={0.99}
      onLongPress={() => setConfirmRemove((v) => !v)}
      style={styles.card}
    >
      <View
        style={styles.topRow}
        accessible
        accessibilityLabel={`Buddy ${link.buddy.displayName}, ${trained}, trained ${dots.filter(Boolean).length} of 7 days this week`}
        accessibilityActions={[
          {
            name: 'toggleRemove',
            label: confirmRemove ? 'Hide remove option' : 'Show remove option',
          },
        ]}
        onAccessibilityAction={(e: AccessibilityActionEvent) => {
          if (e.nativeEvent.actionName === 'toggleRemove') {
            setConfirmRemove((v) => !v);
          }
        }}
      >
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
        <View style={styles.dotRow}>
          {dots.map((on, i) => (
            <View key={i} style={[styles.dot, on && styles.dotOn]} />
          ))}
        </View>
      </View>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={
          showNudged
            ? `Nudged ${link.buddy.displayName} today`
            : `Nudge ${link.buddy.displayName}`
        }
        accessibilityState={{ disabled: showNudged }}
        onPress={nudge}
        style={[styles.nudgePill, showNudged && styles.nudgePillDone]}
      >
        <Ionicons
          name={showNudged ? 'flash' : 'flash-outline'}
          size={18}
          color={showNudged ? colors.onBlock : colors.text}
        />
        <AppText variant="bodyBold" color={showNudged ? colors.onBlock : colors.text}>
          {showNudged ? 'Nudged today' : 'Nudge'}
        </AppText>
      </PressableScale>

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
