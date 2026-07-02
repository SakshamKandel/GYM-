import { StyleSheet, View } from 'react-native';
import { spacing } from '@gym/ui-tokens';
import { AppText } from './AppText';

/** Section header: uppercase micro-label with breathing room. */
const styles = StyleSheet.create({
  wrap: { marginTop: spacing.xl, marginBottom: spacing.md },
});

export function SectionLabel({ children }: { children: string }) {
  return (
    <View style={styles.wrap}>
      <AppText variant="label">{children}</AppText>
    </View>
  );
}
