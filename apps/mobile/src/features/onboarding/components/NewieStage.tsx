import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, enterFade } from '../../../components/ui';
import { fontScaleMultiplier, useProfile } from '../../../state/profile';

/**
 * Newie's voice — the screen's CREAM counterpoint block (REVAMP-BRIEF §2):
 * warm paper fill, chunky `radius.block` corners, NO border — separation by
 * fill contrast. Black ink (`onBlock`) for the message, `creamDim` for
 * secondary text. A rounded-square avatar chip + Oswald micro-label
 * ("NEWIE · COACH") attribute the message; the chat-app behavior survives:
 * a short typing indicator, then the FULL text lands at once as plain,
 * always-visible AppText. NOTHING else is ever hidden or gated; inputs and
 * buttons stay on screen.
 */

const MASCOT = require('../../../../assets/images/mascot.png');

/** How long Newie "types" before his line lands. */
const TYPING_MS = 650;

/** Message line height at fontScale 1 — reservation math scales with it. */
const LINE_HEIGHT = 24;

/**
 * One dot of the typing indicator — a gentle opacity wave, 400ms cycle.
 * This transient indicator is the app's one allowed repeating animation;
 * it unmounts (and is cancelled) the moment the text shows.
 */
function TypingDot({ index }: { index: number }) {
  const pulse = useSharedValue(0.35);
  useEffect(() => {
    pulse.value = withDelay(
      index * 130,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 200, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.35, { duration: 200, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(pulse);
  }, [index, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[styles.dot, style]} />;
}

/**
 * Coach message card: identity strip (avatar chip + "NEWIE · COACH"), then
 * typing dots for ~650ms, then the whole message. `instant` (reactions)
 * skips the indicator and plays a one-shot squash-hop on the avatar.
 * `reserveLines` fixes the message zone height (in scaled text lines) so
 * the dots→text swap and line cycling never shift the layout below.
 */
export function CoachCard({
  text,
  caption,
  instant = false,
  showAvatar = true,
  reserveLines = 2,
  style,
}: {
  text: string;
  caption?: string;
  instant?: boolean;
  /** Hide the avatar chip where a full Newie image sits nearby (welcome). */
  showAvatar?: boolean;
  reserveLines?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const fontScale = useProfile((s) => s.fontScale);
  const lineHeight = Math.round(LINE_HEIGHT * fontScaleMultiplier(fontScale));

  // Which content is currently shown (null = typing dots). Adjusted during
  // render so a new line never flashes stale text for a frame.
  const [shownText, setShownText] = useState<string | null>(instant ? text : null);
  if (instant) {
    if (shownText !== text) setShownText(text);
  } else if (shownText !== null && shownText !== text) {
    setShownText(null);
  }

  useEffect(() => {
    if (instant) return undefined;
    const t = setTimeout(() => setShownText(text), TYPING_MS);
    return () => clearTimeout(t);
  }, [text, instant]);

  const shown = shownText === text;

  // A little squash-hop on the avatar when a reaction lands. Transform-only,
  // one-shot — user-driven movement, not ambient animation.
  const hop = useSharedValue(0);
  useEffect(() => {
    if (instant) {
      hop.value = withSequence(
        withTiming(1, { duration: 110 }),
        withTiming(0, { duration: 110 }),
      );
    }
  }, [text, instant, hop]);
  const hopStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: hop.value * -3 }, { scaleY: 1 - hop.value * 0.06 }],
  }));

  return (
    <View
      style={[styles.card, style]}
      accessible
      accessibilityLabel={`Newie, your coach. ${text}${caption ? `. ${caption}` : ''}`}
    >
      <View style={styles.headerRow}>
        {showAvatar ? (
          <Animated.View style={[styles.avatar, hopStyle]}>
            <Image source={MASCOT} style={styles.avatarImg} contentFit="cover" />
          </Animated.View>
        ) : null}
        {/* Black ink on cream — never red text on cream (brief §2). */}
        <AppText variant="label" color={colors.creamDim}>
          Newie{' '}
          <AppText variant="label" color={colors.onBlock}>
            · Coach
          </AppText>
        </AppText>
      </View>

      <View style={[styles.messageSlot, { minHeight: lineHeight * reserveLines }]}>
        {shown ? (
          <Animated.View entering={enterFade()}>
            <AppText
              variant="bodyBold"
              color={colors.onBlock}
              style={{ lineHeight }}
              tabular={false}
            >
              {text}
            </AppText>
            {caption ? (
              <AppText variant="caption" color={colors.creamDim} style={styles.caption}>
                {caption}
              </AppText>
            ) : null}
          </Animated.View>
        ) : (
          // Dots row is exactly one text line tall, top-aligned — they sit
          // precisely where the first line of type will land.
          <View style={[styles.dots, { height: lineHeight }]}>
            <TypingDot index={0} />
            <TypingDot index={1} />
            <TypingDot index={2} />
          </View>
        )}
      </View>
    </View>
  );
}

/** Coach card + answers. Children (answers) always render right below. */
export function NewieStage({
  text,
  caption,
  mood = 'ask',
  children,
}: {
  text: string;
  caption?: string;
  mood?: 'ask' | 'react';
  children?: React.ReactNode;
}) {
  return (
    <View>
      <CoachCard
        text={text}
        caption={caption}
        instant={mood === 'react'}
        style={styles.stageCard}
      />
      {children ? <View>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Cream color block: chunky corners, flat fill, no border (brief §1/§3).
  card: {
    backgroundColor: colors.blockCream,
    borderRadius: radius.block,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  // Zoomed head-and-shoulders crop of the square bust — reads like a real
  // profile photo at chip size instead of a tiny full figure.
  avatarImg: { width: '150%', height: '150%', marginLeft: '-25%' },

  messageSlot: { marginTop: spacing.sm },
  caption: { marginTop: spacing.xs },

  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.creamDim,
  },

  // Onboarding rhythm: question card, then answers directly below.
  stageCard: { marginTop: spacing.md, marginBottom: spacing.lg },
});
