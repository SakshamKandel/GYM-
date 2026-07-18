import type { ReactElement, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '@gym/ui-tokens';

/** Screen shell: near-black canvas (`colors.bg`), 20px gutters, safe-area aware. */

interface Props {
  children: ReactNode;
  scroll?: boolean;
  /** Wraps the scroll view in a KeyboardAvoidingView so inputs stay visible. */
  keyboardAware?: boolean;
  /** Extra bottom padding so content clears a pinned action bar. */
  bottomInset?: number;
  /** Pull-to-refresh control (RefreshControl) — scroll screens only. */
  refreshControl?: ReactElement<RefreshControlProps>;
  style?: StyleProp<ViewStyle>;
  edges?: { top?: boolean; bottom?: boolean };
}

/** Breathing room above the first element — even when safe-area insets are 0
 * (web, devtools) content must never kiss the top edge. */
const TOP_AIR = 16;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.gutter,
    // Keep phone-first line lengths on wide viewports (web/tablet).
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
});

export function Screen({
  children,
  scroll = false,
  keyboardAware = false,
  bottomInset = 0,
  refreshControl,
  style,
  edges,
}: Props) {
  const insets = useSafeAreaInsets();
  const padTop = edges?.top === false ? 0 : insets.top + TOP_AIR;
  const padBottom = (edges?.bottom === false ? 0 : insets.bottom) + bottomInset;

  if (scroll) {
    const scrollView = (
      <ScrollView
        style={styles.root}
        contentContainerStyle={[
          styles.content,
          { paddingTop: padTop, paddingBottom: padBottom + 24 },
          style,
        ]}
        showsVerticalScrollIndicator={false}
        // Always 'handled' (not just when keyboardAware): with the default
        // ('never') a ScrollView eats the FIRST tap on any focusable child
        // while the keyboard is open — the classic "I have to tap twice / my
        // typing didn't register" symptom. 'handled' lets buttons/inputs take
        // the tap first and only dismisses the keyboard on taps to empty space.
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        {children}
      </ScrollView>
    );

    if (keyboardAware) {
      return (
        <KeyboardAvoidingView
          style={styles.root}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? padTop : 0}
        >
          {scrollView}
        </KeyboardAvoidingView>
      );
    }
    return scrollView;
  }
  if (keyboardAware) {
    return (
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? padTop : 0}
      >
        <View
          style={[
            styles.root,
            styles.content,
            { paddingTop: padTop, paddingBottom: padBottom },
            style,
          ]}
        >
          {children}
        </View>
      </KeyboardAvoidingView>
    );
  }
  return (
    <View
      style={[
        styles.root,
        styles.content,
        { paddingTop: padTop, paddingBottom: padBottom },
        style,
      ]}
    >
      {children}
    </View>
  );
}
