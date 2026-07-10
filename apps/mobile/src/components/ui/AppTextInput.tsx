import { forwardRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import { colors, radius, spacing, type } from '@gym/ui-tokens';

/**
 * The app's only text input. Block language: filled charcoal
 * (`surfaceRaised`) rounded field, NO border at rest — a 2px accent ring
 * appears only on focus. 56dp tall. The browser's default focus ring
 * (the golden outline) is explicitly disabled on web.
 */

const killWebOutline =
  Platform.OS === 'web'
    ? ({ outlineWidth: 0, outlineStyle: 'none' } as unknown as TextStyle)
    : null;

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surfaceRaised,
    // Constant 2px border (transparent at rest) so focus never shifts layout.
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: radius.lg,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    fontFamily: type.body,
    fontSize: type.size.body,
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
