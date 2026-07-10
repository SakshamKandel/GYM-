import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import { AppText, enterFade, PressableScale } from '../../../components/ui';

/**
 * Form field in the block language (REVAMP-BRIEF §1/§2): filled charcoal
 * (`surfaceRaised`) rounded field with NO stroke at rest — separation comes
 * from fill contrast. A 2px accent ring eases in on focus (a direct response
 * to the user tapping in; the constant transparent border means focus never
 * shifts layout), errors swap it for the error colour, and the error text
 * fades in rather than popping. Reduced motion snaps to the final state.
 * `secure` adds a 48dp show/hide toggle so passwords are checkable before
 * submitting.
 */

interface Props extends Omit<TextInputProps, 'style' | 'secureTextEntry'> {
  label: string;
  error?: string | null;
  secure?: boolean;
}

// Browsers draw their own focus outline on <input>; the red border replaces it.
const webOutlineFix: TextStyle | null =
  Platform.OS === 'web' ? ({ outlineWidth: 0 } as TextStyle) : null;

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  frame: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    // Constant 2px border (transparent at rest) so focus never shifts layout.
    borderWidth: 2,
    borderColor: 'transparent',
  },
  frameError: { borderColor: colors.error },
  input: {
    flex: 1,
    minHeight: touch.primary,
    paddingHorizontal: spacing.lg,
    fontFamily: type.body,
    fontSize: type.size.body,
    color: colors.text,
  },
  eyeBtn: {
    width: touch.min,
    height: touch.min,
    marginRight: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export function AuthField({ label, error, secure = false, ...inputProps }: Props) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const reduceMotion = useReducedMotion();

  // 0 = resting (invisible ring), 1 = accent. Eases on focus. An error border
  // is a static style used INSTEAD of the animated one (never layered on top)
  // so reanimated's UI-thread writes can't fight the error colour.
  const focus = useSharedValue(0);
  useEffect(() => {
    const to = focused ? 1 : 0;
    focus.value = reduceMotion ? to : withTiming(to, { duration: 150 });
  }, [focused, reduceMotion, focus]);
  const borderStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.value, [0, 1], ['transparent', colors.accent]),
  }));

  return (
    <View style={styles.wrap}>
      <AppText variant="label">{label}</AppText>
      <Animated.View
        style={[styles.frame, error ? styles.frameError : borderStyle]}
      >
        <TextInput
          {...inputProps}
          secureTextEntry={secure && hidden}
          placeholderTextColor={colors.textFaint}
          style={[styles.input, webOutlineFix]}
          onFocus={(e) => {
            setFocused(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            inputProps.onBlur?.(e);
          }}
        />
        {secure ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            onPress={() => setHidden((h) => !h)}
            style={styles.eyeBtn}
          >
            <Ionicons
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={22}
              color={colors.textDim}
            />
          </PressableScale>
        ) : null}
      </Animated.View>
      {error ? (
        <Animated.View entering={enterFade()}>
          <AppText variant="body" color={colors.error}>
            {error}
          </AppText>
        </Animated.View>
      ) : null}
    </View>
  );
}
