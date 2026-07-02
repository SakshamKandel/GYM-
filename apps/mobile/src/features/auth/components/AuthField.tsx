import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import { AppText, PressableScale } from '../../../components/ui';

/**
 * Form field per the brief: surface background, radius.lg, 16px Poppins,
 * red border on focus, inline error caption. `secure` adds a 48dp
 * show/hide toggle so passwords are checkable before submitting.
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
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  frameFocused: { borderColor: colors.accent },
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

  return (
    <View style={styles.wrap}>
      <AppText variant="label">{label}</AppText>
      <View
        style={[
          styles.frame,
          focused && styles.frameFocused,
          error ? styles.frameError : null,
        ]}
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
      </View>
      {error ? (
        <AppText variant="caption" color={colors.error}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
