import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from '../ui';

interface Props {
  /** Short, concrete status text for the startup gate currently in progress. */
  message?: string;
}

/**
 * A purposeful first frame for the brief periods where fonts, persisted state,
 * or app-security preferences are still loading. It keeps cold starts from
 * presenting an empty dark canvas.
 */
export function AppStartupScreen({ message = 'Getting your training ready' }: Props) {
  return (
    <View accessibilityLabel={message} accessibilityLiveRegion="polite" style={styles.root}>
      <View style={styles.content}>
        <View style={styles.mark}>
          <Ionicons name="flash" size={24} color={colors.onBlock} />
        </View>
        <View style={styles.copy}>
          <AppText variant="label" color={colors.accent} center>
            GYM TRACKER
          </AppText>
          <AppText variant="title" center>
            {message}
          </AppText>
        </View>
        <ActivityIndicator accessibilityLabel="Loading" color={colors.accent} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: spacing.gutter,
  },
  content: {
    width: '100%',
    maxWidth: 300,
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.xxl,
    borderRadius: radius.block,
    backgroundColor: colors.surface,
  },
  mark: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.blockRed,
  },
  copy: { alignItems: 'center', gap: spacing.xs },
});
