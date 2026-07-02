import { forwardRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import { colors, radius, type } from '@gym/ui-tokens';

/**
 * The app's only text input. Minimal by design: surface block, hairline
 * border that turns accent on focus — and the browser's default focus ring
 * (the golden outline) is explicitly disabled on web.
 */

const killWebOutline =
  Platform.OS === 'web'
    ? ({ outlineWidth: 0, outlineStyle: 'none' } as unknown as TextStyle)
    : null;

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    minHeight: 56,
    paddingHorizontal: 18,
    fontFamily: type.body,
    fontSize: 16,
    color: colors.text,
  },
  focused: { borderColor: colors.accent },
});

export const AppTextInput = forwardRef<TextInput, TextInputProps>(function AppTextInput(
  { style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.textFaint}
      selectionColor={colors.accent}
      {...rest}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[styles.input, killWebOutline, focused && styles.focused, style]}
    />
  );
});
