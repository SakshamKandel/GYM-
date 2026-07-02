import { StyleSheet, View } from 'react-native';
import { colors } from '@gym/ui-tokens';

/** 1px hairline — the app uses dividers, not nested cards. */
const styles = StyleSheet.create({
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});

export function Divider() {
  return <View style={styles.line} />;
}
