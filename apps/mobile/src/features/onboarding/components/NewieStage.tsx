import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
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

/**
 * Newie's speech bubble — chat-app pattern. Per new line: a short typing
 * indicator (three dots), then the FULL text lands at once as one plain,
 * always-visible AppText. No typewriter, no transparent-text tricks.
 * NOTHING else is ever hidden or gated; inputs and buttons stay on screen.
 */

const NEWIE = require('../../../../assets/images/newie.png');

/** How long Newie "types" before his line lands. */
const TYPING_MS = 650;

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
 * Chat bubble: typing dots for ~650ms, then the whole message. `instant`
 * (reactions) skips the indicator. minHeight keeps the dots→text swap from
 * jumping; the enterFade on the text covers any growth for longer lines.
 */
export function Bubble({
  text,
  caption,
  instant = false,
}: {
  text: string;
  caption?: string;
  instant?: boolean;
}) {
  // Which line is currently shown (null = typing dots). Adjusted during
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

  return (
    <View
      style={styles.bubble}
      accessible
      accessibilityLabel={caption ? `${text} ${caption}` : text}
    >
      {shown ? (
        <Animated.View entering={enterFade()}>
          <AppText variant="bodyBold" style={styles.line} tabular={false}>
            {text}
          </AppText>
          {caption ? (
            <AppText variant="caption" style={styles.caption}>
              {caption}
            </AppText>
          ) : null}
        </Animated.View>
      ) : (
        <View style={styles.dots}>
          <TypingDot index={0} />
          <TypingDot index={1} />
          <TypingDot index={2} />
        </View>
      )}
    </View>
  );
}

/** Newie + bubble row. Children (answers) always render right below. */
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
  // A little squash-hop when he reacts to your answer. Transform-only.
  const hop = useSharedValue(0);
  useEffect(() => {
    if (mood === 'react') {
      hop.value = withSequence(
        withTiming(1, { duration: 110 }),
        withTiming(0, { duration: 110 }),
      );
    }
  }, [text, mood, hop]);
  const hopStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: hop.value * -6 }, { scaleY: 1 - hop.value * 0.06 }],
  }));

  return (
    <View>
      <View style={styles.row}>
        <Animated.View style={hopStyle}>
          <Image
            source={NEWIE}
            style={styles.newie}
            contentFit="contain"
            accessibilityLabel="Newie, your coach"
          />
        </Animated.View>
        <View style={styles.tail} />
        <View style={styles.bubbleSlot}>
          <Bubble text={text} caption={caption} instant={mood === 'react'} />
        </View>
      </View>
      {children ? <View style={styles.answers}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  newie: { width: 86, height: 138 },
  tail: {
    width: 14,
    height: 14,
    marginLeft: 2,
    marginRight: -9,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    transform: [{ rotate: '45deg' }],
    zIndex: 1,
  },
  // The row gives the bubble its width; the bubble itself never uses flex,
  // so it also lays out correctly in column containers (welcome screen).
  bubbleSlot: { flex: 1 },
  bubble: {
    minHeight: 72,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  line: { fontSize: 17, lineHeight: 24 },
  caption: { marginTop: spacing.sm },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.textDim,
  },
  answers: {},
});
