import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';

/**
 * Newie's speech bubble — deliberately simple. The bubble types its line
 * out (tap it to finish instantly); NOTHING else is ever hidden or gated,
 * so inputs and buttons are always on screen.
 */

const NEWIE = require('../../../../assets/images/newie.png');

/** Typewriter text. Reserves full height up front so layout never jumps. */
export function Bubble({
  text,
  caption,
  instant = false,
}: {
  text: string;
  caption?: string;
  instant?: boolean;
}) {
  const [chars, setChars] = useState(instant ? text.length : 0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (instant) {
      setChars(text.length);
      return;
    }
    setChars(0);
    timer.current = setInterval(() => {
      setChars((c) => {
        if (c >= text.length) {
          if (timer.current) clearInterval(timer.current);
          return c;
        }
        return c + 1;
      });
    }, 28);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [text, instant]);

  return (
    <Pressable
      accessibilityRole="text"
      accessibilityLabel={text}
      onPress={() => setChars(text.length)}
      style={styles.bubble}
    >
      {/* Invisible copy fixes the final size; the typed copy paints over it. */}
      <View>
        <AppText variant="bodyBold" style={[styles.line, styles.ghost]} tabular={false}>
          {text}
        </AppText>
        <AppText variant="bodyBold" style={[styles.line, styles.typed]} tabular={false}>
          {text.slice(0, chars)}
        </AppText>
      </View>
      {caption ? (
        <AppText variant="caption" style={styles.caption}>
          {caption}
        </AppText>
      ) : null}
    </Pressable>
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
        <Bubble text={text} caption={caption} instant={mood === 'react'} />
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
  bubble: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  line: { fontSize: 17, lineHeight: 24 },
  ghost: { opacity: 0 },
  typed: { position: 'absolute', top: 0, left: 0, right: 0 },
  caption: { marginTop: spacing.sm },
  answers: {},
});
